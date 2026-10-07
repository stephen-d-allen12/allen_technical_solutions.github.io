/**
 * Synthetic test lake and API responses in the exact JSON shapes of the real services.
 * Everything here is made-up test data around a point in north Alabama, used because the
 * test machine cannot reach the live APIs.
 */
export const CENTER: [number, number] = [-86.3, 34.4];

function off(p: [number, number], bearing: number, m: number): [number, number] {
  const r = (bearing * Math.PI) / 180;
  return [p[0] + (m * Math.sin(r)) / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + (m * Math.cos(r)) / 111320];
}

/** A 10-vertex star: tips at 2000 m are coves (water reaching into land), inner vertices at 900 m are land points. */
export function starRing(): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const bearing = i * 36;
    // Densify each edge so the outline looks like real mapped shoreline.
    const r0 = i % 2 === 0 ? 2000 : 900;
    const r1 = (i + 1) % 2 === 0 ? 2000 : 900;
    for (let k = 0; k < 6; k++) {
      const f = k / 6;
      const p0 = off(CENTER, bearing, r0), p1 = off(CENTER, bearing + 36, r1);
      ring.push([p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f]);
    }
  }
  // Counter-clockwise like most OSM outer rings? Bearings increase clockwise, so reverse to get CCW.
  ring.reverse();
  ring.push(ring[0]);
  return ring;
}

export function islandRing(): [number, number][] {
  const c = off(CENTER, 200, 300);
  const ring: [number, number][] = [];
  for (let i = 0; i < 12; i++) ring.push(off(c, i * 30, 120));
  ring.push(ring[0]);
  return ring;
}

export const COVE_TIP = () => off(CENTER, 0, 2000);
export const LAND_POINT = () => off(CENTER, 36, 900);

export function photonResponse() {
  const ring = starRing();
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: CENTER },
        properties: {
          osm_type: 'R', osm_id: 424242, osm_key: 'natural', osm_value: 'water', name: 'Test Lake',
          county: 'Marshall County', state: 'Alabama', countrycode: 'US',
          extent: [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)],
        },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-86.1, 34.2] },
        properties: { osm_type: 'W', osm_id: 1, osm_key: 'highway', osm_value: 'residential', name: 'Test Lake Road', state: 'Alabama', countrycode: 'US' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-79.5, 43.7] },
        properties: { osm_type: 'W', osm_id: 2, osm_key: 'natural', osm_value: 'water', name: 'Test Lake', state: 'Ontario', countrycode: 'CA' },
      },
    ],
  };
}

export function nominatimLookup() {
  return [{
    place_id: 1, osm_type: 'relation', osm_id: 424242, lat: String(CENTER[1]), lon: String(CENTER[0]),
    category: 'natural', type: 'water', display_name: 'Test Lake, Marshall County, Alabama, United States',
    boundingbox: ['34.38', '34.42', '-86.32', '-86.28'],
    geojson: { type: 'Polygon', coordinates: [starRing(), islandRing()] },
  }];
}

export function overpassResponse() {
  const cove = COVE_TIP();
  const creekStart = off(cove, 0, 1500);
  const bridgeA = off(CENTER, 144, 2300), bridgeB = off(CENTER, 144, 300);
  const pier = off(CENTER, 288, 1950);
  const ramp = off(CENTER, 252, 920);
  const dam = off(CENTER, 216, 2050);
  const far = off(CENTER, 90, 30000);
  return {
    version: 0.6,
    elements: [
      { type: 'way', id: 11, tags: { waterway: 'stream', name: 'Big Spring Creek' }, geometry: [creekStart, cove].map(([lon, lat]) => ({ lat, lon })) },
      { type: 'way', id: 12, tags: { waterway: 'stream', name: 'Faraway Creek' }, geometry: [far, off(far, 0, 500)].map(([lon, lat]) => ({ lat, lon })) },
      { type: 'way', id: 13, tags: { highway: 'primary', bridge: 'yes', name: 'US 431 Bridge' }, geometry: [bridgeA, bridgeB].map(([lon, lat]) => ({ lat, lon })) },
      { type: 'node', id: 14, lat: pier[1], lon: pier[0], tags: { man_made: 'pier' } },
      { type: 'node', id: 15, lat: ramp[1], lon: ramp[0], tags: { leisure: 'slipway', name: 'Town Ramp' } },
      { type: 'way', id: 16, tags: { waterway: 'dam', name: 'Test Dam' }, geometry: [off(dam, 90, 80), off(dam, 270, 80)].map(([lon, lat]) => ({ lat, lon })) },
    ],
  };
}

/** Hourly weather for 14 days before through 1 day after `date`, fall pattern: cooling, NW wind 8–12 mph. */
export function meteoResponse(date: string) {
  const start = Date.parse(`${date}T00:00:00Z`) - 14 * 864e5;
  const time: string[] = [], temperature_2m: number[] = [], wind_speed_10m: number[] = [], wind_direction_10m: number[] = [],
    wind_gusts_10m: number[] = [], cloud_cover: number[] = [], surface_pressure: number[] = [], precipitation: number[] = [];
  const dt: string[] = [], mx: number[] = [], mn: number[] = [];
  for (let d = 0; d < 16; d++) {
    const day = new Date(start + d * 864e5).toISOString().slice(0, 10);
    const base = 74 - d * 0.6; // cooling into fall
    dt.push(day); mx.push(base + 9); mn.push(base - 9);
    for (let h = 0; h < 24; h++) {
      time.push(`${day}T${String(h).padStart(2, '0')}:00`);
      temperature_2m.push(Math.round((base + 9 * Math.sin(((h - 9) / 24) * 2 * Math.PI)) * 10) / 10);
      wind_speed_10m.push(6 + (h > 9 && h < 18 ? 5 : 0));
      wind_gusts_10m.push(14);
      wind_direction_10m.push(315);
      cloud_cover.push(h < 12 ? 20 : 75);
      surface_pressure.push(1016 - (d === 14 ? h * 0.15 : 0));
      precipitation.push(0);
    }
  }
  return {
    latitude: CENTER[1], longitude: CENTER[0], utc_offset_seconds: -18000, timezone: 'America/Chicago',
    hourly: { time, temperature_2m, wind_speed_10m, wind_direction_10m, wind_gusts_10m, cloud_cover, surface_pressure, precipitation },
    daily: { time: dt, temperature_2m_max: mx, temperature_2m_min: mn },
  };
}

export function usgsResponse() {
  const near = off(CENTER, 180, 2000);
  return {
    value: {
      timeSeries: [
        {
          sourceInfo: { siteName: 'TEST LAKE AT DAM', geoLocation: { geogLocation: { latitude: near[1], longitude: near[0] } } },
          values: [{ value: [{ value: '21.0', dateTime: '2026-10-07T06:00:00.000-05:00' }, { value: '21.5', dateTime: '2026-10-07T07:00:00.000-05:00' }] }],
        },
        {
          sourceInfo: { siteName: 'OTHER RIVER FAR AWAY', geoLocation: { geogLocation: { latitude: CENTER[1] + 0.3, longitude: CENTER[0] + 0.3 } } },
          values: [{ value: [{ value: '15.0', dateTime: '2026-10-07T07:00:00.000-05:00' }] }],
        },
      ],
    },
  };
}
