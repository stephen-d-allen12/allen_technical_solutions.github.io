import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Fonts ship with the app (no Google Fonts round trip, and they work offline on the water).
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import './styles.css';
import { formatHour, formatLocalTime } from './lib/astro';
import { siteTitle } from './lib/format';
import { compass16, distanceM } from './lib/geo';
import { buildForecast } from './lib/model';
import {
  daysBetween, fetchWaterTemps, loadLake, loadStructure, loadWeather, pickUsgsSite, reportLinks, searchLakes, ymd,
} from './lib/sources';
import { collectStructure, shapeFeatures, withShore, type OverpassElement } from './lib/structure';
import type { Forecast, Lake, LakeSuggestion, LonLat, Species, StructureFeature, Weather, WaterTemp } from './lib/types';

/* ------------------------------------------------------------------ state */

interface State {
  species: Species;
  date: string;
  pick: LakeSuggestion | null;
  lake: Lake | null;
  weather: Weather | null;
  water: WaterTemp | null;
  elements: OverpassElement[] | null;
  features: StructureFeature[];
  forecast: Forecast | null;
  selected: number;
  /** Where the spot the angler tapped is, so it stays selected when the list re-ranks. */
  selectedAt: LonLat | null;
  structureFailed: boolean;
  lakeFailed: boolean;
}

const today = ymd(new Date(Date.now() - new Date().getTimezoneOffset() * 60e3));
const st: State = {
  species: 'bass', date: today, pick: null, lake: null, weather: null, water: null,
  elements: null, features: [], forecast: null, selected: 0, selectedAt: null, structureFailed: false, lakeFailed: false,
};
const timings: Record<string, number> = {};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* ------------------------------------------------------------------ theme */

function setTheme(t: 'sun' | 'night', remember: boolean) {
  document.documentElement.dataset.theme = t;
  $('#theme-btn').setAttribute('aria-label', t === 'sun' ? 'Switch to night theme' : 'Switch to sun theme');
  document.querySelector('meta[name="theme-color"]')!.setAttribute('content', t === 'sun' ? '#0B2545' : '#140A00');
  if (remember) try { localStorage.setItem('ff-theme', t); } catch { /* private mode */ }
  if (st.lake) drawLake(st.lake, false);
}
{
  let saved: string | null = null;
  try { saved = localStorage.getItem('ff-theme'); } catch { /* ignore */ }
  const h = new Date().getHours();
  setTheme(saved === 'sun' || saved === 'night' ? saved : h >= 20 || h < 6 ? 'night' : 'sun', false);
}
$('#theme-btn').addEventListener('click', () =>
  setTheme(document.documentElement.dataset.theme === 'sun' ? 'night' : 'sun', true));

/* ------------------------------------------------------------------ map */

const map = L.map('map', { zoomControl: true, preferCanvas: true, attributionControl: true }).setView([37.5, -92], 4);
map.zoomControl.setPosition('bottomright');
// Read-only hook for the automated tests and for support debugging.
(window as unknown as { __ff: unknown }).__ff = { state: st, timings, map };
const layers = [
  {
    name: 'Topo',
    layer: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map',
    }),
  },
  {
    name: 'Aerial',
    layer: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map',
    }),
  },
  {
    name: 'Streets',
    layer: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap contributors',
    }),
  },
];
let layerIdx = 0;
layers[0].layer.addTo(map);
$('#layer-btn').addEventListener('click', () => {
  map.removeLayer(layers[layerIdx].layer);
  layerIdx = (layerIdx + 1) % layers.length;
  layers[layerIdx].layer.addTo(map);
  $('#layer-btn').textContent = layers[layerIdx].name;
});

const lakeLayer = L.layerGroup().addTo(map);
const spotLayer = L.layerGroup().addTo(map);
const planLayer = L.layerGroup().addTo(map);
let meMarker: L.Marker | null = null;

