/* What the URL hash carries.
 *
 * A map of a game is something people send to each other -- "the charge spawns
 * on the roof, look". That only works if the view is in the address bar, so the
 * visible categories, the visible floors and the two overlay toggles all live
 * in the hash. The camera does not: it changes on every drag and would turn the
 * history into noise.
 *
 * The arena used to live here too, as #map=. It is in the path now (see
 * route.ts), because a hash is invisible to a search engine -- five arenas
 * behind five fragments were one indexable page, not five -- and because
 * "which arena" is what the page is about rather than how it is filtered. Links
 * written before the move are still read below and quietly upgraded.
 *
 * The hash survives the full page load that a language switch does, so changing
 * language keeps you on the same arena with the same filters.
 */
export interface ViewState {
  cats: string[];
  floors: number[] | null; // null = every floor this arena has
  nav: boolean;
  zones: boolean;
}

function hashParams(): URLSearchParams {
  return new URLSearchParams(location.hash.replace(/^#/, ""));
}

export function readHash(fallbackCats: string[]): ViewState {
  const p = hashParams();
  const cats = p.get("cat");
  const floors = p.get("floor");
  return {
    cats: cats === null ? fallbackCats : cats ? cats.split(",") : [],
    floors: floors ? floors.split(",").map(Number).filter((n) => !isNaN(n)) : null,
    nav: p.get("nav") !== "0",
    zones: p.get("zones") !== "0",
  };
}

/** The arena named by a link from before arenas had a path of their own, as a
 *  payload slug. The caller turns it into a real URL; the key is not dropping
 *  anyone who saved a link. */
export function legacyMap(): string | null {
  return hashParams().get("map");
}

/** Rewrite the hash without pushing a history entry -- ticking a category is
 *  not a page the back button should have to walk through. Picking an arena is,
 *  and that one goes through the path instead. */
export function writeHash(s: ViewState, allFloors: number[]): void {
  const p = new URLSearchParams();
  p.set("cat", s.cats.join(","));
  const sameFloors =
    s.floors !== null &&
    s.floors.length === allFloors.length &&
    allFloors.every((f) => s.floors!.includes(f));
  if (s.floors !== null && !sameFloors) p.set("floor", s.floors.join(","));
  if (!s.nav) p.set("nav", "0");
  if (!s.zones) p.set("zones", "0");
  const next = "#" + p.toString();
  if (next !== location.hash) history.replaceState(null, "", next);
}
