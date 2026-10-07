import type { LonLat, Polygon, Ring } from './types';

const R_EARTH_M = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees true (0 = north, 90 = east). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by moving `meters` from `p` on `bearing` (flat-earth, fine under a few km). */
export function offset(p: LonLat, bearing: number, meters: number): LonLat {
  const dLat = (meters * Math.cos(toRad(bearing))) / 111320;
  const dLon = (meters * Math.sin(toRad(bearing))) / (111320 * Math.cos(toRad(p[1])));
  return [p[0] + dLon, p[1] + dLat];
}

/** Smallest absolute difference between two bearings, 0..180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const NAMES8: Record<string, string> = {
  N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest',
};

export function compass16(deg: number): string {
  return POINTS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function compassWord(deg: number): string {
  const k = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  return NAMES8[k];
}

export function pointInRing(p: LonLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: LonLat, poly: Polygon): boolean {
  if (!poly.length || !pointInRing(p, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(p, poly[k])) return false;
  return true;
}

/* ------------------------------------------------------------------ shoreline index */

/**
 * Big reservoir outlines have tens of thousands of vertices, and planning one lake asks "is this point
 * on the water?" and "where is the nearest bank?" thousands of times. Scanning every edge for each
 * question took seconds, so each outline gets a one-time index (cached per outline array, which is
 * never mutated once a lake is loaded):
 * - latitude bands: each band lists the edges that reach into it, so a point-in-water test only
 *   looks at the few edges level with the point;
 * - a box tree in shoreline order: consecutive edges sit next to each other along the bank, so runs of
 *   16 edges (then runs of 16 runs) make tight boxes, and the nearest-edge search skips every box
 *   farther away than the best edge found so far.
 * Coordinates are projected to meters about the outline's middle latitude.
 */
interface Boxes { n: number; minX: Float64Array; minY: Float64Array; maxX: Float64Array; maxY: Float64Array }

interface ShoreIndex {
  /** Edge count. */
  n: number;
  lon0: number; lat0: number; kx: number; ky: number;
  minX: number; minY: number; maxX: number; maxY: number;
  ax: Float64Array; ay: Float64Array; bx: Float64Array; by: Float64Array;
  /** Which polygon each edge belongs to (islands flip their own polygon back to land). */
  poly: Int32Array;
  nPolys: number;
  nBands: number; bandH: number; bandStart: Int32Array; bandEdges: Int32Array;
  /** levels[0] boxes runs of FAN edges; levels[k] boxes runs of FAN level k-1 boxes; the top has at most FAN. */
  levels: Boxes[];
}

const FAN = 16;
const indexCache = new WeakMap<Polygon[], ShoreIndex>();