$('#locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) return mapMsg('Location is not available on this device.');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll: L.LatLngExpression = [pos.coords.latitude, pos.coords.longitude];
      meMarker?.remove();
      meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-pin"></div>', iconSize: [22, 22] }), keyboard: false }).addTo(map);
      map.setView(ll, Math.max(map.getZoom(), 14));
    },
    () => mapMsg('Could not get your location. Check location permission.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

function mapMsg(text: string | null) {
  const el = $('#map-msg');
  el.hidden = !text;
  el.textContent = text ?? '';
}

function drawLake(lake: Lake, fit = true) {
  lakeLayer.clearLayers();
  const latlngs = lake.polygons.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x] as [number, number])));
  if (latlngs.length) {
    // Black under-stroke + bright highlight reads on topo, aerial and in glare.
    L.polygon(latlngs, { color: '#000', weight: 8, fill: false, interactive: false }).addTo(lakeLayer);
    L.polygon(latlngs, {
      color: getComputedStyle(document.documentElement).getPropertyValue('--lake').trim() || '#FFD60A',
      weight: 4, fillColor: getComputedStyle(document.documentElement).getPropertyValue('--lake').trim() || '#FFD60A',
      fillOpacity: 0.12, interactive: false,
    }).addTo(lakeLayer);
  }
  if (!fit) return;
  const [w, s, e, n] = lake.bbox;
  const b = L.latLngBounds([[s, w], [n, e]]);
  // Keep the lake (and its pins) clear of the map buttons down the right edge, unless that would
  // cost a whole zoom level; then use the full width.
  const clear = { paddingTopLeft: L.point(16, 16), paddingBottomRight: L.point(80, 16) };
  const full = { padding: L.point(16, 16) };
  map.fitBounds(b, map.getBoundsZoom(b, false, L.point(96, 32)) >= map.getBoundsZoom(b, false, L.point(32, 32)) ? clear : full);
}

/** Pin size follows the zoom so nearby spots don't pile up when the whole lake is in view. */
const pinSize = () => (map.getZoom() <= 13 ? 28 : map.getZoom() <= 15 ? 34 : 40);
/** Boat and cast arrow only make sense once the spot fills the screen (30–45 m is a few pixels at lake zoom). */
const PLAN_ZOOM = 16;

function drawSpots() {
  spotLayer.clearLayers();
  planLayer.clearLayers();
  const f = st.forecast;
  if (!f) return;
  for (const r of st.features.filter((x) => x.kind === 'ramp')) {
    L.marker([r.at[1], r.at[0]], {
      icon: L.divIcon({ className: '', html: '<div class="ramp-pin">R</div>', iconSize: [26, 26] }),
      title: r.name ? `${r.name} boat ramp` : 'Boat ramp', keyboard: false,
    }).addTo(spotLayer);
  }
  const px = pinSize();
  const planView = map.getZoom() >= PLAN_ZOOM;
  f.spots.forEach((s, i) => {
    const sel = i === st.selected;
    if (sel && planView) return; // drawn below as a target ring with the boat and cast line
    const size = sel ? px + 6 : px;
    // A teardrop pin: the point of the drop is the spot itself, so the boat and cast arrow stay visible.
    const m = L.marker([s.feature.at[1], s.feature.at[0]], {
      icon: L.divIcon({
        className: '',
        html: `<div class="spot-pin${sel ? ' sel' : ''}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.6)}px">${s.rank}</div>`,
        iconSize: [size, size + 12], iconAnchor: [size / 2, size + 12],
      }),
      title: `Spot ${s.rank}: ${s.title}`, zIndexOffset: sel ? 1000 : 100,
    }).addTo(spotLayer);
    m.on('click', () => selectSpot(i, true));
  });
  const s = f.spots[st.selected];
  if (!s || !planView) return;
  const boat: L.LatLngExpression = [s.boat[1], s.boat[0]];
  const tgt: L.LatLngExpression = [s.target[1], s.target[0]];
  // Cast line from the boat to the target, arrowhead at the target.
  L.polyline([boat, tgt], { color: '#000', weight: 8, interactive: false }).addTo(planLayer);
  L.polyline([boat, tgt], { color: '#FF6B00', weight: 4, dashArray: '10 7', interactive: false }).addTo(planLayer);
  L.marker(tgt, {
    icon: L.divIcon({ className: '', iconSize: [44, 44], html: `<div class="target-ring" title="Spot ${s.rank}">${s.rank}</div>` }),
    title: `Spot ${s.rank}: ${s.title}`, keyboard: false, zIndexOffset: 1500,
  }).addTo(planLayer);
  const mid: L.LatLngExpression = [(s.boat[1] * 0.35 + s.target[1] * 0.65), (s.boat[0] * 0.35 + s.target[0] * 0.65)];
  L.marker(mid, {
    icon: L.divIcon({ className: '', iconSize: [30, 30], html: `<div class="cast-arrow" style="transform: rotate(${s.castBearing}deg)"><svg width="28" height="28" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 2l9 18-9-5-9 5z" fill="#FF6B00" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/></svg></div>` }),
    interactive: false, keyboard: false, zIndexOffset: 1600,
  }).addTo(planLayer);
  L.marker(boat, {
    icon: L.divIcon({ className: '', iconSize: [40, 40], html: '<div class="boat-pin"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14h18l-3 5H6z" fill="#FFD60A" stroke="#fff" stroke-width="1.5"/><path d="M12 3v10M12 4l6 8h-6" fill="#fff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>' }),
    title: 'Boat position', keyboard: false, zIndexOffset: 2000,
  }).addTo(planLayer);
}

