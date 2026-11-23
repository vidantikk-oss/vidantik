"""Génère les pages « Débarras à [ville] » et le bloc de liens du bas de page.

Usage (depuis la racine du site) : python3 outils/generer_pages_villes.py
- crée / met à jour une page par ville listée dans outils/villes.py (modèle : debarras-tarare.html)
- ajoute (ou remplace) le bloc « Débarras près de chez vous » sur toutes les pages du site
- met à jour sitemap.xml
"""
import html, json, re, sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from villes import VILLES, LIENS  # noqa: E402

e = lambda s: html.escape(s, quote=True)
modele = (RACINE / "debarras-tarare.html").read_text(encoding="utf-8")


def page_ville(v):
    t = modele
    t = re.sub(r"<title>.*?</title>", f"<title>Débarras {e(v['ville'])} ({v['dep']}) – débarras et nettoyage | Vid'Antik</title>", t, count=1)
    t = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="https://vidantik.fr/{v["slug"]}.html">', t, count=1)
    t = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{e(v["desc"])}">', t, count=1)
    ld = {"@context": "https://schema.org", "@type": "Service",
          "name": f"Débarras et nettoyage – {v['ville']}",
          "provider": {"@type": "LocalBusiness", "@id": "https://vidantik.fr/#entreprise", "name": "Vid'Antik",
                       "url": "https://vidantik.fr/", "telephone": "+33744433539",
                       "address": {"@type": "PostalAddress", "addressLocality": "Saint-Germain-Nuelles",
                                   "postalCode": "69210", "addressCountry": "FR"}},
          "areaServed": [{"@type": "City", "name": v["ville"]}]}
    t = re.sub(r'<script type="application/ld\+json">.*?</script>',
               lambda m: '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + "</script>", t, count=1, flags=re.S)
    t = re.sub(r"<h1>.*?</h1>", f"<h1>{e(v['h1'])}</h1>", t, count=1)
    towns = "".join(f"<li>{e(x)}</li>" for x in v["towns"])
    ville = e(v["ville"])
    contenu = (
        f'<div class="lede"><p>{e(v["p1"])}</p><p>{e(v["p2"])}</p></div>'
        '<div class="cards"><article class="card"><span class="num">1</span><h2>Débarras</h2><p>Maisons, appartements, caves, greniers, garages et locaux professionnels. <a href="debarras-maison-appartement.html">En savoir plus</a></p></article>'
        '<article class="card"><span class="num">2</span><h2>Succession</h2><p>Tri des souvenirs remis à la famille, estimation des objets, débarras et nettoyage. <a href="debarras-succession.html">En savoir plus</a></p></article>'
        '<article class="card"><span class="num">3</span><h2>Nettoyage spécialisé</h2><p><a href="nettoyage-syndrome-diogene.html">Syndrome de Diogène</a>, <a href="nettoyage-apres-sinistre.html">après sinistre</a>, remise en état avant vente ou location.</p></article></div>'
        f'<section class="block"><h2>Débarras à {ville} et alentours</h2><p>Quartiers et communes voisines où nous intervenons :</p><ul class="towns">{towns}</ul>'
        '<p>Votre commune n\'est pas dans la liste ? Nous intervenons dans toute la région : <a href="zone-intervention.html">voir la zone d\'intervention</a>.</p></section>'
        '<section class="block"><h2>Comment se passe l\'intervention ?</h2><p><b>1. Prise de contact</b> — Par téléphone ou via le formulaire en ligne. Nous convenons ensemble d\'une date de visite.</p><p><b>2. Visite et devis</b> — Évaluation sur place du volume et des contraintes d\'accès, puis devis détaillé, gratuit et sans engagement.</p><p><b>3. Tri et évacuation</b> — Tri selon vos consignes : objets conservés, dons, revente et recyclage, puis évacuation complète.</p><p><b>4. Remise des lieux</b> — Nettoyage final et restitution des clés. Les lieux vous sont rendus propres et dégagés.</p></section>'
        f'<div class="cta"><h2>Un débarras à prévoir à {ville} ?</h2><p>Visite et devis gratuits, sans engagement. Appelez Vid\'Antik ou remplissez le formulaire en ligne.</p><div class="actions"><a class="btn btn-green" href="./#contact">Demander un devis gratuit</a><a class="btn btn-line" href="tel:+33744433539"><svg aria-hidden="true"><use href="#i-phone"/></svg>07 44 43 35 39</a></div></div>\n'
    )
    t = re.sub(r'<div class="lede">.*?(?=\n    <nav class="links")', lambda m: contenu, t, count=1, flags=re.S)
    assert v["ville"] in t and "Tarare" not in t.split("<main")[1].split('<nav class="links"')[0], v["slug"]
    return t


CSS = """
/* Liens « Débarras à [ville] » du bas de page */
.villes { background: var(--paper); border-top: 1px solid var(--line); }
.villes .wrap { max-width: 1100px; padding-block: 28px; text-align: center; }
.villes h2 { font-size: 1.2rem; margin-bottom: 10px; }
.villes p { font-size: .98rem; line-height: 1.9; color: var(--muted); }
.villes a { color: var(--green); text-underline-offset: 3px; white-space: nowrap; }
.villes a:hover { color: var(--green-deep); }
"""


def bloc_liens():
    items = []
    for slug, nom, dep in LIENS:
        libelle = f"Débarras {nom}" if nom.startswith(("dans", "en ")) else f"Débarras à {nom}"
        if dep:
            libelle += f" ({dep})"
        items.append(f'<a href="{slug}.html">{e(libelle)}</a>')
    return ('<!-- villes:debut -->\n<nav class="band villes" aria-label="Débarras près de chez vous">\n  <div class="wrap">\n'
            '    <h2>Débarras près de chez vous</h2>\n    <p>' + " | ".join(items) + '</p>\n  </div>\n</nav>\n<!-- villes:fin -->\n')


def ajouter_bloc(t):
    t = re.sub(r"<!-- villes:debut -->.*?<!-- villes:fin -->\n", "", t, flags=re.S)
    if "/* Liens « Débarras à [ville] »" not in t:
        t = t.replace("</style>\n</head>", CSS + "</style>\n</head>", 1)
    return t.replace('<footer class="band footer">', bloc_liens() + '<footer class="band footer">', 1)


for v in VILLES:
    (RACINE / f"{v['slug']}.html").write_text(page_ville(v), encoding="utf-8")

for f in sorted(RACINE.glob("*.html")):
    t = f.read_text(encoding="utf-8")
    if '<footer class="band footer">' in t and f.name != "admin.html":
        f.write_text(ajouter_bloc(t), encoding="utf-8")

sm = RACINE / "sitemap.xml"
s = sm.read_text(encoding="utf-8")
for v in VILLES:
    loc = f"https://vidantik.fr/{v['slug']}.html"
    if loc not in s:
        s = s.replace("  <url><loc>https://vidantik.fr/notre-travail.html", f"  <url><loc>{loc}</loc></url>\n  <url><loc>https://vidantik.fr/notre-travail.html", 1)
sm.write_text(s, encoding="utf-8")
print(len(VILLES), "pages villes générées")
