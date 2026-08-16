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
src/arenas.ts        les 5 arènes : slug du payload, clé i18n, segment d'URL
src/route.ts         langue + arène lues dans le chemin, et l'inverse
src/state.ts         les filtres dans le hash (l'arène, elle, est dans le chemin)
vite.config.ts       base Pages + un shell HTML par langue × arène
scripts/make-og.mjs  les vignettes public/og/ ; se lance à la main, PNG committés
```

## SEO — ne pas casser

- `h1` = `seo.h1` (« World War Z Horde Mode Maps » et ses traductions) : c'est ce
  que les gens tapent. Le nom du site est le wordmark au-dessus, pas le titre.
- `h2` = l'arène affichée (`seo.mapHeading`). Un seul h2 par page ; les intertitres
  du rail sont des `h3` pour que le plan lu par un crawler reste ces deux niveaux.
- Le `<title>` met la phrase recherchée **avant** le nom du site.
- **Une arène = une page** : `/<langue?>/<arène>/`, soit 11 × 6 = 66 URLs, chacune
  avec son title, sa description, son canonical, son jeu `hreflang` complet (qui
  apparie Tokyo avec Tokyo, pas avec la page d'accueil) et son JSON-LD. Le hash
  ne porte plus que les filtres : un fragment est invisible pour un moteur.
- Le `#root` servi par Pages **n'est pas vide** : `languageShells` y écrit la
  version lisible de la page (h1, les 5 arènes en `<a href>`, le h2 de l'arène,
  la ligne de faits, l'à-propos), et `main.tsx` la remplace au démarrage. Elle
  doit dire ce que l'app dit — si les deux divergent, c'est le shell qui a tort.
- Les liens d'arène du rail sont de vrais `<a href>`. C'est la seule chose qui
  dit à un crawler que les quatre autres pages existent.
- `og:image` par arène : `public/og/*.png`, générés à la main par
  `scripts/make-og.mjs` et committés (le build n'en dépend pas).
- Ajouter ou renommer une arène = une ligne dans `src/arenas.ts`. Le build
  compare cette liste à `public/data/index.json` et **échoue** si elles
  divergent ; c'est ce qui rend la duplication sûre.

## Commandes

```bash
npm run dev        # http://localhost:5173/wwzatlas/
npm run build      # tsc --noEmit puis vite build (+ les 66 shells)
npm run preview

# vignettes sociales, à relancer seulement si les arènes ou le design changent
npm i -D @resvg/resvg-js && node scripts/make-og.mjs
```

Renommer le repo ou passer sur un domaine : changer `REPO` et `OWNER` en haut de
`vite.config.ts`, tout le reste en découle.