let lastPinSize = 0;
map.on('zoomend', () => {
  const crossedPlan = (map.getZoom() >= PLAN_ZOOM) !== (planLayer.getLayers().length > 0);
  if (pinSize() !== lastPinSize || crossedPlan) drawSpots();
  lastPinSize = pinSize();
});

function selectSpot(i: number, fromMap: boolean) {
  st.selected = i;
  st.selectedAt = st.forecast?.spots[i]?.feature.at ?? null;
  drawSpots();
  document.querySelectorAll<HTMLElement>('.spot').forEach((el, k) => {
    el.classList.toggle('sel', k === i);
    el.querySelector('button')!.setAttribute('aria-expanded', String(k === i));
  });
  const s = st.forecast?.spots[i];
  if (!s) return;
  const b = L.latLngBounds([[s.target[1], s.target[0]], [s.boat[1], s.boat[0]]]);
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Close enough that boat-to-bank (30–45 m) spans a good part of the screen.
  map.flyToBounds(b, { padding: [110, 110], maxZoom: 18, duration: 0.6, animate: !still });
  if (fromMap) document.querySelectorAll('.spot')[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ------------------------------------------------------------------ search box */

const q = $<HTMLInputElement>('#lake-q');
const list = $<HTMLUListElement>('#lake-list');
let suggestions: LakeSuggestion[] = [];
let active = -1;
let searchCtl: AbortController | null = null;
let debounce = 0;

function showList(items: LakeSuggestion[], note?: string) {
  suggestions = items;
  active = -1;
  list.innerHTML = note
    ? `<li class="note" role="option" aria-disabled="true">${esc(note)}</li>`
    : items.map((s, i) => `<li role="option" id="opt-${i}" aria-selected="false" data-i="${i}"><b>${esc(s.name)}</b><span>${esc(s.label.replace(`${s.name}, `, ''))}</span></li>`).join('');
  list.hidden = !note && !items.length;
  q.setAttribute('aria-expanded', String(!list.hidden));
}
function hideList() { list.hidden = true; q.setAttribute('aria-expanded', 'false'); }

q.addEventListener('input', () => {
  clearTimeout(debounce);
  const text = q.value.trim();
  if (text.length < 3) { searchCtl?.abort(); hideList(); return; }
  debounce = window.setTimeout(async () => {
    searchCtl?.abort();
    searchCtl = new AbortController();
    const t0 = performance.now();
    try {
      const res = await searchLakes(text, searchCtl.signal);
      timings.search = Math.round(performance.now() - t0);
      if (q.value.trim() !== text) return;
      showList(res, res.length ? undefined : 'No US lakes match. Try the full name, like "Lake Fork".');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') showList([], 'Search is offline. Check your connection.');
    }
  }, 220);
});
q.addEventListener('keydown', (e) => {
  if (list.hidden || !suggestions.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
    list.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    q.setAttribute('aria-activedescendant', `opt-${active}`);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(suggestions[Math.max(0, active)]);
  } else if (e.key === 'Escape') hideList();
});
list.addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest('li[data-i]') as HTMLElement | null;
  if (li) choose(suggestions[Number(li.dataset.i)]);
});
document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.search')) hideList(); });

/* ------------------------------------------------------------------ species + date */

document.querySelectorAll<HTMLButtonElement>('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    st.species = b.dataset.species as Species;
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    syncUrl();
    recompute();
  }));
