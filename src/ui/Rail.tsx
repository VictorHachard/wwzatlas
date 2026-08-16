/* The left rail: pick an arena, cut it by floor, filter what is on it.
 *
 * Counts come from the arena that is loaded, so a category with nothing on this
 * map is not offered at all -- an empty checkbox that can never do anything is
 * worse than a shorter list.
 */
import { CATS, FLOOR_COL } from "../catalog";
import type { AtlasIndex, MapDoc } from "../data/loader";
import { arenaBySlug } from "../arenas";
import { hrefFor } from "../route";
import { LANGS, currentLang, t, num, urlFor } from "../i18n";

interface Props {
  id: string;
  /** narrow screens only: the rail is a drawer there, a column everywhere else */
  open: boolean;
  index: AtlasIndex;
  doc: MapDoc | null;
  slug: string;
  cats: Set<string>;
  floors: Set<number>;
  nav: boolean;
  zones: boolean;
  onSlug: (s: string) => void;
  onClose: () => void;
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
  const here = p.index.maps.find((m) => m.slug === p.slug);

  return (
    <aside class={"rail" + (p.open ? " open" : "")} id={p.id}>
      {/* The wordmark is the name; the h1 is what people actually type into a
          search box. Keeping them separate means the page can be called Horde
          Mode Atlas without the only heading on it being a name nobody looks
          for. */}
      <div class="brand">
        <button class="railclose" aria-label={t("nav.close")} onClick={p.onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <p class="wordmark">{t("app.title")}</p>
        <h1>{t("seo.h1")}</h1>
        <p>{t("app.tagline")}</p>
      </div>

      <section class="sect">
        <h3>{t("nav.arena")}</h3>
        {/* Real links, not buttons. Each arena is a page of its own, so this is
            the one list that tells a crawler the other four exist, and it is
            also what lets someone middle-click Tokyo into a second tab. The
            click handler only takes over the plain left click; every modifier
            the browser has a better answer for is left alone. */}
        <div class="maps">
          {p.index.maps.map((m) => (
            <a
              key={m.slug}
              class="mapbtn"
              href={hrefFor(lang.seg, arenaBySlug(m.slug) ?? null)}
              aria-current={m.slug === p.slug ? "page" : undefined}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button) return;
                e.preventDefault();
                p.onSlug(m.slug);
              }}
              // An arena is ~700 kB of quantised geometry that barely gzips, so
              // fetching all five up front would spend 3 MB of someone's data
              // on four arenas they may never open. Pointing at the link is
              // the earliest honest signal that they will.
              onMouseEnter={() => p.onPrefetch(m.slug)}
              onFocus={() => p.onPrefetch(m.slug)}
            >
              <b>{t("map." + m.key)}</b>
              <span>{t("stats.size", { w: num(m.sizeM[0]), h: num(m.sizeM[1]) })}</span>
            </a>
          ))}
        </div>

        {/* The one sentence that is true of this arena and of no other. It is
            what makes /tokyo/ a different document from /rome/ rather than the
            same shell with a different heading, and it is genuinely the first
            thing anyone asks about an arena they have not played. */}
        {here && (
          <p class="facts">
            {t("seo.mapFacts", {
              w: num(here.sizeM[0]),
              h: num(here.sizeM[1]),
              markers: num(here.markers),
              floors: num(here.floors),
              area: num(here.navStats?.area ?? 0),
            })}
          </p>
        )}
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

      {/* Both sets of controls are in the page and CSS shows the one that
          matches the pointer, rather than a media query the renderer would have
          to agree with or a user-agent guess that gets a hybrid laptop wrong. */}
      <section class="sect">
        <p class="hint bymouse">{t("hint.controls")}</p>
        <p class="hint bytouch">{t("hint.controlsTouch")}</p>
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
