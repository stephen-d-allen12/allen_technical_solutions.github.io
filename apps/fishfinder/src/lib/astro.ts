import * as SunCalc from 'suncalc';

export interface DayAstro {
  sunrise: Date | null;
  sunset: Date | null;
  /** Moon overhead and underfoot: solunar "major" periods (about 2 h each). */
  major: Date[];
  /** Moonrise and moonset: solunar "minor" periods (about 1 h each). */
  minor: Date[];
  moonIllum: number;
  moonPhase: number;
  moonPhaseName: string;
}

const valid = (d: Date | undefined | null): Date | null => (d && !isNaN(d.getTime()) ? d : null);

export function moonPhaseName(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return 'New moon';
  if (phase < 0.22) return 'Waxing crescent';
  if (phase < 0.28) return 'First quarter';
  if (phase < 0.47) return 'Waxing gibbous';
  if (phase < 0.53) return 'Full moon';
  if (phase < 0.72) return 'Waning gibbous';
  if (phase < 0.78) return 'Last quarter';
  return 'Waning crescent';
}

/**
 * Sun and moon for one local day at the lake.
 * `dayStartUtcMs` is local midnight of the fishing date expressed in UTC milliseconds.
 */
export function dayAstro(lat: number, lon: number, dayStartUtcMs: number): DayAstro {
  const noon = new Date(dayStartUtcMs + 12 * 3600e3);
  const sun = SunCalc.getTimes(noon, lat, lon);
  const illum = SunCalc.getMoonIllumination(noon);

  // Moon transit (highest), underfoot (lowest), rise and set: scan the local day at 5-minute steps.
  const H0 = (0.133 * Math.PI) / 180; // moon's apparent horizon (parallax and refraction)
  let hi = { t: 0, alt: -Infinity };
  let lo = { t: 0, alt: Infinity };
  const crossings: number[] = [];
  let prev: { t: number; alt: number } | null = null;
  for (let m = 0; m <= 24 * 60; m += 5) {
    const t = dayStartUtcMs + m * 60e3;
    const alt = SunCalc.getMoonPosition(new Date(t), lat, lon).altitude;
    if (alt > hi.alt) hi = { t, alt };
    if (alt < lo.alt) lo = { t, alt };
    if (prev && (prev.alt - H0) * (alt - H0) < 0) {
      crossings.push(prev.t + ((H0 - prev.alt) / (alt - prev.alt)) * (t - prev.t));
    }
    prev = { t, alt };
  }
  const end = dayStartUtcMs + 24 * 3600e3;
  const inDay = (t: number) => t > dayStartUtcMs + 5 * 60e3 && t < end - 5 * 60e3;
  const major = [hi.t, lo.t].filter(inDay).sort((a, b) => a - b).map((t) => new Date(t));
  const minor = crossings.filter(inDay).map((t) => new Date(t));

  return {
    sunrise: valid(sun.sunrise),
    sunset: valid(sun.sunset),
    major,
    minor,
    moonIllum: illum.fraction,
    moonPhase: illum.phase,
    moonPhaseName: moonPhaseName(illum.phase),
  };
}

/** Local hour (fractional, 0..24) of a UTC instant at a fixed UTC offset. */
export function localHour(d: Date, utcOffsetSeconds: number): number {
  const ms = d.getTime() + utcOffsetSeconds * 1000;
  const x = new Date(ms);
  return x.getUTCHours() + x.getUTCMinutes() / 60;
}

export function formatLocalTime(d: Date | null, utcOffsetSeconds: number): string {
  if (!d) return '—';
  return formatHour(localHour(d, utcOffsetSeconds));
}

export function formatHour(h: number): string {
  const hh = Math.floor(h + 1e-6) % 24;
  const mm = Math.round((h - Math.floor(h + 1e-6)) * 60) % 60;
  const ap = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}