const dateIn = $<HTMLInputElement>('#date');
dateIn.value = today;
dateIn.addEventListener('change', () => {
  if (!dateIn.value) { dateIn.value = st.date; return; }
  st.date = dateIn.value;
  syncUrl();
  void loadConditions();
});

/* ------------------------------------------------------------------ loading pipeline */

// Picking a lake starts a new lake run; picking a lake or a date starts a new conditions run. Every
// async step checks that its run is still the current one, so a slow answer for an old lake or date
// never overwrites a newer one, and changing the date mid-load never drops the lake's map data.
let lakeRun = 0;
let condRun = 0;
let lakeLoad: Promise<Lake> = Promise.reject(new Error('No lake chosen'));
lakeLoad.catch(() => {});
let lakeCtl: AbortController | null = null;
let loadingConditions = false;
let waterPending = false;
let runStart = 0;
const sinceStart = () => Math.round(performance.now() - runStart);
const sleep = (ms: number) => new Promise<undefined>((r) => setTimeout(() => r(undefined), ms));
/** How long the first forecast waits for the water gauge once the weather is in (the season depends on it). */
const GAUGE_WAIT_MS = 1200;

async function choose(s: LakeSuggestion) {
  hideList();
  q.value = s.name;
  q.blur();
  st.pick = s;
  st.lake = null; st.weather = null; st.water = null; st.elements = null; st.features = []; st.forecast = null;
  st.selected = 0; st.selectedAt = null; st.structureFailed = false; st.lakeFailed = false;
  for (const k of Object.keys(timings)) delete timings[k];
  syncUrl();
  drawSpots();
  const id = ++lakeRun;
  // A different lake makes the old lake's downloads pointless; free the connection for the new one.
  lakeCtl?.abort();
  const ctl = (lakeCtl = new AbortController());
  runStart = performance.now();
  // Everything that only needs the search result starts right away, in parallel (REQ-002).
  lakeLoad = loadLake(s, ctl.signal);
  lakeLoad.catch(() => {}); // handled below
  const structureP = loadStructure(s, ctl.signal).catch(() => null);
  void loadConditions();
  try {
    const lake = await lakeLoad;
    if (id !== lakeRun) return;
    st.lake = lake;
    timings.outline = sinceStart();
    drawLake(lake);
    // Points, coves and islands from the outline's shape right away; mapped creeks, bridges and docks follow.
    st.features = withShore(lake, shapeFeatures(lake));
    recompute();
    const elems = await structureP;
    if (id !== lakeRun) return;
    if (elems) {
      st.elements = elems;
      st.features = collectStructure(lake, elems);
    } else st.structureFailed = true;
    recompute();
  } catch (e) {
    if (id !== lakeRun) return;
    console.error(e);
    st.lakeFailed = true;
    render();
  }
}

/** Weather and water temperature for the chosen lake and date. */
async function loadConditions() {
  const s = st.pick;
  if (!s) return;
  const id = ++condRun;
  const lakeId = lakeRun;
  const current = () => id === condRun && lakeId === lakeRun;
  const date = st.date;
  const lakeP = lakeLoad;
  st.weather = null; st.water = null; st.forecast = null;
  loadingConditions = true;
  waterPending = true;
  render();
  const weatherP = loadWeather(s.center, date, today).catch((e) => { console.warn(e); return null; });
  // The gauge request only needs the search result's extent; choosing the gauge on the lake needs the outline.
  const gaugesP = s.bbox ? fetchWaterTemps(s.bbox, date, today) : lakeP.then((l) => fetchWaterTemps(l.bbox, date, today));
  const waterP: Promise<WaterTemp | null> = Promise.all([lakeP, gaugesP])
    .then(([lake, j]) => (j ? pickUsgsSite(j, lake) : null))
    .catch(() => null);
  const weather = await weatherP;
  // Measured water temperature decides the season pattern, so give the gauge a moment to answer
  // rather than showing one plan and flipping to another a second later.
  const water = await Promise.race([waterP, sleep(GAUGE_WAIT_MS)]);
  if (!current()) return;
  loadingConditions = false;
  st.weather = weather;
  if (water !== undefined) {
    st.water = water;
    waterPending = false;
  }
  timings.weather ??= sinceStart();
  recompute();
  if (water === undefined) {
    const late = await waterP;
    if (!current()) return;
    st.water = late;
    waterPending = false;
    recompute();
  }
}

