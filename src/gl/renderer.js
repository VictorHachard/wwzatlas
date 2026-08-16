/* The Horde Mode Atlas renderer.
 *
 * Ported from the standalone artifact, where it was tuned against all five
 * arenas. The graphics logic below is unchanged on purpose -- the shaders, the
 * HDR accumulation, the sub-floor clipping and the cap generation are the parts
 * that took the longest to get right and are the hardest to test from the
 * outside. What changed is the shape around them:
 *
 *   - module globals became closure state, so a page can hold one instance
 *     and tear it down;
 *   - geometry arrives already decoded from the .bin payload instead of being
 *     base64 inside the page, so decodeBoxes/navPositions read typed arrays;
 *   - everything that used to poke at the DOM (the rail, the tooltip, the
 *     readout) is now a callback, and Preact owns that side.
 *
 * It stays plain JavaScript: see the note in tsconfig.json. The public surface
 * is typed in renderer.d.ts.
 */

/* One scene, one camera. Looking straight down through a narrow field of view
   gives a near-orthographic plan; tilting opens the field back up to a normal
   perspective. The field therefore follows the elevation.

   The camera is parameterised by the ground half-height it frames, not by its
   distance: distance is derived. Otherwise every change of field of view would
   also change the framing, and tilting would zoom. */
const TOP_EL = 1.5533; // ~89 degrees; exactly 90 makes lookAt degenerate
const TOP_FOV = 11;
const PERSP_FOV = 50;
const TILT_FROM = 0.9;

// canvas font must be a literal stack: a CSS custom property comes back with
// leading whitespace and the ctx.font setter silently rejects it.
const FACE =
  'Bahnschrift,"DIN Alternate","Segoe UI",system-ui,sans-serif';

const VS = `attribute vec3 aPos; attribute vec2 aTS;
uniform mat4 uMVP; varying float vT; varying float vS; varying float vD;
varying float vY;
void main(){ vec4 p = uMVP * vec4(aPos,1.0); gl_Position = p;
             vT = aTS.x; vS = aTS.y; vD = p.w; vY = aPos.y; }`;

const FS = `precision mediump float; varying float vT; varying float vS; varying float vD;
varying float vY;
uniform vec2 uFog; uniform float uGain;
uniform float uTintOn; uniform float uAlpha; uniform float uClipY;
/* same height ramp the 2D map uses, so the two views read alike */
vec3 navRamp(float t){
  float u = clamp(t, 0.0, 1.0) * 4.0;
  vec3 c = mix(vec3(0.149,0.275,0.502), vec3(0.133,0.478,0.549), clamp(u,       0.0, 1.0));
  c      = mix(c,                       vec3(0.337,0.651,0.486), clamp(u - 1.0, 0.0, 1.0));
  c      = mix(c,                       vec3(0.839,0.745,0.455), clamp(u - 2.0, 0.0, 1.0));
  c      = mix(c,                       vec3(0.965,0.949,0.910), clamp(u - 3.0, 0.0, 1.0));
  return c;
}
void main(){
  // Nothing walkable exists below the lowest navmesh point, so with the overlay
  // on we cut the model there. Per fragment, not per box: the volumes that hang
  // low are mostly tall ones that cross the floor, and dropping them whole would
  // take the building with them.
  if (vY < uClipY) discard;
  vec3 lo = vec3(1.00,0.60,0.22);          // ground level, orange
  vec3 hi = vec3(0.33,0.72,1.00);          // upper levels, blue
  vec3 c = mix(mix(lo, hi, clamp(vT,0.0,1.0)), navRamp(vT), uTintOn);
  float f = clamp((uFog.y - vD) / max(uFog.y - uFog.x, 1.0), 0.04, 1.0);
  gl_FragColor = vec4(c * f * vS * uGain, uAlpha);
}`;

/* Fullscreen pass that compresses the accumulated line density.
   Reinhard on luminance only, so the hue survives: sparse areas stay linear,
   dense ones keep gaining but ever more slowly instead of clipping to white. */
const QVS = `attribute vec2 aQ; varying vec2 vUv;
void main(){ vUv = aQ*0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }`;

const QFS = `precision highp float; varying vec2 vUv;
uniform sampler2D uTex; uniform float uExp; uniform vec3 uBg;
void main(){
  vec3 a = texture2D(uTex, vUv).rgb;
  float L = dot(a, vec3(0.30, 0.59, 0.11));
  float Lm = (uExp * L) / (1.0 + uExp * L);
  vec3 c = a * (Lm / max(L, 1e-4));
  gl_FragColor = vec4(uBg + c, 1.0);
}`;

