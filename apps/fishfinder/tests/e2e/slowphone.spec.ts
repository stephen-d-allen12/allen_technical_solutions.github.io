import { expect, test } from '@playwright/test';
import { bigLakeNominatim, bigLakeOverpass } from '../fixtures/biglake';
import { mockServices, startClock } from './mock';

/**
 * Worst case on purpose: a 20,000-vertex reservoir with 150 docks and 60 creeks, on a phone CPU
 * (Chromium throttled 4x) with 4G-like service delays. The app must show spots quickly and never
 * freeze the screen for long.
 */
test('big lake on a slow phone: fast first spots, no long freezes', async ({ page }) => {
  await startClock(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__long.push(Math.round(e.duration)); })
      .observe({ type: 'longtask', buffered: true });
  });
  await mockServices(page, {
    latency: { photon: 300, nominatim: 900, overpass: 2000, meteo: 500, usgs: 600 },
    data: { nominatim: bigLakeNominatim, overpass: bigLakeOverpass },
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  await page.goto('./');
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lak');
  await page.getByRole('option').first().click();
  // Long tasks while loading the page itself don't count; only what happens after the tap.
  await page.evaluate(() => { (window as unknown as { __long: number[] }).__long.length = 0; });
  await expect(page.locator('.spot').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 20000 });

  const r = await page.evaluate(() => {
    const w = window as unknown as { __ff: { timings: Record<string, number>; state: { forecast: { spots: unknown[] } } }; __long: number[] };
    return { timings: w.__ff.timings, long: w.__long, spots: w.__ff.state.forecast.spots.length };
  });
  console.log(`slow phone, big lake: ${JSON.stringify(r.timings)} long tasks ${JSON.stringify(r.long)} spots ${r.spots}`);
  expect(r.spots).toBeGreaterThanOrEqual(6);
  // Network alone is 900 ms (outline) and 2,000 ms (map data); the rest is the phone's own work.
  expect(r.timings.firstResults).toBeLessThan(2500);
  expect(r.timings.allResults).toBeLessThan(3500);
  expect(Math.max(0, ...r.long)).toBeLessThan(600);
});
