/* Fetching one arena.
 *
 * The build ships each arena as a small JSON document plus one binary blob
 * holding the three big arrays (box volumes, navmesh vertices, navmesh
 * indices). They are views over the same ArrayBuffer, so nothing is copied and
 * there is no base64 to decode -- which is the whole reason the payload is
 * split this way instead of embedded like the standalone artifact does it.
 *
 * See build_site_data.py in the pipeline repo for the writer. */

const BASE = import.meta.env.BASE_URL;

export interface Marker {
  c: string; // category id, see catalog.ts
  n?: string; // instance name as the level authored it
  z0?: string; // zone it sits in
  x: number;
  y?: number;
  zz: number;
  f: number; // floor
  k?: number; // how many identical markers were folded into this one
  a?: number[]; // mounted MG: barrel heading per gun, degrees, 0 = world +Z, 90 = +X
}

export interface ZoneLabel {
  z: string;
  x: number;
  y?: number;
  zz: number;
  f: number;
  n: number;
}

export interface Layer {
  floor: number;
  yMin: number;
  yMax: number;
}

export interface NavStats {
  faces: number;
  vertices: number;
  area: number;
}

export interface Vol {
  n: number;
  centre: [number, number, number];
  posScale: number;
  extScale: number;
  yMin: number;
  yMax: number;
  radius: number;
  off: number;
  len: number;
  /** filled in by loadMap */
  view: DataView;
}

export interface Nav {
  n: number;
  t: number;
  origin: [number, number, number];
  scale: number;
  vOff: number;
  vLen: number;
  iOff: number;
  iLen: number;
  /** filled in by loadMap */
  v: Uint16Array;
  i: Uint16Array;
}

export interface MapDoc {
  slug: string;
  key: string; // i18n key for the display name
  rot: number;
  worldMin: [number, number];
  worldMax: [number, number];
  layers: Layer[];
  navStats: NavStats | null;
  vol: Vol;
  nav: Nav | null;
  markers: Marker[];
  labels: ZoneLabel[];
}

export interface IndexEntry {
  slug: string;
  key: string;
  sizeM: [number, number];
  floors: number;
  markers: number;
  cats: string[];
  navStats: NavStats | null;
  bytes: number;
}

export interface AtlasIndex {
  maps: IndexEntry[];
  totals: { markers: number; faces: number; area: number };
}

export function loadIndex(): Promise<AtlasIndex> {
  return fetch(BASE + "data/index.json").then((r) => {
    if (!r.ok) throw new Error("index.json: " + r.status);
    return r.json();
  });
}

const cache = new Map<string, Promise<MapDoc>>();

export function loadMap(slug: string): Promise<MapDoc> {
  let p = cache.get(slug);
  if (!p) {
    p = fetchMap(slug);
    // a failed load must not be remembered as the answer for that arena
    p.catch(() => cache.delete(slug));
    cache.set(slug, p);
  }
  return p;
}

async function fetchMap(slug: string): Promise<MapDoc> {
  const [doc, buf] = await Promise.all([
    fetch(`${BASE}data/${slug}.json`).then((r) => {
      if (!r.ok) throw new Error(`${slug}.json: ${r.status}`);
      return r.json() as Promise<MapDoc>;
    }),
    fetch(`${BASE}data/${slug}.bin`).then((r) => {
      if (!r.ok) throw new Error(`${slug}.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  doc.vol.view = new DataView(buf, doc.vol.off, doc.vol.len);
  if (doc.nav) {
    // the writer pads every section to 4 bytes, so these views are always
    // aligned and can be taken over the buffer directly
    doc.nav.v = new Uint16Array(buf, doc.nav.vOff, doc.nav.vLen / 2);
    doc.nav.i = new Uint16Array(buf, doc.nav.iOff, doc.nav.iLen / 2);
  }
  return doc;
}

/** Warm the cache without blocking: used to prefetch the neighbouring arenas
 *  once the first one is on screen. */
export function prefetch(slug: string): void {
  if (!cache.has(slug)) loadMap(slug).catch(() => {});
}
