/* Draws the social cards in public/og/.
 *
 * Run by hand, not by the build:
 *
 *   npm i -D @resvg/resvg-js && node scripts/make-og.mjs
 *
 * The six PNGs are committed, so CI never needs the renderer or the fonts, and
 * a deploy cannot start depending on what is installed on one laptop. Re-run it
 * when the arena set, the wording or the colours change.
 *
 * The picture is the arena seen from directly above: the collision volumes the
 * atlas draws as the level itself, outlined and tinted by floor the way the app
 * tints them, held well back so the card reads as a backdrop and the title
 * stays the thing you see first. It needs no translating -- the shape of Tokyo
 * is the shape of Tokyo in eleven languages.
 */
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const W = 1200;
const H = 630;

/* Matches src/style.css and src/catalog.ts. Kept as literals because this
   script runs outside the bundler and reads no TypeScript. */
const GROUND = "#0a0d13";
const INK = "#dce4ef";
const MUTED = "#78899f";
const LIVE = "#ff6b4a";
/* src/catalog.ts FLOOR_COL: the height ramp the 3D view already uses, so the
   card and the arena agree on what a floor is. */
const FLOOR = { 1: "#FF9938", 2: "#54B8FF", 3: "#FF82BE" };

/* Where the map is allowed to sit. The left third is text, and the gradient
   below fades the drawing out underneath it rather than clipping it. */
const BOX = { x: 300, y: 8, w: 892, h: 614 };

const ARENAS = [
  { slug: "hm_jer", path: "jerusalem", name: "Jerusalem" },
  { slug: "hm_ny", path: "new-york", name: "New York" },
  { slug: "hm_rome", path: "rome", name: "Rome" },
  { slug: "horde_mode_02", path: "tokyo", name: "Tokyo" },
  { slug: "camp_04_pve", path: "airport-camp", name: "Airport / Camp" },
];

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function readArena(slug) {
  const doc = JSON.parse(fs.readFileSync(`public/data/${slug}.json`, "utf8"));
  const buf = fs.readFileSync(`public/data/${slug}.bin`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return {
    doc,
    vol: new DataView(ab, doc.vol.off, doc.vol.len),
    nav: new Uint16Array(ab, doc.nav.vOff, doc.nav.vLen / 2),
  };
}

/* Sixteen bytes a box: quantised centre, quantised half-extents, and the
   orientation as a byte quaternion. Same layout decodeBoxes() reads in
   src/gl/renderer.js -- if that ever changes, this changes with it. */
function boxes(doc, dv) {
  const v = doc.vol;
  const bands = doc.layers.map((L) => [L.yMin, L.yMax, L.floor]);
  const out = [];
  for (let i = 0, o = 0; i < v.n; i++, o += 16) {
    const c = [
      dv.getInt16(o, true) * v.posScale + v.centre[0],
      dv.getInt16(o + 2, true) * v.posScale + v.centre[1],
      dv.getInt16(o + 4, true) * v.posScale + v.centre[2],
    ];
    const e = [
      dv.getUint16(o + 6, true) * v.extScale,
      dv.getUint16(o + 8, true) * v.extScale,
      dv.getUint16(o + 10, true) * v.extScale,
    ];
    let qx = dv.getInt8(o + 12) / 127, qy = dv.getInt8(o + 13) / 127;
    let qz = dv.getInt8(o + 14) / 127, qw = dv.getInt8(o + 15) / 127;
    const ql = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= ql; qy /= ql; qz /= ql; qw /= ql;
    const xx = qx * qx, yy = qy * qy, zz = qz * qz;
    const xy = qx * qy, xz = qx * qz, yz = qy * qz;
    const wx = qw * qx, wy = qw * qy, wz = qw * qz;
    const ax = [
      1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
      2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
      2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy),
    ];

    let f = bands.length ? bands[0][2] : 1;
    for (const [lo, hi, fl] of bands) if (c[1] >= lo && c[1] < hi) f = fl;
    const last = bands[bands.length - 1];
    if (last && c[1] >= last[1]) f = last[2];

    out.push({ c, e, ax, f });
  }
  return out;
}

/* The footprint of a rotated box is the outline of its eight corners seen from
   above -- a quad when it sits square to the world, and anything up to a
   hexagon once a ramp or a leaning wall tilts it. Hulling the eight projected
   points covers both without special cases. */
function hull(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  const hi = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
    hi.push(p);
  }
  lo.pop();
  hi.pop();
  return lo.concat(hi);
}

