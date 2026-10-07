import { dayAstro, localHour } from './astro';
import { angleDiff, bearingDeg, compass16, compassWord, distanceM, inWater, nearestShore, offset } from './geo';
import { featureTitle } from './structure';
import type {
  FeatureKind, Forecast, HourScore, Lake, LonLat, Phase, Species, SpotPlan, StructureFeature, Technique, Weather, WaterTemp,
} from './types';

/* ------------------------------------------------------------------ water temperature + season */

/** Water temperature from the last two weeks of daily mean air temperature (lakes lag the air by about a week). */
export function estimateWaterTempF(dailyMeanF: number[]): number {
  const days = dailyMeanF.filter((v) => Number.isFinite(v)).slice(-14);
  if (!days.length) return 65;
  let w = 0, s = 0;
  days.forEach((v, i) => { const k = i + 1; w += k; s += v * k; });
  const lagged = s / w;
  return Math.round(Math.min(90, Math.max(36, lagged + 3)));
}

export function tempTrend(dailyMeanF: number[]): 'rising' | 'falling' | 'steady' {
  const d = dailyMeanF.filter((v) => Number.isFinite(v)).slice(-14);
  if (d.length < 6) return 'steady';
  const half = Math.floor(d.length / 2);
  const a = d.slice(0, half).reduce((x, y) => x + y, 0) / half;
  const b = d.slice(half).reduce((x, y) => x + y, 0) / (d.length - half);
  return b - a > 2 ? 'rising' : a - b > 2 ? 'falling' : 'steady';
}

interface Thresholds { winter: number; prespawn: number; spawnEnd: number; postEnd: number }
const TH: Record<Species, Thresholds> = {
  bass: { winter: 48, prespawn: 60, spawnEnd: 72, postEnd: 80 },
  crappie: { winter: 50, prespawn: 58, spawnEnd: 68, postEnd: 76 },
};

/** month: 1..12 */
export function phaseFor(species: Species, waterF: number, month: number, trend: 'rising' | 'falling' | 'steady'): Phase {
  const t = TH[species];
  if (waterF < t.winter) return 'winter';
  const autumn = month >= 9 || (month === 8 && trend === 'falling');
  if (autumn && waterF < t.postEnd + 2) return 'fall';
  if (month <= 2 && waterF < t.prespawn) return trend === 'rising' ? 'prespawn' : 'winter';
  if (waterF < t.prespawn) return month >= 8 ? 'fall' : 'prespawn';
  if (waterF < t.spawnEnd) return month <= 6 ? 'spawn' : month >= 8 ? 'fall' : 'summer';
  if (waterF < t.postEnd && month <= 6) return 'postspawn';
  return month >= 10 ? 'fall' : 'summer';
}

/* ------------------------------------------------------------------ species × phase playbook */

interface PhaseProfile {
  label: string;
  summary: string;
  depth: [number, number];
  weights: Partial<Record<FeatureKind, number>>;
  /** Bonus for banks the wind is blowing into (bait gets pushed there). */
  windBank: number;
  /** Bonus for north-shore banks that face the sun (warm first in spring). */
  sunBank: number;
  times: { dawn: number; dusk: number; midday: number; afternoon: number; night: number };
  lures: { lure: string; sunny: string; cloudy: string; retrieve: string }[];
  boat: 'cast-bank' | 'cast-uphill' | 'vertical' | 'troll' | 'skip-docks';
  notes?: string;
}

type Playbook = Record<Phase, PhaseProfile>;

