import { distanceM, distanceToLineM, inWater, nearestShore, nearestShorePoint, ringAreaM2, ringIsCCW, simplifyRing, turnDeg } from './geo';
import type { FeatureKind, Lake, LonLat, Polygon, StructureFeature } from './types';

/** Minimal shape of the Overpass JSON elements we ask for (`out geom;`). */
export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

/** The map features that matter to anglers, as Overpass selectors with a spatial filter appended. */
function selectors(filter: string, islandFilter = filter): string {
  return `way["waterway"~"^(river|stream|canal)$"]${filter};
nwr["man_made"="pier"]${filter};
nwr["leisure"~"^(slipway|marina|fishing)$"]${filter};
way["bridge"]["bridge"!="no"]${filter};
nwr["waterway"~"^(dam|weir)$"]${filter};
node["place"~"^(island|islet)$"]${islandFilter};`;
}

/**
 * Preferred query: only features within 150 m of the lake's own shoreline (fast and small even for
 * 100,000-acre reservoirs, where a bounding box would pull every creek in the county).
 */
export function overpassAroundQuery(osmType: 'N' | 'W' | 'R', osmId: number, radiusM = 150): string | null {
  if (osmType === 'N') return null;
  const ref = osmType === 'R' ? `rel(${osmId});way(r)->.lake;` : `way(${osmId})->.lake;`;
  return `[out:json][timeout:25];${ref}(${selectors(`(around.lake:${radiusM})`, '(around.lake:3000)')});out geom;`;
}

/** Fallback query by bounding box ([minLon, minLat, maxLon, maxLat]). */
export function overpassQuery(bbox: [number, number, number, number]): string {
  const pad = 0.01;
  const b = `(${bbox[1] - pad},${bbox[0] - pad},${bbox[3] + pad},${bbox[2] + pad})`;
  return `[out:json][timeout:25];(${selectors(b)});out geom;`;
}

const NAMED: Partial<Record<FeatureKind, string>> = {
  creek_mouth: 'Creek mouth',
  river_mouth: 'River mouth',
  point: 'Main-lake point',
  cove: 'Cove / pocket',
  bridge: 'Bridge',
  dock: 'Dock',
  marina: 'Marina',
  ramp: 'Boat ramp',
  dam: 'Dam',
  island: 'Island',
  fishing_pier: 'Fishing pier',
};

export function featureTitle(f: StructureFeature): string {
  const base = NAMED[f.kind] ?? f.kind;
  return f.name ? `${f.name} (${base.toLowerCase()})` : base;
}

function centroidOf(el: OverpassElement): LonLat | null {
  if (el.lat != null && el.lon != null) return [el.lon, el.lat];
  if (el.geometry?.length) {
    let x = 0, y = 0;
    for (const g of el.geometry) { x += g.lon; y += g.lat; }
    return [x / el.geometry.length, y / el.geometry.length];
  }
  if (el.bounds) return [(el.bounds.minlon + el.bounds.maxlon) / 2, (el.bounds.minlat + el.bounds.maxlat) / 2];
  return null;
}

