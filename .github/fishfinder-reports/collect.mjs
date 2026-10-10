// The angler reports job: gathers recent state, guide and forum fishing reports into small JSON
// files the app reads (one per state, plus US.json for national sources), and a status.json that
// says which sources answered. Run: node scripts/reports/collect.mjs <out-dir> [--dump <dir>]
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SOURCES } from './sources.mjs';
import { aboutOtherFish, bassCrappieOnly, clip, fetchText, fingerprint, namesBassOrCrappie, pool, SkipError } from './lib.mjs';

const args = process.argv.slice(2);
const outDir = args.find((a, i) => !a.startsWith('--') && !['--dump', '--only', '--previous'].includes(args[i - 1])) ?? 'reports-out';
const dumpDir = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const prevDir = args.includes('--previous') ? args[args.indexOf('--previous') + 1] : null;
/** Reports older than this are dropped; the app shows the last two months. */
const MAX_DAYS = 75;
const now = Date.now();

/** Undated pages (a monthly trends page, a reservoir table) are dated by when the job first saw their text. */
const firstSeen = new Map();
/** Last run's reports by link, so a guide's full report page isn't fetched again until it changes. */
const before = new Map();
if (prevDir) {
  try {
    for (const f of (await readdir(prevDir)).filter((n) => /^[A-Z]{2}\.json$/.test(n))) {
      for (const r of JSON.parse(await readFile(join(prevDir, f), 'utf8')).reports ?? []) {
        firstSeen.set(`${r.url}|${fingerprint(r.text ?? '')}`, r.date);
        before.set(r.url, r);
      }
    }
  } catch { /* first run */ }
}

const dumps = [];
/** fetchText that also keeps a copy of what came back, for writing new parsers. */
async function fetchAndKeep(url, opts) {
  const text = await fetchText(url, opts);
  if (dumpDir) dumps.push({ url, text: text.slice(0, 400_000) });
  return text;
}

/**
 * One report as the app reads it, or null when it isn't about bass or crappie: Stephen's rule is
 * that the panel only shows bass and crappie catches and tips. A report covering many fish keeps
 * only its bass and crappie parts.
 */
function normalize(item, src) {
  const kept = item.trim ? bassCrappieOnly(item.text ?? '') : item.text ?? '';
  if (!namesBassOrCrappie(`${item.title ?? ''}\n${kept}`) || /^no reports?\b/i.test(kept)) return null;
  if (!item.trim && aboutOtherFish(item.title)) return null;
  const r = {
    kind: item.kind ?? src.kind,
    source: item.source ?? src.name,
    title: clip(item.title ?? '', 200),
    url: item.url,
  };
  const text = clip(kept, 700);
  const d = item.date ? new Date(item.date) : null;
  r.date = d && !Number.isNaN(d.getTime()) ? d.toISOString() : firstSeen.get(`${r.url}|${fingerprint(text)}`) ?? new Date(now).toISOString();
  if (text) r.text = text;
  if (item.by) r.by = clip(item.by, 80);
  if (item.lake ?? src.lake) r.lake = item.lake ?? src.lake;
  if (item.state ?? src.state) r.state = item.state ?? src.state;
  return r;
}

const recent = (date) => {
  const t = Date.parse(date);
  return Number.isFinite(t) && t > now - MAX_DAYS * 864e5 && t < now + 2 * 864e5;
};

const sources = only ? SOURCES.filter((s) => s.name.toLowerCase().includes(only.toLowerCase())) : SOURCES;
const results = await pool(sources.filter((s) => !s.probe || dumpDir), 6, async (src) => {
  const t0 = Date.now();
  try {
    const items = await src.collect({ fetchText: fetchAndKeep, previous: (url) => before.get(url) });
    // A source marked `probe: true` is being tried out: fetched and saved for a look, but nothing from it reaches the app.
    if (src.probe) return { src, ok: true, found: items.length, items: [], ms: Date.now() - t0 };
    const fresh = items.filter((it) => it.url?.startsWith('https://')).map((it) => normalize(it, src)).filter((it) => it && recent(it.date));
    return { src, ok: true, found: items.length, items: fresh, ms: Date.now() - t0 };
  } catch (e) {
    return { src, ok: false, found: 0, items: [], error: e instanceof SkipError ? `skipped: ${e.message}` : String(e?.message ?? e), ms: Date.now() - t0 };
  }
});

const byState = new Map();
for (const r of results) {
  for (const it of r.items) {
    const key = it.state ?? 'US';
    if (!byState.has(key)) byState.set(key, []);
    byState.get(key).push(it);
  }
}

await mkdir(outDir, { recursive: true });
const updated = new Date(now).toISOString();
for (const [state, list] of byState) {
  list.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  await writeFile(join(outDir, `${state}.json`), JSON.stringify({ updated, reports: list.slice(0, 600) }));
}
// A state with no reports this time still gets a file, so the app finds an empty list instead of a 404.
for (const s of ['US', ...new Set(sources.map((x) => x.state).filter(Boolean))]) {
  if (!byState.has(s)) await writeFile(join(outDir, `${s}.json`), JSON.stringify({ updated, reports: [] }));
}
const status = results.map((r) => ({ name: r.src.name, url: r.src.url, state: r.src.state ?? 'US', ok: r.ok, found: r.found, kept: r.items.length, ms: r.ms, ...(r.error ? { error: r.error } : {}) }));
await writeFile(join(outDir, 'status.json'), JSON.stringify({ updated, sources: status }, null, 1));

if (dumpDir) {
  await mkdir(dumpDir, { recursive: true });
  for (const [i, d] of dumps.entries()) await writeFile(join(dumpDir, `${String(i).padStart(3, '0')}-${new URL(d.url).host}.txt`), `${d.url}\n\n${d.text}`);
}

for (const s of status) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${String(s.kept).padStart(4)} kept / ${String(s.found).padStart(4)} found  ${s.state}  ${s.name}${s.error ? `  (${s.error})` : ''}`);
const okCount = status.filter((s) => s.ok).length;
console.log(`${okCount} of ${status.length} sources answered; ${results.reduce((n, r) => n + r.items.length, 0)} reports kept.`);