const BASS: Playbook = {
  winter: {
    label: 'Winter',
    summary: 'Bass are slow and grouped up deep on steep banks, channel bends and main-lake points. Fish slow; the warmest afternoon hours are best.',
    depth: [15, 35],
    weights: { point: 0.9, dam: 0.85, river_mouth: 0.8, creek_mouth: 0.6, bridge: 0.75, island: 0.6, marina: 0.55, dock: 0.35, cove: 0.2, ramp: 0.25, fishing_pier: 0.3 },
    windBank: 0.2, sunBank: 0.5,
    times: { dawn: 0.35, dusk: 0.5, midday: 0.75, afternoon: 1, night: 0.05 },
    lures: [
      { lure: 'Suspending jerkbait', sunny: 'Ghost shad / translucent', cloudy: 'Chartreuse shad', retrieve: 'Two twitches, then pause 5–10 seconds' },
      { lure: 'Blade bait or jigging spoon (1/2 oz)', sunny: 'Silver', cloudy: 'Gold', retrieve: 'Lift 1–2 ft and let it flutter back on a slack line' },
      { lure: 'Football jig (3/4 oz) with craw trailer', sunny: 'Green pumpkin', cloudy: 'Black / blue', retrieve: 'Drag slowly along the bottom, stop on rocks' },
    ],
    boat: 'cast-uphill',
    notes: 'Smallmouth: rocky bluffs and gravel points, a hair-jig or float-n-fly. Spotted bass: steepest rock in 25–40 ft.',
  },
  prespawn: {
    label: 'Pre-spawn',
    summary: 'Water is warming and bass are moving from deep water toward spawning coves. They stage on secondary points, creek mouths and riprap. Sunny afternoons on north-shore banks are best.',
    depth: [5, 15],
    weights: { creek_mouth: 0.95, river_mouth: 0.7, point: 0.85, cove: 0.6, bridge: 0.75, dock: 0.55, marina: 0.5, dam: 0.4, island: 0.55, ramp: 0.35, fishing_pier: 0.35 },
    windBank: 0.6, sunBank: 0.8,
    times: { dawn: 0.5, dusk: 0.65, midday: 0.8, afternoon: 1, night: 0.05 },
    lures: [
      { lure: 'Lipless crankbait (1/2 oz)', sunny: 'Gold / chrome', cloudy: 'Red craw', retrieve: 'Yo-yo through grass or rip it free when it ticks the bottom' },
      { lure: 'Bladed swim jig (chatterbait)', sunny: 'Green pumpkin', cloudy: 'White / chartreuse', retrieve: 'Steady, just fast enough to feel the blade' },
      { lure: 'Suspending jerkbait', sunny: 'Natural shad', cloudy: 'Clown', retrieve: 'Jerk, jerk, pause 2–4 seconds' },
    ],
    boat: 'cast-bank',
    notes: 'Smallmouth: transitions from rock to gravel. Spotted bass: channel swing banks near creek mouths.',
  },
  spawn: {
    label: 'Spawn',
    summary: 'Bass are on beds in protected coves and pockets, 1–6 ft deep on firm bottom. Sight-fish with polarized glasses during the brightest hours.',
    depth: [1, 6],
    weights: { cove: 1, creek_mouth: 0.6, dock: 0.75, marina: 0.6, point: 0.35, bridge: 0.3, island: 0.45, ramp: 0.4, dam: 0.1, river_mouth: 0.35, fishing_pier: 0.45 },
    windBank: 0.1, sunBank: 0.9,
    times: { dawn: 0.45, dusk: 0.5, midday: 1, afternoon: 0.95, night: 0.05 },
    lures: [
      { lure: 'Wacky-rigged stick worm (5 in)', sunny: 'Watermelon red', cloudy: 'Junebug', retrieve: 'Let it fall on a slack line, then tiny lifts' },
      { lure: 'Texas-rigged creature bait', sunny: 'Green pumpkin with chartreuse tail', cloudy: 'Black / blue', retrieve: 'Drop it in the bed and shake it in place' },
      { lure: 'Weightless fluke', sunny: 'Pearl', cloudy: 'Albino', retrieve: 'Twitch just under the surface over beds' },
    ],
    boat: 'cast-bank',
    notes: 'Keep the sun at your back and stay back far enough to see the bed. Please release spawning bass quickly.',
  },
  postspawn: {
    label: 'Post-spawn',
    summary: 'Bass are recovering on the first breaks outside spawning areas and under docks, and chasing shad and bluegill spawns. Early topwater is strong.',
    depth: [3, 15],
    weights: { point: 0.9, dock: 0.9, cove: 0.65, creek_mouth: 0.75, marina: 0.65, bridge: 0.6, island: 0.6, river_mouth: 0.5, dam: 0.35, ramp: 0.3, fishing_pier: 0.45 },
    windBank: 0.5, sunBank: 0.2,
    times: { dawn: 1, dusk: 0.85, midday: 0.45, afternoon: 0.5, night: 0.15 },
    lures: [
      { lure: 'Walking topwater', sunny: 'Bone', cloudy: 'Black', retrieve: 'Walk-the-dog with a steady cadence; pause near cover' },
      { lure: 'Swim jig with paddle tail', sunny: 'Bluegill', cloudy: 'White', retrieve: 'Slow roll along dock edges and grass lines' },
      { lure: 'Shaky head with finesse worm', sunny: 'Green pumpkin', cloudy: 'Junebug', retrieve: 'Drag and shake on the first drop-off' },
    ],
    boat: 'skip-docks',
  },
  summer: {
    label: 'Summer',
    summary: 'Bass go deep on main-lake points, ledges, humps and bridges in the heat, and feed shallow at dawn, dusk and at night. Wind and current turn them on.',
    depth: [12, 25],
    weights: { point: 1, river_mouth: 0.8, bridge: 0.85, dam: 0.8, island: 0.8, creek_mouth: 0.6, dock: 0.55, marina: 0.5, cove: 0.2, ramp: 0.2, fishing_pier: 0.4 },
    windBank: 0.8, sunBank: 0,
    times: { dawn: 1, dusk: 0.9, midday: 0.3, afternoon: 0.35, night: 0.55 },
    lures: [
      { lure: 'Deep-diving crankbait (to 20 ft)', sunny: 'Citrus shad', cloudy: 'Chartreuse / blue back', retrieve: 'Long cast, crank down hard and grind the bottom' },
      { lure: 'Texas or Carolina-rigged 10 in worm', sunny: 'Green pumpkin', cloudy: 'Plum', retrieve: 'Drag slowly across the ledge, pause at the drop' },
      { lure: 'Drop shot (roboworm)', sunny: 'Morning dawn', cloudy: 'Oxblood', retrieve: 'Shake in place over fish you see on electronics' },
      { lure: 'Topwater popper or buzzbait (dawn / dusk only)', sunny: 'Bone', cloudy: 'Black', retrieve: 'Pop-pop-pause along the bank' },
    ],
    boat: 'cast-uphill',
    notes: 'Smallmouth: offshore rock humps in 15–30 ft, a tube or drop shot. Spotted bass: suspend off bluffs; try a swimbait.',
  },
  fall: {
    label: 'Fall',
    summary: 'Bass follow shad into the creeks and the backs of coves. Find the bait and you find the fish; windblown banks and creek mouths are prime.',
    depth: [2, 12],
    weights: { creek_mouth: 1, cove: 0.85, river_mouth: 0.75, point: 0.75, bridge: 0.65, dock: 0.55, marina: 0.5, island: 0.5, dam: 0.4, ramp: 0.35, fishing_pier: 0.4 },
    windBank: 0.9, sunBank: 0.1,
    times: { dawn: 0.9, dusk: 0.85, midday: 0.6, afternoon: 0.7, night: 0.1 },
    lures: [
      { lure: 'Squarebill crankbait', sunny: 'Shad', cloudy: 'Chartreuse / black back', retrieve: 'Bang it off rocks and wood at medium speed' },
      { lure: 'Spinnerbait (double willow)', sunny: 'White / silver blades', cloudy: 'White-chartreuse / gold blades', retrieve: 'Slow roll just under the surface' },
      { lure: 'Walking topwater', sunny: 'Bone', cloudy: 'Chrome', retrieve: 'Fast walk where shad are flicking on top' },
    ],
    boat: 'cast-bank',
    notes: 'Fall turnover can make fishing tough for a week; if so, stick to creeks with clear, flowing water.',
  },
};

