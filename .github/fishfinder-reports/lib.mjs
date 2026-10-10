// Helpers for the angler reports job: polite fetching, robots.txt, RSS/Atom and HTML to plain text.
// Plain Node 22 JavaScript with no packages, so the job runs anywhere with `node`.

export const USER_AGENT = 'AllenFishFinderReports/1.0 (+https://stephen-d-allen12.github.io/allen_technical_solutions.github.io/fishfinder/)';

const robotsCache = new Map();

/** The Disallow and Allow rules that apply to us (our own name, or *) in a robots.txt file. */
export function robotsRules(txt, agent = 'allenfishfinderreports') {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, k, v] = m;
    const key = k.toLowerCase();
    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'disallow' || key === 'allow')) cur.rules.push({ allow: key === 'allow', path: v });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules).filter((r) => r.path !== '' || !r.allow);
}

/** Whether robots.txt lets us fetch this path: the longest matching rule wins, Allow on a tie. */
export function robotsAllows(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue; // "Disallow:" with nothing means allow everything
    const re = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
    if (re.test(pathAndQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

async function robotsFor(origin, fetchImpl) {
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, (async () => {
      try {
        const r = await fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
        return r.ok ? robotsRules(await r.text()) : [];
      } catch {
        return [];
      }
    })());
  }
  return robotsCache.get(origin);
}

export class SkipError extends Error {}

/** GET a page or feed as text: robots.txt respected, one retry, a 25 s limit, and our name in the User-Agent. */
export async function fetchText(url, { fetchImpl = fetch, accept = '*/*' } = {}) {
  const u = new URL(url);
  const rules = await robotsFor(u.origin, fetchImpl);
  if (!robotsAllows(rules, u.pathname + u.search)) throw new SkipError(`robots.txt asks robots not to fetch ${u.pathname}`);
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      last = e;
      if (/HTTP (4\d\d)/.test(String(e))) break; // a 403 or 404 won't change on a retry
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
  throw last;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', bull: '•', middot: '·', eacute: 'é', copy: '©', reg: '®', trade: '™' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML to readable plain text: scripts and styles dropped, blocks become line breaks, spaces collapsed. */
export function htmlToText(html) {
  return decodeEntities(String(html)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ +([,.;:!?])(?=\s|$)/g, '$1') // "bass , crappie" from bold words in a sentence
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1') : '';
};
const attr = (xml, name, a) => xml.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i'))?.[1] ?? '';

/** Items from an RSS 2.0, RSS 1.0 or Atom feed: title, link, date, author and the text of the post. */
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    const title = htmlToText(tag(b, 'title'));
    let link = decodeEntities(tag(b, 'link').trim());
    if (!link || link.startsWith('<')) link = decodeEntities(attr(b, 'link', 'href'));
    const when = tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'a10:updated');
    const body = tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'content') || tag(b, 'summary');
    const author = htmlToText(tag(b, 'dc:creator') || tag(tag(b, 'author'), 'name') || tag(b, 'author'));
    const date = new Date(when.trim());
    if (!link || Number.isNaN(date.getTime())) continue;
    const categories = (b.match(/<category\b[^>]*>([\s\S]*?)<\/category>/gi) ?? []).map((c) => htmlToText(c.replace(/<\/?category\b[^>]*>/gi, '')));
    items.push({ title, url: link, date: date.toISOString(), html: decodeEntities(body), text: htmlToText(decodeEntities(body)), by: author || undefined, categories });
  }
  return items;
}