function isClosed(ring: Ring): boolean {
  const a = ring[0], b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

function buildIndex(polys: Polygon[]): ShoreIndex {
  // Plain indexed loops throughout: this runs once per lake, usually before the JIT has warmed up.
  let n = 0, minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (let pi = 0; pi < polys.length; pi++) {
    for (let ri = 0; ri < polys[pi].length; ri++) {
      const ring = polys[pi][ri];
      if (ring.length < 2) continue;
      n += isClosed(ring) ? ring.length - 1 : ring.length;
      for (let i = 0; i < ring.length; i++) {
        const x = ring[i][0], y = ring[i][1];
        if (x < minLon) minLon = x;
        if (x > maxLon) maxLon = x;
        if (y < minLat) minLat = y;
        if (y > maxLat) maxLat = y;
      }
    }
  }
  const lon0 = n ? (minLon + maxLon) / 2 : 0, lat0 = n ? (minLat + maxLat) / 2 : 0;
  const kx = 111320 * Math.cos(toRad(lat0)), ky = 110574;
  const ax = new Float64Array(n), ay = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n);
  const poly = new Int32Array(n);
  let e = 0;
  for (let pi = 0; pi < polys.length; pi++) {
    for (let ri = 0; ri < polys[pi].length; ri++) {
      const ring = polys[pi][ri];
      if (ring.length < 2) continue;
      // An unclosed ring still has the edge from its last vertex back to its first.
      const m = isClosed(ring) ? ring.length - 1 : ring.length;
      let px = (ring[0][0] - lon0) * kx, py = (ring[0][1] - lat0) * ky;
      for (let i = 1; i <= m; i++) {
        const v = ring[i % ring.length];
        const qx = (v[0] - lon0) * kx, qy = (v[1] - lat0) * ky;
        ax[e] = px; ay[e] = py; bx[e] = qx; by[e] = qy; poly[e] = pi;
        e++;
        px = qx; py = qy;
      }
    }
  }
  const minX = (minLon - lon0) * kx, maxX = (maxLon - lon0) * kx;
  const minY = (minLat - lat0) * ky, maxY = (maxLat - lat0) * ky;

  // Latitude bands, stored flat: the edges of band b are bandEdges[bandStart[b] .. bandStart[b + 1]).
  const nBands = Math.max(1, Math.min(8192, Math.ceil(n / 8)));
  const bandH = Math.max((maxY - minY) / nBands, 1e-9);
  const lo = new Int32Array(n), hi = new Int32Array(n);
  const bandStart = new Int32Array(nBands + 1);
  for (let i = 0; i < n; i++) {
    const y0 = ay[i] < by[i] ? ay[i] : by[i], y1 = ay[i] < by[i] ? by[i] : ay[i];
    const b0 = Math.floor((y0 - minY) / bandH), b1 = Math.floor((y1 - minY) / bandH);
    lo[i] = b0 < 0 ? 0 : b0 >= nBands ? nBands - 1 : b0;
    hi[i] = b1 < 0 ? 0 : b1 >= nBands ? nBands - 1 : b1;
    for (let b = lo[i]; b <= hi[i]; b++) bandStart[b + 1]++;
  }
  for (let b = 0; b < nBands; b++) bandStart[b + 1] += bandStart[b];
  const bandEdges = new Int32Array(bandStart[nBands]);
  const fill = bandStart.slice(0, nBands);
  for (let i = 0; i < n; i++) for (let b = lo[i]; b <= hi[i]; b++) bandEdges[fill[b]++] = i;

  // Box tree over runs of consecutive edges.
  const levels: Boxes[] = [];
  let below = n;
  while (n && (levels.length === 0 || below > FAN)) {
    const m = Math.ceil(below / FAN);
    const L: Boxes = { n: m, minX: new Float64Array(m), minY: new Float64Array(m), maxX: new Float64Array(m), maxY: new Float64Array(m) };
    const prev = levels.length ? levels[levels.length - 1] : null;
    // Children: the edges themselves for the first level, the boxes of the level below after that.
    const c0x = prev ? prev.minX : ax, c0y = prev ? prev.minY : ay, c1x = prev ? prev.maxX : bx, c1y = prev ? prev.maxY : by;
    for (let j = 0; j < m; j++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = j * FAN, end = Math.min(below, i + FAN); i < end; i++) {
        // An edge's endpoints are in no particular order, so take min and max of both for edges too.
        const u0 = c0x[i] < c1x[i] ? c0x[i] : c1x[i], u1 = c0x[i] < c1x[i] ? c1x[i] : c0x[i];
        const v0 = c0y[i] < c1y[i] ? c0y[i] : c1y[i], v1 = c0y[i] < c1y[i] ? c1y[i] : c0y[i];
        if (u0 < x0) x0 = u0;
        if (u1 > x1) x1 = u1;
        if (v0 < y0) y0 = v0;
        if (v1 > y1) y1 = v1;
      }
      L.minX[j] = x0; L.minY[j] = y0; L.maxX[j] = x1; L.maxY[j] = y1;
    }
    levels.push(L);
    below = m;
  }
  return {
    n, lon0, lat0, kx, ky, minX, minY, maxX, maxY, ax, ay, bx, by, poly, nPolys: polys.length,
    nBands, bandH, bandStart, bandEdges, levels,
  };
}

function shoreIndex(polys: Polygon[]): ShoreIndex {
  let ix = indexCache.get(polys);
  if (!ix) {
    ix = buildIndex(polys);
    indexCache.set(polys, ix);
  }
  return ix;
}