function recompute() {
  if (st.lake && st.weather) {
    const t0 = performance.now();
    st.forecast = buildForecast({ lake: st.lake, species: st.species, date: st.date, weather: st.weather, water: st.water, features: st.features });
    timings.model = Math.round(performance.now() - t0);
    // Keep the angler's spot selected when the list re-ranks (map data arriving, species or date change).
    const at = st.selectedAt;
    const k = at ? st.forecast.spots.findIndex((x) => distanceM(x.feature.at, at) < 150) : -1;
    st.selected = k >= 0 ? k : 0;
    timings.firstResults ??= sinceStart();
    if ((st.elements || st.structureFailed) && !waterPending) timings.allResults ??= sinceStart();
  }
  render();
  drawSpots();
}

/* ------------------------------------------------------------------ render panel */

function render() {
  const welcome = $('#welcome');
  const out = $('#results');
  if (!st.pick) { welcome.hidden = false; out.hidden = true; return; }
  welcome.hidden = true;
  out.hidden = false;
  const lake = st.lake;
  const f = st.forecast;
  const sp = st.species === 'bass' ? 'Bass' : 'Crappie';
  const dateLabel = new Date(`${st.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  let h = `<div class="lake-head"><h1>${esc(st.pick.name)}</h1><span class="sub">${esc(st.pick.state ?? '')}${lake?.acres ? ` · ${lake.acres.toLocaleString()} acres` : ''}</span></div>
  <p class="sub">${sp} · ${esc(dateLabel)}</p>`;
  if (st.lakeFailed) {
    out.innerHTML = `${h}<p class="err">Could not load ${esc(st.pick.name)}. Check your connection and try again.</p><p><button type="button" class="chip" id="retry">Try again</button></p>`;
    const pick = st.pick;
    $('#retry').addEventListener('click', () => void choose(pick));
    return;
  }
  if (!lake || !f) {
    out.innerHTML = `${h}<p class="loading">${lake ? 'Loading weather and water temperature…' : 'Loading lake map and conditions…'}</p>`;
    if (lake && !st.weather && !loadingConditions) {
      out.innerHTML = `${h}<p class="err">Weather is unavailable right now, so the forecast can't be built.</p><p><button type="button" class="chip" id="retry">Try again</button></p>`;
      $('#retry').addEventListener('click', () => void loadConditions());
    }
    return;
  }
  const off = st.weather!.utcOffsetSeconds;
  if (st.weather!.basis === 'typical') h += `<p class="basis">This date is more than 16 days out, so it uses last year's weather for the same week as typical conditions.</p>`;
  if (lake.polygons.length === 0) h += `<p class="basis">No outline is mapped for this lake, so spots come from nearby structure only.</p>`;

  const w = f.water;
  h += `<div class="tiles">
    <div class="tile"><div class="k">Water</div><div class="v">${w.tempF}°F</div><div class="s">${w.source === 'usgs' ? `Measured at ${esc(siteTitle(w.siteName ?? 'a USGS gauge'))}` : 'Estimated from 2 weeks of air temps'}</div></div>
    <div class="tile"><div class="k">Season</div><div class="v">${esc(f.phaseLabel)}</div><div class="s">${sp} pattern</div></div>
    <div class="tile"><div class="k">Wind</div><div class="v">${esc(f.windSummary.split(' from ')[0])}</div><div class="s">From the ${esc(f.windSummary.split(' from the ')[1] ?? '')}</div></div>
    <div class="tile"><div class="k">Sky</div><div class="v">${esc(f.skySummary.split(',')[0])}</div><div class="s">${esc(f.skySummary.split(',')[1]?.trim() ?? '')} · pressure ${f.pressureTrend}</div></div>
  </div>
  <div class="phase"><b>${esc(f.phaseLabel)} ${sp.toLowerCase()}:</b> ${esc(f.phaseSummary)}</div>`;

  // Best times (bar per hour).
  const max = Math.max(...f.hours.map((x) => x.score));
  const hiHours = new Set(f.bestWindows.flatMap((b) => Array.from({ length: b.end - b.start }, (_, k) => b.start + k)));
  const winText = f.bestWindows.map((b) => `${formatHour(b.start)}–${formatHour(b.end)}`);
  h += `<h2>Best times to fish</h2><div class="times">
    <div class="windows">${winText.map((t) => `<span class="window">${t}</span>`).join('')}</div>
    <div class="bars" role="img" aria-label="Bite rating by hour. Best: ${winText.join(', ')}">
      ${f.hours.map((x) => `<div class="bar${hiHours.has(x.hour) ? ' hi' : ''}" style="height:${Math.max(3, (x.score / max) * 100)}%" title="${formatHour(x.hour)}: ${x.score}${x.reasons.length ? ` · ${esc(x.reasons.join(', '))}` : ''}"></div>`).join('')}
    </div>
    <div class="axis" aria-hidden="true">${f.hours.map((x) => `<span>${x.hour % 6 === 0 ? formatHour(x.hour).replace(' ', '') : ''}</span>`).join('')}</div>
    <div class="sunmoon">
      <span><b>Sunrise</b> ${formatLocalTime(f.sunrise, off)}</span>
      <span><b>Sunset</b> ${formatLocalTime(f.sunset, off)}</span>
      <span><b>Moon</b> ${esc(f.moonPhaseName)} (${Math.round(f.moonIllum * 100)}%)</span>
      ${f.solunar.major.length ? `<span><b>Major</b> ${f.solunar.major.map((d) => formatLocalTime(d, off)).join(', ')}</span>` : ''}
      ${f.solunar.minor.length ? `<span><b>Minor</b> ${f.solunar.minor.map((d) => formatLocalTime(d, off)).join(', ')}</span>` : ''}
    </div>
    ${topReasons(f)}
  </div>`;

  // Spots.
  h += `<h2>Where ${sp.toLowerCase()} are holding</h2>`;
  if (!st.elements && !st.structureFailed) h += `<p class="loading">Adding creeks, docks, bridges and ramps from the map…</p>`;
  if (!f.spots.length) h += `<p class="err">No structure found for this lake yet.</p>`;
  h += f.spots.map((s, i) => `<article class="spot${i === st.selected ? ' sel' : ''}">
      <button type="button" aria-expanded="${i === st.selected}" data-spot="${i}">
        <span class="num" aria-hidden="true">${s.rank}</span>
        <span class="t"><b>${esc(s.title)}</b>${s.depthFt[0]}–${s.depthFt[1]} ft</span>
        <span class="score"><span class="sr">Rating </span>${s.score}<span class="sr"> of 100</span><small aria-hidden="true">rating</small></span>
      </button>
      <div class="body">
        <ul>${s.why.map((y) => `<li>${esc(y)}</li>`).join('')}</ul>
        <dl class="howto">
          <dt>Boat</dt><dd>${esc(s.boatText)}</dd>
          <dt>Cast</dt><dd>${esc(s.castText)} <b>(${compass16(s.castBearing)}, ${s.castBearing}°)</b></dd>
          <dt>Depth</dt><dd>${s.depthFt[0]}–${s.depthFt[1]} ft</dd>
        </dl>
        <h3 class="lures-h">Lures to throw</h3>
        <ol class="lures">${s.techniques.map((t) => `<li><b>${esc(t.lure)}</b><span class="color">Color: ${esc(t.color)}</span><span>${esc(t.retrieve)}</span></li>`).join('')}</ol>
        <p class="sub"><a href="https://www.google.com/maps/dir/?api=1&destination=${s.boat[1].toFixed(5)},${s.boat[0].toFixed(5)}" target="_blank" rel="noopener">Navigate to the boat spot</a> · ${s.boat[1].toFixed(5)}, ${s.boat[0].toFixed(5)}</p>
      </div>
    </article>`).join('');

  h += `<h2>Recent angler reports</h2><div class="links">${reportLinks(lake, st.species === 'bass' ? 'bass' : 'crappie', st.date)
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>
  <p class="fine">Spots come from the lake's real shape and mapped creeks, bridges, docks and dams, scored with this day's weather, wind, sun, moon and water temperature against seasonal bass and crappie patterns. Data: OpenStreetMap contributors, USGS, Open-Meteo. Always check local regulations and conditions.${timings.allResults ? ` Loaded in ${(timings.allResults / 1000).toFixed(1)} s.` : ''}</p>`;
  out.innerHTML = h;
  out.querySelectorAll<HTMLButtonElement>('button[data-spot]').forEach((b) =>
    b.addEventListener('click', () => selectSpot(Number(b.dataset.spot), false)));
}

