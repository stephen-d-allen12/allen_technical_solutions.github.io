import { fetchJson } from './fetcher';
import { bboxOf, distanceM, inWater, nearestShorePoint, polygonAcres } from './geo';
import { overpassAroundQuery, overpassQuery, type OverpassElement } from './structure';
import type { Lake, LakeSuggestion, LonLat, Polygon, Weather, WaterTemp } from './types';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const US_BBOX = '-125,24,-66.5,49.5';
const WATER_VALUES = new Set(['water', 'lake', 'reservoir', 'pond', 'basin', 'river', 'oxbow', 'lagoon', 'bay']);

export const ENDPOINTS = {
  photon: 'https://photon.komoot.io/api/',
  nominatim: 'https://nominatim.openstreetmap.org',
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'],
  meteo: 'https://api.open-meteo.com/v1/forecast',
  meteoArchive: 'https://archive-api.open-meteo.com/v1/archive',
  usgs: 'https://waterservices.usgs.gov/nwis',
};

/* ---------------------------------------------------------------- lake search */

interface PhotonFeature {
  geometry: { coordinates: LonLat };
  properties: {
    osm_type: 'N' | 'W' | 'R'; osm_id: number; osm_key?: string; osm_value?: string;
    name?: string; state?: string; county?: string; city?: string; countrycode?: string;
    extent?: [number, number, number, number];
  };
}

