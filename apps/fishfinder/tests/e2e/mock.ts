import type { Page, Route } from '@playwright/test';
import { meteoResponse, nominatimLookup, overpassResponse, photonResponse, usgsResponse } from '../fixtures/synthetic';

/** Blank 1x1 PNG map tile (the test machine cannot reach the real map servers). */
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4+/oxAAWEArxGdsvgAAAAAElFTkSuQmCC', 'base64');

export interface MockOpts {
  /** Replace a service's response body (for example a much bigger lake). */
  data?: Partial<Record<'nominatim' | 'overpass', () => unknown>>;
  /** Simulated network delay per service, ms (a typical 4G phone). */
  latency?: Partial<Record<'photon' | 'nominatim' | 'overpass' | 'meteo' | 'usgs', number>>;
  fail?: Partial<Record<'photon' | 'nominatim' | 'overpass' | 'meteo' | 'usgs', number>>;
}

export interface MockLog { calls: { service: string; url: string; t: number }[] }

export async function mockServices(page: Page, opts: MockOpts = {}): Promise<MockLog> {
  const log: MockLog = { calls: [] };
  const lat = { photon: 150, nominatim: 300, overpass: 600, meteo: 300, usgs: 250, ...opts.latency };
  const t0 = Date.now();
  const json = (service: keyof typeof lat, body: () => unknown) => async (route: Route) => {
    log.calls.push({ service, url: route.request().url(), t: Date.now() - t0 });
    await new Promise((r) => setTimeout(r, lat[service]));
    const status = opts.fail?.[service];
    if (status) return route.fulfill({ status, body: 'error' });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body()) });
  };
  await page.route('https://photon.komoot.io/**', json('photon', photonResponse));
  await page.route('https://nominatim.openstreetmap.org/**', json('nominatim', opts.data?.nominatim ?? nominatimLookup));
  await page.route(/overpass/, json('overpass', opts.data?.overpass ?? overpassResponse));
  await page.route(/open-meteo\.com/, async (route) => {
    const u = new URL(route.request().url());
    const start = u.searchParams.get('start_date')!;
    const date = new Date(Date.parse(`${start}T12:00:00Z`) + 14 * 864e5).toISOString().slice(0, 10);
    return json('meteo', () => meteoResponse(date))(route);
  });
  await page.route('https://waterservices.usgs.gov/**', json('usgs', usgsResponse));
  await page.route(/basemap\.nationalmap\.gov|tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  return log;
}

/** Start the page clock at 7 AM on 2026-10-07 in Alabama and let it run (map animations need moving time). */
export async function startClock(page: Page) {
  await page.clock.install({ time: new Date('2026-10-07T07:00:00-05:00') });
  await page.clock.resume();
}
