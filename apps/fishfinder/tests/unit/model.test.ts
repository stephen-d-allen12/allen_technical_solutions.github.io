import { describe, expect, it } from 'vitest';
import { angleDiff, bearingDeg, distanceM, inWater, nearestShore } from '../../src/lib/geo';
import { bestWindows, buildForecast, estimateWaterTempF, phaseFor, planSpots, scoreHours, tempTrend } from '../../src/lib/model';
import { lakeFromNominatim, parseMeteo, parsePhoton } from '../../src/lib/sources';
import { collectStructure } from '../../src/lib/structure';
import type { Weather } from '../../src/lib/types';
import { meteoResponse, nominatimLookup, overpassResponse, photonResponse } from '../fixtures/synthetic';

const sug = parsePhoton(photonResponse() as never)[0];
const lake = lakeFromNominatim(nominatimLookup()[0] as never, sug);
const features = collectStructure(lake, overpassResponse().elements as never);

function flatWeather(over: Partial<Weather> = {}): Weather {
  const n = 48;
  return {
    time: Array.from({ length: n }, (_, i) => `2026-07-0${1 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`),
    tempF: Array(n).fill(85), windMph: Array(n).fill(8), gustMph: Array(n).fill(12), windFromDeg: Array(n).fill(180),
    cloudPct: Array(n).fill(10), pressureHpa: Array(n).fill(1015), precipIn: Array(n).fill(0),
    dailyMeanF: Array(14).fill(84), utcOffsetSeconds: -18000, timezone: 'America/Chicago', basis: 'forecast', ...over,
  };
}

describe('season phase', () => {
  const cases: [string, Parameters<typeof phaseFor>, string][] = [
    ['cold January bass', ['bass', 44, 1, 'steady'], 'winter'],
    ['warming March bass', ['bass', 55, 3, 'rising'], 'prespawn'],
    ['April bass at 66°F', ['bass', 66, 4, 'rising'], 'spawn'],
    ['June bass at 76°F', ['bass', 76, 6, 'rising'], 'postspawn'],
    ['July bass at 86°F', ['bass', 86, 7, 'steady'], 'summer'],
    ['October bass at 68°F, cooling', ['bass', 68, 10, 'falling'], 'fall'],
    ['crappie at 56°F in March', ['crappie', 56, 3, 'rising'], 'prespawn'],
    ['crappie at 62°F in April', ['crappie', 62, 4, 'rising'], 'spawn'],
    ['crappie at 48°F in December', ['crappie', 48, 12, 'falling'], 'winter'],
    ['crappie at 84°F in August', ['crappie', 84, 8, 'steady'], 'summer'],
  ];
  it.each(cases)('%s', (_n, args, want) => expect(phaseFor(...args)).toBe(want));

  it('estimates water temperature from recent air temps and reads the trend', () => {
    expect(estimateWaterTempF(Array(14).fill(70))).toBe(73);
    expect(estimateWaterTempF([])).toBe(65);
    expect(tempTrend([60, 61, 60, 62, 63, 65, 68, 70, 71, 72])).toBe('rising');
    expect(tempTrend([80, 79, 78, 76, 74, 72, 70, 69])).toBe('falling');
  });
});

describe('best times', () => {
  it('summer: dawn and dusk beat midday', () => {
    const h = scoreHours('bass', 'summer', flatWeather(), 0, 5.6, 20.1, [], [], 0.3);
    const at = (x: number) => h[x].score;
    expect(at(6)).toBeGreaterThan(at(13) + 15);
    expect(at(19)).toBeGreaterThan(at(13) + 15);
  });
  it('winter: the warm afternoon beats dawn', () => {
    const h = scoreHours('bass', 'winter', flatWeather(), 0, 7, 17, [], [], 0.3);
    expect(h[14].score).toBeGreaterThan(h[7].score);
  });
  it('a solunar major period lifts its hour', () => {
    const base = scoreHours('bass', 'fall', flatWeather(), 0, 6.8, 18.5, [], [], 0.3);
    const withMajor = scoreHours('bass', 'fall', flatWeather(), 0, 6.8, 18.5, [11.5], [], 0.3);
    expect(withMajor[11].score).toBeGreaterThan(base[11].score + 10);
  });
  it('falling pressure lifts the bite and a strong wind lowers it', () => {
    const p = Array(48).fill(1015).map((v, i) => (i >= 10 ? v - (i - 10) * 0.6 : v));
    const falling = scoreHours('bass', 'fall', flatWeather({ pressureHpa: p }), 0, 6.8, 18.5, [], [], 0.3);
    const flat = scoreHours('bass', 'fall', flatWeather(), 0, 6.8, 18.5, [], [], 0.3);
    expect(falling[14].score).toBeGreaterThan(flat[14].score);
    const windy = scoreHours('bass', 'fall', flatWeather({ windMph: Array(48).fill(25) }), 0, 6.8, 18.5, [], [], 0.3);
    expect(windy[14].score).toBeLessThan(flat[14].score);
  });
  it('groups the top hours into at most three windows', () => {
    const h = scoreHours('bass', 'summer', flatWeather(), 0, 5.6, 20.1, [], [], 0.3);
    const w = bestWindows(h);
    expect(w.length).toBeGreaterThan(0);
    expect(w.length).toBeLessThanOrEqual(3);
    for (const x of w) expect(x.end).toBeGreaterThan(x.start);
    expect(w.some((x) => x.start <= 7 && x.end >= 6)).toBe(true);
  });
});

