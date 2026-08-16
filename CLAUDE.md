# wwzatlas — le site public

Carte interactive des 5 arènes Horde Mode de World War Z. Preact + Vite,
déployé sur GitHub Pages, en 11 langues.

**Repo public.** Il ne contient que le produit fini. La recherche, les scripts
d'extraction et tout ce qui touche aux fichiers du jeu vivent dans le repo privé
`../wwzatlas-pipeline`.

## Règles

- **Ne jamais committer de fichier venant du jeu** (`.pak`, `.nav`, `.obb`,
  `.cd_list`, `.pct`, textures décodées). `public/data/` ne contient que des
  coordonnées dérivées, produites par le pipeline.
- `public/data/` est **généré**, pas édité à la main. Le régénérer depuis le repo
  privé : `python scripts/build_site_data.py`.
- `src/gl/renderer.js` reste en JavaScript simple, pas en TypeScript : il a été
  porté en état de marche depuis le fichier unique et ses chemins graphiques sont
  difficiles à tester de l'extérieur. Sa surface publique est typée à la main dans
  `renderer.d.ts`. Ne pas le réécrire pour satisfaire le typage.
- Preact ne dessine rien. Il pousse de l'état dans le renderer (quelle arène,
  quels étages, quelles catégories) et reçoit des callbacks. Garder cette
  frontière.

## Structure

```
src/gl/renderer.js   scène WebGL : volumes de collision, navmesh, coupe sous le sol
src/ui/              Rail (colonne de gauche), Stage (viewport + tooltip)
src/i18n/            langs.json = la liste des langues, locales/ = les chaînes
src/data/loader.ts   une arène = 1 JSON + 1 .bin (3 sections alignées)
src/catalog.ts       catégories de marqueurs, couleurs, glyphes
src/state.ts         l'état de la vue dans le hash de l'URL
vite.config.ts       base Pages + un shell HTML par langue (title, hreflang, JSON-LD)
```

## SEO — ne pas casser

- `h1` = `seo.h1` (« World War Z Horde Mode Maps » et ses traductions) : c'est ce
  que les gens tapent. Le nom du site est le wordmark au-dessus, pas le titre.
- `h2` = l'arène affichée (`seo.mapHeading`). Un seul h2 par page ; les intertitres
  du rail sont des `h3` pour que le plan lu par un crawler reste ces deux niveaux.
- Le `<title>` met la phrase recherchée **avant** le nom du site.
- Chaque langue a sa page statique, son canonical, le jeu `hreflang` complet et
  son JSON-LD (WebSite + WebApplication→VideoGame + ItemList des 5 arènes). Tout
  est généré par le plugin `languageShells` dans `vite.config.ts`.
- La liste des arènes du JSON-LD vient de `public/data/index.json`, pas d'une
  seconde copie : ne pas la dupliquer dans la config.

## Commandes

```bash
npm run dev        # http://localhost:5173/wwzatlas/
npm run build      # tsc --noEmit puis vite build (+ les 11 shells)
npm run preview
```

Renommer le repo ou passer sur un domaine : changer `REPO` et `OWNER` en haut de
`vite.config.ts`, tout le reste en découle.
