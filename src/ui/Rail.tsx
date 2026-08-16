/* The left rail: pick an arena, cut it by floor, filter what is on it.
 *
 * Counts come from the arena that is loaded, so a category with nothing on this
 * map is not offered at all -- an empty checkbox that can never do anything is
 * worse than a shorter list.
 */
import { CATS, FLOOR_COL } from "../catalog";
import type { AtlasIndex, MapDoc } from "../data/loader";
import { LANGS, currentLang, t, num, urlFor } from "../i18n";

interface Props {
  index: AtlasIndex;
  doc: MapDoc | null;
  slug: string;
  cats: Set<string>;
  floors: Set<number>;
  nav: boolean;
  zones: boolean;
  onSlug: (s: string) => void;
  onPrefetch: (s: string) => void;
  onCats: (s: Set<string>) => void;
  onFloors: (s: Set<number>) => void;
  onNav: (v: boolean) => void;
  onZones: (v: boolean) => void;
}

const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
  const next = new Set(set);
  if (!next.delete(v)) next.add(v);
  return next;
};

export function Rail(p: Props) {
  const counts: Record<string, number> = {};
  p.doc?.markers.forEach((m) => (counts[m.c] = (counts[m.c] || 0) + 1));
  const lang = currentLang();

  return (
    <aside class="rail">
      {/* The wordmark is the name; the h1 is what people actually type into a
          search box. Keeping them separate means the page can be called Horde
          Mode Atlas without the only heading on it being a name nobody looks
          for. */}
      <div class="brand">
        <p class="wordmark">{t("app.title")}</p>
        <h1>{t("seo.h1")}</h1>
        <p>{t("app.tagline")}</p>
      </div>

      <section class="sect">
        <h3>{t("nav.arena")}</h3>
        <div class="maps">
          {p.index.maps.map((m) => (
            <button
              key={m.slug}
              class="mapbtn"
              aria-pressed={m.slug === p.slug}
              onClick={() => p.onSlug(m.slug)}
              // An arena is ~700 kB of quantised geometry that barely gzips, so
              // fetching all five up front would spend 3 MB of someone's data
              // on four arenas they may never open. Pointing at the button is
              // the earliest honest signal that they will.
              onMouseEnter={() => p.onPrefetch(m.slug)}
              onFocus={() => p.onPrefetch(m.slug)}
            >
              <b>{t("map." + m.key)}</b>
              <span>{t("stats.size", { w: num(m.sizeM[0]), h: num(m.sizeM[1]) })}</span>
            </button>
          ))}
        </div>
      </section>

      <section class="sect">
        <h3>{t("nav.layers")}</h3>

        {p.doc?.nav && (
          <label class="cat">
            <input
              type="checkbox"
              checked={p.nav}
              onChange={(e) => p.onNav((e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="dot" style={{ background: "#4CF29E" }}>
              N
            </span>
            <span class="nm">{t("layer.navmesh")}</span>
          </label>
        )}

        <div class="layers">
          {(p.doc?.layers ?? []).map((L) => (
            <label class="layer" key={L.floor}>
              <input
                type="checkbox"
                checked={p.floors.has(L.floor)}
                onChange={() => p.onFloors(toggle(p.floors, L.floor))}
              />
              <span class="sw" style={{ background: FLOOR_COL[L.floor] }} />
              <span class="nm">{t("floor.level", { n: L.floor })}</span>
            </label>
          ))}
        </div>
      </section>

      <section class="sect">
        <h3>
          {t("nav.objects")}
          <span>{p.doc ? t("stats.placed", { n: num(p.doc.markers.length) }) : ""}</span>
        </h3>
        <div class="cats">
          {CATS.filter((c) => counts[c.id]).map((c) => (
            <label class="cat" key={c.id}>
              <input
                type="checkbox"
                checked={p.cats.has(c.id)}
                onChange={() => p.onCats(toggle(p.cats, c.id))}
              />
              <span class="dot" style={{ background: c.col }}>
                {c.g}
              </span>
              <span class="nm">{t("cat." + c.id)}</span>
              <span class="ct">{num(counts[c.id])}</span>
            </label>
          ))}
          <label class="cat">
            <input
              type="checkbox"
              checked={p.zones}
              onChange={(e) => p.onZones((e.currentTarget as HTMLInputElement).checked)}
            />
            <span class="dot" style={{ background: "#5B6B80" }}>
              Z
            </span>
            <span class="nm">{t("layer.zones")}</span>
            <span class="ct">{p.doc ? num(p.doc.labels.length) : ""}</span>
          </label>
        </div>
      </section>

      <section class="sect">
        <p class="hint">{t("hint.controls")}</p>
      </section>

      <section class="sect">
        <h3>{t("nav.language")}</h3>
        <select
          class="langsel"
          value={lang.seg}
          onChange={(e) => {
            const seg = (e.currentTarget as HTMLSelectElement).value;
            // remember the explicit choice so the next visit does not get
            // bounced back to whatever the browser prefers
            localStorage.setItem("lang.pinned", seg || "en");
            location.href = urlFor(seg);
          }}
        >
          {LANGS.map((l) => (
            <option key={l.seg} value={l.seg}>
              {l.name}
            </option>
          ))}
        </select>
      </section>

      <section class="sect about">
        <h3>{t("about.title")}</h3>
        <p class="hint">{t("seo.about")}</p>
        <p class="hint">{t("about.body")}</p>
        <p class="hint dim">{t("about.disclaimer")}</p>
        <p class="hint">
          <a href="https://github.com/VictorHachard/wwzatlas" rel="noopener">
            {t("about.source")}
          </a>
        </p>
      </section>
    </aside>
  );
}
