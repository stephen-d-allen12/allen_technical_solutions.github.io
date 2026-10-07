export type Species = 'bass' | 'crappie';

/** [lon, lat], GeoJSON order. */
export type LonLat = [number, number];
export type Ring = LonLat[];
/** A polygon is an outer ring followed by any hole rings (islands). */
export type Polygon = Ring[];

export interface LakeSuggestion {
  name: string;
  label: string;
  osmType: 'N' | 'W' | 'R';
  osmId: number;
  center: LonLat;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox?: [number, number, number, number];
  state?: string;
}

export interface Lake {
  name: string;
  label: string;
  state?: string;
  center: LonLat;
  bbox: [number, number, number, number];
  polygons: Polygon[];
  /** Water area in acres, from the outline. */
  acres: number;
}

export type FeatureKind =
  | 'creek_mouth'
  | 'river_mouth'
  | 'point'
  | 'cove'
  | 'bridge'
  | 'dock'
  | 'marina'
  | 'ramp'
  | 'dam'
  | 'island'
  | 'fishing_pier';

export interface StructureFeature {
  kind: FeatureKind;
  at: LonLat;
  name?: string;
  /** Other structure at the same place (a creek entering the back of a cove, a dock on a point). */
  also?: FeatureKind[];
  /** Nearest shoreline point and the direction from it out into open water; filled once per lake. */
  shore?: { at: LonLat; distM: number; intoWaterDeg: number };
}

export interface Weather {
  /** Local ISO hour strings, e.g. 2026-10-07T06:00, in the lake's time zone. */
  time: string[];
  tempF: number[];
  windMph: number[];
  gustMph: number[];
  /** Direction the wind blows FROM, degrees true. */
  windFromDeg: number[];
  cloudPct: number[];
  pressureHpa: number[];
  precipIn: number[];
  /** Daily mean air temperatures (F) for the days before and including the fishing date. */
  dailyMeanF: number[];
  utcOffsetSeconds: number;
  timezone: string;
  /** 'forecast' | 'history' | 'typical' (last year's weather used for dates too far ahead). */
  basis: 'forecast' | 'history' | 'typical';
}

export interface WaterTemp {
  tempF: number;
  source: 'usgs' | 'estimate';
  siteName?: string;
  distanceMi?: number;
}

export type Phase = 'winter' | 'prespawn' | 'spawn' | 'postspawn' | 'summer' | 'fall';

export interface HourScore {
  hour: number;
  score: number;
  reasons: string[];
}

export interface Technique {
  lure: string;
  color: string;
  retrieve: string;
}

export interface SpotPlan {
  rank: number;
  feature: StructureFeature;
  title: string;
  score: number;
  why: string[];
  depthFt: [number, number];
  techniques: Technique[];
  /** Where the cast lands: the bank for shoreline spots, the structure itself for offshore spots. */
  target: LonLat;
  boat: LonLat;
  boatText: string;
  castBearing: number;
  castText: string;
}

export interface Forecast {
  phase: Phase;
  phaseLabel: string;
  phaseSummary: string;
  water: WaterTemp;
  hours: HourScore[];
  bestWindows: { start: number; end: number; score: number }[];
  spots: SpotPlan[];
  sunrise: Date | null;
  sunset: Date | null;
  moonPhaseName: string;
  moonIllum: number;
  solunar: { major: Date[]; minor: Date[] };
  windSummary: string;
  skySummary: string;
  pressureTrend: 'rising' | 'falling' | 'steady';
}