const CRAPPIE: Playbook = {
  winter: {
    label: 'Winter',
    summary: 'Crappie school tightly over deep brush, channel ledges, bridge pilings and deep marina docks. Fish vertically and very slowly.',
    depth: [18, 35],
    weights: { bridge: 1, marina: 0.95, river_mouth: 0.8, dam: 0.6, point: 0.65, dock: 0.6, creek_mouth: 0.6, island: 0.45, cove: 0.2, ramp: 0.3, fishing_pier: 0.6 },
    windBank: 0.1, sunBank: 0.4,
    times: { dawn: 0.35, dusk: 0.55, midday: 0.75, afternoon: 1, night: 0.2 },
    lures: [
      { lure: '1/16 oz jig with 2 in tube or curly tail', sunny: 'Monkey milk', cloudy: 'Chartreuse / black', retrieve: 'Vertical, hold it still just above the fish' },
      { lure: 'Live minnow on a slip float or tight line', sunny: 'Natural', cloudy: 'Natural', retrieve: 'Set depth 1–2 ft above the school' },
    ],
    boat: 'vertical',
  },
  prespawn: {
    label: 'Pre-spawn',
    summary: 'Crappie are staging on creek channel ledges and brush leading into spawning coves, and moving shallower on warm days.',
    depth: [8, 15],
    weights: { creek_mouth: 1, cove: 0.7, bridge: 0.8, dock: 0.7, marina: 0.65, river_mouth: 0.7, point: 0.6, island: 0.45, dam: 0.3, ramp: 0.35, fishing_pier: 0.5 },
    windBank: 0.3, sunBank: 0.7,
    times: { dawn: 0.6, dusk: 0.8, midday: 0.75, afternoon: 1, night: 0.2 },
    lures: [
      { lure: 'Spider rig: 6–8 rods of 1/16 oz jigs', sunny: 'Blue / white', cloudy: 'Chartreuse / black (John Deere)', retrieve: 'Push or pull at 0.5–0.8 mph along the channel ledge' },
      { lure: 'Long-line trolled jigs', sunny: 'Pink / white', cloudy: 'Chartreuse / orange', retrieve: 'Troll at 1.0–1.3 mph, 80–100 ft behind the boat' },
    ],
    boat: 'troll',
  },
  spawn: {
    label: 'Spawn',
    summary: 'Crappie are shallow on wood, brush, reeds and docks in protected coves, 1–6 ft deep. Males are aggressive; females sit just outside.',
    depth: [1, 6],
    weights: { cove: 1, dock: 0.9, marina: 0.7, creek_mouth: 0.7, ramp: 0.45, bridge: 0.4, point: 0.3, island: 0.45, river_mouth: 0.4, dam: 0.1, fishing_pier: 0.6 },
    windBank: 0.1, sunBank: 0.8,
    times: { dawn: 0.6, dusk: 0.8, midday: 0.9, afternoon: 1, night: 0.15 },
    lures: [
      { lure: '1/32 oz jig under a small float', sunny: 'Pink / white', cloudy: 'Chartreuse / black', retrieve: 'Pop the float and let it sit next to wood' },
      { lure: 'Jig pole dipping (1/16 oz)', sunny: 'Monkey milk', cloudy: 'Electric chicken', retrieve: 'Drop straight into brush and reeds; lift out slowly' },
    ],
    boat: 'cast-bank',
  },
  postspawn: {
    label: 'Post-spawn',
    summary: 'Crappie pull back to the first deep brush, docks and bridges near spawning coves and suspend. Dock shooting shines.',
    depth: [8, 15],
    weights: { dock: 1, marina: 0.85, bridge: 0.85, creek_mouth: 0.6, point: 0.55, cove: 0.5, island: 0.5, river_mouth: 0.5, dam: 0.3, ramp: 0.3, fishing_pier: 0.55 },
    windBank: 0.2, sunBank: 0.1,
    times: { dawn: 0.9, dusk: 1, midday: 0.5, afternoon: 0.55, night: 0.45 },
    lures: [
      { lure: 'Dock shooting: 1/24 oz jig, 1.5 in body', sunny: 'Blue ice', cloudy: 'Black / chartreuse', retrieve: 'Shoot it deep under the dock and count it down' },
      { lure: '1/16 oz jig on a slow swim', sunny: 'Monkey milk', cloudy: 'Chartreuse', retrieve: 'Count down to 8–10 ft and swim it back slowly' },
    ],
    boat: 'skip-docks',
  },
  summer: {
    label: 'Summer',
    summary: 'Crappie suspend 15–25 ft deep over brush, bridge pilings and deep docks. Fish early, late, or at night under lights at bridges and marinas.',
    depth: [15, 25],
    weights: { bridge: 1, marina: 0.85, dock: 0.75, point: 0.6, river_mouth: 0.7, dam: 0.5, creek_mouth: 0.55, island: 0.5, cove: 0.2, ramp: 0.2, fishing_pier: 0.6 },
    windBank: 0.3, sunBank: 0,
    times: { dawn: 1, dusk: 0.95, midday: 0.35, afternoon: 0.35, night: 0.85 },
    lures: [
      { lure: 'Trolled crankbait (small, dives 12–18 ft)', sunny: 'Shad', cloudy: 'Chartreuse / orange', retrieve: 'Troll at 1.8–2.2 mph over brush and channel edges' },
      { lure: 'Jig and minnow under lights at night', sunny: 'Natural', cloudy: 'Glow', retrieve: 'Suspend just above the school near bridge pilings' },
    ],
    boat: 'vertical',
  },
  fall: {
    label: 'Fall',
    summary: 'Crappie follow shad into the creeks and gather on brush, docks and bridges 5–15 ft deep. Schools roam, so cover water until you find them.',
    depth: [5, 15],
    weights: { creek_mouth: 1, bridge: 0.85, dock: 0.75, marina: 0.7, cove: 0.6, river_mouth: 0.65, point: 0.55, island: 0.45, dam: 0.3, ramp: 0.3, fishing_pier: 0.5 },
    windBank: 0.5, sunBank: 0.1,
    times: { dawn: 0.85, dusk: 1, midday: 0.6, afternoon: 0.7, night: 0.35 },
    lures: [
      { lure: 'Long-line trolled jigs', sunny: 'Blue / white', cloudy: 'Chartreuse / pink', retrieve: 'Troll at 1.0–1.3 mph through creek mouths' },
      { lure: '1/16 oz jig vertically over brush', sunny: 'Monkey milk', cloudy: 'Black / chartreuse', retrieve: 'Hold still, tiny shakes' },
    ],
    boat: 'troll',
  },
};