const SIGNS = [
  [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
  [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
];

/* World XZ, turned the way the atlas turns it. `rot` is the heading the
   renderer starts its camera at, so applying it here is what makes the card
   and the app agree on which way is up. */
function projector(rotDeg) {
  const a = (rotDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (x, z) => [x * c - z * s, x * s + z * c];
}

function build(slug) {
  const { doc, vol, nav } = readArena(slug);
  const p = projector(doc.rot || 0);

  /* Framed on the navmesh, not on the volumes. The collision set reaches out
     to whatever the level authors put past the playable edge -- a skybox
     shell, a distant prop -- and letting that decide the crop would shrink the
     arena to a smudge in the middle. The walkable ground is the arena. */
  const o = doc.nav.origin;
  const sc = doc.nav.scale;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < doc.nav.n; k++) {
    const [a, b] = p(o[0] + nav[k * 3] * sc, o[2] + nav[k * 3 + 2] * sc);
    if (a < x0) x0 = a;
    if (a > x1) x1 = a;
    if (b < y0) y0 = b;
    if (b > y1) y1 = b;
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.03;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;

  // contain: the whole arena is on the card, never a cropped corner
  const k = Math.min(BOX.w / (x1 - x0), BOX.h / (y1 - y0));
  const ox = BOX.x + (BOX.w - (x1 - x0) * k) / 2;
  const oy = BOX.y + (BOX.h - (y1 - y0) * k) / 2;
  const X = (a) => ox + (a - x0) * k;
  const Y = (b) => oy + (b - y0) * k;
  const f1 = (v) => v.toFixed(1);

  /* One path per floor, lower floors first, so the upper deck reads as sitting
     on top of the street the way it does in the atlas. Anything under a pixel
     across is dropped: at this scale it is noise that only costs file size. */
  const paths = {};
  for (const b of boxes(doc, vol)) {
    const pts = SIGNS.map((s) => {
      const u = s[0] * b.e[0], w = s[1] * b.e[1], t = s[2] * b.e[2];
      return p(
        b.c[0] + u * b.ax[0] + w * b.ax[3] + t * b.ax[6],
        b.c[2] + u * b.ax[2] + w * b.ax[5] + t * b.ax[8],
      );
    });
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const [a, c] of pts) {
      if (a < bx0) bx0 = a;
      if (a > bx1) bx1 = a;
      if (c < by0) by0 = c;
      if (c > by1) by1 = c;
    }
    if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1) continue;
    if ((bx1 - bx0) * k < 1 && (by1 - by0) * k < 1) continue;

    const ring = hull(pts).map(([a, c]) => `${f1(X(a))} ${f1(Y(c))}`);
    (paths[b.f] ??= []).push("M" + ring.join("L") + "Z");
  }

  /* Outlines, not solids. Filled, thirty thousand overlapping volumes merge
     into one brown continent and the arena disappears; stroked, the same data
     reads as the plan of a building -- which is what it is. The faint fill only
     separates a room from the gap next to it. */
  const plan = Object.keys(paths)
    .map(Number)
    .sort((a, b) => a - b)
    .map((f) => {
      const col = FLOOR[f] ?? FLOOR[1];
      return (
        `<path d="${paths[f].join("")}" fill="${col}" fill-opacity=".03" ` +
        `stroke="${col}" stroke-opacity="${f === 1 ? ".3" : ".24"}" ` +
        `stroke-width=".8" stroke-linejoin="round"/>`
      );
    })
    .join("");

  return { doc, plan };
}

function card({ plan }, title, sub) {
  const lines = title.split("\n");
  // the block is centred on the card whether the title runs one line or two
  const top = 315 - (lines.length - 1) * 38;
  const big = lines
    .map(
      (l, k) =>
        `<text x="64" y="${top + k * 76}" class="big">${esc(l.toUpperCase())}</text>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${GROUND}" stop-opacity="1"/>
      <stop offset=".46" stop-color="${GROUND}" stop-opacity=".94"/>
      <stop offset=".80" stop-color="${GROUND}" stop-opacity="0"/>
    </linearGradient>
    <style>
      .big { font-family: Bahnschrift; font-size: 68px; fill: ${INK}; letter-spacing: 2px; }
      .mark { font-family: Consolas; font-size: 21px; fill: ${LIVE}; letter-spacing: 5px; }
      .sub { font-family: Bahnschrift; font-size: 31px; fill: ${MUTED}; letter-spacing: 1px; }
    </style>
  </defs>
  <rect width="${W}" height="${H}" fill="${GROUND}"/>
  ${plan}
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <rect x="0" y="0" width="10" height="${H}" fill="${LIVE}"/>
  <text x="64" y="${top - 88}" class="mark">HORDE MODE ATLAS</text>
  ${big}
  <text x="64" y="${top + lines.length * 76 - 8}" class="sub">${esc(sub)}</text>
</svg>`;
}

function write(svg, name) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: {
      loadSystemFonts: false,
      fontFiles: ["C:/Windows/Fonts/bahnschrift.ttf", "C:/Windows/Fonts/consola.ttf"],
      defaultFontFamily: "Bahnschrift",
    },
  })
    .render()
    .asPng();
  fs.mkdirSync("public/og", { recursive: true });
  fs.writeFileSync(path.join("public/og", name + ".png"), png);
  console.log(name + ".png", (png.length / 1024).toFixed(0) + " kB");
}

for (const a of ARENAS) {
  write(card(build(a.slug), a.name, "World War Z Horde Mode map"), a.path);
}

/* The front page is not an arena, so its card names the site and the set. It
   borrows the first arena's drawing because a card with nothing on it says
   less about what is behind the link than any real map does. */
write(
  card(
    build(ARENAS[0].slug),
    "World War Z\nHorde Mode Maps",
    "Five arenas, top-down, every object placed",
  ),
  "home",
);