export function parsePhoton(json: { features?: PhotonFeature[] }): LakeSuggestion[] {
  const out: LakeSuggestion[] = [];
  const seen = new Set<string>();
  for (const f of json.features ?? []) {
    const p = f.properties;
    if (!p.name || (p.countrycode && p.countrycode.toUpperCase() !== 'US')) continue;
    const isWater = p.osm_key === 'natural' ? WATER_VALUES.has(p.osm_value ?? '')
      : p.osm_key === 'water' || (p.osm_key === 'landuse' && p.osm_value === 'reservoir');
    if (!isWater) continue;
    const key = `${p.name}|${p.state ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const where = [p.county, p.state].filter(Boolean).join(', ');
    const e = p.extent;
    out.push({
      name: p.name,
      label: where ? `${p.name}, ${where}` : p.name,
      osmType: p.osm_type,
      osmId: p.osm_id,
      center: f.geometry.coordinates,
      bbox: e ? [Math.min(e[0], e[2]), Math.min(e[1], e[3]), Math.max(e[0], e[2]), Math.max(e[1], e[3])] : undefined,
      state: p.state,
    });
  }
  return out;
}

export async function searchLakes(q: string, signal?: AbortSignal): Promise<LakeSuggestion[]> {
  const qs = new URLSearchParams({ q, limit: '15', lang: 'en', bbox: US_BBOX });
  qs.append('osm_tag', 'natural:water');
  qs.append('osm_tag', 'landuse:reservoir');
  qs.append('osm_tag', 'water');
  try {
    const json = await fetchJson<{ features: PhotonFeature[] }>(`${ENDPOINTS.photon}?${qs}`, { ttlMs: 7 * DAY, timeoutMs: 6000, signal });
    const res = parsePhoton(json);
    if (res.length) return res.slice(0, 8);
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  // Fallback: Nominatim search (rate limited, so only after Photon misses).
  const nq = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'us', limit: '10', addressdetails: '1' });
  const rows = await fetchJson<NominatimRow[]>(`${ENDPOINTS.nominatim}/search?${nq}`, { ttlMs: 7 * DAY, timeoutMs: 8000, signal });
  return rows
    .filter((r) => r.category === 'natural' || r.category === 'water' || r.type === 'reservoir' || r.type === 'water')
    .map((r) => ({
      name: r.name || r.display_name.split(',')[0],
      label: r.display_name.split(',').slice(0, 3).join(','),
      osmType: (r.osm_type[0].toUpperCase() as 'N' | 'W' | 'R'),
      osmId: r.osm_id,
      center: [Number(r.lon), Number(r.lat)] as LonLat,
      state: r.address?.state,
    }));
}

/* ---------------------------------------------------------------- lake outline */

interface NominatimRow {
  osm_type: string; osm_id: number; lat: string; lon: string; name?: string; display_name: string;
  category?: string; type?: string; boundingbox?: [string, string, string, string];
  geojson?: { type: string; coordinates: unknown };
  address?: { state?: string };
}

export function geojsonToPolygons(g: { type: string; coordinates: unknown } | undefined): Polygon[] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates as Polygon];
  if (g.type === 'MultiPolygon') return g.coordinates as Polygon[];
  return [];
}

export function lakeFromNominatim(row: NominatimRow, fallback: LakeSuggestion): Lake {
  const polygons = geojsonToPolygons(row.geojson).filter((p) => p[0]?.length >= 4);
  const center: LonLat = [Number(row.lon), Number(row.lat)];
  let bbox: [number, number, number, number];
  if (polygons.length) bbox = bboxOf(polygons);
  else if (row.boundingbox) {
    const [s, n, w, e] = row.boundingbox.map(Number);
    bbox = [w, s, e, n];
  } else bbox = fallback.bbox ?? [center[0] - 0.02, center[1] - 0.02, center[0] + 0.02, center[1] + 0.02];
  return {
    name: fallback.name,
    label: fallback.label,
    state: fallback.state,
    center: polygons.length ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : center,
    bbox,
    polygons,
    acres: Math.round(polygonAcres(polygons)),
  };
}

export async function loadLake(s: LakeSuggestion, signal?: AbortSignal): Promise<Lake> {
  const qs = new URLSearchParams({
    osm_ids: `${s.osmType}${s.osmId}`, format: 'jsonv2', polygon_geojson: '1', polygon_threshold: '0.0002',
  });
  const rows = await fetchJson<NominatimRow[]>(`${ENDPOINTS.nominatim}/lookup?${qs}`, { ttlMs: 30 * DAY, timeoutMs: 15000, signal });
  if (!rows.length) throw new Error('Lake outline not found');
  return lakeFromNominatim(rows[0], s);
}

/* ---------------------------------------------------------------- structure */

export async function loadStructure(
  lake: { osmType: 'N' | 'W' | 'R'; osmId: number; bbox?: [number, number, number, number] }, signal?: AbortSignal,
): Promise<OverpassElement[]> {
  const urls: string[] = [];
  const around = overpassAroundQuery(lake.osmType, lake.osmId);
  if (around) for (const u of ENDPOINTS.overpass) urls.push(`${u}?data=${encodeURIComponent(around)}`);
  if (lake.bbox) urls.push(`${ENDPOINTS.overpass[0]}?data=${encodeURIComponent(overpassQuery(lake.bbox))}`);
  if (!urls.length) return [];
  const json = await fetchJson<{ elements: OverpassElement[] }>(urls, { ttlMs: 30 * DAY, timeoutMs: 30000, signal });
  return json.elements ?? [];
}

/* ---------------------------------------------------------------- weather */

interface MeteoJson {
  utc_offset_seconds: number;
  timezone: string;
  hourly: Record<string, (number | null)[]> & { time: string[] };
  daily: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] };
}

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => ymd(new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

export function parseMeteo(j: MeteoJson, basis: Weather['basis'], fishingDate: string, shiftDays = 0): Weather {
  const num = (a: (number | null)[] | undefined) => (a ?? []).map((v) => (v == null ? NaN : v));
  const shift = (t: string) => (shiftDays ? `${addDays(t.slice(0, 10), shiftDays)}${t.slice(10)}` : t);
  const dailyMean: number[] = [];
  j.daily.time.forEach((t, i) => {
    if (shift(t) > fishingDate) return;
    const hi = j.daily.temperature_2m_max[i], lo = j.daily.temperature_2m_min[i];
    if (hi != null && lo != null) dailyMean.push((hi + lo) / 2);
  });
  return {
    time: j.hourly.time.map(shift),
    tempF: num(j.hourly.temperature_2m),
    windMph: num(j.hourly.wind_speed_10m),
    gustMph: num(j.hourly.wind_gusts_10m),
    windFromDeg: num(j.hourly.wind_direction_10m),
    cloudPct: num(j.hourly.cloud_cover),
    pressureHpa: num(j.hourly.surface_pressure),
    precipIn: num(j.hourly.precipitation),
    dailyMeanF: dailyMean,
    utcOffsetSeconds: j.utc_offset_seconds,
    timezone: j.timezone,
    basis,
  };
}

export async function loadWeather(at: LonLat, date: string, today: string, signal?: AbortSignal): Promise<Weather> {
  const ahead = daysBetween(today, date);
  let basis: Weather['basis'] = ahead < -75 ? 'history' : 'forecast';
  let shiftDays = 0;
  let qDate = date;
  if (ahead > 15) {
    // Too far ahead for a forecast: use the same dates last year as typical conditions.
    basis = 'typical';
    shiftDays = 364; // whole weeks, so the weekday pattern of fronts is irrelevant but dates line up
    qDate = addDays(date, -364);
  }
  const start = addDays(qDate, -14);
  const end = basis === 'forecast' ? addDays(qDate, Math.min(1, 15 - ahead)) : addDays(qDate, 1);
  const qs = new URLSearchParams({
    latitude: at[1].toFixed(4), longitude: at[0].toFixed(4),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,surface_pressure,precipitation',
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch',
    timezone: 'auto', start_date: start, end_date: end,
  });
  const base = basis === 'forecast' ? ENDPOINTS.meteo : ENDPOINTS.meteoArchive;
  const ttl = basis === 'forecast' ? HOUR / 2 : 30 * DAY;
  const j = await fetchJson<MeteoJson>(`${base}?${qs}`, { ttlMs: ttl, timeoutMs: 12000, signal });
  return parseMeteo(j, basis, date, shiftDays);
}

/* ---------------------------------------------------------------- water temperature (USGS) */

export interface UsgsJson {
  value?: { timeSeries?: {
    sourceInfo: { siteName: string; geoLocation: { geogLocation: { latitude: number; longitude: number } } };
    values: { value: { value: string; dateTime: string }[] }[];
  }[] };
}

export function pickUsgsSite(j: UsgsJson, lake: Lake): WaterTemp | null {
  const series = j.value?.timeSeries ?? [];
  let best: WaterTemp & { score: number } | null = null;
  for (const s of series) {
    const g = s.sourceInfo.geoLocation.geogLocation;
    const p: LonLat = [g.longitude, g.latitude];
    const vals = s.values?.[0]?.value ?? [];
    const last = [...vals].reverse().find((v) => Number(v.value) > -50 && Number(v.value) < 45);
    if (!last) continue;
    // Gauges on the lake itself (a dam forebay, a mid-lake buoy) count as zero distance.
    const shore = lake.polygons.length ? nearestShorePoint(p, lake.polygons) : null;
    const offLake = !shore ? distanceM(p, lake.center) : inWater(p, lake.polygons) ? 0 : shore.distM;
    if (offLake > 3000) continue; // a gauge on some other river is not this lake
    const score = offLake;
    if (!best || score < best.score) {
      best = {
        tempF: Math.round((Number(last.value) * 9) / 5 + 32),
        source: 'usgs',
        siteName: s.sourceInfo.siteName,
        distanceMi: Math.round((distanceM(p, lake.center) / 1609.34) * 10) / 10,
        score,
      };
    }
  }
  if (!best) return null;
  const { score: _drop, ...rest } = best;
  void _drop;
  return rest;
}

/** The NWIS request for water temperature around a bounding box on a date, or null when the date is out of range. */
export function waterTempUrl(bbox: [number, number, number, number], date: string, today: string): string | null {
  const ahead = daysBetween(today, date);
  if (ahead > 1 || ahead < -365) return null;
  const [w, s, e, n] = bbox;
  const pad = 0.05;
  // NWIS limits a bounding box to 25 square degrees.
  const bb = [w - pad, s - pad, Math.min(e + pad, w + 4.9), Math.min(n + pad, s + 4.9)].map((v) => v.toFixed(4)).join(',');
  return ahead >= -1
    ? `${ENDPOINTS.usgs}/iv/?format=json&bBox=${bb}&parameterCd=00010&siteStatus=active`
    : `${ENDPOINTS.usgs}/dv/?format=json&bBox=${bb}&parameterCd=00010&statCd=00003&startDT=${date}&endDT=${date}`;
}

/**
 * Gauge readings around a bounding box. It only needs the search result's extent, so it can start
 * before the lake outline arrives; picking the gauge that is on the lake waits for the outline.
 */
export async function fetchWaterTemps(
  bbox: [number, number, number, number], date: string, today: string, signal?: AbortSignal,
): Promise<UsgsJson | null> {
  const url = waterTempUrl(bbox, date, today);
  if (!url) return null;
  const live = daysBetween(today, date) >= -1;
  try {
    return await fetchJson<UsgsJson>(url, { ttlMs: live ? HOUR / 2 : 30 * DAY, timeoutMs: 10000, signal });
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- angler reports (links) */

export function reportLinks(lake: Lake, species: string, date: string): { label: string; url: string }[] {
  const month = new Date(`${date}T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const lakeQ = `${lake.name}${lake.state ? ` ${lake.state}` : ''}`;
  const enc = encodeURIComponent;
  return [
    { label: 'Video reports (YouTube)', url: `https://www.youtube.com/results?search_query=${enc(`${lakeQ} ${species} fishing ${month}`)}&sp=CAI%253D` },
    { label: 'Angler posts (Reddit)', url: `https://www.reddit.com/search/?q=${enc(`${lakeQ} ${species}`)}&sort=new` },
    { label: 'State and guide fishing reports', url: `https://www.google.com/search?q=${enc(`${lakeQ} ${species} fishing report`)}&tbs=qdr:m` },
    { label: 'Forum threads', url: `https://www.google.com/search?q=${enc(`${lakeQ} ${species} forum`)}&tbs=qdr:y` },
  ];
}
