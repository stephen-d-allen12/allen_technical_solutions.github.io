import { describe, expect, it } from 'vitest';
import { inWater, nearestShore, nearestShorePoint, offset, pointInPolygon } from '../../src/lib/geo';
import type { LonLat, Polygon, Ring } from '../../src/lib/types';

/** Small seeded random generator so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ragged closed ring around `c` (wobbly radius like a real shoreline). */
function ragged(c: LonLat, r: number, n: number, rand: () => number, ccw = true): Ring {
  const ring: Ring = [];
  const k1 = 2 + Math.floor(rand() * 8), k2 = 15 + Math.floor(rand() * 30);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    const rr = r * (1 + 0.3 * Math.sin((a * k1 * Math.PI) / 180) + 0.08 * Math.sin((a * k2 * Math.PI) / 180) + 0.02 * (rand() - 0.5));
    ring.push(offset(c, a, rr));
  }
  if (ccw) ring.reverse();
  ring.push(ring[0]);
  return ring;
}

/** Brute force: the plain point-in-polygon test on every polygon. */
const bruteInWater = (p: LonLat, polys: Polygon[]) => polys.some((poly) => pointInPolygon(p, poly));

/** Brute force: distance to every edge, projected about the point's own latitude. */
function bruteShoreM(p: LonLat, polys: Polygon[]): number {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180), ky = 110574;
  let best = Infinity;
  for (const poly of polys) for (const ring of poly) for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - p[0]) * kx, ay = (ring[i - 1][1] - p[1]) * ky;
    const dx = (ring[i][0] - p[0]) * kx - ax, dy = (ring[i][1] - p[1]) * ky - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

describe('shoreline index matches the brute-force math', () => {
  const rand = rng(7);
  const c: LonLat = [-95.5, 36.6];
  // Main lake with three islands, a pond on one island (a separate polygon inside a hole), and a
  // second arm that is its own polygon.
  const island1 = ragged(offset(c, 40, 2500), 400, 300, rand, false);
  const island2 = ragged(offset(c, 200, 3000), 250, 200, rand, false);
  const island3 = ragged(offset(c, 300, 1500), 600, 400, rand, false);
  const lakes: Polygon[] = [
    [ragged(c, 6000, 6000, rand), island1, island2, island3],
    [ragged(offset(c, 300, 1500), 150, 80, rand)],
    [ragged(offset(c, 90, 12000), 1500, 900, rand)],
  ];
  const [w, s] = offset(c, 225, 15000), [e, n] = offset(c, 45, 21000);

  it('agrees on water versus land at 6,000 random points', () => {
    let wet = 0;
    for (let k = 0; k < 6000; k++) {
      const p: LonLat = [w + (e - w) * rand(), s + (n - s) * rand()];
      const want = bruteInWater(p, lakes);
      expect(inWater(p, lakes), `point ${p}`).toBe(want);
      if (want) wet++;
    }
    expect(wet).toBeGreaterThan(600); // the sample really exercised both sides
  });

  it('agrees on the distance to the nearest bank at 2,000 random points, near and far', () => {
    for (let k = 0; k < 2000; k++) {
      const p: LonLat = k % 4 === 0 ? offset(c, rand() * 360, 20000 + rand() * 30000) : [w + (e - w) * rand(), s + (n - s) * rand()];
      const want = bruteShoreM(p, lakes);
      const got = nearestShorePoint(p, lakes)!.distM;
      expect(Math.abs(got - want), `point ${p}`).toBeLessThan(0.5 + want * 0.004);
    }
  });

  it('treats an unclosed ring like a closed one', () => {
    const closed = ragged(c, 1000, 200, rng(3));
    const open = closed.slice(0, -1);
    const r2 = rng(11);
    for (let k = 0; k < 2000; k++) {
      const p = offset(c, r2() * 360, r2() * 1500);
      expect(inWater(p, [[open]])).toBe(inWater(p, [[closed]]));
    }
  });

  it('handles an empty outline', () => {
    expect(inWater(c, [])).toBe(false);
    expect(nearestShore(c, [])).toBeNull();
    expect(nearestShorePoint(c, [])).toBeNull();
  });
});
