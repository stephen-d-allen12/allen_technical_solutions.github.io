// The past-years reports job: gathers dated bass and crappie reports from earlier years (state
// weekly report archives and crappie tournament stories), so the app can show what anglers
// reported on a lake in the same weeks of past years when it has no recent report. Writes one file
// per state per calendar month, past/<ST>-<MM>.json ({ updated, reports }, GA-10.json holding
// every kept report from any past October), and a status.json with each source's progress.
//
//   node scripts/reports/past.mjs <out-dir> [--previous <dir>] [--dump <dir>] [--only <name>]
//        [--minutes 35] [--max-kb 300] [--window 2019-10-01:2019-10-20,...] [--max-pages N]
//
// With --previous it keeps what an earlier run gathered and reads only what is newer than each
// source's newest report (then carries on with the backfill if an earlier run ran out of time),
// so the first run reads the archives back to each source's start and a weekly run is light.
// --window reads only the given date ranges (for checking the parsers against a past month) and
// writes just what it found.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { namesWater, PAST_SOURCES } from './past-sources.mjs';
import { fetchText, fingerprint, pool, robotsCrawlDelay, SkipError, toReport } from './lib.mjs';

const DAY = 864e5;
/** collect.mjs covers the last 75 days; this job keeps what is older. */
export const RECENT_DAYS = 75;
/** The least time between two requests to one site, when its robots.txt asks for no more. */
const MIN_GAP_MS = 1500;
/** Pages kept per site under --dump, for writing and fixing parsers. */
const DUMPS_PER_HOST = 6;

class OutOfTime extends Error {}

/* ------------------------------------------------------------------ the stored reports */

/** The file a report belongs in: its state and the month it was written ("GA-10.json"; "US-" when no one state). */
export const fileFor = (r) => `${r.state ?? 'US'}-${r.date.slice(5, 7)}.json`;

/** The same report text, whatever its spacing, case or punctuation. */
const sameText = (r) => fingerprint(String(r.text ?? r.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());

/**
 * Every kept report, with no repeats: a report whose link is already here replaces the old one
 * (the newer reading wins), and the same text for the same lake from the same source (a weekly
 * report repeating an entry nobody updated) is kept once, at its earliest date.
 */
export class PastStore {
  constructor() {
    this.byKey = new Map();
    this.keyOfUrl = new Map();
  }

  /** Adds a report; says whether it was 'added', 'replaced' an older reading, or was a 'repeat'. */
  add(r) {
    const key = `${r.state ?? 'US'}|${r.source}|${(r.lake ?? '').toLowerCase()}|${sameText(r)}`;
    const atUrl = this.keyOfUrl.get(r.url);
    if (atUrl !== undefined) {
      if (atUrl === key) return 'repeat';
      this.byKey.delete(atUrl);
      this.keyOfUrl.delete(r.url);
      this.#put(key, r);
      return 'replaced';
    }
    const had = this.byKey.get(key);
    if (had) {
      if (Date.parse(r.date) >= Date.parse(had.date)) return 'repeat';
      this.keyOfUrl.delete(had.url);
    }
    this.#put(key, r);
    return 'added';
  }

  #put(key, r) {
    const old = this.byKey.get(key);
    if (old) this.keyOfUrl.delete(old.url);
    this.byKey.set(key, r);
    this.keyOfUrl.set(r.url, key);
  }

  /** The reports grouped by file name. */
  files() {
    const out = new Map();
    for (const r of this.byKey.values()) {
      const f = fileFor(r);
      if (!out.has(f)) out.set(f, []);
      out.get(f).push(r);
    }
    return out;
  }

  /** The reports one source gave. */
  of(source) {
    return [...this.byKey.values()].filter((r) => r.source === source);
  }
}

/**
 * A report's lake that doesn't say it is water ("Final Word", "How Big") and that its source named
 * fewer than `min` times is a feature's heading, not a lake: the report stays, without the lake.
 * "Clarks Hill", named every week, stays a lake. Counts over all of `reports`; returns what to apply to a file's list.
 */
export function dropRareLakes(reports, min = 3) {
  const count = new Map();
  const key = (r) => `${r.source}|${r.lake}`;
  for (const r of reports) if (r.lake && !namesWater(r.lake)) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
  return (list) => list.map((r) => {
    if (!r.lake || namesWater(r.lake) || (count.get(key(r)) ?? 0) >= min) return r;
    const { lake, ...rest } = r;
    return rest;
  });
}