function topReasons(f: Forecast): string {
  const best = [...f.hours].sort((a, b) => b.score - a.score)[0];
  if (!best?.reasons.length) return '';
  return `<p class="sub" style="margin:10px 0 0"><b>Why ${formatHour(best.hour)}:</b> ${esc(best.reasons.join(', '))}.</p>`;
}

/* ------------------------------------------------------------------ quick picks, URL state, offline */

const QUICK: LakeSuggestion[] = [
  { name: 'Lake Guntersville', label: 'Lake Guntersville, Alabama', osmType: 'R', osmId: 0, center: [-86.25, 34.45], state: 'Alabama' },
  { name: 'Lake Fork', label: 'Lake Fork, Texas', osmType: 'R', osmId: 0, center: [-95.6, 32.85], state: 'Texas' },
  { name: 'Kentucky Lake', label: 'Kentucky Lake, Kentucky', osmType: 'R', osmId: 0, center: [-88.1, 36.6], state: 'Kentucky' },
  { name: 'Grenada Lake', label: 'Grenada Lake, Mississippi', osmType: 'R', osmId: 0, center: [-89.7, 33.8], state: 'Mississippi' },
  { name: 'Lake Okeechobee', label: 'Lake Okeechobee, Florida', osmType: 'R', osmId: 0, center: [-80.8, 26.95], state: 'Florida' },
  { name: 'Reelfoot Lake', label: 'Reelfoot Lake, Tennessee', osmType: 'R', osmId: 0, center: [-89.4, 36.4], state: 'Tennessee' },
];
$('#quick').innerHTML = QUICK.map((s, i) => `<button type="button" class="chip" data-q="${i}">${esc(s.name)}, ${esc(s.state ?? '')}</button>`).join('');
$('#quick').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest('button[data-q]') as HTMLElement | null;
  if (!b) return;
  const s = QUICK[Number(b.dataset.q)];
  q.value = s.name;
  try {
    const res = await searchLakes(`${s.name} ${s.state}`);
    const hit = res.find((r) => r.state === s.state) ?? res[0];
    if (hit) choose(hit); else q.dispatchEvent(new Event('input'));
  } catch {
    showList([], 'Search is offline. Check your connection.');
  }
});