/** Is the point on the water: inside an outline and not on one of its islands. */
export function inWater(p: LonLat, polys: Polygon[]): boolean {
  const ix = shoreIndex(polys);
  const x = (p[0] - ix.lon0) * ix.kx, y = (p[1] - ix.lat0) * ix.ky;
  if (!(y >= ix.minY && y < ix.maxY && x >= ix.minX && x <= ix.maxX)) return false;
  const b = Math.min(ix.nBands - 1, Math.floor((y - ix.minY) / ix.bandH));
  const { ax, ay, bx, by, poly, bandEdges } = ix;
  // Count edges crossed by a ray going east from the point, separately for each polygon.
  let crossings = 0;
  let hits: number[] | null = null;
  for (let k = ix.bandStart[b], end = ix.bandStart[b + 1]; k < end; k++) {
    const i = bandEdges[k];
    if (ay[i] > y !== by[i] > y && x < ((bx[i] - ax[i]) * (y - ay[i])) / (by[i] - ay[i]) + ax[i]) {
      if (ix.nPolys === 1) crossings++;
      else (hits ??= []).push(poly[i]);
    }
  }
  if (!hits) return crossings % 2 === 1;
  hits.sort((a, c) => a - c);
  for (let k = 0; k < hits.length;) {
    let j = k;
    while (j < hits.length && hits[j] === hits[k]) j++;
    if ((j - k) % 2 === 1) return true;
    k = j;
  }
  return false;
}

interface Nearest { d2: number; edge: number; cx: number; cy: number }

function boxDist2(L: Boxes, i: number, x: number, y: number): number {
  const dx = x < L.minX[i] ? L.minX[i] - x : x > L.maxX[i] ? x - L.maxX[i] : 0;
  const dy = y < L.minY[i] ? L.minY[i] - y : y > L.maxY[i] ? y - L.maxY[i] : 0;
  return dx * dx + dy * dy;
}

function searchEdges(ix: ShoreIndex, from: number, to: number, x: number, y: number, best: Nearest) {
  const { ax, ay, bx, by } = ix;
  for (let i = from; i < to; i++) {
    const dx = bx[i] - ax[i], dy = by[i] - ay[i];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax[i]) * dx + (y - ay[i]) * dy) / len2)) : 0;
    const cx = ax[i] + t * dx, cy = ay[i] + t * dy;
    const d2 = (cx - x) ** 2 + (cy - y) ** 2;
    if (d2 < best.d2) { best.d2 = d2; best.edge = i; best.cx = cx; best.cy = cy; }
  }
}

function searchBoxes(ix: ShoreIndex, level: number, from: number, to: number, x: number, y: number, best: Nearest) {
  const L = ix.levels[level];
  const cand: { lb: number; i: number }[] = [];
  for (let i = from; i < to; i++) {
    const lb = boxDist2(L, i, x, y);
    if (lb < best.d2) cand.push({ lb, i });
  }
  cand.sort((a, b) => a.lb - b.lb);
  for (const { lb, i } of cand) {
    if (lb >= best.d2) break;
    if (level === 0) searchEdges(ix, i * FAN, Math.min(ix.n, (i + 1) * FAN), x, y, best);
    else searchBoxes(ix, level - 1, i * FAN, Math.min(ix.levels[level - 1].n, (i + 1) * FAN), x, y, best);
  }
}

function nearestEdge(ix: ShoreIndex, p: LonLat): Nearest | null {
  if (!ix.n) return null;
  const best: Nearest = { d2: Infinity, edge: -1, cx: 0, cy: 0 };
  const top = ix.levels.length - 1;
  searchBoxes(ix, top, 0, ix.levels[top].n, (p[0] - ix.lon0) * ix.kx, (p[1] - ix.lat0) * ix.ky, best);
  return best.edge < 0 ? null : best;
}

/** Nearest point on any shoreline (outer banks and island banks) and how far away it is. */
export function nearestShorePoint(p: LonLat, polys: Polygon[]): { point: LonLat; distM: number } | null {
  const ix = shoreIndex(polys);
  const e = nearestEdge(ix, p);
  return e ? { point: [ix.lon0 + e.cx / ix.kx, ix.lat0 + e.cy / ix.ky], distM: Math.sqrt(e.d2) } : null;
}

/** Distance in meters from `p` to the nearest point of a polyline (a dam, a bridge). */
export function distanceToLineM(p: LonLat, line: LonLat[]): number {
  const kx = 111320 * Math.cos(toRad(p[1])), ky = 110574;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const ax = (line[i][0] - p[0]) * kx, ay = (line[i][1] - p[1]) * ky;
    const b = line[Math.min(i + 1, line.length - 1)];
    const dx = (b[0] - p[0]) * kx - ax, dy = (b[1] - p[1]) * ky - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Area of a lon/lat ring in square meters (equirectangular projection about its own latitude). */
export function ringAreaM2(ring: Ring): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos(toRad(lat0));
  const ky = 110574;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * kx * (ring[i][1] * ky) - ring[i][0] * kx * (ring[j][1] * ky);
  }
  return Math.abs(a / 2);
}

