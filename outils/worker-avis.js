// Vid'Antik - Worker Cloudflare "vidantik-avis"
// Reçoit les avis du formulaire vidantik.fr/avis.html, les garde en attente,
// et ne publie que ceux que Valentin valide depuis la page /admin.
//
// Réglages dans Cloudflare (Worker > Settings) :
//   - Liaison KV : nom de variable  AVIS_KV
//   - Secret      : ADMIN_CODE  (ton code perso pour la page /admin)
//   - (facultatif) Variable NTFY_TOPIC : nom d'un canal ntfy.sh pour être prévenu sur ton téléphone

const ORIGINES = ['https://vidantik.fr', 'https://www.vidantik.fr', 'https://vidantikk-oss.github.io'];
const MAX_PAR_JOUR_PAR_IP = 3;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/avis' && req.method === 'GET') return listePublique(env, cors);
      if (url.pathname === '/avis' && req.method === 'POST') return deposer(req, env, cors);
      if (url.pathname === '/admin' && req.method === 'GET') return new Response(PAGE_ADMIN, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (url.pathname === '/admin/liste' && req.method === 'POST') return adminListe(req, env);
      if (url.pathname === '/admin/action' && req.method === 'POST') return adminAction(req, env);
      return new Response('Vid\'Antik - avis', { status: 404 });
    } catch (e) {
      return json({ ok: false, erreur: 'Erreur serveur' }, 500, cors);
    }
  }
};

function corsHeaders(req) {
  const o = req.headers.get('Origin') || '';
  const ok = ORIGINES.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return {
    'Access-Control-Allow-Origin': ok ? o : ORIGINES[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {}) });
}

async function lire(env, cle) { return (await env.AVIS_KV.get(cle, 'json')) || []; }

async function listePublique(env, cors) {
  const publies = await lire(env, 'publies');
  const sortie = publies.map(a => ({ nom: a.nom, commune: a.commune, prestation: a.prestation, note: a.note, texte: a.texte, date: a.date }));
  return json(sortie, 200, Object.assign({ 'Cache-Control': 'public, max-age=60' }, cors));
}

function propre(s, max) { return String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

async function deposer(req, env, cors) {
  let d;
  try { d = await req.json(); } catch (e) { return json({ ok: false, erreur: 'Formulaire illisible' }, 400, cors); }
  if (d.site) return json({ ok: true }, 200, cors); // piège à robots
  const avis = {
    id: crypto.randomUUID(),
    nom: propre(d.nom, 40),
    commune: propre(d.commune, 60),
    prestation: propre(d.prestation, 60),
    note: Math.round(Number(d.note)),
    texte: propre(d.texte, 1200),
    date: new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }),
    recu: new Date().toISOString()
  };
  if (!avis.nom || !avis.texte || !(avis.note >= 1 && avis.note <= 5) || d.accord !== true)
    return json({ ok: false, erreur: 'Merci de remplir la note, votre prénom et votre avis.' }, 400, cors);

  const ip = req.headers.get('CF-Connecting-IP') || 'inconnue';
  const jour = new Date().toISOString().slice(0, 10);
  const cleIp = 'limite:' + jour + ':' + ip;
  const n = Number(await env.AVIS_KV.get(cleIp)) || 0;
  if (n >= MAX_PAR_JOUR_PAR_IP) return json({ ok: false, erreur: 'Vous avez déjà envoyé plusieurs avis aujourd\'hui. Merci !' }, 429, cors);
  await env.AVIS_KV.put(cleIp, String(n + 1), { expirationTtl: 86400 });

  const attente = await lire(env, 'attente');
  attente.unshift(avis);
  await env.AVIS_KV.put('attente', JSON.stringify(attente.slice(0, 200)));

  if (env.NTFY_TOPIC) {
    try {
      await fetch('https://ntfy.sh/' + env.NTFY_TOPIC, {
        method: 'POST',
        headers: { Title: 'Nouvel avis Vid\'Antik (' + avis.note + '/5)', Click: new URL(req.url).origin + '/admin' },
        body: avis.nom + ' : ' + avis.texte.slice(0, 200)
      });
    } catch (e) {}
  }
  return json({ ok: true }, 200, cors);
}

async function verifier(req, env) {
  let d = {};
  try { d = await req.json(); } catch (e) {}
  const ok = env.ADMIN_CODE && typeof d.code === 'string' && d.code === env.ADMIN_CODE;
  return ok ? d : null;
}

async function adminListe(req, env) {
  const d = await verifier(req, env);
  if (!d) return json({ ok: false, erreur: 'Code incorrect' }, 401);
  return json({ ok: true, attente: await lire(env, 'attente'), publies: await lire(env, 'publies') });
}

