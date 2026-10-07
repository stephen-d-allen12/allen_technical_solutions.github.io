import { describe, expect, it } from 'vitest';
import { distanceM, inWater, nearestShorePoint, offset } from '../../src/lib/geo';
import { lakeFromNominatim, parsePhoton } from '../../src/lib/sources';
import { collectStructure, overpassAroundQuery, overpassFeatures, overpassQuery, shapeFeatures } from '../../src/lib/structure';
import { CENTER, COVE_TIP, LAND_POINT, nominatimLookup, overpassResponse, photonResponse } from '../fixtures/synthetic';
import type { LonLat } from '../../src/lib/types';

const way = (id: number, tags: Record<string, string>, pts: LonLat[]) =>
  ({ type: 'way' as const, id, tags, geometry: pts.map(([lon, lat]) => ({ lat, lon })) });

const sug = parsePhoton(photonResponse() as never)[0];
const lake = lakeFromNominatim(nominatimLookup()[0] as never, sug);

describe('lake structure', () => {
  it('reads the outline with its island and computes acres', () => {
    expect(lake.polygons[0].length).toBe(2);
    expect(lake.acres).toBeGreaterThan(1000);
    expect(lake.acres).toBeLessThan(2000);
  });
  it('finds land points and coves from the shoreline shape', () => {
    const f = shapeFeatures(lake);
    const points = f.filter((x) => x.kind === 'point');
    const coves = f.filter((x) => x.kind === 'cove');
    expect(points.length).toBeGreaterThanOrEqual(4);
    expect(coves.length).toBeGreaterThanOrEqual(4);
    expect(points.some((p) => distanceM(p.at, LAND_POINT()) < 150)).toBe(true);
    expect(coves.some((c) => distanceM(c.at, COVE_TIP()) < 150)).toBe(true);
    expect(f.some((x) => x.kind === 'island')).toBe(true);
  });
  it('turns map data into creek mouths, bridges, docks, ramps and dams, and skips far-away creeks', () => {
    const f = overpassFeatures(lake, overpassResponse().elements as never);
    const kinds = f.map((x) => x.kind).sort();
    expect(kinds).toEqual(['bridge', 'creek_mouth', 'dam', 'dock', 'ramp']);
    const creek = f.find((x) => x.kind === 'creek_mouth')!;
    expect(creek.name).toBe('Big Spring Creek');
    expect(distanceM(creek.at, COVE_TIP())).toBeLessThan(60);
    const bridge = f.find((x) => x.kind === 'bridge')!;
    expect(inWater(bridge.at, lake.polygons)).toBe(true);
  });
  it('puts a creek mouth where the creek meets the bank, even when the line runs on into the lake', () => {
    // Drawn downstream from the hills, across the bank at the cove tip, and on toward the middle of the lake.
    const creek = way(1, { waterway: 'stream', name: 'Long Creek' }, [offset(COVE_TIP(), 0, 1200), offset(COVE_TIP(), 180, 1400)]);
    const f = overpassFeatures(lake, [creek]);
    expect(f).toHaveLength(1);
    expect(nearestShorePoint(f[0].at, lake.polygons)!.distM).toBeLessThan(3);
    expect(distanceM(f[0].at, COVE_TIP())).toBeLessThan(20);
  });
  it('skips the outflow below the dam and a channel drawn through the open lake', () => {
    const dam = overpassResponse().elements.find((e) => e.tags?.waterway === 'dam')!;
    const outflow = way(2, { waterway: 'river', name: 'Tailwater' }, [offset(CENTER, 216, 1800), offset(CENTER, 216, 6000)]);
    const channel = way(3, { waterway: 'river', name: 'Old channel' }, [offset(CENTER, 0, 300), offset(CENTER, 0, 1500)]);
    expect(overpassFeatures(lake, [dam, outflow, channel] as never).map((x) => x.kind)).toEqual(['dam']);
  });
  it('still finds a creek drawn the wrong way (from the lake upstream)', () => {
    const tip = offset(CENTER, 72, 2000);
    const reversed = way(4, { waterway: 'stream', name: 'Backwards Branch' }, [tip, offset(tip, 72, 1500)]);
    const f = overpassFeatures(lake, [reversed]);
    expect(f.map((x) => x.kind)).toEqual(['creek_mouth']);
    expect(distanceM(f[0].at, tip)).toBeLessThan(20);
  });
  it('places a bridge with both ends on land at the middle of its span over the water', () => {
    // Across the north arm, 1,500 m out: the arm is about 400 m wide there.
    const mid = offset(CENTER, 0, 1500);
    const f = overpassFeatures(lake, [way(5, { highway: 'secondary', bridge: 'yes' }, [offset(mid, 270, 600), offset(mid, 90, 600)])]);
    expect(f.map((x) => x.kind)).toEqual(['bridge']);
    expect(inWater(f[0].at, lake.polygons)).toBe(true);
    expect(distanceM(f[0].at, mid)).toBeLessThan(40);
  });
  it('dedupes shape features that the map already names', () => {
    const all = collectStructure(lake, overpassResponse().elements as never);
    const nearCove = all.filter((x) => distanceM(x.at, COVE_TIP()) < 150);
    expect(nearCove.map((x) => x.kind)).toContain('creek_mouth');
  });
  it('queries only map features near the lake shoreline, with a bounding-box fallback', () => {
    const rel = overpassAroundQuery('R', 424242)!;
    expect(rel).toContain('rel(424242);way(r)->.lake;');
    expect(rel).toContain('(around.lake:150)');
    expect(rel.match(/around\.lake:150/g)!.length).toBe(5);
    expect(rel).toContain('node["place"~"^(island|islet)$"](around.lake:3000)');
    expect(overpassAroundQuery('W', 7)).toContain('way(7)->.lake;');
    expect(overpassAroundQuery('N', 7)).toBeNull();
    const bb = overpassQuery(lake.bbox);
    expect(bb).toMatch(/\(34\.\d+,-86\.\d+,34\.\d+,-86\.\d+\)/);
    for (const q of [rel, bb]) {
      expect(q.startsWith('[out:json][timeout:25];')).toBe(true);
      expect(q.endsWith('out geom;')).toBe(true);
      // Balanced brackets: a malformed query is rejected by Overpass with HTTP 400.
      expect(q.split('(').length).toBe(q.split(')').length);
      expect(q.split('[').length).toBe(q.split(']').length);
    }
  });
});
