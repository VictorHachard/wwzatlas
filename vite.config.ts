import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import fs from "node:fs";
import path from "node:path";
import { ARENAS, DEFAULT_ARENA, type Arena } from "./src/arenas";

/* GitHub Pages serves a project site under /<repo>/, so every asset URL has to
   carry that prefix. Change these two together if the repo is renamed or moved
   to a custom domain. */
const REPO = "wwzatlas";
const OWNER = "VictorHachard";
const BASE = `/${REPO}/`;
const SITE = `https://${OWNER.toLowerCase()}.github.io${BASE}`;

interface LangRow {
  seg: string;
  tag: string;
  name: string;
}

/* Only the fields the pages are built out of; the payload carries more. */
interface IndexEntry {
  slug: string;
  key: string;
  sizeM: [number, number];
  floors: number;
  markers: number;
  navStats: { area: number } | null;
}

function readLangs(): LangRow[] {
  return JSON.parse(fs.readFileSync("src/i18n/langs.json", "utf8"));
}

function dictFor(seg: string): Record<string, string> {
  const file = seg === "" ? "en" : seg;
  return JSON.parse(fs.readFileSync(`src/i18n/locales/${file}.json`, "utf8"));
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* The numbers in the page have to read the way the app writes them, or the
   copy a crawler sees and the copy a visitor sees disagree over a thousands
   separator. Same Intl call the rail makes. */
const numFor = (tag: string) => {
  const nf = new Intl.NumberFormat(tag);
  return (n: number) => nf.format(n);
};

const fill = (s: string, vars: Record<string, string>) => {
  for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
  return s;
};

/* The arena set exists twice: as routes in src/arenas.ts, which the browser
   needs before any fetch has landed, and as payload entries in the file the
   pipeline wrote. Reconciling them here is what makes the duplication safe --
   a renamed or added arena stops the build instead of silently shipping five
   pages for four arenas. */
function readArenas(): IndexEntry[] {
  const p = "public/data/index.json";
  if (!fs.existsSync(p)) {
    throw new Error(
      "public/data/index.json is missing. Run build_site_data.py from the " +
        "pipeline repo before building the site.",
    );
  }
  const maps: IndexEntry[] = JSON.parse(fs.readFileSync(p, "utf8")).maps;

  const payload = maps.map((m) => `${m.slug}=${m.key}`).sort();
  const routed = ARENAS.map((a) => `${a.slug}=${a.key}`).sort();
  if (payload.join() !== routed.join()) {
    throw new Error(
      "src/arenas.ts and public/data/index.json disagree about the arenas.\n" +
        `  payload: ${payload.join(", ")}\n` +
        `  routed:  ${routed.join(", ")}\n` +
        "Add or rename the route in src/arenas.ts to match the payload.",
    );
  }
  const clash = ARENAS.filter((a) => readLangs().some((l) => l.seg === a.path));
  if (clash.length) {
    throw new Error(
      `arena path ${clash[0].path} collides with a language segment; the ` +
        "router would read it as a language and never reach the arena.",
    );
  }
  return maps;
}

/* Every page is one language and one arena -- or one language and no arena,
   which is that language's front page. */
interface Page {
  arena: Arena | null;
}
const PAGES: Page[] = [{ arena: null }, ...ARENAS.map((a) => ({ arena: a }))];

const urlFor = (seg: string, arena: Arena | null) =>
  SITE + (seg ? seg + "/" : "") + (arena ? arena.path + "/" : "");

/* One social card per arena plus one for the front page, each drawn from real
   navmesh by scripts/make-og.mjs and committed as a PNG. The cards are in
   English on every language: one shared set is worth more than eleven
   translations of six words nobody reads twice. */
const cardFor = (arena: Arena | null) =>
  SITE + "og/" + (arena ? arena.path : "home") + ".png";

const headingFor = (d: Record<string, string>, arena: Arena) =>
  fill(d["seo.mapHeading"], { name: d["map." + arena.key] });

function titleFor(d: Record<string, string>, arena: Arena | null): string {
  // the searched-for phrase first, the site name after it: a result page
  // truncates the tail, and the tail is the part nobody types
  const head = arena ? headingFor(d, arena) : d["seo.h1"];
  return `${head} - ${d["app.title"]}`;
}

const descFor = (d: Record<string, string>, arena: Arena | null) =>
  arena
    ? fill(d["meta.mapDescription"], { name: d["map." + arena.key] })
    : d["meta.description"];

/* Structured data, one graph per page.
 *
 * A language front page says three things, and search engines use them
 * differently: this is a site (WebSite), the thing on it is a browser app about
 * a specific game (WebApplication -> VideoGame), and it covers exactly these
 * five arenas (ItemList). The ItemList entries are now real addresses, so a
 * result that deep-links to one arena lands on a page that is about it.
 *
 * An arena page repeats the site node and then describes itself: a WebPage with
 * its own image, and a breadcrumb back up, which is what turns the result line
 * into "Horde Mode Atlas > Tokyo" instead of a bare URL. */
function jsonLd(
  lang: LangRow,
  d: Record<string, string>,
  arena: Arena | null,
  arenas: IndexEntry[],
) {
  const home = urlFor(lang.seg, null);
  const url = urlFor(lang.seg, arena);
  const game = {
    "@type": "VideoGame",
    name: "World War Z",
    gamePlatform: ["PC", "PlayStation", "Xbox", "Nintendo Switch"],
  };

  const graph: unknown[] = [
    {
      "@type": "WebSite",
      "@id": SITE + "#website",
      url: SITE,
      name: d["app.title"],
      alternateName: d["seo.h1"],
      inLanguage: lang.tag,
      description: d["meta.description"],
    },
  ];

  if (!arena) {
    graph.push(
      {
        "@type": "WebApplication",
        "@id": home + "#app",
        url: home,
        name: d["seo.h1"],
        applicationCategory: "GameApplication",
        applicationSubCategory: "Interactive game map",
        operatingSystem: "Any",
        browserRequirements: "Requires WebGL",
        inLanguage: lang.tag,
        description: d["seo.about"],
        isPartOf: { "@id": SITE + "#website" },
        // free, and saying so is what makes the entry eligible for rich results
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        about: game,
      },
      {
        "@type": "ItemList",
        "@id": home + "#arenas",
        name: d["seo.h1"],
        numberOfItems: ARENAS.length,
        itemListElement: ARENAS.map((a, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: headingFor(d, a),
          url: urlFor(lang.seg, a),
        })),
      },
    );
  } else {
    const e = arenas.find((m) => m.slug === arena.slug)!;
    graph.push(
      {
        "@type": "WebPage",
        "@id": url + "#page",
        url,
        name: headingFor(d, arena),
        inLanguage: lang.tag,
        description: descFor(d, arena),
        isPartOf: { "@id": SITE + "#website" },
        about: game,
        breadcrumb: { "@id": url + "#crumbs" },
        primaryImageOfPage: {
          "@type": "ImageObject",
          url: cardFor(arena),
          width: 1200,
          height: 630,
        },
        // the one line that is true of this arena and no other
        abstract: factsFor(d, lang.tag, e),
      },
      {
        "@type": "BreadcrumbList",
        "@id": url + "#crumbs",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: d["seo.h1"], item: home },
          // the last crumb is the page itself, so it carries no item
          { "@type": "ListItem", position: 2, name: d["map." + arena.key] },
        ],
      },
    );
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

