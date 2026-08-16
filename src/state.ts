/* What the URL hash carries.
 *
 * A map of a game is something people send to each other -- "the charge spawns
 * on the roof, look". That only works if the view is in the address bar, so
 * the arena, the visible categories, the visible floors and the two overlay
 * toggles all live in the hash. The camera does not: it changes on every drag
 * and would turn the history into noise.
 *
 * The hash also survives the full page load that a language switch does, so
 * changing language keeps you on the same arena with the same filters.
 */
export interface ViewState {
  map: string;
  cats: string[];
  floors: number[] | null; // null = every floor this arena has
  nav: boolean;
  zones: boolean;
}

export function readHash(fallbackMap: string, fallbackCats: string[]): ViewState {
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  const cats = p.get("cat");
  const floors = p.get("floor");
  return {
    map: p.get("map") || fallbackMap,
    cats: cats === null ? fallbackCats : cats ? cats.split(",") : [],
    floors: floors ? floors.split(",").map(Number).filter((n) => !isNaN(n)) : null,
    nav: p.get("nav") !== "0",
    zones: p.get("zones") !== "0",
  };
}

/** Rewrite the hash without pushing a history entry -- panning through five
 *  arenas should not bury the page the visitor arrived from. */
export function writeHash(s: ViewState, allFloors: number[]): void {
  const p = new URLSearchParams();
  p.set("map", s.map);
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