export const PLAYBOOK: Record<Species, Playbook> = { bass: BASS, crappie: CRAPPIE };

/* ------------------------------------------------------------------ hourly bite score */

const gauss = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd));

export function scoreHours(
  species: Species, phase: Phase, w: Weather, dayIndex: number, sunriseH: number | null, sunsetH: number | null,
  majorH: number[], minorH: number[], moonPhase: number,
): HourScore[] {
  const p = PLAYBOOK[species][phase].times;
  const sr = sunriseH ?? 6.5, ss = sunsetH ?? 19;
  const out: HourScore[] = [];
  for (let h = 0; h < 24; h++) {
    const i = dayIndex + h;
    const reasons: string[] = [];
    const x = h + 0.5;
    const night = x < sr - 0.75 || x > ss + 0.75;
    let light = night ? p.night : Math.max(
      p.dawn * gauss(x, sr + 0.75, 1.3),
      p.dusk * gauss(x, ss - 0.6, 1.3),
      p.midday * gauss(x, 12.5, 2),
      p.afternoon * gauss(x, 15, 1.6),
    );
    if (!night) light = Math.max(light, 0.2);
    let s = light * 0.7;
    if (!night && light === p.dawn * gauss(x, sr + 0.75, 1.3) && light > 0.5) reasons.push('Low light at dawn');
    if (!night && light === p.dusk * gauss(x, ss - 0.6, 1.3) && light > 0.5) reasons.push('Low light at dusk');
    if (night && p.night > 0.4) reasons.push(species === 'crappie' ? 'Night bite under lights' : 'Night feeding');
    if (!night && (light === p.afternoon * gauss(x, 15, 1.6) || light === p.midday * gauss(x, 12.5, 2)) && light > 0.6) reasons.push('Warmest water of the day');

    for (const m of majorH) {
      const d = Math.abs(x - m);
      if (d < 1.25) { s += 0.2 * (1 - d / 1.25); if (d < 0.75) reasons.push('Solunar major period'); }
    }
    for (const m of minorH) {
      const d = Math.abs(x - m);
      if (d < 0.75) { s += 0.12 * (1 - d / 0.75); if (d < 0.5) reasons.push('Solunar minor period'); }
    }

    const cloud = w.cloudPct[i] ?? 50;
    const mid = x > 10 && x < 17;
    if (mid && (phase === 'summer' || phase === 'postspawn' || phase === 'fall')) {
      s += 0.12 * (cloud / 100);
      if (cloud > 70) reasons.push('Cloud cover keeps fish active');
    }
    if (mid && (phase === 'winter' || phase === 'prespawn' || phase === 'spawn')) {
      s += 0.08 * (1 - cloud / 100);
      if (cloud < 30) reasons.push('Sun warming the shallows');
    }

    const wind = w.windMph[i] ?? 5;
    if (wind >= 5 && wind <= 15) { s += 0.08; reasons.push('Good chop on the water'); }
    else if (wind > 20) { s -= 0.15; reasons.push('Strong wind, hard boat control'); }
    else if (wind < 2) s -= 0.03;

    const p0 = w.pressureHpa[i - 3], p1 = w.pressureHpa[i];
    if (Number.isFinite(p0) && Number.isFinite(p1)) {
      const dp = p1 - p0;
      if (dp < -1) { s += 0.12; reasons.push('Falling pressure ahead of weather'); }
      else if (dp > 1.5) { s -= 0.08; reasons.push('Rising pressure after a front'); }
    }

    const rain = w.precipIn[i] ?? 0;
    if (rain > 0.01 && rain <= 0.1) { s += 0.04; reasons.push('Light rain'); }
    else if (rain > 0.3) { s -= 0.1; reasons.push('Heavy rain'); }

    if (moonPhase < 0.05 || moonPhase > 0.95 || Math.abs(moonPhase - 0.5) < 0.05) s += 0.04;

    out.push({ hour: h, score: Math.round(Math.max(0.03, Math.min(1, s)) * 100), reasons: [...new Set(reasons)].slice(0, 3) });
  }
  return out;
}