/**
 * A file's reports, newest first, cut to `maxBytes` of JSON: whole years go, oldest first, and if
 * one year alone is too big, its oldest reports. Returns the kept reports and how many were dropped.
 */
export function capReports(list, maxBytes) {
  const sorted = [...list].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.url.localeCompare(b.url));
  const sizes = sorted.map((r) => Buffer.byteLength(JSON.stringify(r)) + 1);
  let total = 2 + sizes.reduce((a, b) => a + b, 0);
  let n = sorted.length;
  while (total > maxBytes && n > 0) {
    const oldestYear = sorted[n - 1].date.slice(0, 4);
    const wholeYear = sorted[0].date.slice(0, 4) !== oldestYear;
    // Drop the oldest year; when only one is left, its oldest reports one at a time.
    do {
      n--;
      total -= sizes[n];
    } while (wholeYear && n > 0 && sorted[n - 1].date.slice(0, 4) === oldestYear);
  }
  return { reports: sorted.slice(0, n), dropped: sorted.length - n };
}

/* ------------------------------------------------------------------ where each source got to */

/**
 * Where a source's reading got to: `through`, the newest post read (the next run reads after it);
 * `from`, the oldest post read so far by the backfill; and `complete` once the backfill reached the
 * source's start. Taken from the last run's status, else from the reports it kept.
 */
export function cursorsFor(src, lastStatus, kept) {
  const st = lastStatus?.sources?.find((s) => s.name === src.name);
  const dates = kept.map((r) => Date.parse(r.date)).filter(Number.isFinite);
  const newest = dates.length ? Math.max(...dates) : null;
  const oldest = dates.length ? Math.min(...dates) : null;
  const through = Math.max(st?.through ? Date.parse(st.through) : -Infinity, newest ?? -Infinity);
  const from = st?.from ? Date.parse(st.from) : oldest;
  return {
    through: Number.isFinite(through) ? through : null,
    from: Number.isFinite(from) ? from : null,
    complete: Boolean(st?.complete),
  };
}

/**
 * @typedef {{ name: string, url: string, state: string, ok: boolean, found: number, kept: number, error?: string, note?: string,
 *   through?: string | null, from?: string | null, complete?: boolean, ms?: number, checked?: string }} SourceStatus
 */

/**
 * Reads one source: first what it posted since the last run (oldest first, so an interrupted run
 * resumes where it stopped), then, until the backfill is complete, further back (newest first, so
 * the most recent years come in first). `add(report)` keeps each report; returns the source's status.
 * @param {any} src
 * @param {{ get: (url: string, accept?: string) => Promise<string>, cutoff: number, add: (r: any) => string,
 *   known?: { through: number | null, from: number | null, complete: boolean } | null, maxPages?: number, windows?: number[][] | null, now?: number }} options
 * @returns {Promise<SourceStatus>}
 */
export async function runSource(src, { get, cutoff, known, add, maxPages = Infinity, windows, now = Date.now() }) {
  /** @type {SourceStatus} */
  const st = { name: src.name, url: src.url, state: src.state ?? 'US', ok: true, found: 0, kept: 0 };
  const t0 = Date.now();
  const start = Date.parse(src.start);
  let { through, from, complete } = known ?? { through: null, from: null, complete: false };
  const keep = (items) => {
    for (const it of items) {
      st.found++;
      if (!it.url?.startsWith('https://')) continue;
      const r = toReport(it, src);
      if (!r?.date || !r.text || Date.parse(r.date) > cutoff) continue;
      if (add(r) !== 'repeat') st.kept++;
    }
  };
  try {
    if (windows) {
      for (const [a, b] of windows) {
        await src.collect({ get, after: a, before: Math.min(b, cutoff), order: 'asc', maxPages, emit: (items) => keep(items) });
      }
    } else {
      if (through !== null && through < cutoff) {
        await src.collect({ get, after: through, before: cutoff, order: 'asc', maxPages, emit: (items, at) => { keep(items); through = Math.max(through, at); } });
      }
      // The backfill covers everything up to the cutoff from where it starts, so the next run reads after it.
      through = cutoff;
      if (from === null) from = cutoff;
      if (!complete && from > start) {
        await src.collect({ get, after: start, before: from, order: 'desc', maxPages, emit: (items, at) => { keep(items); from = Math.min(from, at); } });
        complete = true;
        from = start;
      } else complete = true;
    }
  } catch (e) {
    st.ok = !(e instanceof SkipError) && !/HTTP (401|402|403|429|451)/.test(String(e?.message));
    if (e instanceof OutOfTime) st.note = 'stopped for time; the next run carries on';
    else if (e instanceof SkipError) st.error = `skipped: ${e.message}`;
    else if (/HTTP (401|402|403|451)/.test(String(e?.message))) st.error = `skipped: the site turned us away (${e.message})`;
    else if (/HTTP 429/.test(String(e?.message))) st.error = 'stopped: the site asked us to slow down (HTTP 429)';
    else { st.ok = false; st.error = String(e?.message ?? e); }
  }
  if (!windows) Object.assign(st, { through: through === null ? null : new Date(through).toISOString(), from: from === null ? null : new Date(from).toISOString(), complete });
  st.ms = Date.now() - t0;
  st.checked = new Date(now).toISOString();
  return st;
}