/* 12 edges of a unit cube, as pairs of corner indices
   (corner index = 4*(sx>0) + 2*(sy>0) + 1*(sz>0)) */
const EDGES = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7];
const SIGNS = [];
for (let sx = -1; sx <= 1; sx += 2)
  for (let sy = -1; sy <= 1; sy += 2)
    for (let sz = -1; sz <= 1; sz += 2) SIGNS.push([sx, sy, sz]);

/* two triangles per face; corner indices as above */
const TRIS = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5,   // -X, +X
              0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6,   // -Y, +Y
              0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];  // -Z, +Z
const TRI_AXIS = [0, 0, 1, 1, 2, 2];
const TRI_SIGN = [-1, 1, -1, 1, -1, 1];
const LIGHT = [-0.42, 0.82, -0.39];

/* Lowest walkable height per 3 m cell of XZ. Used to drop collision volumes
   that sit entirely under the floor -- basements and foundation blocks that
   only clutter the view once the navmesh is on. */
const NAV_CELL = 3.0;

/* --- tiny mat4 --- */
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, ctr, up) {
  let z0 = eye[0] - ctr[0], z1 = eye[1] - ctr[1], z2 = eye[2] - ctr[2];
  let l = Math.hypot(z0, z1, z2) || 1; z0 /= l; z1 /= l; z2 /= l;
  let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
  l = Math.hypot(x0, x1, x2) || 1; x0 /= l; x1 /= l; x2 /= l;
  const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
  return [x0, y0, z0, 0, x1, y1, z1, 0, x2, y2, z2, 0,
          -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
          -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
          -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]), 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}

/* --- geometry, cached on the arena document so switching back is instant --- */

function decodeBoxes(m) {
  if (m._boxes) return m._boxes;
  const v = m.vol, dv = v.view, n = v.n;
  const B = {
    n, c: new Float32Array(n * 3), e: new Float32Array(n * 3),
    ax: new Float32Array(n * 9), floor: new Uint8Array(n),
  };
  const bands = m.layers.map((L) => [L.yMin, L.yMax, L.floor]);
  for (let i = 0, o = 0; i < n; i++, o += 16) {
    const cx = dv.getInt16(o, true) * v.posScale;
    const cy = dv.getInt16(o + 2, true) * v.posScale;
    const cz = dv.getInt16(o + 4, true) * v.posScale;
    B.c[i * 3] = cx; B.c[i * 3 + 1] = cy; B.c[i * 3 + 2] = cz;
    B.e[i * 3]     = dv.getUint16(o + 6, true) * v.extScale;
    B.e[i * 3 + 1] = dv.getUint16(o + 8, true) * v.extScale;
    B.e[i * 3 + 2] = dv.getUint16(o + 10, true) * v.extScale;
    let qx = dv.getInt8(o + 12) / 127, qy = dv.getInt8(o + 13) / 127;
    let qz = dv.getInt8(o + 14) / 127, qw = dv.getInt8(o + 15) / 127;
    const ql = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= ql; qy /= ql; qz /= ql; qw /= ql;
    // quaternion -> rotation matrix; ax[0..2] is axis 0, ax[3..5] axis 1, ax[6..8] axis 2
    const xx = qx * qx, yy = qy * qy, zz = qz * qz;
    const xy = qx * qy, xz = qx * qz, yz = qy * qz;
    const wx = qw * qx, wy = qw * qy, wz = qw * qz, a = i * 9;
    B.ax[a]     = 1 - 2 * (yy + zz); B.ax[a + 1] = 2 * (xy + wz);     B.ax[a + 2] = 2 * (xz - wy);
    B.ax[a + 3] = 2 * (xy - wz);     B.ax[a + 4] = 1 - 2 * (xx + zz); B.ax[a + 5] = 2 * (yz + wx);
    B.ax[a + 6] = 2 * (xz + wy);     B.ax[a + 7] = 2 * (yz - wx);     B.ax[a + 8] = 1 - 2 * (xx + yy);
    const abs = cy + v.centre[1];
    let f = bands.length ? bands[0][2] : 1;
    for (const [lo2, hi2, fl] of bands) if (abs >= lo2 && abs < hi2) f = fl;
    if (bands.length && abs >= bands[bands.length - 1][1]) f = bands[bands.length - 1][2];
    B.floor[i] = f;
  }
  // group by floor so a floor can be drawn as one contiguous range
  B.order = Array.from({ length: n }, (_, i) => i).sort((p, q) => B.floor[p] - B.floor[q]);
  B.ranges = {};
  let cur = -1;
  B.order.forEach((bi, k) => {
    const f = B.floor[bi];
    if (f !== cur) { B.ranges[f] = { start: k, count: 0 }; cur = f; }
    B.ranges[f].count++;
  });
  m._boxes = B;
  return B;
}

