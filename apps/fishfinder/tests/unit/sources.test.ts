import { describe, expect, it } from 'vitest';
import { lakeFromNominatim, parseMeteo, parsePhoton, pickUsgsSite, reportLinks } from '../../src/lib/sources';
import { offset } from '../../src/lib/geo';
import { CENTER, meteoResponse, nominatimLookup, photonResponse, usgsResponse } from '../fixtures/synthetic';

describe('data source parsing', () => {
  it('keeps only US lakes from the search results', () => {
    const r = parsePhoton(photonResponse() as never);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Test Lake', osmType: 'R', osmId: 424242, state: 'Alabama' });
    expect(r[0].label).toBe('Test Lake, Marshall County, Alabama');
    expect(r[0].bbox![0]).toBeLessThan(r[0].bbox![2]);
    expect(r[0].bbox![1]).toBeLessThan(r[0].bbox![3]);
  });
  it('parses hourly weather and daily means up to the fishing date', () => {
    const w = parseMeteo(meteoResponse('2026-10-07') as never, 'forecast', '2026-10-07');
    expect(w.time.length).toBe(16 * 24);
    expect(w.dailyMeanF.length).toBe(15);
    expect(w.windFromDeg[0]).toBe(315);
    expect(w.utcOffsetSeconds).toBe(-18000);
  });
  it('relabels last year as "typical" weather for dates too far ahead', () => {
    const w = parseMeteo(meteoResponse('2025-10-08') as never, 'typical', '2026-10-07', 364);
    expect(w.time.some((t) => t.startsWith('2026-10-07'))).toBe(true);
  });
  it('uses the USGS gauge on the lake and converts to °F', () => {
    const sug = parsePhoton(photonResponse() as never)[0];
    const lake = lakeFromNominatim(nominatimLookup()[0] as never, sug);
    const w = pickUsgsSite(usgsResponse() as never, lake)!;
    expect(w.siteName).toBe('TEST LAKE AT DAM');
    expect(w.tempF).toBe(71); // 21.5 °C
    expect(w.source).toBe('usgs');
  });
  it('prefers a gauge out on the lake over one on a nearby bank', () => {
    const sug = parsePhoton(photonResponse() as never)[0];
    const lake = lakeFromNominatim(nominatimLookup()[0] as never, sug);
    const site = (name: string, [lon, lat]: [number, number], c: string) => ({
      sourceInfo: { siteName: name, geoLocation: { geogLocation: { latitude: lat, longitude: lon } } },
      values: [{ value: [{ value: c, dateTime: '2026-10-07T07:00:00.000-05:00' }] }],
    });
    const j = { value: { timeSeries: [site('CREEK NEAR TOWN', offset(CENTER, 90, 1200), '18.0'), site('TEST LAKE MID-LAKE BUOY', offset(CENTER, 0, 400), '22.0')] } };
    expect(pickUsgsSite(j as never, lake)!.siteName).toBe('TEST LAKE MID-LAKE BUOY');
  });
  it('builds report links with the lake, species and month', () => {
    const sug = parsePhoton(photonResponse() as never)[0];
    const lake = lakeFromNominatim(nominatimLookup()[0] as never, sug);
    const links = reportLinks(lake, 'crappie', '2026-10-07');
    expect(links[0].url).toContain('Test%20Lake%20Alabama%20crappie%20fishing%20October');
    expect(links.every((l) => l.url.startsWith('https://'))).toBe(true);
  });
});
