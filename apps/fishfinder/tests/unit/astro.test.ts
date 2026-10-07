import { describe, expect, it } from 'vitest';
import { dayAstro, formatHour, localHour, moonPhaseName } from '../../src/lib/astro';

// Lake Guntersville area, Central Daylight Time (UTC-5) in June.
const LAT = 34.4, LON = -86.3, CDT = -5 * 3600;
const midnight = (d: string, off: number) => Date.parse(`${d}T00:00:00Z`) - off * 1000;

describe('sun and moon', () => {
  it('summer solstice: sunrise about 5:35 AM, sunset about 8:05 PM, ~14.5 h of daylight', () => {
    const a = dayAstro(LAT, LON, midnight('2026-06-21', CDT));
    const sr = localHour(a.sunrise!, CDT), ss = localHour(a.sunset!, CDT);
    expect(sr).toBeGreaterThan(5.3);
    expect(sr).toBeLessThan(5.9);
    expect(ss).toBeGreaterThan(19.8);
    expect(ss).toBeLessThan(20.4);
    expect(ss - sr).toBeGreaterThan(14.2);
    expect(ss - sr).toBeLessThan(14.7);
  });
  it('winter solstice has about 9.8 h of daylight', () => {
    const CST = -6 * 3600;
    const a = dayAstro(LAT, LON, midnight('2026-12-21', CST));
    const len = localHour(a.sunset!, CST) - localHour(a.sunrise!, CST);
    expect(len).toBeGreaterThan(9.5);
    expect(len).toBeLessThan(10.1);
  });
  it('names known moon phases (full moon 2024-01-25, total eclipse new moon 2024-04-08)', () => {
    expect(dayAstro(LAT, LON, midnight('2024-01-25', -6 * 3600)).moonPhaseName).toBe('Full moon');
    expect(dayAstro(LAT, LON, midnight('2024-04-08', CDT)).moonPhaseName).toBe('New moon');
    expect(moonPhaseName(0.25)).toBe('First quarter');
  });
  it('finds solunar periods: majors ~12.4 h apart, minors are rise/set', () => {
    for (const d of ['2026-03-10', '2026-07-04', '2026-10-07']) {
      const a = dayAstro(LAT, LON, midnight(d, CDT));
      expect(a.major.length).toBeGreaterThanOrEqual(1);
      expect(a.major.length).toBeLessThanOrEqual(2);
      if (a.major.length === 2) {
        const gap = (a.major[1].getTime() - a.major[0].getTime()) / 3600e3;
        expect(gap).toBeGreaterThan(11.5);
        expect(gap).toBeLessThan(13.3);
      }
      expect(a.minor.length).toBeLessThanOrEqual(2);
    }
  });
  it('formats hours', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(6.5)).toBe('6:30 AM');
    expect(formatHour(13)).toBe('1 PM');
  });
});
