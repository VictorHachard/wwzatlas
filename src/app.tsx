import { useEffect, useState } from "preact/hooks";
import { Rail } from "./ui/Rail";
import { Stage } from "./ui/Stage";
import { CATS } from "./catalog";
import { loadIndex, loadMap, prefetch } from "./data/loader";
import type { AtlasIndex, MapDoc } from "./data/loader";
import { readHash, writeHash } from "./state";
import { t } from "./i18n";

const DEFAULT_MAP = "hm_jer";
const DEFAULT_CATS = CATS.filter((c) => c.on).map((c) => c.id);

export function App() {
  const boot = readHash(DEFAULT_MAP, DEFAULT_CATS);

  const [index, setIndex] = useState<AtlasIndex | null>(null);
  const [doc, setDoc] = useState<MapDoc | null>(null);
  const [slug, setSlug] = useState(boot.map);
  const [cats, setCats] = useState(new Set(boot.cats));
  const [floors, setFloors] = useState(new Set(boot.floors ?? []));
  const [nav, setNav] = useState(boot.nav);
  const [zones, setZones] = useState(boot.zones);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIndex().then(setIndex, () => setError(t("error.load")));
  }, []);

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
    if (!doc) return;
    writeHash(
      { map: slug, cats: [...cats], floors: [...floors], nav, zones },
      doc.layers.map((L) => L.floor),
    );
  }, [doc, slug, cats, floors, nav, zones]);

  if (!index) {
    return (
      <div class="boot">{error ? error : t("state.loading")}</div>
    );
  }

  return (
    <div class="app">
      <Rail
        index={index}
        doc={doc}
        slug={slug}
        cats={cats}
        floors={floors}
        nav={nav}
        zones={zones}
        onSlug={setSlug}
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