/** A short excerpt cut at a word boundary, for the reports files (the app links to the full post). */
export function clip(text, max = 600) {
  // Line breaks stay: each line of a trimmed report is one fish's part, which the app picks from.
  const t = String(text ?? '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n[\s]*/g, '\n').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'), max - 60)).replace(/[\s,;:.-]+$/, '')}…`;
}

/** Run tasks with at most `n` at a time. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/**
 * The first date written in a piece of text: "Oct 6", "October 6, 2026", "10-1-2026", "9/30/26",
 * "(updated 10-1-2026)". A date with no year is taken as the most recent one not in the future.
 */
export function findDate(text, now = new Date()) {
  const s = String(text);
  const make = (y, m, d) => {
    const year = y === undefined ? now.getUTCFullYear() : y < 100 ? 2000 + y : y;
    let t = Date.UTC(year, m, d, 12);
    if (y === undefined && t > now.getTime() + 2 * 864e5) t = Date.UTC(year - 1, m, d, 12);
    return m >= 0 && m < 12 && d >= 1 && d <= 31 ? new Date(t) : null;
  };
  const named = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
  const numeric = s.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  const at = (m) => (m ? m.index : Infinity);
  if (named && at(named) <= at(numeric)) return make(named[3] ? Number(named[3]) : undefined, MONTHS[named[1].toLowerCase()], Number(named[2]));
  if (numeric) {
    const [m, d] = [Number(numeric[1]) - 1, Number(numeric[2])];
    if (m <= 11 && d <= 31) return make(numeric[3] ? Number(numeric[3]) : undefined, m, d);
  }
  return null;
}

/**
 * Splits a page or post into titled sections at its headings (h2 to h5 by default, and a paragraph
 * that is just bold text), so a weekly report covering twenty lakes becomes twenty entries the app
 * can match. `levels` picks the headings ('h3' for a page whose lakes are all h3), `bold: false`
 * ignores bold paragraphs, and `marks` adds a site's own heading pattern.
 * @param {string} html
 * @param {{ levels?: string, bold?: boolean, marks?: RegExp }} [options]
 */
export function sections(html, { levels = 'h[2-5]', bold = true, marks } = {}) {
  let marked = String(html).replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(new RegExp(`<(${levels})\\b[^>]*>([\\s\\S]*?)</\\1>`, 'gi'), (_, __, inner) => `\u0001${htmlToText(inner)}\u0002`);
  // A site's own heading markup (its first group is the heading).
  if (marks) marked = marked.replace(marks, (_, inner) => `\u0001${htmlToText(inner)}\u0002`);
  // A paragraph that is only bold text (not one that starts bold and goes on).
  if (bold) marked = marked.replace(/<p\b[^>]*>\s*<(strong|b)\b[^>]*>((?:(?!<\/\1>|<\/p>)[\s\S])*)<\/\1>\s*(?::|&nbsp;)?\s*<\/p>/gi, (_, __, inner) => `\u0001${htmlToText(inner)}\u0002`);
  const out = [];
  const parts = marked.split('\u0001');
  for (const p of parts.slice(1)) {
    const [heading, rest = ''] = p.split('\u0002');
    const text = htmlToText(rest);
    // A heading with no words (a photo, a stray bold space) doesn't start a new section.
    if (!heading.trim() && out.length) out[out.length - 1].text += `\n${text}`;
    else if (heading.trim() && text.length > 40) out.push({ heading: heading.replace(/\s+/g, ' ').trim(), text });
  }
  return out;
}

/** "ALTAMAHA RIVER" -> "Altamaha River"; a heading in mixed case stays as written. */
export function tidyHeading(h) {
  const t = String(h).replace(/\s+/g, ' ').trim();
  return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : t;
}

/** The part of a page between two markers (the report itself, without the site's menus and footer). */
export function between(html, start, end) {
  const s = String(html);
  const i = start ? s.search(start) : 0;
  if (i < 0) return '';
  const rest = s.slice(i);
  const j = end ? rest.slice(1).search(end) : -1;
  return j < 0 ? rest : rest.slice(0, j + 1);
}

/** A short id for a heading, used as the link fragment so an entry keeps its link when entries move. */
export function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';
}

/* ------------------------------------------------- only bass and crappie (Stephen's rule) */

/** Fish called bass that aren't black bass, which the app doesn't cover (and Bass Pro Shops and bass boats, which aren't fish). */
const NOT_BLACK_BASS = /\b(white|striped|sand|hybrid|yellow|rock|sea|peacock|striper)[ -]?bass\b|\bwhitebass\b|\bbass (pro|boats?|cat|tracker)\b/gi;
const BASS_OR_CRAPPIE = /\b(bass|largemouths?|smallmouths?|bucketmouths?|crappies?|slabs?|papermouths?|sac.a.lait)\b/i;
/** Any fish a report might be labeled with, to tell a "Catfish:" paragraph from a "Bass:" one. */
const ANY_FISH = /\b(bass|largemouths?|smallmouths?|crappies?|catfish|cats|walleyes?|saugers?|saugeyes?|trout|rainbows?|browns|stripers?|hybrids?|wipers?|bluegills?|bream|sunfish|panfish|perch|pike|muskies|muskie|musky|muskellunge|carp|gar|drum|redears?|shellcrackers?|whitebass|salmon|steelhead|kings|coho|bullheads?|paddlefish|redfish|flounder|specks|shad)\b/i;

/** Whether the text is about black bass or crappie ("white bass" and "striped bass" don't count). */
export function namesBassOrCrappie(text) {
  return BASS_OR_CRAPPIE.test(String(text ?? '').replace(NOT_BLACK_BASS, ' '));
}

/** A headline about some other fish ("Morgan City angler sets his sights on redfish"). */
export function aboutOtherFish(title) {
  return ANY_FISH.test(String(title ?? '')) && !namesBassOrCrappie(title);
}

// "Bass- Fishing is decent." "Black Bass: Guide Lane Clark reports..." "Reservoir Conditions- ..."
const LABEL_MARK = /^([A-Za-z'’/&,. ]{2,48}?)\s*(?:[-–—:]\s)/;
// "Largemouth Bass Good on jigs..." "Black Crappie, White Crappie Fair on minnows..."
const LABEL_RATING = /^([A-Za-z'’/&, ]{2,60}?)\s+(?:-\s+)?(?=(?:excellent|good|fair|slow|poor|decent|tough)\b)/i;

/**
 * Keeps only what a multi-fish report says about bass and crappie. A paragraph labeled with a fish
 * ("Crappie- Fishing is slow.", "Catfish: ...") and the unlabeled paragraphs after it stay or go
 * with that label (joined into one line per fish); anywhere else, only the sentences that name
 * bass or crappie stay.
 */
export function bassCrappieOnly(text) {
  const out = [];
  let keep = null; // null: no fish label in force, so go sentence by sentence
  for (const para of String(text ?? '').split('\n').map((p) => p.trim()).filter(Boolean)) {
    const m = para.match(LABEL_MARK) ?? (para.match(LABEL_RATING)?.[1].match(ANY_FISH) ? para.match(LABEL_RATING) : null);
    if (m) {
      keep = ANY_FISH.test(m[1]) ? namesBassOrCrappie(m[1]) : null;
      if (keep) { out.push(para); continue; }
      if (keep === false) continue;
    } else if (keep === true) {
      out[out.length - 1] += ` ${para}`; // one line per fish, so the app can show the one the angler picked
      continue;
    } else if (keep === false) {
      continue;
    }
    // Sentences end at . ! or ? and a space before a capital or a number ("a 0.75 and a 2.5-pounder" stays whole).
    const said = para.split(/(?<=[.!?]["”’)]*)\s+(?=["“‘(]?[A-Z0-9])/).map((s) => s.trim()).filter((s) => namesBassOrCrappie(s));
    if (said.length) out.push(said.join(' '));
  }
  return out.join('\n');
}

/** A short fingerprint of a text, to notice when an undated page changes. */
export function fingerprint(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return (h >>> 0).toString(36);
}

export const STATE_CODES = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

/** The one state a list of labels names ("Ohio Fishing Reports" -> OH), or undefined if none or several. */
export function stateFrom(labels) {
  const found = new Set();
  // Longest names first, removed once found, so "West Virginia" doesn't also count as Virginia.
  const names = Object.keys(STATE_CODES).sort((a, b) => b.length - a.length);
  for (let l of labels) {
    for (const name of names) {
      const re = new RegExp(`\\b${name}\\b`, 'gi');
      if (re.test(l)) { found.add(STATE_CODES[name]); l = l.replace(re, ' '); }
    }
  }
  return found.size === 1 ? [...found][0] : undefined;
}
