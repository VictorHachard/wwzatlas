/* The marker vocabulary, shared by the rail and the canvas overlay.
 *
 * `g` is the glyph drawn inside the dot: one character, because at map zoom a
 * marker is 18 px across and anything longer turns to mush. `on` is what shows
 * by default -- everything at once is unreadable, so the categories a player
 * actually plans around (charges, lootboxes, gates) start visible. */
export interface Cat {
  id: string;
  g: string;
  col: string;
  on: boolean;
}

export const CATS: Cat[] = [
  { id: "charge", g: "C", col: "#FF3B2F", on: true },
  { id: "lootbox", g: "L", col: "#FF9500", on: true },
  { id: "shop", g: "$", col: "#3DDC84", on: false },
  { id: "gate", g: "G", col: "#B36BFF", on: true },
  { id: "front", g: "F", col: "#FF6FB5", on: false },
  { id: "medkit", g: "+", col: "#5AD1FF", on: false },
  { id: "ammo", g: "A", col: "#C8B24D", on: false },
  { id: "weapon", g: "W", col: "#9FB0C4", on: false },
  { id: "supplies", g: "S", col: "#7ED4A6", on: false },
  { id: "corpse", g: "x", col: "#A8748F", on: false },
  { id: "mg", g: "M", col: "#E0703C", on: false },
  { id: "zspawn", g: "Z", col: "#7A5CCB", on: false },
  { id: "pspawn", g: "P", col: "#4FC3A1", on: false },
  { id: "barricade", g: "B", col: "#8C9AAF", on: false },
  { id: "wire", g: "#", col: "#D14D8C", on: false },
  { id: "grid", g: "E", col: "#2FB8C9", on: false },
  { id: "ladder", g: "^", col: "#B0A24D", on: false },
];

export const CAT_BY: Record<string, Cat> = Object.fromEntries(
  CATS.map((c) => [c.id, c]),
);

/* Matched to the 3D shader's height ramp -- vec3(1.00,0.60,0.22) at ground and
   vec3(0.33,0.72,1.00) above -- so the two views agree on what a floor is. */
export const FLOOR_COL: Record<number, string> = {
  1: "#FF9938",
  2: "#54B8FF",
  3: "#FF82BE",
};

/* Zone labels name places the level designers named, in whatever form they
   typed them: "gamemode_museum", "cathedral", "roof_02". They are not part of
   the translated string set -- there are dozens per arena and they are level
   authoring, not game text -- so all we do is make them readable. */
export function prettyZone(z: string): string {
  return z.replace(/^gamemode_/, "").replace(/_/g, " ");
}