export function bestWindows(hours: HourScore[]): { start: number; end: number; score: number }[] {
  const max = Math.max(...hours.map((h) => h.score));
  const cut = Math.max(35, max * 0.8);
  const runs: { start: number; end: number; score: number }[] = [];
  let cur: { start: number; end: number; score: number } | null = null;
  for (const h of hours) {
    if (h.score >= cut) {
      if (cur && cur.end === h.hour) { cur.end = h.hour + 1; cur.score = Math.max(cur.score, h.score); }
      else { cur = { start: h.hour, end: h.hour + 1, score: h.score }; runs.push(cur); }
    } else cur = null;
  }
  return runs.sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------ spots */

function depthFor(kind: FeatureKind, range: [number, number]): [number, number] {
  const [a, b] = range;
  const mid = Math.round((a + b) / 2);
  if (kind === 'cove' || kind === 'ramp' || kind === 'creek_mouth') return [a, Math.max(a + 2, mid)];
  if (kind === 'point' || kind === 'dam' || kind === 'island' || kind === 'river_mouth' || kind === 'bridge') return [Math.min(mid, b - 2), b];
  return [a, b];
}

const ydFromM = (m: number) => Math.round((m * 1.0936) / 5) * 5;

/** Where to hold the boat: `standoffM` out from `target` toward open water, nudged upwind in a breeze, always on the water. */
function placeBoat(lake: Lake, target: LonLat, intoWater: number, standoffM: number, windFromDeg: number, windMph: number): LonLat {
  const tries = [standoffM, standoffM * 0.6, standoffM * 0.35];
  for (const d of tries) {
    let p = offset(target, intoWater, d);
    if (!inWater(p, lake.polygons)) continue;
    if (windMph >= 8) {
      const up = offset(p, windFromDeg, Math.min(15, d / 2));
      if (inWater(up, lake.polygons)) p = up;
    }
    return p;
  }
  return target;
}

/** Spots that score well for several reasons at once: stacked structure is where fish concentrate. */
function stackedKinds(f: StructureFeature, all: StructureFeature[], radiusM: number): FeatureKind[] {
  const kinds = new Set<FeatureKind>(f.also ?? []);
  for (const o of all) {
    if (o === f || o.kind === f.kind || o.kind === 'ramp') continue;
    if (distanceM(o.at, f.at) <= radiusM) kinds.add(o.kind);
  }
  kinds.delete(f.kind);
  return [...kinds];
}

const KIND_WORD: Record<FeatureKind, string> = {
  creek_mouth: 'creek mouth', river_mouth: 'river channel', point: 'point', cove: 'cove', bridge: 'bridge',
  dock: 'docks', marina: 'marina', ramp: 'ramp', dam: 'dam', island: 'island', fishing_pier: 'fishing pier',
};

export function planSpots(
  lake: Lake, features: StructureFeature[], species: Species, phase: Phase,
  windFromDeg: number, windMph: number, cloudy: boolean, limit = 8,
): SpotPlan[] {
  const prof = PLAYBOOK[species][phase];
  const windToward = (windFromDeg + 180) % 360;
  const phaseWord = prof.label.toLowerCase();
  const scored = features
    .filter((f) => f.kind !== 'ramp' || (prof.weights.ramp ?? 0) >= 0.4)
    .map((f) => {
      const why: string[] = [];
      const base = prof.weights[f.kind] ?? 0.2;
      let score = base * 60;
      const e = f.shore ?? (() => {
        const n = nearestShore(f.at, lake.polygons);
        return n ? { at: n.point, distM: n.distM, intoWaterDeg: n.intoWaterDeg } : undefined;
      })();
      if (base >= 0.8) why.push(`${featureTitle({ kind: f.kind, at: f.at })} is a top ${phaseWord} spot for ${species}`);
      else if (base >= 0.55) why.push(`${featureTitle({ kind: f.kind, at: f.at })} holds ${species} in ${phaseWord}`);
      const stack = stackedKinds(f, features, 250);
      if (stack.length) {
        const bonus = Math.min(15, stack.reduce((t, k) => t + (prof.weights[k] ?? 0.2) * 10, 0));
        score += bonus;
        why.push(`More structure right here: ${stack.map((k) => KIND_WORD[k]).join(', ')}`);
      }
      if (e && windMph >= 6 && prof.windBank > 0) {
        const bankFacing = (e.intoWaterDeg + 180) % 360; // from the water toward the land
        if (angleDiff(windToward, bankFacing) < 60) {
          score += prof.windBank * 20;
          why.push(`The ${compassWord(windFromDeg)} wind is pushing baitfish onto this bank`);
        }
      }
      if (e && prof.sunBank > 0 && angleDiff(e.intoWaterDeg, 180) < 60) {
        score += prof.sunBank * 14;
        why.push('North-shore bank faces the sun and warms first');
      }
      if (f.name) score += 3;
      return { f, score, why, e };
    });

  scored.sort((a, b) => b.score - a.score);
  const perKind = new Map<FeatureKind, number>();
  const chosen: typeof scored = [];
  for (const s of scored) {
    const n = perKind.get(s.f.kind) ?? 0;
    if (n >= 2) continue;
    if (chosen.some((c) => distanceM(c.f.at, s.f.at) < 150)) continue; // one card per place
    perKind.set(s.f.kind, n + 1);
    chosen.push(s);
    if (chosen.length >= limit) break;
  }

  return chosen.map((s, idx) => {
    const depth = depthFor(s.f.kind, prof.depth);
    // Offshore targets (bridge spans, humps) are fished where they are; bank targets from the bank.
    const offshore = !!s.e && s.e.distM > 60 && inWater(s.f.at, lake.polygons);
    const target: LonLat = offshore ? s.f.at : s.e?.at ?? s.f.at;
    let intoWater = s.e?.intoWaterDeg ?? 0;
    if (offshore) intoWater = windMph >= 6 ? (windFromDeg + 180) % 360 : intoWater; // hold downwind, cast upwind
    const standoff = offshore ? 25 : prof.boat === 'cast-uphill' ? 45 : prof.boat === 'vertical' ? 20 : 30;
    const boat = placeBoat(lake, target, intoWater, standoff, windFromDeg, offshore ? 0 : windMph);
    const fromTarget = bearingDeg(target, boat);
    let cast = bearingDeg(boat, target);
    const yd = ydFromM(distanceM(boat, target));
    const deep = `${depth[0]}–${depth[1]} ft`;
    let boatText: string;
    let castText: string;
    switch (offshore ? 'offshore' : prof.boat) {
      case 'offshore':
        boatText = `Hold about ${yd} yd ${compassWord(fromTarget)} of the ${KIND_WORD[s.f.kind]}${windMph >= 6 ? ', downwind, so the wind pushes you off it rather than into it' : ''}.`;
        castText = `Cast ${compass16(cast)} past the pilings or edge and let the bait swing back along it at ${deep}.`;
        break;
      case 'cast-uphill':
        boatText = `Sit out on the deep side, about ${yd} yd ${compassWord(fromTarget)} of the bank. Ease out until your depth finder reads ${depth[1]} ft or more.`;
        castText = `Cast ${compass16(cast)} up onto the shallow side and work the bait downhill through ${deep}.`;
        break;
      case 'vertical':
        boatText = `Idle ${compassWord(fromTarget)} from the bank until your depth finder shows ${deep} and fish on screen, then hover on them with the trolling motor or spot-lock.`;
        castText = `Drop straight down and keep the bait just above the school at ${deep}.`;
        break;
      case 'troll':
        cast = windFromDeg % 360;
        boatText = `Troll along the bank about ${yd} yd out, staying in ${deep} on your depth finder.`;
        castText = `Head ${compass16(cast)} into the wind for best boat control; turn and make another pass when you mark fish.`;
        break;
      case 'skip-docks':
        boatText = `Idle ${yd} yd ${compassWord(fromTarget)} of the docks or bank, in about ${depth[1]} ft.`;
        castText = `Skip or cast ${compass16(cast)} to the shady side of the dock posts and the deepest corner.`;
        break;
      default:
        boatText = `Keep the boat about ${yd} yd ${compassWord(fromTarget)} of the bank in about ${depth[1]} ft.`;
        castText = `Cast ${compass16(cast)} toward the bank and bring the bait back out to ${depth[1]} ft.`;
    }
    if (windMph >= 6 && prof.boat !== 'troll' && prof.boat !== 'vertical' && !offshore) {
      castText += ` With the wind from the ${compassWord(windFromDeg)}, angle some casts upwind so moving baits come back with the wind like drifting bait.`;
    }
    const techniques: Technique[] = prof.lures.slice(0, 3).map((l) => ({
      lure: l.lure, color: cloudy ? l.cloudy : l.sunny, retrieve: l.retrieve,
    }));
    return {
      rank: idx + 1,
      feature: s.f,
      title: featureTitle(s.f),
      score: Math.max(1, Math.min(99, Math.round((s.score / 85) * 100))),
      why: s.why.length ? s.why : [`Structure ${species} use in ${phaseWord}`],
      depthFt: depth,
      techniques,
      target,
      boat,
      boatText,
      castBearing: Math.round(cast) % 360,
      castText,
    };
  });
}

/* ------------------------------------------------------------------ whole forecast */

export interface ForecastInput {
  lake: Lake;
  species: Species;
  /** Fishing date, YYYY-MM-DD in the lake's local time. */
  date: string;
  weather: Weather;
  water?: WaterTemp | null;
  features: StructureFeature[];
}

export function buildForecast(inp: ForecastInput): Forecast {
  const { lake, species, date, weather: w } = inp;
  const month = Number(date.slice(5, 7));
  const trend = tempTrend(w.dailyMeanF);
  const water: WaterTemp = inp.water ?? { tempF: estimateWaterTempF(w.dailyMeanF), source: 'estimate' };
  const phase = phaseFor(species, water.tempF, month, trend);
  const prof = PLAYBOOK[species][phase];

  const dayIndex = Math.max(0, w.time.findIndex((t) => t.startsWith(date)));
  const dayStartUtcMs = Date.parse(`${date}T00:00:00Z`) - w.utcOffsetSeconds * 1000;
  const astro = dayAstro(lake.center[1], lake.center[0], dayStartUtcMs);
  const lh = (d: Date) => localHour(d, w.utcOffsetSeconds);
  const hours = scoreHours(
    species, phase, w, dayIndex,
    astro.sunrise ? lh(astro.sunrise) : null, astro.sunset ? lh(astro.sunset) : null,
    astro.major.map(lh), astro.minor.map(lh), astro.moonPhase,
  );
  const windows = bestWindows(hours);

  // Conditions during the best windows decide wind-driven spots and lure colors.
  const idx = windows.flatMap((b) => Array.from({ length: b.end - b.start }, (_, k) => dayIndex + b.start + k));
  const pick = (arr: number[]) => (idx.length ? idx : [dayIndex + 12]).map((i) => arr[i]).filter(Number.isFinite);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const windMph = avg(pick(w.windMph));
  const cloud = avg(pick(w.cloudPct));
  // Circular mean for wind direction.
  const dirs = pick(w.windFromDeg);
  const sx = dirs.reduce((s, d) => s + Math.sin((d * Math.PI) / 180), 0);
  const cx = dirs.reduce((s, d) => s + Math.cos((d * Math.PI) / 180), 0);
  const windFrom = ((Math.atan2(sx, cx) * 180) / Math.PI + 360) % 360;

  const spots = planSpots(lake, inp.features, species, phase, windFrom, windMph, cloud > 60);

  const pDay = w.pressureHpa.slice(dayIndex, dayIndex + 24).filter(Number.isFinite);
  const dp = pDay.length > 1 ? pDay[pDay.length - 1] - pDay[0] : 0;
  const dayTemps = w.tempF.slice(dayIndex, dayIndex + 24).filter(Number.isFinite);

  return {
    phase,
    phaseLabel: prof.label,
    phaseSummary: prof.summary + (prof.notes ? ` ${prof.notes}` : ''),
    water,
    hours,
    bestWindows: windows,
    spots,
    sunrise: astro.sunrise,
    sunset: astro.sunset,
    moonPhaseName: astro.moonPhaseName,
    moonIllum: astro.moonIllum,
    solunar: { major: astro.major, minor: astro.minor },
    windSummary: `${Math.round(windMph)} mph from the ${compassWord(windFrom)}`,
    skySummary: `${cloud > 70 ? 'Cloudy' : cloud > 35 ? 'Part sun' : 'Sunny'}, ${dayTemps.length ? `${Math.round(Math.min(...dayTemps))}–${Math.round(Math.max(...dayTemps))}°F air` : ''}`,
    pressureTrend: dp < -2 ? 'falling' : dp > 2 ? 'rising' : 'steady',
  };
}
