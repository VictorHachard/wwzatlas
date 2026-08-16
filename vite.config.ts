import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import fs from "node:fs";
import path from "node:path";

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

function readLangs(): LangRow[] {
  return JSON.parse(fs.readFileSync("src/i18n/langs.json", "utf8"));
}

function dictFor(seg: string): Record<string, string> {
  const file = seg === "" ? "en" : seg;
  return JSON.parse(fs.readFileSync(`src/i18n/locales/${file}.json`, "utf8"));
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* The arena list comes from the payload the pipeline wrote, not from a second
   copy kept here: if an arena is added or renamed there, the structured data
   follows without anyone remembering to update it. */
function readArenas(): { slug: string; key: string }[] {
  const p = "public/data/index.json";
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")).maps;
}

/* Structured data, one graph per language.
 *
 * Three things are being said, and search engines use them differently: this
 * is a site (WebSite), the thing on it is a browser app about a specific game
 * (WebApplication -> VideoGame), and it covers exactly these five arenas
 * (ItemList). The ItemList entries carry the hash the app itself reads, so a
 * result that deep-links to one arena lands on that arena. */
function jsonLd(
  lang: LangRow,
  d: Record<string, string>,
  arenas: { slug: string; key: string }[],
) {
  const url = SITE + (lang.seg ? lang.seg + "/" : "");
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
    {
      "@type": "WebApplication",
      "@id": url + "#app",
      url,
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
      about: {
        "@type": "VideoGame",
        name: "World War Z",
        gamePlatform: ["PC", "PlayStation", "Xbox", "Nintendo Switch"],
      },
    },
    {
      "@type": "ItemList",
      "@id": url + "#arenas",
      name: d["seo.h1"],
      numberOfItems: arenas.length,
      itemListElement: arenas.map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: d["seo.mapHeading"].replace("{name}", d["map." + a.key]),
        url: `${url}#map=${a.slug}`,
      })),
    },
  ];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

/* One static page per language.
 *
 * The app could switch language client-side, but then every language would
 * share one URL and search engines would only ever see English. Emitting a
 * real /fr/index.html costs one file copy per language and gives each one an
 * indexable address, its own <title> and a complete hreflang set. The bundle
 * is identical in all of them -- only the head differs -- and the runtime
 * reads the language back off the path. */
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
      if (!arenas.length) {
        console.warn(
          "language-shells: public/data/index.json is missing, so the pages " +
            "ship without an arena list in their structured data. Run " +
            "build_site_data.py from the pipeline repo first.",
        );
      }

      const alternates = langs
        .map(
          (l) =>
            `<link rel="alternate" hreflang="${l.tag}" href="${SITE}${l.seg ? l.seg + "/" : ""}" />`,
        )
        .concat(`<link rel="alternate" hreflang="x-default" href="${SITE}" />`)
        .join("\n    ");

      for (const l of langs) {
        const d = dictFor(l.seg);
        // the searched-for phrase first, the site name after it: a result page
        // truncates the tail, and the tail is the part nobody types
        const title = `${d["seo.h1"]} - ${d["app.title"]}`;
        const desc = d["meta.description"];
        const url = SITE + (l.seg ? l.seg + "/" : "");
        const head = [
          alternates,
          `<link rel="canonical" href="${url}" />`,
          `<meta property="og:url" content="${url}" />`,
          `<meta property="og:locale" content="${l.tag.replace("-", "_")}" />`,
          `<meta property="og:site_name" content="${esc(d["app.title"])}" />`,
          `<meta name="twitter:card" content="summary" />`,
          `<script type="application/ld+json">${jsonLd(l, d, arenas)}</script>`,
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
          .replace("<!--HREFLANG-->", head);

        const out = l.seg ? path.join(dist, l.seg, "index.html") : root;
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, html);
      }

      // Pages has no rewrite rules, so an unknown path would 404 out of the
      // app entirely. Serving the shell there keeps a mistyped or stale link
      // inside the atlas instead of on GitHub's error page.
      fs.copyFileSync(root, path.join(dist, "404.html"));

      const urls = langs
        .map((l) => `  <url><loc>${SITE}${l.seg ? l.seg + "/" : ""}</loc></url>`)
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

      console.log(`language shells: ${langs.map((l) => l.seg || "en").join(", ")}`);
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