function corners8(B, i, out) {
  const c = i * 3, a = i * 9;
  for (let k = 0; k < 8; k++) {
    const s = SIGNS[k];
    const u = s[0] * B.e[c], w2 = s[1] * B.e[c + 1], t = s[2] * B.e[c + 2];
    out[k * 3]     = B.c[c]     + u * B.ax[a]     + w2 * B.ax[a + 3] + t * B.ax[a + 6];
    out[k * 3 + 1] = B.c[c + 1] + u * B.ax[a + 1] + w2 * B.ax[a + 4] + t * B.ax[a + 7];
    out[k * 3 + 2] = B.c[c + 2] + u * B.ax[a + 2] + w2 * B.ax[a + 5] + t * B.ax[a + 8];
  }
}

/* navmesh vertices in the scene's local frame, decoded once per arena.
   Positions arrive quantised over the mesh's own AABB; vol.centre puts them in
   the scene's local frame, the same one the boxes already live in. */
function navPositions(m) {
  if (m._navP) return m._navP;
  const N = m.nav;
  if (!N) return null;
  const q = N.v, c = m.vol.centre, sc = N.scale, o = N.origin;
  const P = new Float32Array(N.n * 3);
  for (let i = 0; i < N.n; i++) {
    P[i * 3]     = o[0] + q[i * 3]     * sc - c[0];
    P[i * 3 + 1] = o[1] + q[i * 3 + 1] * sc - c[1];
    P[i * 3 + 2] = o[2] + q[i * 3 + 2] * sc - c[2];
  }
  m._navP = P;
  return P;
}

function navGrid(m) {
  if (m._navGrid) return m._navGrid;
  const P = navPositions(m);
  if (!P) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, gmin = Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < x0) x0 = P[i];
    if (P[i] > x1) x1 = P[i];
    if (P[i + 2] < z0) z0 = P[i + 2];
    if (P[i + 2] > z1) z1 = P[i + 2];
    if (P[i + 1] < gmin) gmin = P[i + 1];
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / NAV_CELL) + 1);
  const nz = Math.max(1, Math.ceil((z1 - z0) / NAV_CELL) + 1);
  const g = new Float32Array(nx * nz).fill(Infinity);
  for (let i = 0; i < P.length; i += 3) {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((P[i]     - x0) / NAV_CELL)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((P[i + 2] - z0) / NAV_CELL)));
    const k = iz * nx + ix;
    if (P[i + 1] < g[k]) g[k] = P[i + 1];
  }
  // where a cell has no navmesh at all, fall back to the lowest walkable point
  // anywhere on the arena, so distant scenery hanging below it is cut too
  for (let k = 0; k < g.length; k++) if (g[k] === Infinity) g[k] = gmin;
  m._navGrid = { x0, z0, nx, nz, g, gmin };
  return m._navGrid;
}

function navFloorAt(G, x, z) {
  const ix = Math.floor((x - G.x0) / NAV_CELL), iz = Math.floor((z - G.z0) / NAV_CELL);
  if (ix < 0 || iz < 0 || ix >= G.nx || iz >= G.nz) return G.gmin;
  return G.g[iz * G.nx + ix];
}

function buildBuffer(m, solid) {
  const B = decodeBoxes(m), v = m.vol;
  const per = solid ? 36 : 24;
  const span = Math.max(v.yMax - v.yMin, 1e-3);
  const arr = new Float32Array(B.n * per * 5);
  const cn = new Float32Array(24);
  // volumes lying entirely below the walkable floor are never useful, in either
  // view, so this is unconditional -- the checkbox only governs the green surface
  const G = m.nav ? navGrid(m) : null;
  const ranges = {};
  let w = 0, kept = 0;
  for (const bi of B.order) {
    const fl = B.floor[bi];
    if (!(fl in ranges)) ranges[fl] = { start: kept, count: 0 };
    corners8(B, bi, cn);
    if (G) {
      let top = -Infinity, cx = 0, cz = 0;
      for (let k = 0; k < 8; k++) {
        if (cn[k * 3 + 1] > top) top = cn[k * 3 + 1];
        cx += cn[k * 3]; cz += cn[k * 3 + 2];
      }
      // 0.5 m of slack so floor slabs flush with the navmesh survive
      if (top < navFloorAt(G, cx / 8, cz / 8) - 0.5) continue;
    }
    ranges[fl].count++; kept++;
    if (!solid) {
      for (let k = 0; k < 24; k++) {
        const ci = EDGES[k] * 3, py = cn[ci + 1];
        arr[w++] = cn[ci]; arr[w++] = py; arr[w++] = cn[ci + 2];
        arr[w++] = (py + v.centre[1] - v.yMin) / span; arr[w++] = 1;
      }
    } else {
      const a = bi * 9;
      for (let f = 0; f < 6; f++) {
        const sg = TRI_SIGN[f], ai = TRI_AXIS[f] * 3;
        const nx = sg * B.ax[a + ai], ny = sg * B.ax[a + ai + 1], nz = sg * B.ax[a + ai + 2];
        const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        const sh = 0.30 + 0.70 * lam;
        for (let t = 0; t < 6; t++) {
          const ci = TRIS[f * 6 + t] * 3, py = cn[ci + 1];
          arr[w++] = cn[ci]; arr[w++] = py; arr[w++] = cn[ci + 2];
          arr[w++] = (py + v.centre[1] - v.yMin) / span; arr[w++] = sh;
        }
      }
    }
  }
  return { arr: arr.subarray(0, w), per, ranges, kept, total: B.n };
}

