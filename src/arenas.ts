/* The address each arena answers on.
 *
 * The pipeline names arenas by their level id -- hm_jer, horde_mode_02,
 * camp_04_pve -- which is what the payload files are called and what the
 * renderer asks for. None of those belong in a URL: they are game internals,
 * a patch can rename them, and nobody types them into a search box. So every
 * arena also has a path segment, and it is written here rather than derived
 * from the payload, because a link someone shared has to keep working even if
 * the level id underneath it does not.
 *
 * It lives in a plain list because routing has to answer "which arena is this
 * page?" before index.json has been fetched -- the boot state is read out of
 * the URL synchronously. That does make this a second copy of the arena set,
 * so the build cross-checks it against public/data/index.json and refuses to
 * emit pages if the two disagree. A duplicate is only dangerous when it can
 * drift quietly.
 */
export interface Arena {
  /** payload name: public/data/<slug>.json and .bin */
  slug: string;
  /** i18n key for the display name: map.<key> */
  key: string;
  /** URL segment: /wwzatlas/<lang?>/<path>/ */
  path: string;
}

export const ARENAS: Arena[] = [
  { slug: "hm_jer", key: "jerusalem", path: "jerusalem" },
  { slug: "hm_ny", key: "newYork", path: "new-york" },
  { slug: "hm_rome", key: "rome", path: "rome" },
  { slug: "horde_mode_02", key: "tokyo", path: "tokyo" },
  { slug: "camp_04_pve", key: "camp", path: "airport-camp" },
];

/** What a language root shows, and where an unknown arena segment lands. */
export const DEFAULT_ARENA: Arena = ARENAS[0];

export const arenaByPath = (seg: string): Arena | undefined =>
  ARENAS.find((a) => a.path === seg);

export const arenaBySlug = (slug: string): Arena | undefined =>
  ARENAS.find((a) => a.slug === slug);