/* ------------------------------------------------------------------ polite fetching */

/**
 * A fetch that keeps the job's manners for each site: one request at a time, at least
 * MIN_GAP_MS apart or the site's Crawl-delay if longer, and a stop at a redirect to another
 * site (a pay-per-crawl or sign-in wall), which answers as HTTP 402 so the source is skipped.
 */
export function politeFetch({ fetchImpl = fetch, minGapMs = MIN_GAP_MS, onRobots = () => {} } = {}) {
  const sites = new Map();
  const base = (host) => host.split('.').slice(-2).join('.');
  return (url, opts) => {
    const u = new URL(url);
    if (!sites.has(u.origin)) sites.set(u.origin, { chain: Promise.resolve(), last: 0, delay: 0 });
    const site = sites.get(u.origin);
    const run = site.chain.then(async () => {
      const wait = site.last + Math.max(minGapMs, site.delay * 1000) - Date.now();
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      try {
        const r = await fetchImpl(url, opts);
        const to = r.url ? new URL(r.url) : u;
        if (base(to.hostname) !== base(u.hostname) || /tollbit|paywall|captcha/i.test(to.hostname)) {
          return new Response(`redirected to ${to.hostname}`, { status: 402, statusText: `redirected to ${to.hostname}` });
        }
        if (u.pathname === '/robots.txt') {
          const txt = r.ok ? await r.text() : '';
          if (r.ok) site.delay = robotsCrawlDelay(txt);
          onRobots(url, txt, r.status, site.delay);
          return new Response(txt, { status: r.status });
        }
        return r;
      } finally {
        site.last = Date.now();
      }
    });
    site.chain = run.catch(() => {});
    return run;
  };
}

/* ------------------------------------------------------------------ the run */

const argOf = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

async function readPrevious(dir) {
  const files = new Map();
  let status = null;
  if (!dir) return { files, status };
  let names = [];
  try { names = await readdir(dir); } catch { return { files, status }; }
  for (const n of names) {
    try {
      if (/^[A-Z]{2}-\d\d\.json$/.test(n)) files.set(n, JSON.parse(await readFile(join(dir, n), 'utf8')));
      else if (n === 'status.json') status = JSON.parse(await readFile(join(dir, n), 'utf8'));
    } catch (e) {
      console.warn(`Could not read ${n} from ${dir}: ${e.message}`);
    }
  }
  return { files, status };
}