export function polygonAcres(polys: Polygon[]): number {
  let m2 = 0;
  for (const poly of polys) {
    m2 += ringAreaM2(poly[0]);
    for (let k = 1; k < poly.length; k++) m2 -= ringAreaM2(poly[k]);
  }
  return m2 / 4046.856;
}

export interface NearestEdge {
  point: LonLat;
  distM: number;
  /** Bearing pointing from the shore out into open water, degrees. */
  intoWaterDeg: number;
}

/** Nearest point on any shoreline ring (outer edges and island edges) and the direction into the water there. */
export function nearestShore(p: LonLat, polys: Polygon[]): NearestEdge | null {
  const ix = shoreIndex(polys);
  const e = nearestEdge(ix, p);
  if (!e) return null;
  const point: LonLat = [ix.lon0 + e.cx / ix.kx, ix.lat0 + e.cy / ix.ky];
  const i = e.edge;
  const segBearing = (toDeg(Math.atan2(ix.bx[i] - ix.ax[i], ix.by[i] - ix.ay[i])) + 360) % 360;
  // First guess: whichever perpendicular of the nearest edge lands in water.
  const left = (segBearing + 270) % 360;
  const right = (segBearing + 90) % 360;
  const guess = inWater(offset(point, right, 15), polys) ? right : left;
  // At corners (the back of a cove, the tip of a point) the perpendicular can aim straight back onto
  // land, so prefer the middle of the open-water directions around the shore point.
  return { point, distM: Math.sqrt(e.d2), intoWaterDeg: openWaterBearing(point, polys) ?? guess };
}

/**
 * Circular mean of the bearings (every 15 degrees) along which both a near and a far sample from `p`
 * are on the water: the bisector of a cove, the open side of a point, the perpendicular of a straight bank.
 */
export function openWaterBearing(p: LonLat, polys: Polygon[], nearM = 15, farM = 35): number | null {
  let sx = 0, sy = 0, n = 0;
  for (let b = 0; b < 360; b += 15) {
    if (inWater(offset(p, b, nearM), polys) && inWater(offset(p, b, farM), polys)) {
      sx += Math.sin(toRad(b));
      sy += Math.cos(toRad(b));
      n++;
    }
  }
  if (!n || Math.hypot(sx, sy) < 1e-6) return null;
  return (toDeg(Math.atan2(sx, sy)) + 360) % 360;
}

export function bboxOf(polys: Polygon[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Douglas-Peucker simplification of an open polyline, tolerance in meters. */
function simplifyLine(line: Ring, tolM: number): Ring {
  if (line.length <= 2) return line.slice();
  const lat0 = line[0][1];
  const kx = 111320 * Math.cos(toRad(lat0));
  const ky = 110574;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    const ax = line[s][0] * kx, ay = line[s][1] * ky;
    const bx = line[e][0] * kx, by = line[e][1] * ky;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    for (let i = s + 1; i < e; i++) {
      const px = line[i][0] * kx, py = line[i][1] * ky;
      // Distance to the chord, or to its start when the chord has no length.
      const d = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolM && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

/**
 * Douglas-Peucker simplification on a ring, tolerance in meters.
 * A closed ring starts and ends on the same vertex, so it is split at the vertex farthest
 * from the start and each half is simplified on its own (a single zero-length chord would
 * otherwise collapse the whole ring).
 */
export function simplifyRing(ring: Ring, tolM: number): Ring {
  if (ring.length <= 4) return ring.slice();
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return simplifyLine(ring, tolM);
  let far = 1, farD = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = distanceM(first, ring[i]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tolM);
  const b = simplifyLine(ring.slice(far), tolM);
  return [...a, ...b.slice(1)];
}

/** Signed turn at vertex b (degrees, -180..180). Bearings run clockwise, so positive = right turn. */
export function turnDeg(a: LonLat, b: LonLat, c: LonLat): number {
  const t = bearingDeg(b, c) - bearingDeg(a, b);
  return ((t + 540) % 360) - 180;
}

export function ringIsCCW(ring: Ring): boolean {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[i][0] - ring[j][0]) * (ring[i][1] + ring[j][1]);
  return s < 0;
}