/** Keep at most one feature per kind in each ~cellM grid cell, so big lakes with 500 docks stay readable. */
function thin(features: StructureFeature[], cellM: number): StructureFeature[] {
  const seen = new Set<string>();
  const out: StructureFeature[] = [];
  for (const f of features) {
    const kx = 111320 * Math.cos((f.at[1] * Math.PI) / 180);
    const key = `${f.kind}:${Math.floor((f.at[0] * kx) / cellM)}:${Math.floor((f.at[1] * 110574) / cellM)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Shoreline points (land jutting into the water) and coves (water pockets), found from sharp turns in the outline. */
export function shapeFeatures(lake: Lake): StructureFeature[] {
  const out: StructureFeature[] = [];
  const sizeM = Math.sqrt(Math.max(1, lake.acres * 4046.856));
  const tol = Math.min(250, Math.max(25, sizeM / 70));
  for (const poly of lake.polygons) {
    const outer = poly[0];
    if (ringAreaM2(outer) < 20000) continue;
    const ring = simplifyRing(outer, tol);
    if (ring.length < 5) continue;
    // Convexity > 0 where the water outline bends outward (back of a cove), < 0 where land juts into
    // the water (a point). On a CCW ring the water is on the left, so convex corners are left (negative) turns.
    const sign = ringIsCCW(ring) ? -1 : 1;
    const n = ring.length - 1; // closed ring: last == first
    const cand: { f: StructureFeature; mag: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
      if (distanceM(a, b) < tol || distanceM(b, c) < tol) continue;
      const t = turnDeg(a, b, c) * sign;
      if (t < -55) cand.push({ f: { kind: 'point', at: b }, mag: -t });
      else if (t > 70) cand.push({ f: { kind: 'cove', at: b }, mag: t });
    }
    cand.sort((x, y) => y.mag - x.mag);
    const points = cand.filter((c) => c.f.kind === 'point').slice(0, 14);
    const coves = cand.filter((c) => c.f.kind === 'cove').slice(0, 10);
    for (const c of [...points, ...coves]) out.push(c.f);
    for (let k = 1; k < poly.length; k++) {
      const hole = poly[k];
      if (ringAreaM2(hole) < 300) continue;
      let x = 0, y = 0;
      for (const p of hole) { x += p[0]; y += p[1]; }
      out.push({ kind: 'island', at: [x / hole.length, y / hole.length] });
    }
  }
  return thin(out, Math.max(200, tol * 3));
}

/** The point where the segment a→b crosses the shoreline, found by halving (a and b on opposite sides). */
function shoreCrossing(polys: Polygon[], a: LonLat, b: LonLat): LonLat {
  const aWet = inWater(a, polys);
  let lo = a, hi = b;
  for (let k = 0; k < 20; k++) {
    const mid: LonLat = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
    if (inWater(mid, polys) === aWet) lo = mid;
    else hi = mid;
  }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
}

/**
 * Where a stream meets the lake. Mapped waterways point downstream, so the mouth is where the line
 * first runs into the water, or its downstream end when the line stops at (or just short of) the bank.
 * Lines are not always drawn the right way, so a line that runs out of the lake also counts, unless it
 * leaves next to a dam: that is the outflow below the dam, not a mouth. A line that never leaves the
 * water is the old river channel drawn through the lake.
 */
function streamMouth(polys: Polygon[], line: LonLat[], dams: LonLat[][]): LonLat | null {
  const nearDam = (p: LonLat) => dams.some((d) => distanceToLineM(p, d) < 300);
  let outflow: LonLat | null = null;
  let wasWet = inWater(line[0], polys);
  for (let i = 1; i < line.length; i++) {
    const wet = inWater(line[i], polys);
    if (wet !== wasWet) {
      const at = shoreCrossing(polys, line[i - 1], line[i]);
      if (!nearDam(at)) {
        if (wet) return at;
        outflow ??= at;
      }
    }
    wasWet = wet;
  }
  if (outflow) return outflow;
  if (line.some((p) => inWater(p, polys))) return null;
  for (const end of [line[line.length - 1], line[0]]) {
    const e = nearestShorePoint(end, polys);
    if (e && e.distM <= 150 && !nearDam(e.point)) return e.point;
  }
  return null;
}

/** Where a bridge crosses the most open water: the sampled point farthest from either bank (the channel span). */
function bridgeSpan(polys: Polygon[], line: LonLat[]): LonLat | null {
  let best: LonLat | null = null, bestD = -1;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const steps = Math.min(100, Math.max(1, Math.ceil(distanceM(a, b) / 25)));
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      const p: LonLat = [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
      if (!inWater(p, polys)) continue;
      const d = nearestShorePoint(p, polys)?.distM ?? 0;
      if (d > bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

const lineOf = (el: OverpassElement): LonLat[] => (el.geometry ?? []).map((g) => [g.lon, g.lat]);

export function overpassFeatures(lake: Lake, elements: OverpassElement[]): StructureFeature[] {
  const polys = lake.polygons;
  const out: StructureFeature[] = [];
  const near = (p: LonLat, maxM: number) => {
    const e = nearestShorePoint(p, polys);
    return e && (e.distM <= maxM || inWater(p, polys)) ? e : null;
  };
  const dams = elements
    .filter((el) => el.tags?.waterway === 'dam' || el.tags?.waterway === 'weir')
    .map((el) => (el.geometry?.length ? lineOf(el) : el.lat != null && el.lon != null ? [[el.lon, el.lat] as LonLat] : []))
    .filter((l) => l.length);
  for (const el of elements) {
    const t = el.tags ?? {};
    const name = t.name;
    if (t.waterway === 'river' || t.waterway === 'stream' || t.waterway === 'canal') {
      const line = lineOf(el);
      if (line.length < 2) continue;
      const at = streamMouth(polys, line, dams);
      if (at) out.push({ kind: t.waterway === 'river' ? 'river_mouth' : 'creek_mouth', at, name });
      continue;
    }
    if (t.bridge && t.bridge !== 'no') {
      const at = bridgeSpan(polys, lineOf(el));
      if (at) out.push({ kind: 'bridge', at, name });
      continue;
    }
    const c = centroidOf(el);
    if (!c) continue;
    let kind: FeatureKind | null = null;
    let maxM = 120;
    if (t.waterway === 'dam' || t.waterway === 'weir') { kind = 'dam'; maxM = 400; }
    else if (t.man_made === 'pier') kind = 'dock';
    else if (t.leisure === 'marina') { kind = 'marina'; maxM = 250; }
    else if (t.leisure === 'slipway') kind = 'ramp';
    else if (t.leisure === 'fishing') kind = 'fishing_pier';
    else if (t.place === 'island' || t.place === 'islet') { kind = 'island'; maxM = 400; }
    if (!kind) continue;
    const e = near(c, maxM);
    if (!e) continue;
    out.push({ kind, at: kind === 'island' ? c : e.point, name });
  }
  return thin(out, 350);
}

/** Nearest shore and open-water direction for each feature, computed once per lake (it is the slow part). */
export function withShore(lake: Lake, features: StructureFeature[]): StructureFeature[] {
  if (!lake.polygons.length) return features;
  return features.map((f) => {
    if (f.shore) return f;
    const e = nearestShore(f.at, lake.polygons);
    return e ? { ...f, shore: { at: e.point, distM: e.distM, intoWaterDeg: e.intoWaterDeg } } : f;
  });
}

/**
 * All structure: what the map data names plus what the outline's shape shows.
 * A shape feature at the same place as a named one is folded into it (a named creek at the back of a
 * cove becomes one creek-mouth spot that is also a cove), so a spot is listed once.
 */
export function collectStructure(lake: Lake, elements: OverpassElement[]): StructureFeature[] {
  const named = overpassFeatures(lake, elements).map((f) => ({ ...f }));
  const shaped: StructureFeature[] = [];
  for (const s of shapeFeatures(lake)) {
    const host = named
      .map((n) => ({ n, d: distanceM(n.at, s.at) }))
      .filter((x) => x.d < (x.n.kind === 'island' ? 400 : 200))
      .sort((a, b) => a.d - b.d)[0]?.n;
    if (!host) { shaped.push(s); continue; }
    if (host.kind !== s.kind && !(host.also ?? []).includes(s.kind)) host.also = [...(host.also ?? []), s.kind];
  }
  return withShore(lake, [...named, ...shaped]);
}

