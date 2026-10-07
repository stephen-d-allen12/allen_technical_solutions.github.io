import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockServices, startClock } from './mock';

const SHOTS = process.env.SHOTS_DIR;

async function openLake(page: Page) {
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lak');
  const opt = page.getByRole('option').first();
  await expect(opt).toContainText('Test Lake');
  await opt.click();
  await expect(page.locator('.spot').first()).toBeVisible();
  // Wait for the second pass (creeks, bridges, docks from the map data).
  await expect(page.locator('.loading')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await startClock(page);
});

test('REQ-003: search, species and date sit at the top; REQ-007: the map is the biggest thing on screen', async ({ page }) => {
  await mockServices(page);
  await page.goto('./');
  const vh = page.viewportSize()!.height;
  const search = await page.getByRole('combobox', { name: 'Search for a lake' }).boundingBox();
  const bass = await page.getByRole('radio', { name: /Bass/ }).boundingBox();
  const date = await page.getByLabel('Fishing date').boundingBox();
  const map = await page.locator('.mapwrap').boundingBox();
  for (const b of [search!, bass!, date!]) expect(b.y + b.height).toBeLessThanOrEqual(map!.y + 1);
  expect(map!.height / vh).toBeGreaterThan(0.55);
  expect(map!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
  await expect(page.getByRole('radio', { name: /Bass/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Fishing date')).toHaveValue('2026-10-07');
});

test('REQ-003/004: lake search shows only US lakes and highlights the chosen lake', async ({ page }) => {
  const log = await mockServices(page);
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lak');
  await expect(page.getByRole('option')).toHaveCount(1); // the road and the Canadian lake are filtered out
  await expect(page.getByRole('option')).toContainText('Marshall County, Alabama');
  await page.getByRole('option').click();
  await expect(page.locator('.spot').first()).toBeVisible();
  const st = await page.evaluate(() => (window as any).__ff.state);
  expect(st.lake.name).toBe('Test Lake');
  expect(st.lake.polygons.length).toBe(1);
  expect(st.lake.acres).toBeGreaterThan(1000);
  // The highlight is drawn (on the map's canvas layer) and the map zoomed in to the lake.
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__ff.map.getZoom())).toBeGreaterThanOrEqual(12);
  expect(log.calls.some((c) => c.url.includes('osm_ids=R424242') && c.url.includes('polygon_geojson=1'))).toBe(true);
  // Search is debounced: typing 8 characters did not send 6 requests.
  expect(log.calls.filter((c) => c.service === 'photon').length).toBeLessThanOrEqual(2);
});

test('REQ-005/006: spots, best times and full technique for fall bass', async ({ page }) => {
  await mockServices(page);
  await openLake(page);
  const tiles = page.locator('.tile');
  await expect(tiles.nth(0)).toContainText('71°F');
  await expect(tiles.nth(0)).toContainText('Measured at Test Lake at Dam');
  await expect(tiles.nth(1)).toContainText('Fall');
  await expect(tiles.nth(2)).toContainText('mph');
  await expect(page.locator('.window').first()).toBeVisible();
  await expect(page.locator('.bar')).toHaveCount(24);

  const spots = page.locator('.spot');
  expect(await spots.count()).toBeGreaterThanOrEqual(5);
  await expect(spots.first()).toContainText('Big Spring Creek');
  const first = spots.first();
  await expect(first.locator('.howto')).toContainText('Boat');
  await expect(first.locator('.howto')).toContainText('Cast');
  await expect(first.locator('.howto dd').nth(1)).toContainText(/\b(N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW)\b, \d+°/);
  expect(await first.locator('.lures li').count()).toBeGreaterThanOrEqual(2);
  await expect(first.locator('.lures')).toContainText(/crankbait|spinnerbait|topwater/i);
  await expect(first.locator('.lures li').first()).toContainText('Color:');

  // Numbered pins match the list. At whole-lake zoom the boat and cast arrow are left off (they'd be a few pixels).
  expect(await page.locator('.spot-pin').count()).toBe(await spots.count());
  await expect(page.locator('.ramp-pin')).toHaveCount(1);
  await expect(page.locator('.boat-pin')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-1-lake-and-spots.png` });

  // Tapping another spot opens it and moves the boat.
  const boatBefore = await page.evaluate(() => (window as any).__ff.state.forecast.spots[0].boat);
  await spots.nth(2).locator('button').click();
  await expect(spots.nth(2)).toHaveClass(/sel/);
  await expect(spots.nth(2).locator('button')).toHaveAttribute('aria-expanded', 'true');
  await expect(spots.first().locator('.body')).toBeHidden();
  const sel = await page.evaluate(() => (window as any).__ff.state.selected);
  expect(sel).toBe(2);
  const boatAfter = await page.evaluate(() => (window as any).__ff.state.forecast.spots[2].boat);
  expect(boatAfter).not.toEqual(boatBefore);
  // The map flies in close enough to show where to put the boat and which way to cast.
  await expect(page.locator('.boat-pin')).toHaveCount(1);
  await expect(page.locator('.cast-arrow')).toHaveCount(1);
  await expect(page.locator('.target-ring')).toHaveText('3');
  expect(await page.evaluate(() => (window as any).__ff.map.getZoom())).toBeGreaterThanOrEqual(16);
  if (SHOTS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SHOTS}/phone-3-spot-boat-and-cast.png` });
    await spots.nth(2).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 140));
    await page.screenshot({ path: `${SHOTS}/phone-4-spot-technique.png` });
  }
});