/* Cross-section of the boxes at the clip plane.

   The shader throws away everything below the plane, which leaves a sliced box
   open at the bottom -- it reads as a broken shape rather than a solid sitting
   on the ground. Capping it closes the volume back up: for every box the plane
   crosses, intersect the 12 edges with it, sort the hits around their centroid
   (the section of a convex box by a horizontal plane is a convex polygon of 3 to
   6 points) and emit that outline, or a fan filling it in solid mode.

   Ranges are in vertices, not boxes, because the cap size varies per box. */
function buildCaps(m, solid, clipY) {
  const B = decodeBoxes(m), v = m.vol;
  const span = Math.max(v.yMax - v.yMin, 1e-3);
  const EPS = 0.01; // sit just above the plane, not on it
  const y = clipY + EPS;
  const arr = new Float32Array(B.n * 24 * 5);
  const cn = new Float32Array(24);
  const px = new Float64Array(8), pz = new Float64Array(8);
  const ranges = {};
  // the cap faces down, away from the solid that is left above it
  // a downward face gets no light at all, so lift the ambient or it reads as a hole
  const sh = solid ? 0.45 + 0.55 * Math.max(0, -LIGHT[1]) : 1;
  let w = 0;
  for (const bi of B.order) {
    const fl = B.floor[bi];
    if (!(fl in ranges)) ranges[fl] = { start: w / 5, count: 0 };
    corners8(B, bi, cn);
    let lo2 = Infinity, hi2 = -Infinity;
    for (let k = 0; k < 8; k++) {
      const q = cn[k * 3 + 1];
      if (q < lo2) lo2 = q;
      if (q > hi2) hi2 = q;
    }
    if (lo2 >= y || hi2 <= y) continue; // plane misses this box
    let np = 0;
    for (let k = 0; k < 24; k += 2) {
      const a = EDGES[k] * 3, b = EDGES[k + 1] * 3;
      const ya = cn[a + 1], yb = cn[b + 1];
      if ((ya < y) === (yb < y)) continue;
      const t = (y - ya) / (yb - ya);
      px[np] = cn[a]     + t * (cn[b]     - cn[a]);
      pz[np] = cn[a + 2] + t * (cn[b + 2] - cn[a + 2]);
      np++;
      if (np === 8) break;
    }
    if (np < 3) continue;
    let cx = 0, cz = 0;
    for (let k = 0; k < np; k++) { cx += px[k]; cz += pz[k]; }
    cx /= np; cz /= np;
    const ord = Array.from({ length: np }, (_, k) => k)
      .sort((p, q) => Math.atan2(pz[p] - cz, px[p] - cx) - Math.atan2(pz[q] - cz, px[q] - cx));
    const tt = (y + v.centre[1] - v.yMin) / span;
    const put = (X, Z) => { arr[w++] = X; arr[w++] = y; arr[w++] = Z; arr[w++] = tt; arr[w++] = sh; };
    for (let k = 0; k < np; k++) {
      const a = ord[k], b = ord[(k + 1) % np];
      if (solid) { put(cx, cz); put(px[a], pz[a]); put(px[b], pz[b]); }
      else { put(px[a], pz[a]); put(px[b], pz[b]); }
    }
    ranges[fl].count = w / 5 - ranges[fl].start;
  }
  return { arr: arr.subarray(0, w), ranges };
}