describe('spots and techniques', () => {
  it('fall bass: the creek mouth ranks first', () => {
    const s = planSpots(lake, features, 'bass', 'fall', 315, 10, false);
    expect(s[0].feature.kind).toBe('creek_mouth');
    expect(s[0].title).toContain('Big Spring Creek');
  });
  it('spawning crappie: coves and docks lead; winter crappie: bridge leads', () => {
    const spawn = planSpots(lake, features, 'crappie', 'spawn', 180, 3, false);
    expect(['cove', 'dock']).toContain(spawn[0].feature.kind);
    const winter = planSpots(lake, features, 'crappie', 'winter', 180, 3, false);
    expect(winter[0].feature.kind).toBe('bridge');
  });
  it('never lists more than two spots of the same kind, ranks 1..n, and every boat is on the water', () => {
    const s = planSpots(lake, features, 'bass', 'summer', 200, 9, true);
    const counts = new Map<string, number>();
    s.forEach((x) => counts.set(x.feature.kind, (counts.get(x.feature.kind) ?? 0) + 1));
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    expect(s.map((x) => x.rank)).toEqual(s.map((_, i) => i + 1));
    for (const x of s) expect(inWater(x.boat, lake.polygons)).toBe(true);
  });
  it('casts point from the boat toward the bank, or toward offshore structure like a bridge span', () => {
    const s = planSpots(lake, features, 'bass', 'prespawn', 0, 2, false);
    expect(s.some((x) => x.feature.kind === 'bridge')).toBe(true);
    for (const x of s) {
      const shore = nearestShore(x.feature.at, lake.polygons)!;
      const offshore = shore.distM > 60 && inWater(x.feature.at, lake.polygons);
      const target = offshore ? x.feature.at : shore.point;
      expect(angleDiff(x.castBearing, bearingDeg(x.boat, target))).toBeLessThan(3);
      expect(distanceM(x.boat, target)).toBeLessThan(80);
      expect(inWater(x.boat, lake.polygons)).toBe(true);
    }
  });
  it('merges a named creek and the cove it enters into one stacked spot', () => {
    const creek = features.find((f) => f.kind === 'creek_mouth')!;
    expect(creek.also).toContain('cove');
    const s = planSpots(lake, features, 'bass', 'fall', 315, 10, false);
    expect(s[0].why.join(' ')).toContain('More structure right here: cove');
  });
  it('keeps one card per place', () => {
    const s = planSpots(lake, features, 'crappie', 'summer', 90, 7, false);
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      expect(distanceM(s[i].feature.at, s[j].feature.at)).toBeGreaterThanOrEqual(150);
    }
  });
  it('credits banks the wind is blowing into', () => {
    // A south wind blows toward the north banks.
    const s = planSpots(lake, features, 'bass', 'fall', 180, 12, false, 20);
    const windy = s.filter((x) => x.why.some((w) => w.includes('wind is pushing')));
    expect(windy.length).toBeGreaterThan(0);
    for (const x of windy) {
      const shore = nearestShore(x.feature.at, lake.polygons)!;
      expect(angleDiff((shore.intoWaterDeg + 180) % 360, 0)).toBeLessThan(60);
    }
  });
  it('switches lure colors for cloudy skies', () => {
    const sunny = planSpots(lake, features, 'bass', 'fall', 315, 10, false)[0].techniques[0].color;
    const cloudy = planSpots(lake, features, 'bass', 'fall', 315, 10, true)[0].techniques[0].color;
    expect(sunny).not.toBe(cloudy);
  });
});

describe('whole forecast', () => {
  it('builds a fall bass forecast for the synthetic lake', () => {
    const w = parseMeteo(meteoResponse('2026-10-07') as never, 'forecast', '2026-10-07');
    const f = buildForecast({ lake, species: 'bass', date: '2026-10-07', weather: w, features });
    expect(f.phase).toBe('fall');
    expect(f.water.source).toBe('estimate');
    expect(f.hours).toHaveLength(24);
    expect(f.spots.length).toBeGreaterThanOrEqual(5);
    expect(f.sunrise).not.toBeNull();
    expect(f.windSummary).toMatch(/mph from the north/);
  });
  it('uses measured water temperature when a gauge has it', () => {
    const w = parseMeteo(meteoResponse('2026-10-07') as never, 'forecast', '2026-10-07');
    const f = buildForecast({ lake, species: 'crappie', date: '2026-10-07', weather: w, features, water: { tempF: 45, source: 'usgs' } });
    expect(f.phase).toBe('winter');
    expect(f.water.source).toBe('usgs');
  });
  it('is fast: 200 forecasts in well under a second', () => {
    const w = parseMeteo(meteoResponse('2026-10-07') as never, 'forecast', '2026-10-07');
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) buildForecast({ lake, species: i % 2 ? 'bass' : 'crappie', date: '2026-10-07', weather: w, features });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
