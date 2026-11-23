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
      if (url.pathname === '/admin/liste' && req.method === 'POST') return adminListe(req, env, cors);
      if (url.pathname === '/admin/action' && req.method === 'POST') return adminAction(req, env, cors);
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
        headers: { Title: 'Nouvel avis Vid\'Antik (' + avis.note + '/5)', Click: 'https://vidantik.fr/admin.html' },
        body: avis.nom + ' : ' + avis.texte.slice(0, 200)
      });
    } catch (e) {}
  }
  return json({ ok: true }, 200, cors);
}

// Bloque l'accès admin après 10 codes faux en une heure (par adresse IP)
async function verifier(req, env) {
  let d = {};
  try { d = await req.json(); } catch (e) {}
  const ip = req.headers.get('CF-Connecting-IP') || 'inconnue';
  const cle = 'essais:' + new Date().toISOString().slice(0, 13) + ':' + ip;
  const essais = Number(await env.AVIS_KV.get(cle)) || 0;
  if (essais >= 10) return { bloque: true };
  const ok = env.ADMIN_CODE && typeof d.code === 'string' && d.code === env.ADMIN_CODE;
  if (!ok) { await env.AVIS_KV.put(cle, String(essais + 1), { expirationTtl: 3600 }); return null; }
  return d;
}

function refus(v, cors) {
  return v && v.bloque ? json({ ok: false, erreur: 'Trop d\'essais' }, 429, cors) : json({ ok: false, erreur: 'Code incorrect' }, 401, cors);
}

async function adminListe(req, env, cors) {
  const d = await verifier(req, env);
  if (!d || d.bloque) return refus(d, cors);
  return json({ ok: true, attente: await lire(env, 'attente'), publies: await lire(env, 'publies') }, 200, cors);
}

async function adminAction(req, env, cors) {
  const d = await verifier(req, env);
  if (!d || d.bloque) return refus(d, cors);
  const attente = await lire(env, 'attente');
  const publies = await lire(env, 'publies');
  const iA = attente.findIndex(a => a.id === d.id);
  const iP = publies.findIndex(a => a.id === d.id);
  if (d.action === 'publier' && iA >= 0) { publies.unshift(attente.splice(iA, 1)[0]); }
  else if (d.action === 'supprimer' && iA >= 0) { attente.splice(iA, 1); }
  else if (d.action === 'retirer' && iP >= 0) { attente.unshift(publies.splice(iP, 1)[0]); }
  else return json({ ok: false, erreur: 'Avis introuvable' }, 404, cors);
  await env.AVIS_KV.put('attente', JSON.stringify(attente));
  await env.AVIS_KV.put('publies', JSON.stringify(publies));
  return json({ ok: true }, 200, cors);
}

const PAGE_ADMIN = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://vidantik.fr/admin.html"><meta name="robots" content="noindex"></head><body><a href="https://vidantik.fr/admin.html">Administration des avis</a></body></html>`;