function buildNav(m) {
  const N = m.nav;
  if (!N) return null;
  if (m._nav3d) return m._nav3d;
  const P = navPositions(m), idx = N.i;
  // Height is normalised over the NAVMESH's own range, not the whole volume
  // stack: measured against the buildings the walkable surface occupies a thin
  // band, and the ramp would collapse to a single colour. Per triangle, and by
  // its mean, so the 3D colours match the 2D map exactly.
  let ylo = Infinity, yhi = -Infinity;
  const key = new Float32Array(N.t);
  for (let t = 0; t < N.t; t++) {
    const s = (P[idx[t * 3] * 3 + 1] + P[idx[t * 3 + 1] * 3 + 1] + P[idx[t * 3 + 2] * 3 + 1]) / 3;
    key[t] = s;
    if (s < ylo) ylo = s;
    if (s > yhi) yhi = s;
  }
  const span = Math.max(yhi - ylo, 1e-6);
  const arr = new Float32Array(N.t * 3 * 5);
  let w = 0;
  for (let t = 0; t < N.t; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, d = idx[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // navmesh winding is not guaranteed, so light it from both sides
    const lam = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const sh = 0.42 + 0.58 * lam;
    const tt = (key[t] - ylo) / span;
    for (const ci of [a, b, d]) {
      arr[w++] = P[ci]; arr[w++] = P[ci + 1]; arr[w++] = P[ci + 2];
      arr[w++] = tt; arr[w++] = sh;
    }
  }
  m._nav3d = arr;
  return arr;
}

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.glCanvas   the WebGL surface
 * @param {HTMLCanvasElement} o.overlay    2D canvas for markers and zone names
 * @param {HTMLElement}       o.stage      the element both canvases fill
 * @param {object}            o.catBy      category id -> {g, col}
 * @param {object}            o.floorCol   floor number -> css colour
 * @param {(z: object) => string} o.zoneText  how to print a zone label
 * @param {(hit: object|null, x: number, y: number) => void} [o.onHover]
 * @param {(cam: object) => void} [o.onCamera]
 * @param {(culled: number) => void} [o.onCull]
 * @param {() => void} [o.onNoWebGL]
 */
export function createRenderer(o) {
  const glc = o.glCanvas, cv = o.overlay, stage = o.stage;
  const ctx = cv.getContext("2d");

  let M = null;                    // the arena on screen
  let floorsOn = new Set();
  let catsOn = new Set();
  let navOn = true;
  let showZones = true;
  // "Faces pleines" is retired: shading collision boxes as solids reads worse
  // than the wireframe, which is what actually shows the density. The code path
  // stays (it drives buildBuffer, buildCaps and the blend setup), so restoring
  // the toggle is a matter of putting two buttons back.
  const solidMode = false;
  const exposure = 1.2;

  let gl = null, prog = null, vbo = null, glMap = null;
  let toneProg = null, quadVbo = null, fbo = null, fboTex = null;
  let fboW = 0, fboH = 0, hdr = false, glver = 1;
  let navVbo = null, navMap = null, navCount = 0;
  let capVbo = null, capInfo = null, bufInfo = null;
  let MVP = null;
  let disposed = false;

  const cam = { az: -0.7, el: TOP_EL, half: 300, tx: 0, ty: 0 };

  const rot = () => (((M?.rot || 0) % 360) + 360) % 360;
  const camRadius = () => (M?.vol ? M.vol.radius : 300);
  function camFov() {
    const t = Math.max(0, Math.min(1, (cam.el - TILT_FROM) / (TOP_EL - TILT_FROM)));
    return PERSP_FOV + (TOP_FOV - PERSP_FOV) * (t * t * (3 - 2 * t));
  }
  const camDist = () => cam.half / Math.tan((camFov() * Math.PI) / 360);

  function compile(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s));
    return s;
  }

  function initGL() {
    if (gl !== null) return gl;
    const opts = { antialias: true, alpha: false, premultipliedAlpha: false };
    gl = glc.getContext("webgl2", opts);
    glver = gl ? 2 : 1;
    if (!gl) gl = glc.getContext("webgl", opts);
    if (!gl) { o.onNoWebGL?.(); return null; }

    prog = gl.createProgram();
    gl.attachShader(prog, compile(VS, gl.VERTEX_SHADER));
    gl.attachShader(prog, compile(FS, gl.FRAGMENT_SHADER));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.bindAttribLocation(prog, 1, "aTS");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(prog));
      gl = null; o.onNoWebGL?.(); return null;
    }
    vbo = gl.createBuffer();
    navVbo = gl.createBuffer();
    capVbo = gl.createBuffer();

    // an HDR accumulation target is what makes the compression possible at all;
    // an 8-bit target would clip before the curve ever sees the density
    hdr = glver === 2
      ? !!gl.getExtension("EXT_color_buffer_float")
      : !!(gl.getExtension("OES_texture_half_float") &&
           gl.getExtension("EXT_color_buffer_half_float"));
    if (hdr) {
      toneProg = gl.createProgram();
      gl.attachShader(toneProg, compile(QVS, gl.VERTEX_SHADER));
      gl.attachShader(toneProg, compile(QFS, gl.FRAGMENT_SHADER));
      gl.bindAttribLocation(toneProg, 0, "aQ");
      gl.linkProgram(toneProg);
      if (!gl.getProgramParameter(toneProg, gl.LINK_STATUS)) {
        console.warn(gl.getProgramInfoLog(toneProg)); hdr = false;
      } else {
        quadVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        fbo = gl.createFramebuffer();
        fboTex = gl.createTexture();
      }
    }
    return gl;
  }

  function ensureTarget(w, h) {
    if (!hdr || (w === fboW && h === fboH)) return;
    fboW = w; fboH = h;
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    if (glver === 2) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      const HF = gl.getExtension("OES_texture_half_float").HALF_FLOAT_OES;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, HF, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) hdr = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function buildGeometry() {
    const key = M.slug + (solidMode ? "|s" : "|w");
    if (glMap === key) return;
    const r = buildBuffer(M, solidMode);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, r.arr, gl.STATIC_DRAW);
    bufInfo = r;
    // close the sliced boxes back up at the plane
    const clipY = M.nav ? navGrid(M).gmin - 0.5 : null;
    if (clipY === null) {
      capInfo = null;
    } else {
      capInfo = buildCaps(M, solidMode, clipY);
      gl.bindBuffer(gl.ARRAY_BUFFER, capVbo);
      gl.bufferData(gl.ARRAY_BUFFER, capInfo.arr, gl.STATIC_DRAW);
    }
    glMap = key;
    o.onCull?.(r.total - r.kept);
  }

  function project3(p) {
    const x = p[0], y = p[1], z = p[2];
    const cx = MVP[0] * x + MVP[4] * y + MVP[8] * z + MVP[12];
    const cy = MVP[1] * x + MVP[5] * y + MVP[9] * z + MVP[13];
    const cw = MVP[3] * x + MVP[7] * y + MVP[11] * z + MVP[15];
    if (cw <= 0.001) return null;
    const r = stage.getBoundingClientRect();
    return [(cx / cw * 0.5 + 0.5) * r.width, (0.5 - cy / cw * 0.5) * r.height];
  }

  function screenOf(k) {
    // MVP only exists once a frame has been drawn; without a WebGL context there
    // is no projection at all, and the overlay must simply not be placed.
    if (!MVP || !M?.vol) return null;
    const c = M.vol.centre;
    return project3([k.x - c[0], (k.y ?? 0) - c[1], k.zz - c[2]]);
  }

  function drawGL() {
    if (!initGL()) return;
    buildGeometry();
    const r = stage.getBoundingClientRect();
    const useHDR = hdr && !solidMode;
    if (useHDR) ensureTarget(glc.width, glc.height);
    const toneOn = hdr && !solidMode; // ensureTarget may have cleared hdr on failure

    gl.bindFramebuffer(gl.FRAMEBUFFER, toneOn ? fbo : null);
    gl.viewport(0, 0, glc.width, glc.height);
    if (toneOn) {
      gl.clearColor(0, 0, 0, 1); // background added after the curve
    } else {
      gl.clearColor(0.020, 0.027, 0.043, 1);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (solidMode) {
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    } else {
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    }

    const ce = Math.cos(cam.el), se = Math.sin(cam.el);
    const eye = [camDist() * ce * Math.cos(cam.az) + cam.tx,
                 camDist() * se,
                 camDist() * ce * Math.sin(cam.az) + cam.ty];
    const ctr = [cam.tx, 0, cam.ty];
    const P = perspective((camFov() * Math.PI) / 180, r.width / Math.max(r.height, 1),
                          Math.max(camDist() * 0.005, 0.5), camDist() * 4 + 20000);
    MVP = mul(P, lookAt(eye, ctr, [0, 1, 0]));

    const U = (n) => gl.getUniformLocation(prog, n);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(U("uMVP"), false, new Float32Array(MVP));
    gl.uniform2f(U("uFog"), camDist() * 0.15, camDist() * 2.4);
    // in HDR the curve does the limiting, so each line can contribute a small
    // linear amount; without it we fall back to the old pre-dimmed constant
    gl.uniform1f(U("uGain"), solidMode ? 1.0 : toneOn ? 0.30 : 0.42);
    gl.uniform1f(U("uTintOn"), 0.0);
    gl.uniform1f(U("uAlpha"), 1.0);
    // cut the model at the lowest walkable point once the overlay is on
    const clipY = M.nav ? navGrid(M).gmin - 0.5 : -1e9;
    gl.uniform1f(U("uClipY"), clipY);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    // one contiguous range per floor, so the layer checkboxes cut the model
    const per = bufInfo.per, mode = solidMode ? gl.TRIANGLES : gl.LINES;
    Object.keys(bufInfo.ranges).forEach((f) => {
      if (!floorsOn.has(+f)) return;
      const r2 = bufInfo.ranges[f];
      gl.drawArrays(mode, r2.start * per, r2.count * per);
    });

    // the caps close the boxes the plane sliced; their ranges are in vertices
    if (capInfo && capInfo.arr.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER, capVbo);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      gl.uniform1f(U("uClipY"), -1e9); // the cap IS the plane
      Object.keys(capInfo.ranges).forEach((f) => {
        if (!floorsOn.has(+f)) return;
        const r3 = capInfo.ranges[f];
        if (r3.count > 0) gl.drawArrays(mode, r3.start, r3.count);
      });
      gl.uniform1f(U("uClipY"), clipY);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    }

    // the navmesh sits on top of the volumes, in the same frame
    if (navOn && M.nav) {
      const arr = buildNav(M);
      if (arr) {
        if (navMap !== M.slug) {
          gl.bindBuffer(gl.ARRAY_BUFFER, navVbo);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
          navMap = M.slug; navCount = arr.length / 5;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, navVbo);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
        gl.uniform1f(U("uTintOn"), 1.0);
        gl.uniform1f(U("uClipY"), -1e9); // never clip the mesh itself
        // It is an overlay: never depth-tested. A collision box wraps a whole
        // building, so any navmesh inside one would simply vanish behind it.
        gl.disable(gl.DEPTH_TEST);
        if (solidMode) {
          // no additive accumulation here, so blend it over the solids instead
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.uniform1f(U("uAlpha"), 0.88);
          gl.uniform1f(U("uGain"), 1.0);
        } else {
          gl.uniform1f(U("uGain"), toneOn ? 0.34 : 0.46);
        }
        gl.drawArrays(gl.TRIANGLES, 0, navCount);
        gl.uniform1f(U("uTintOn"), 0.0);
        gl.uniform1f(U("uAlpha"), 1.0);
        if (solidMode) { gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); }
      }
    }

    if (!toneOn) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, glc.width, glc.height);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(toneProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.uniform1i(gl.getUniformLocation(toneProg, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(toneProg, "uExp"), exposure);
    gl.uniform3f(gl.getUniformLocation(toneProg, "uBg"), 0.020, 0.027, 0.043);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function visibleMarkers() {
    if (!M) return [];
    return M.markers.filter((k) => catsOn.has(k.c) && floorsOn.has(k.f));
  }

  /* zone labels + markers, in screen space */
  function drawOverlay(r) {
    if (showZones) {
      ctx.font = "600 11px " + FACE;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      M.labels.forEach((z) => {
        if (!floorsOn.has(z.f)) return;
        const s = screenOf(z);
        if (!s) return;
        const [sx, sy] = s;
        if (sx < -60 || sy < -20 || sx > r.width + 60 || sy > r.height + 20) return;
        const t = o.zoneText(z);
        const w = ctx.measureText(t).width;
        ctx.fillStyle = "rgba(10,13,19,.72)";
        ctx.fillRect(sx - w / 2 - 5, sy - 8, w + 10, 16);
        ctx.fillStyle = "#93A3B8"; ctx.fillText(t, sx, sy);
      });
    }
    visibleMarkers().forEach((k) => {
      const cat = o.catBy[k.c] || { g: "?", col: "#fff" };
      const s = screenOf(k);
      if (!s) return;
      const [sx, sy] = s;
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fillStyle = cat.col; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = o.floorCol[k.f] || "#fff"; ctx.stroke();
      ctx.fillStyle = "#0A0D13";
      ctx.font = "700 10px " + FACE;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(cat.g, sx, sy + 0.5);
    });
  }

  function draw() {
    if (!M || disposed) return;
    const r = stage.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    drawGL();
    drawOverlay(r);
  }

  /* A pointer can fire several moves per displayed frame. Redrawing on each one
     does the work more than once and still shows only the last, which reads as
     lag; coalescing into one animation frame keeps the drag on the cursor. */
  let pending = false;
  function scheduleDraw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  }

  function pick(mx, my) {
    let best = null, bd = 13;
    visibleMarkers().forEach((k) => {
      const s = screenOf(k);
      if (!s) return;
      const d = Math.hypot(s[0] - mx, s[1] - my);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  function reportCam() {
    o.onCamera?.({
      az: (cam.az * 180) / Math.PI,
      el: (cam.el * 180) / Math.PI,
      dist: camDist(),
    });
  }

  function resetCam() {
    if (!M) return;
    // straight down, aligned the way this arena reads best. Screen-right is the
    // ground direction (az - pi/2), so turning the view clockwise by t is az - t.
    cam.az = -Math.PI / 2 - (rot() * Math.PI) / 180;
    cam.el = TOP_EL;
    cam.half = camRadius() * 1.15;
    cam.tx = 0; cam.ty = 0;
    reportCam();
  }

  let flyRaf = 0;
  /* half is the framed ground half-height; the camera has no distance of its
     own, so that is what gets animated */
  function flyTo(tx, ty, half) {
    const from = { tx: cam.tx, ty: cam.ty, h: cam.half }, t0 = performance.now();
    cancelAnimationFrame(flyRaf);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cam.tx = tx; cam.ty = ty; cam.half = half; reportCam(); draw(); return;
    }
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 520);
      const s = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
      cam.tx = from.tx + (tx - from.tx) * s;
      cam.ty = from.ty + (ty - from.ty) * s;
      cam.half = from.h + (half - from.h) * s;
      draw();
      if (k < 1) flyRaf = requestAnimationFrame(step);
      else reportCam();
    };
    flyRaf = requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------- input --- */
  let drag = null;

  const onContext = (e) => e.preventDefault();
  const onDown = (e) => {
    drag = {
      x: e.clientX, y: e.clientY, moved: false,
      az: cam.az, el: cam.el, ctx: cam.tx, cty: cam.ty,
      // left button moves the map, right button turns the camera
      pan: e.button !== 2 && !e.shiftKey,
    };
    cv.classList.add("grabbing");
  };
  const onMove = (e) => {
    if (!M) return;
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.pan) {
        // screen right on the ground is (sin az, 0, -cos az) and screen down is
        // (cos az, 0, sin az); to keep the point under the cursor the target
        // moves against the drag. The view spans 2*half metres over the canvas
        // height, so one pixel is exactly that much ground -- a constant here
        // makes the grab slide.
        const k = (2 * cam.half) / Math.max(r.height, 1);
        const ca = Math.cos(cam.az), sa = Math.sin(cam.az);
        cam.tx = drag.ctx - (dx * sa + dy * ca) * k;
        cam.ty = drag.cty - (-dx * ca + dy * sa) * k;
      } else {
        cam.az = drag.az + dx * 0.006;
        cam.el = Math.max(0.03, Math.min(TOP_EL, drag.el + dy * 0.005));
      }
      reportCam();
      scheduleDraw();
      return;
    }
    const hit = e.target === cv ? pick(mx, my) : null;
    o.onHover?.(hit, mx, my);
  };
  const onUp = (e) => {
    const wasDrag = drag && drag.moved;
    drag = null;
    cv.classList.remove("grabbing");
    // click a marker to bring the camera to it
    if (wasDrag || e.target !== cv || !M?.vol) return;
    const r = cv.getBoundingClientRect();
    const hit = pick(e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    const c = M.vol.centre;
    flyTo(hit.x - c[0], hit.zz - c[2], M.vol.radius * 0.35);
  };
  const onWheel = (e) => {
    e.preventDefault();
    if (!M) return;
    cam.half = Math.max(camRadius() * 0.02,
                        Math.min(camRadius() * 3, cam.half * Math.exp(e.deltaY * 0.0011)));
    reportCam();
    scheduleDraw();
  };

  cv.addEventListener("contextmenu", onContext);
  cv.addEventListener("mousedown", onDown);
  cv.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  function resize() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cv.style.width = r.width + "px"; cv.style.height = r.height + "px";
    glc.width = Math.round(r.width * dpr); glc.height = Math.round(r.height * dpr);
    draw();
  }

  return {
    setMap(doc, keepCamera) {
      M = doc;
      glMap = null; // force a geometry rebuild for the new arena
      floorsOn = new Set(doc.layers.map((L) => L.floor));
      if (!keepCamera) resetCam();
      draw();
    },
    setFloors(set) { floorsOn = new Set(set); draw(); },
    setCats(set) { catsOn = new Set(set); draw(); },
    setNav(on) { navOn = on; draw(); },
    setZones(on) { showZones = on; draw(); },
    floors: () => new Set(floorsOn),
    resetCam() { resetCam(); draw(); },
    zoomBy(f) {
      cam.half = Math.max(camRadius() * 0.02, Math.min(camRadius() * 3, cam.half * f));
      reportCam(); draw();
    },
    flyTo,
    resize,
    draw,
    dispose() {
      disposed = true;
      cancelAnimationFrame(flyRaf);
      cv.removeEventListener("contextmenu", onContext);
      cv.removeEventListener("mousedown", onDown);
      cv.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // let the driver reclaim the context instead of waiting for GC
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
    },
  };
}
