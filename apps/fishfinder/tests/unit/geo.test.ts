import { describe, expect, it } from 'vitest';
import { angleDiff, bearingDeg, compass16, distanceM, nearestShore, offset, pointInPolygon, polygonAcres } from '../../src/lib/geo';
import type { Polygon } from '../../src/lib/types';

const square = (c: [number, number], halfM: number): [number, number][] => {
  const n = offset(c, 0, halfM)[1], s = offset(c, 180, halfM)[1];
  const e = offset(c, 90, halfM)[0], w = offset(c, 270, halfM)[0];
  return [[w, s], [e, s], [e, n], [w, n], [w, s]];
};

describe('geo', () => {
  it('measures distance: one degree of latitude is about 111 km', () => {
    expect(distanceM([-86, 34], [-86, 35])).toBeGreaterThan(110_500);
    expect(distanceM([-86, 34], [-86, 35])).toBeLessThan(111_500);
  });
  it('gives compass bearings', () => {
    expect(Math.round(bearingDeg([-86, 34], [-86, 35]))).toBe(0);
    expect(Math.round(bearingDeg([-86, 34], [-85.99, 34]))).toBe(90);
    expect(compass16(225)).toBe('SW');
    expect(compass16(359)).toBe('N');
    expect(angleDiff(350, 10)).toBe(20);
  });
  it('offsets and comes back', () => {
    const p = offset([-86, 34], 135, 500);
    expect(Math.abs(distanceM([-86, 34], p) - 500)).toBeLessThan(2);
    expect(Math.abs(bearingDeg([-86, 34], p) - 135)).toBeLessThan(0.5);
  });
  it('handles islands as holes', () => {
    const c: [number, number] = [-86, 34];
    const poly: Polygon = [square(c, 1000), square(c, 100)];
    expect(pointInPolygon(offset(c, 0, 500), poly)).toBe(true);
    expect(pointInPolygon(c, poly)).toBe(false); // on the island
    expect(pointInPolygon(offset(c, 0, 1500), poly)).toBe(false); // on land
  });
  it('computes area in acres: a 2 km square is about 988 acres, minus the island', () => {
    const c: [number, number] = [-86, 34];
    expect(polygonAcres([[square(c, 1000)]])).toBeGreaterThan(975);
    expect(polygonAcres([[square(c, 1000)]])).toBeLessThan(1000);
    expect(polygonAcres([[square(c, 1000), square(c, 100)]])).toBeLessThan(polygonAcres([[square(c, 1000)]]) - 9);
  });
  it('finds the nearest shore and which way is open water', () => {
    const c: [number, number] = [-86, 34];
    const lake: Polygon[] = [[square(c, 1000)]];
    const e = nearestShore(offset(c, 0, 950), lake)!; // near the north bank
    expect(e.distM).toBeLessThan(60);
    expect(angleDiff(e.intoWaterDeg, 180)).toBeLessThan(5); // water is to the south
  });
});