const factsFor = (d: Record<string, string>, tag: string, e: IndexEntry) => {
  const n = numFor(tag);
  return fill(d["seo.mapFacts"], {
    w: n(e.sizeM[0]),
    h: n(e.sizeM[1]),
    markers: n(e.markers),
    floors: n(e.floors),
    area: n(e.navStats?.area ?? 0),
  });
};

/* What sits inside #root in the file GitHub Pages serves.
 *
 * The app is a WebGL canvas driven from a 700 kB payload; until that has
 * loaded and run, the page used to be an empty div. Everything that made this
 * page worth finding -- the heading, the arena it is about, the four other
 * arenas, what the atlas actually is -- existed only after JavaScript. Google
 * does render, eventually and in a second pass; nothing else reliably does,
 * and neither does a link preview or a slow connection.
 *
 * So the build writes the readable version of the page here, in the markup the
 * rail already has styles for, and main.tsx clears it the moment Preact is
 * ready to say the same things interactively. It is a copy of the app's own
 * text, never a keyword page written for robots: if the two ever say different
 * things, this is the one that is wrong. */
function body(
  lang: LangRow,
  d: Record<string, string>,
  arena: Arena | null,
  arenas: IndexEntry[],
): string {
  const n = numFor(lang.tag);
  const shown = arena ?? DEFAULT_ARENA;
  const links = ARENAS.map((a) => {
    const e = arenas.find((m) => m.slug === a.slug)!;
    const here = a.path === shown.path ? ' aria-current="page"' : "";
    const size = fill(d["stats.size"], { w: n(e.sizeM[0]), h: n(e.sizeM[1]) });
    return (
      `<a class="mapbtn" href="${BASE}${lang.seg ? lang.seg + "/" : ""}${a.path}/"${here}>` +
      `<b>${esc(d["map." + a.key])}</b><span>${esc(size)}</span></a>`
    );
  }).join("");

  const facts = factsFor(d, lang.tag, arenas.find((m) => m.slug === shown.slug)!);

  return `<div class="preboot">
      <div class="brand">
        <p class="wordmark">${esc(d["app.title"])}</p>
        <h1>${esc(d["seo.h1"])}</h1>
        <p>${esc(d["app.tagline"])}</p>
      </div>
      <section class="sect">
        <h3>${esc(d["nav.arena"])}</h3>
        <div class="maps">${links}</div>
        <p class="facts">${esc(facts)}</p>
      </section>
      <section class="sect">
        <h2>${esc(headingFor(d, shown))}</h2>
        <p class="hint">${esc(d["seo.about"])}</p>
      </section>
      <section class="sect">
        <h3>${esc(d["about.title"])}</h3>
        <p class="hint">${esc(d["about.body"])}</p>
        <p class="hint dim">${esc(d["about.disclaimer"])}</p>
      </section>
      <p class="load">${esc(d["state.loading"])}</p>
    </div>`;
}