function syncUrl() {
  const p = new URLSearchParams();
  if (st.pick) {
    p.set('lake', `${st.pick.osmType}${st.pick.osmId}`);
    p.set('name', st.pick.name);
    if (st.pick.state) p.set('st', st.pick.state);
    p.set('c', `${st.pick.center[1].toFixed(4)},${st.pick.center[0].toFixed(4)}`);
    if (st.pick.bbox) p.set('bb', st.pick.bbox.map((v) => v.toFixed(4)).join(','));
  }
  p.set('sp', st.species);
  if (st.date !== today) p.set('d', st.date);
  history.replaceState(null, '', `?${p}`);
}

function fromUrl() {
  const p = new URLSearchParams(location.search);
  const sp = p.get('sp');
  if (sp === 'crappie' || sp === 'bass') {
    st.species = sp;
    document.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-checked', String((x as HTMLElement).dataset.species === sp)));
  }
  const d = p.get('d');
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && Math.abs(daysBetween(today, d)) < 3650) { st.date = d; dateIn.value = d; }
  const lake = p.get('lake');
  const m = lake?.match(/^([NWR])(\d+)$/);
  const c = p.get('c')?.split(',').map(Number);
  if (m && c?.length === 2 && c.every(Number.isFinite)) {
    const bb = p.get('bb')?.split(',').map(Number);
    choose({
      name: p.get('name') ?? 'Lake', label: p.get('name') ?? 'Lake', state: p.get('st') ?? undefined,
      osmType: m[1] as 'N' | 'W' | 'R', osmId: Number(m[2]), center: [c[1], c[0]],
      bbox: bb?.length === 4 && bb.every(Number.isFinite) ? (bb as [number, number, number, number]) : undefined,
    });
  }
}
fromUrl();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

