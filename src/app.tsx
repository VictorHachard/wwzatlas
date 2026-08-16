import { useEffect, useState } from "preact/hooks";
import { Rail } from "./ui/Rail";
import { Stage } from "./ui/Stage";
import { CATS } from "./catalog";
import { loadIndex, loadMap, prefetch } from "./data/loader";
import type { AtlasIndex, MapDoc } from "./data/loader";
import { legacyMap, readHash, writeHash } from "./state";
import { hrefFor, parseRoute } from "./route";
import { DEFAULT_ARENA, arenaBySlug } from "./arenas";
import { currentLang, t } from "./i18n";

const DEFAULT_CATS = CATS.filter((c) => c.on).map((c) => c.id);

export function App() {
  const boot = readHash(DEFAULT_CATS);
  const seg = currentLang().seg;
  // The path is the address of the page and wins outright; the hash is only
  // consulted for links written before arenas had a path, and those get
  // rewritten below so the old form never spreads any further.
  const stale = parseRoute().arena ? null : legacyMap();
  const bootArena =
    parseRoute().arena ?? (stale ? arenaBySlug(stale) : null) ?? DEFAULT_ARENA;

  const [index, setIndex] = useState<AtlasIndex | null>(null);
  const [doc, setDoc] = useState<MapDoc | null>(null);
  const [slug, setSlug] = useState(bootArena.slug);
  const [cats, setCats] = useState(new Set(boot.cats));
  const [floors, setFloors] = useState(new Set(boot.floors ?? []));
  const [nav, setNav] = useState(boot.nav);
  const [zones, setZones] = useState(boot.zones);
  const [error, setError] = useState<string | null>(null);
  // Only a phone ever hides the rail; on a wide screen the class is inert and
  // the rail is simply the left column.
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    loadIndex().then(setIndex, () => setError(t("error.load")));
  }, []);

  // An old #map= link lands on the language root showing the right arena; move
  // the address to that arena's page so what gets copied out of the bar next is
  // the form search engines and the rest of this app agree on.
  useEffect(() => {
    if (stale && arenaBySlug(stale)) {
      history.replaceState(null, "", hrefFor(seg, bootArena, location.hash));
    }
  }, []);

  // Arena changes are pushed, so Back walks them. That means Back can also
  // arrive from outside this component, and the arena has to follow the path
  // rather than the other way round.
  useEffect(() => {
    const pop = () => setSlug((parseRoute().arena ?? DEFAULT_ARENA).slug);
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);

  // Each arena page has its own title in the shell the server sent; keep the
  // promise once navigation is happening in the browser instead. A language
  // root is the site's own page and keeps the site's own title.
  useEffect(() => {
    const here = parseRoute().arena;
    const head = here
      ? t("seo.mapHeading", { name: t("map." + here.key) })
      : t("seo.h1");
    document.title = head + " - " + t("app.title");
  }, [slug]);

  useEffect(() => {
    let live = true;
    setError(null);
    loadMap(slug).then(
      (d) => {
        if (!live) return;
        setDoc(d);
        // Floors are per-arena, so a hash that named floors only applies to the
        // arena it was written for; switching arenas turns them all back on.
        const all = d.layers.map((L) => L.floor);
        setFloors((cur) => {
          const keep = all.filter((f) => cur.has(f));
          return new Set(keep.length ? keep : all);
        });
      },
      () => live && setError(t("error.load")),
    );
    return () => {
      live = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [menu]);

  useEffect(() => {
    if (!doc) return;
    writeHash(
      { cats: [...cats], floors: [...floors], nav, zones },
      doc.layers.map((L) => L.floor),
    );
  }, [doc, slug, cats, floors, nav, zones]);

  /* Picking an arena is a navigation, not a filter: it changes what the page
     is about, so it gets a real address and a history entry. The filters ride
     along in the hash so the link still describes the view. */
  const goto = (s: string) => {
    const a = arenaBySlug(s) ?? DEFAULT_ARENA;
    history.pushState(null, "", hrefFor(seg, a, location.hash));
    setSlug(a.slug);
    setMenu(false);
  };

  if (!index) {
    return (
      <div class="boot">{error ? error : t("state.loading")}</div>
    );
  }

  return (
    <div class="app" data-menu={menu ? "open" : "shut"}>
      {/* The whole point of the drawer is that the arena gets the screen, so on
          a phone the only chrome left over the map is this one button. It is
          hidden on a wide screen, where the rail is always there. */}
      <button
        class="menubtn"
        aria-expanded={menu}
        aria-controls="rail"
        aria-label={t("nav.menu")}
        onClick={() => setMenu((v) => !v)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <div class="scrim" onClick={() => setMenu(false)} />

      <Rail
        id="rail"
        open={menu}
        index={index}
        doc={doc}
        slug={slug}
        cats={cats}
        floors={floors}
        nav={nav}
        zones={zones}
        // Picking an arena is the one choice whose result is only visible on the
        // map, so it closes the drawer. Toggling a filter is not: people flip
        // several in a row.
        onSlug={goto}
        onClose={() => setMenu(false)}
        onPrefetch={prefetch}
        onCats={setCats}
        onFloors={setFloors}
        onNav={setNav}
        onZones={setZones}
      />
      <Stage
        doc={doc}
        cats={cats}
        floors={floors}
        nav={nav}
        zones={zones}
        onNoWebGL={() => setError(t("error.webgl"))}
      />
      {error && <div class="banner">{error}</div>}
    </div>
  );
}