/* One static page per language and per arena.
 *
 * The app could switch both client-side, but then fifty-five views would share
 * one URL and search engines would only ever see the English front page.
 * Emitting a real /fr/tokyo/index.html costs one file copy and gives each view
 * an indexable address, its own <title>, its own description and a complete
 * hreflang set pointing at the same arena in the other ten languages. The
 * bundle is identical in all of them -- only the head and the pre-render
 * differ -- and the runtime reads both back off the path. */
function languageShells() {
  return {
    name: "language-shells",
    apply: "build" as const,
    closeBundle() {
      const dist = "dist";
      const root = path.join(dist, "index.html");
      if (!fs.existsSync(root)) return;
      const template = fs.readFileSync(root, "utf8");
      const langs = readLangs();
      const arenas = readArenas();
      const stamp = new Date().toISOString().slice(0, 10);

      for (const l of langs) {
        const d = dictFor(l.seg);

        for (const page of PAGES) {
          const url = urlFor(l.seg, page.arena);
          const title = titleFor(d, page.arena);
          const desc = descFor(d, page.arena);
          const card = cardFor(page.arena);

          /* hreflang has to pair like with like: /fr/tokyo/ is the French
             version of /tokyo/, not of the French front page. */
          const alternates = langs
            .map(
              (a) =>
                `<link rel="alternate" hreflang="${a.tag}" href="${urlFor(a.seg, page.arena)}" />`,
            )
            .concat(
              `<link rel="alternate" hreflang="x-default" href="${urlFor("", page.arena)}" />`,
            )
            .join("\n    ");

          const head = [
            alternates,
            `<link rel="canonical" href="${url}" />`,
            `<meta property="og:url" content="${url}" />`,
            `<meta property="og:locale" content="${l.tag.replace("-", "_")}" />`,
            `<meta property="og:site_name" content="${esc(d["app.title"])}" />`,
            `<meta property="og:image" content="${card}" />`,
            `<meta property="og:image:width" content="1200" />`,
            `<meta property="og:image:height" content="630" />`,
            `<meta property="og:image:alt" content="${esc(title)}" />`,
            `<meta name="twitter:card" content="summary_large_image" />`,
            `<meta name="twitter:image" content="${card}" />`,
            `<script type="application/ld+json">${jsonLd(l, d, page.arena, arenas)}</script>`,
          ].join("\n    ");

          const html = template
            .replace(/<html lang="[^"]*"/, `<html lang="${l.tag}"`)
            .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
            .replace(
              /(<meta name="description" content=")[^"]*(")/,
              `$1${esc(desc)}$2`,
            )
            .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
            .replace(
              /(<meta property="og:description" content=")[^"]*(")/,
              `$1${esc(desc)}$2`,
            )
            .replace("<!--HREFLANG-->", head)
            .replace(
              '<div id="root"></div>',
              `<div id="root">${body(l, d, page.arena, arenas)}</div>`,
            );

          const dir = path.join(dist, l.seg, page.arena ? page.arena.path : "");
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "index.html"), html);
        }
      }

      // Pages has no rewrite rules, so an unknown path would 404 out of the
      // app entirely. Serving the shell there keeps a mistyped or stale link
      // inside the atlas instead of on GitHub's error page. It is the English
      // front page, canonical included, so a soft copy of it cannot compete
      // with a real arena page.
      fs.copyFileSync(root, path.join(dist, "404.html"));

      const urls = langs
        .flatMap((l) => PAGES.map((p) => urlFor(l.seg, p.arena)))
        .map(
          (loc) =>
            `  <url><loc>${loc}</loc><lastmod>${stamp}</lastmod></url>`,
        )
        .join("\n");
      fs.writeFileSync(
        path.join(dist, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      );
      fs.writeFileSync(
        path.join(dist, "robots.txt"),
        `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`,
      );

      console.log(
        `language shells: ${langs.length} languages x ${PAGES.length} pages ` +
          `= ${langs.length * PAGES.length} indexable URLs`,
      );
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [preact(), languageShells()],
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
    // The arena payloads live in public/ and are copied verbatim; nothing in
    // the bundle should be big enough to warrant a warning.
    chunkSizeWarningLimit: 400,
  },
});
