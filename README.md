# Horde Mode Atlas

Interactive top-down maps of the five World War Z Horde Mode arenas: Jerusalem,
New York, Rome, Tokyo and the Airport/Camp. Every arena shows where the
breaching charges spawn, where the shops, lootboxes, gates and machine guns
stand, and which surfaces the horde can actually walk on.

**https://victorhachard.github.io/wwzatlas/**, in 11 languages.

Unofficial fan project. Not affiliated with Saber Interactive or Focus
Entertainment.

## What is in here

```
src/
  gl/renderer.js     the WebGL scene: collision volumes, navmesh, sub-floor clip
  ui/                Preact: the rail, the viewport, the tooltip
  i18n/              11 locales; langs.json is the list, locales/ the strings
  data/loader.ts     fetches one arena as JSON + one binary blob
  catalog.ts         marker categories, colours, glyphs
  state.ts           the view in the URL hash
public/data/         the arena payload (generated, see below)
```

The renderer is deliberately plain JavaScript rather than TypeScript: it was
ported working from a standalone build and the graphics paths in it are hard to
test from the outside, so it is not worth rewriting to satisfy a type checker.
Its public surface is typed by hand in `src/gl/renderer.d.ts`.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173/wwzatlas/
npm run build      # -> dist/, typechecked first
npm run preview
```

Opening `dist/index.html` straight from the filesystem does **not** work, and
cannot be made to: a `file://` page has an opaque origin, so the browser refuses
the `fetch()` calls that pull `data/index.json` and the arena payload. That is a
browser rule, not a path problem. Always go through `npm run preview` (or any
static server) to look at a build.

`npm run build` also writes one shell page per language (`dist/fr/index.html`
and so on), each with its own `<title>`, canonical URL, full `hreflang` set and
JSON-LD. The bundle inside them is identical; the language is read back off the
URL path at runtime.

Deployment is `.github/workflows/deploy.yml`: any push to `main` builds and
publishes to GitHub Pages. Set **Settings → Pages → Source** to *GitHub Actions*
once, and it runs itself.

If the repo is renamed or moved to a custom domain, change `REPO` and `OWNER` at
the top of `vite.config.ts`: `base`, the canonical URLs, the hreflang set and
the sitemap all follow from those two.

## The data

`public/data/` is generated, not written by hand:

| file | what |
|---|---|
| `index.json` | the arena list, read before any arena is chosen |
| `<slug>.json` | metadata, markers, zone labels |
| `<slug>.bin` | box volumes ++ navmesh vertices ++ navmesh indices, raw |

Each arena is fetched only when it is opened; the rest are prefetched quietly a
second later. The binary is one `ArrayBuffer` with three aligned sections, so
the loader takes typed-array views over it without copying or decoding anything.

It is produced by `build_site_data.py` in the **wwzatlas-pipeline** repo, which
holds the extraction and reverse-engineering work this site is the front end
for. To refresh:

```bash
python scripts/build_site_data.py      # from wwzatlas-pipeline, writes here
```

### How the data was obtained

Nothing was decompiled: no executable or game code was touched. The work is
reverse engineering of the game's data files, read-only, on a personal install.

- The `.pak` archives turned out to be plain, uncompressed ZIP files, so they
  open with any ZIP reader.
- The formats inside were worked out by hand, from hex dumps and hypotheses
  checked against the game: collision boxes (`.obb`, 15 floats per box), placed
  objects with their world positions (`.cd_list`, names plus 4x4 matrices) and
  the navmesh (`.nav`, a columnar format mixing zigzag LEB128 integers and raw
  floats in one stream, the hardest of the lot).
- A Python script turns that into coordinates only: boxes, markers and walkable
  surfaces. That is all that lands in `public/data/`.

Still unsolved: the 3D model format, which is why the maps show volumes and
surfaces rather than textured geometry.

## Adding a language

1. copy `src/i18n/locales/en.json` to `<seg>.json` and translate it;
2. add the row to `src/i18n/langs.json`;
3. add the static import and the `DICTS` entry in `src/i18n/index.tsx`.

The build picks up the new shell page, hreflang entry and sitemap URL on its
own. A key a translation is missing falls back to English rather than going
blank.

## Licence

Code: MIT, see `LICENSE`.

The arena data describes the layout of a commercial game and is published here
for reference only. World War Z and all related marks belong to their respective
owners. No game files are redistributed by this repository.