export async function main(args = process.argv.slice(2)) {
  const flags = ['--dump', '--only', '--previous', '--minutes', '--max-kb', '--window', '--max-pages'];
  const outDir = args.find((a, i) => !a.startsWith('--') && !flags.includes(args[i - 1])) ?? 'past-out';
  const dumpDir = argOf(args, '--dump');
  const only = argOf(args, '--only');
  const minutes = Number(argOf(args, '--minutes') ?? 35);
  const maxBytes = Number(argOf(args, '--max-kb') ?? 300) * 1024;
  const maxPages = argOf(args, '--max-pages') ? Number(argOf(args, '--max-pages')) : Infinity;
  const windows = argOf(args, '--window')?.split(',').map((w) => w.split(':').map((d, i) => Date.parse(`${d}T${i ? '23:59:59' : '00:00:00'}Z`)));
  const now = Date.now();
  const cutoff = now - RECENT_DAYS * DAY;
  const deadline = now + minutes * 60e3;

  const previous = windows ? { files: new Map(), status: null } : await readPrevious(argOf(args, '--previous'));
  const store = new PastStore();
  for (const f of previous.files.values()) for (const r of f.reports ?? []) store.add(r);

  const dumps = [];
  const perHost = new Map();
  const keepDump = (url, text) => {
    if (!dumpDir) return;
    const host = new URL(url).host;
    const n = perHost.get(host) ?? 0;
    if (url.endsWith('/robots.txt') || n < DUMPS_PER_HOST) dumps.push({ url, text: String(text).slice(0, 600_000) });
    if (!url.endsWith('/robots.txt')) perHost.set(host, n + 1);
  };
  const robots = [];
  const fetchImpl = politeFetch({ onRobots: (url, txt, status, delay) => { robots.push({ url, status, delay }); keepDump(url, txt || `(HTTP ${status})`); } });
  const get = async (url, accept = '*/*') => {
    if (Date.now() > deadline) throw new OutOfTime();
    const text = await fetchText(url, { fetchImpl, accept });
    keepDump(url, text);
    return text;
  };

  const sources = only ? PAST_SOURCES.filter((s) => s.name.toLowerCase().includes(only.toLowerCase())) : PAST_SOURCES;
  // Every source is its own site, and politeFetch keeps each site to one request at a time, so they
  // all run at once (a long backfill of one mustn't use up the time of the others).
  const statuses = await pool(sources, sources.length, (src) => runSource(src, {
    get, cutoff, windows, now, add: (r) => store.add(r),
    // --max-pages is for a quick look at a window; a full run reads everything so its cursors hold.
    maxPages: windows ? maxPages : Infinity,
    known: cursorsFor(src, previous.status, store.of(src.name)),
  }));
  // A source this run didn't read (--only) keeps its place.
  for (const s of previous.status?.sources ?? []) if (!statuses.some((x) => x.name === s.name)) statuses.push(s);

  await mkdir(outDir, { recursive: true });
  const updated = new Date(now).toISOString();
  const fileStatus = {};
  const files = [...store.files()].sort(([a], [b]) => a.localeCompare(b)).map(([name, list]) => [name, capReports(list, maxBytes - 64)]);
  // Counted over what the files keep, so a run that finds nothing new writes the same files.
  const tidyLakes = dropRareLakes(files.flatMap(([, kept]) => kept.reports));
  for (const [name, { reports: capped, dropped }] of files) {
    const reports = tidyLakes(capped);
    if (!reports.length) continue;
    const before = previous.files.get(name);
    const same = before && JSON.stringify(before.reports) === JSON.stringify(reports);
    const body = JSON.stringify({ updated: same ? before.updated : updated, reports });
    await writeFile(join(outDir, name), body);
    const years = reports.map((r) => Number(r.date.slice(0, 4)));
    fileStatus[name.replace('.json', '')] = { reports: reports.length, kb: Math.round(body.length / 102.4) / 10, years: [Math.min(...years), Math.max(...years)], ...(dropped ? { dropped } : {}) };
  }
  await writeFile(join(outDir, 'status.json'), JSON.stringify({ updated, sources: statuses, robots, files: fileStatus }, null, 1));

  if (dumpDir) {
    await mkdir(dumpDir, { recursive: true });
    for (const [i, d] of dumps.entries()) await writeFile(join(dumpDir, `${String(i).padStart(3, '0')}-${new URL(d.url).host}.txt`), `${d.url}\n\n${d.text}`);
  }

  for (const s of statuses) {
    const span = s.from && s.through ? `  ${s.from.slice(0, 10)} to ${s.through.slice(0, 10)}${s.complete ? '' : ' (backfill continues)'}` : '';
    console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${String(s.kept).padStart(5)} kept / ${String(s.found).padStart(5)} found  ${s.state}  ${s.name}${span}${s.note ? `  (${s.note})` : ''}${s.error ? `  (${s.error})` : ''}`);
  }
  for (const r of robots) console.log(`robots ${r.url}: HTTP ${r.status}${r.delay ? `, Crawl-delay ${r.delay}` : ''}`);
  const sizes = Object.entries(fileStatus);
  console.log(`${sizes.length} files, ${sizes.reduce((n, [, f]) => n + f.reports, 0)} reports:`);
  for (const [n, f] of sizes) console.log(`  ${n}  ${String(f.reports).padStart(4)} reports  ${String(f.kb).padStart(6)} KB  ${f.years[0]}-${f.years[1]}${f.dropped ? `  (${f.dropped} older dropped for size)` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