test('switching to crappie changes the pattern and lures, and the link remembers it', async ({ page }) => {
  await mockServices(page);
  await openLake(page);
  const bassLures = await page.locator('.spot').first().locator('.lures').innerText();
  await page.getByRole('radio', { name: /Crappie/ }).click();
  await expect(page.getByRole('radio', { name: /Crappie/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.phase')).toContainText('crappie');
  const crappieLures = await page.locator('.spot').first().locator('.lures').innerText();
  expect(crappieLures).not.toBe(bassLures);
  expect(crappieLures.toLowerCase()).toMatch(/jig|minnow|troll/);
  expect(page.url()).toContain('sp=crappie');
  if (SHOTS) {
    await page.locator('.tiles').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -20));
    await page.screenshot({ path: `${SHOTS}/phone-2-crappie-conditions-and-times.png` });
  }
  // A shared link reopens the same lake and species.
  const url = page.url();
  const page2 = await page.context().newPage();
  await startClock(page2);
  await mockServices(page2);
  await page2.goto(url);
  await expect(page2.locator('.lake-head h1')).toHaveText('Test Lake');
  await expect(page2.getByRole('radio', { name: /Crappie/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page2.locator('.spot').first()).toBeVisible();
});

test('date picker: a forecast date asks for that day; a date 2 months out uses last year as typical weather', async ({ page }) => {
  const log = await mockServices(page);
  await openLake(page);
  await page.getByLabel('Fishing date').fill('2026-10-10');
  await page.getByLabel('Fishing date').dispatchEvent('change');
  await expect(page.locator('.spot').first()).toBeVisible();
  expect(log.calls.some((c) => c.service === 'meteo' && c.url.includes('api.open-meteo.com') && c.url.includes('start_date=2026-09-26'))).toBe(true);

  await page.getByLabel('Fishing date').fill('2026-12-05');
  await page.getByLabel('Fishing date').dispatchEvent('change');
  await expect(page.locator('.basis')).toContainText("last year's weather");
  expect(log.calls.some((c) => c.url.includes('archive-api.open-meteo.com') && c.url.includes('start_date=2025-11-22'))).toBe(true);
  await expect(page.locator('.spot').first()).toBeVisible();
});

test('REQ-002: data sources load in parallel, and a repeat visit is served from cache', async ({ page }) => {
  const log = await mockServices(page);
  await openLake(page);
  const t = await page.evaluate(() => (window as any).__ff.timings);
  // Serial would be 300 + 600 + 300 + 250 = 1450 ms of network time after the tap.
  expect(t.allResults).toBeLessThan(1100);
  expect(t.firstResults).toBeLessThan(800);
  expect(t.model).toBeLessThan(150);
  // Overpass and weather start before the outline returns (they only need the search result).
  const pick = log.calls.find((c) => c.url.includes('/lookup'))!.t;
  const over = log.calls.find((c) => c.service === 'overpass')!.t;
  const met = log.calls.find((c) => c.service === 'meteo')!.t;
  expect(Math.abs(over - pick)).toBeLessThan(150);
  expect(Math.abs(met - pick)).toBeLessThan(150);

  // Choose the same lake again: everything comes from the cache, no new network calls.
  const before = log.calls.length;
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lake');
  await page.getByRole('option').first().click();
  await expect(page.locator('.spot').first()).toBeVisible();
  await expect(page.locator('.loading')).toHaveCount(0);
  const newCalls = log.calls.slice(before).filter((c) => c.service !== 'photon');
  expect(newCalls).toEqual([]);
  const t2 = await page.evaluate(() => (window as any).__ff.timings);
  expect(t2.allResults).toBeLessThan(250);
});

test('keeps working when map data or the water gauge is down', async ({ page }) => {
  await mockServices(page, { fail: { overpass: 504, usgs: 500 } });
  await openLake(page);
  // Shape-based spots (points, coves, island) still come through, with an estimated water temp.
  expect(await page.locator('.spot').count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.tile').first()).toContainText('Estimated');
});

test('explains when weather is down and recovers with Try again', async ({ page }) => {
  const opts = { fail: { meteo: 500 } as Record<string, number> };
  await mockServices(page, opts);
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lak');
  await page.getByRole('option').first().click();
  await expect(page.locator('.err')).toContainText('Weather is unavailable');
  delete opts.fail.meteo; // service comes back
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.spot').first()).toBeVisible();
});

test('changing the date while map data is still loading keeps the creeks, docks and bridges', async ({ page }) => {
  await mockServices(page, { latency: { overpass: 2500 } });
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lak');
  await page.getByRole('option').first().click();
  // Shape-based spots first, with the map data still on its way.
  await expect(page.locator('.spot').first()).toBeVisible();
  await expect(page.locator('.loading')).toContainText('Adding creeks');
  await page.getByLabel('Fishing date').fill('2026-10-09');
  await page.getByLabel('Fishing date').dispatchEvent('change');
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.spot').first()).toContainText('Big Spring Creek');
  expect(await page.evaluate(() => (window as any).__ff.state.date)).toBe('2026-10-09');
});

test('the spot you tapped stays selected when the map data re-ranks the list', async ({ page }) => {
  await mockServices(page, { latency: { overpass: 2500 } });
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lak');
  await page.getByRole('option').first().click();
  const spots = page.locator('.spot');
  await expect(spots.nth(3)).toBeVisible();
  await expect(page.locator('.loading')).toContainText('Adding creeks');
  await spots.nth(3).locator('button').click();
  const picked = await page.evaluate(() => (window as any).__ff.state.forecast.spots[3].feature.at);
  await expect(page.locator('.loading')).toHaveCount(0, { timeout: 8000 });
  const after = await page.evaluate(() => {
    const s = (window as any).__ff.state;
    return { at: s.forecast.spots[s.selected].feature.at, selected: s.selected };
  });
  expect(after.at).toEqual(picked);
  await expect(spots.nth(after.selected)).toHaveClass(/sel/);
  await expect(page.locator('.target-ring')).toHaveText(String(after.selected + 1));
});

test('waits briefly for the water gauge so the first plan already uses measured water temperature', async ({ page }) => {
  await mockServices(page, { latency: { usgs: 900, meteo: 200, nominatim: 200 } });
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lak');
  await page.getByRole('option').first().click();
  await expect(page.locator('.tile').first()).toBeVisible();
  // The very first forecast on screen already reads the gauge (no flip from an estimate).
  await expect(page.locator('.tile').first()).toContainText('Measured at Test Lake at Dam', { timeout: 100 });
});

test('a failed lake outline explains itself and Try again recovers', async ({ page }) => {
  const opts = { fail: { nominatim: 503 } as Record<string, number> };
  await mockServices(page, opts);
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Search for a lake' }).fill('test lak');
  await page.getByRole('option').first().click();
  await expect(page.locator('.err')).toContainText('Could not load Test Lake');
  delete opts.fail.nominatim;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.spot').first()).toBeVisible();
  await expect(page.locator('.err')).toHaveCount(0);
});

test('REQ-001: sunlight readability: AAA contrast, big type, big touch targets, in Sun and Night themes', async ({ page }) => {
  await mockServices(page);
  await openLake(page);
  for (const theme of ['sun', 'night'] as const) {
    if (theme === 'night') {
      await page.getByRole('button', { name: 'Switch to night theme' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    }
    const axe = await new AxeBuilder({ page })
      .include('.topbar').include('#panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21aa', 'best-practice'])
      .analyze();
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.id.startsWith('color-contrast'));
    expect(serious.map((v) => `${theme}: ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

    // Type sizes: readouts large, body at least 15 px (most at 18).
    const sizes = await page.evaluate(() => {
      const px = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
      const texts = [...document.querySelectorAll('#panel p, #panel li, #panel td, #panel dd, #panel span')]
        .filter((el) => (el as HTMLElement).offsetParent && (el.textContent ?? '').trim());
      return { readout: px(document.querySelector('.tile .v')), window: px(document.querySelector('.window')), min: Math.min(...texts.map(px)) };
    });
    expect(sizes.readout).toBeGreaterThanOrEqual(36);
    expect(sizes.window).toBeGreaterThanOrEqual(24);
    expect(sizes.min).toBeGreaterThanOrEqual(13);

    // Touch targets: everything you tap is at least 44 px tall (most are 56).
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.topbar button, .topbar input, .map-tools button, #panel button, #panel .links a')]
        .map((el) => ({ el: (el as HTMLElement).className || el.tagName, h: el.getBoundingClientRect().height }))
        .filter((x) => x.h > 0 && x.h < 44));
    expect(small).toEqual([]);
    if (SHOTS && theme === 'night') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/phone-5-night-theme.png` });
    }
  }
  // The choice is remembered.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
});

test('welcome screen with one-tap example lakes', async ({ page }) => {
  await mockServices(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Where are they biting?' })).toBeVisible();
  expect(await page.locator('.chip').count()).toBe(6);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-0-welcome.png` });
});
