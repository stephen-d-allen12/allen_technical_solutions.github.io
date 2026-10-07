/**
 * A big, ragged synthetic reservoir for speed tests: ~20,000 shoreline vertices (like a 60,000-acre
 * TVA lake as Nominatim returns it), 150 docks and 60 creeks. Made-up data, not a real lake.
 */
import type { LonLat } from '../../src/lib/types';

export const BIG_CENTER: LonLat = [-86.3, 34.4];

function off(p: LonLat, bearing: number, m: number): LonLat {
  const r = (bearing * Math.PI) / 180;
  return [p[0] + (m * Math.sin(r)) / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + (m * Math.cos(r)) / 111320];
}

export function bigLakeRing(n = 20000): LonLat[] {
  const ring: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360;
    const r = 9000 + 2500 * Math.sin((a * Math.PI) / 18) + 600 * Math.sin((a * Math.PI) / 2.1) + 120 * Math.sin(a * 7.3);
    ring.push(off(BIG_CENTER, a, r));
  }
  ring.reverse();
  ring.push(ring[0]);
  return ring;
}

/** Overpass elements: docks spread around the lake and creeks running from the hills down to the bank. */
export function bigLakeElements(ring: LonLat[]) {
  const n = ring.length - 1;
  const elements: { type: 'node' | 'way'; id: number; lat?: number; lon?: number; tags: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] = [];
  for (let k = 0; k < 150; k++) {
    const p = off(BIG_CENTER, k * 2.4, 6000);
    elements.push({ type: 'node', id: k, lat: p[1], lon: p[0], tags: { man_made: 'pier' } });
  }
  for (let k = 0; k < 60; k++) {
    const a = k * 6;
    const p0 = off(BIG_CENTER, a, 16000), p1 = ring[Math.floor(((360 - a) / 360) * n) % n];
    elements.push({ type: 'way', id: 1000 + k, tags: { waterway: 'stream' }, geometry: [p0, p1].map(([lon, lat]) => ({ lat, lon })) });
  }
  return elements;
}

export function bigLakeNominatim() {
  const ring = bigLakeRing();
  return [{
    place_id: 2, osm_type: 'relation', osm_id: 424242, lat: String(BIG_CENTER[1]), lon: String(BIG_CENTER[0]),
    category: 'natural', type: 'water', display_name: 'Test Lake, Marshall County, Alabama, United States',
    geojson: { type: 'Polygon', coordinates: [ring] },
  }];
}

export function bigLakeOverpass() {
  return { version: 0.6, elements: bigLakeElements(bigLakeRing()) };
}
