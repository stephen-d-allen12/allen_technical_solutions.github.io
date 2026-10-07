import { describe, expect, it } from 'vitest';
import { buildForecast } from '../../src/lib/model';
import { parseMeteo } from '../../src/lib/sources';
import { collectStructure, type OverpassElement } from '../../src/lib/structure';
import type { Lake } from '../../src/lib/types';
import { BIG_CENTER, bigLakeElements, bigLakeRing } from '../fixtures/biglake';
import { meteoResponse } from '../fixtures/synthetic';

function bigLake(): { lake: Lake; elements: OverpassElement[] } {
  const ring = bigLakeRing();
  const c = BIG_CENTER;
  const lake: Lake = { name: 'Big', label: 'Big', center: c, bbox: [c[0] - 0.15, c[1] - 0.12, c[0] + 0.15, c[1] + 0.12], polygons: [[ring]], acres: 70000 };
  return { lake, elements: bigLakeElements(ring) as OverpassElement[] };
}

describe('speed on a big lake', () => {
  it('finds structure and builds the forecast fast enough for a phone', () => {
    const { lake, elements } = bigLake();
    const t0 = performance.now();
    const features = collectStructure(lake, elements);
    const t1 = performance.now();
    const w = parseMeteo(meteoResponse('2026-10-07') as never, 'forecast', '2026-10-07');
    const f = buildForecast({ lake, species: 'bass', date: '2026-10-07', weather: w, features });
    const t2 = performance.now();
    console.log(`features=${features.length} structure=${Math.round(t1 - t0)}ms forecast=${Math.round(t2 - t1)}ms spots=${f.spots.length}`);
    expect(f.spots.length).toBeGreaterThanOrEqual(6);
    // Phones run roughly 3-4x slower than this test machine.
    expect(t1 - t0).toBeLessThan(400);
    expect(t2 - t1).toBeLessThan(100);
  });
});