async function adminAction(req, env) {
  const d = await verifier(req, env);
  if (!d) return json({ ok: false, erreur: 'Code incorrect' }, 401);
  const attente = await lire(env, 'attente');
  const publies = await lire(env, 'publies');
  const iA = attente.findIndex(a => a.id === d.id);
  const iP = publies.findIndex(a => a.id === d.id);
  if (d.action === 'publier' && iA >= 0) { publies.unshift(attente.splice(iA, 1)[0]); }
  else if (d.action === 'supprimer' && iA >= 0) { attente.splice(iA, 1); }
  else if (d.action === 'retirer' && iP >= 0) { attente.unshift(publies.splice(iP, 1)[0]); }
  else return json({ ok: false, erreur: 'Avis introuvable' }, 404);
  await env.AVIS_KV.put('attente', JSON.stringify(attente));
  await env.AVIS_KV.put('publies', JSON.stringify(publies));
  return json({ ok: true });
}

const PAGE_ADMIN = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Avis - administration Vid'Antik</title>
<style>
body{font-family:system-ui,sans-serif;background:#f7f2df;color:#1f2a22;margin:0;padding:20px;max-width:760px;margin-inline:auto}
h1{color:#2d5a3a;font-size:1.5rem}h2{color:#2d5a3a;font-size:1.15rem;margin-top:32px}
.carte{background:#fffcf0;border:1px solid #d9d1b5;padding:16px;margin:12px 0;display:grid;gap:8px}
.etoiles{color:#d98e2b;font-size:1.2rem}.meta{color:#6b6b5e;font-size:.9rem}
button{font:inherit;padding:10px 16px;border:0;cursor:pointer;margin-right:8px}
.pub{background:#2d5a3a;color:#fff}.sup{background:#9b2c1c;color:#fff}.ret{background:#ddd}
input{font:inherit;padding:10px;width:220px}.vide{color:#6b6b5e;font-style:italic}
</style></head><body>
<h1>Avis clients - Vid'Antik</h1>
<div id="connexion"><p>Entre ton code administrateur :</p><input type="password" id="code"> <button class="pub" id="ok">Entrer</button><p id="msg"></p></div>
<div id="zone" hidden>
<h2>En attente de validation</h2><div id="attente"></div>
<h2>Publiés sur le site</h2><div id="publies"></div>
</div>
<script>
var code = sessionStorage.getItem('c') || '';
function el(t, c, x){ var e=document.createElement(t); if(c) e.className=c; if(x!=null) e.textContent=x; return e; }
function carte(a, boutons){
  var d=el('div','carte');
  d.appendChild(el('div','etoiles','★★★★★'.slice(0,a.note)+'☆☆☆☆☆'.slice(0,5-a.note)));
  d.appendChild(el('div','', a.texte));
  d.appendChild(el('div','meta', a.nom+(a.commune?' · '+a.commune:'')+(a.prestation?' · '+a.prestation:'')+' · '+a.date));
  var b=el('div'); boutons.forEach(function(x){ var bt=el('button',x[1],x[0]); bt.onclick=function(){ agir(a.id,x[2],x[3]); }; b.appendChild(bt); }); d.appendChild(b);
  return d;
}
function charger(){
  fetch('/admin/liste',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code})}).then(function(r){return r.json();}).then(function(d){
    if(!d.ok){ document.getElementById('msg').textContent='Code incorrect.'; sessionStorage.removeItem('c'); return; }
    sessionStorage.setItem('c',code);
    document.getElementById('connexion').hidden=true; document.getElementById('zone').hidden=false;
    var A=document.getElementById('attente'), P=document.getElementById('publies'); A.textContent=''; P.textContent='';
    if(!d.attente.length) A.appendChild(el('p','vide','Aucun nouvel avis.'));
    d.attente.forEach(function(a){ A.appendChild(carte(a,[['Publier','pub','publier'],['Supprimer','sup','supprimer','Supprimer définitivement cet avis ?']])); });
    if(!d.publies.length) P.appendChild(el('p','vide','Aucun avis publié pour l\\'instant.'));
    d.publies.forEach(function(a){ P.appendChild(carte(a,[['Retirer du site','ret','retirer']])); });
  });
}
function agir(id,action,question){
  if(question && !confirm(question)) return;
  fetch('/admin/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code,id:id,action:action})}).then(charger);
}
document.getElementById('ok').onclick=function(){ code=document.getElementById('code').value; charger(); };
document.getElementById('code').onkeydown=function(e){ if(e.key==='Enter') document.getElementById('ok').click(); };
if(code) charger();
</script></body></html>`;
