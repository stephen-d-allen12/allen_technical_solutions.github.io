// Where the past-years reports job looks: archives of dated weekly reports and pattern stories,
// read through each site's own search (WordPress's REST API) or yearly archive pages. Each source's
// `collect({ get, after, before, order, emit, maxPages })` reads what the source posted after
// `after` up to `before` (times in ms), oldest first (order 'asc') or newest first ('desc'), and
// calls `emit(items, postedAt)` after each post, so a run can stop between posts and pick up there
// next time. `get(url, accept)` is fetchText with the job's manners (robots.txt, Crawl-delay, a
// pause between requests to one site). Items are shaped like sources.mjs's. Checked October 2026;
// see README "Angler reports".
import { findDate, fragments, htmlToText, stateFrom, STATE_CODES, tidyHeading } from './lib.mjs';

const JSON_TYPES = 'application/json';
const HTML = 'text/html';
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString();

/* ------------------------------------------------------------------ WordPress REST API */

/** Text pasted through the wrong character set ("Black CrappieÂ â€“ Slow"), put right. */
export function unmangle(s) {
  return String(s).replace(/Â(?=[\u00a0 °])/g, '').replace(/â€“/g, '–').replace(/â€”/g, '—').replace(/â€™/g, '’').replace(/â€˜/g, '‘')
    .replace(/â€œ/g, '“').replace(/â€\u009d/g, '”').replace(/â€¦/g, '…');
}

/** A post from WordPress's REST API: its title, link, date (UTC) and HTML. */
export function wpPost(p) {
  const gmt = p?.date_gmt ? Date.parse(`${p.date_gmt}Z`) : Date.parse(p?.date ?? '');
  if (!p?.link || !Number.isFinite(gmt)) return null;
  return { id: p.id, title: htmlToText(p.title?.rendered ?? ''), url: p.link, time: gmt, date: iso(gmt), html: unmangle(p.content?.rendered ?? ''), categories: p.categories ?? [] };
}

const wpTime = (t) => iso(t).slice(0, 19);

/**
 * The URL of one page of a WordPress site's posts, in date order, posted between two times. The
 * site compares in its own time zone, so the query reaches a day further each way; wpPosts then
 * keeps exactly the posts in range by their UTC date.
 * @typedef {{ after: number, before: number, search?: string, categories?: number[], order?: string, per?: number, page?: number }} WpQuery
 * @param {string} base
 * @param {WpQuery} query
 */
export function wpPostsUrl(base, { search, categories, after, before, order = 'desc', per = 20, page = 1 }) {
  const q = new URLSearchParams({ per_page: String(per), page: String(page), orderby: 'date', order });
  if (search) q.set('search', search);
  if (categories?.length) q.set('categories', categories.join(','));
  q.set('after', wpTime(after - DAY));
  q.set('before', wpTime(before + DAY));
  q.set('_fields', 'id,date,date_gmt,link,title,content,categories');
  return `${base}/wp-json/wp/v2/posts?${q}`;
}

/**
 * Posts from a WordPress site's own REST API, a page at a time, posted after `after` up to `before`.
 * @param {(url: string, accept?: string) => Promise<string>} get
 * @param {string} base
 * @param {WpQuery & { maxPages?: number }} query
 */
export async function* wpPosts(get, base, { maxPages = Infinity, ...query }) {
  const per = query.per ?? 20;
  for (let page = 1; page <= maxPages; page++) {
    let body;
    try {
      body = await get(wpPostsUrl(base, { ...query, per, page }), JSON_TYPES);
    } catch (e) {
      // Asking past the last page is a 400 ("rest_post_invalid_page_number").
      if (page > 1 && /HTTP 400/.test(String(e?.message))) return;
      throw e;
    }
    let list;
    try { list = JSON.parse(body); } catch { throw new Error(`${base} did not answer with JSON (its REST API may be off)`); }
    if (!Array.isArray(list)) throw new Error(`${base} did not answer with a list of posts`);
    for (const raw of list) {
      const p = wpPost(raw);
      if (p && p.time > query.after && p.time <= query.before) yield p;
    }
    if (list.length < per) return;
  }
}

/* ------------------------------------------------------------------ splitting a report by lake */

const WATER = /\b(lakes?|reservoirs?|rivers?|ponds?|creeks?|PFA|WMA|(?:public )?fishing areas?|tailraces?|tailwaters?|dam|bayous?|sloughs?|oxbows?|impoundments?|pools?|swamp|chain|flowage|state park)\b/i;
const NOT_WATER = /\b(georgia|arkansas|texas|iowa|regions?|statewide|saltwater|coast(al)?|stocking|introduction|trout|bass|crappie|catfish|bream|stripers?|walleye|fish|fishing|kids|youth|family|license|photos?|weeks?|weekly|top|left|right|above|below|bassin\w*|biologists?|classes|seminars?|workshops?|schedules?|reruns?|tournaments?|clubs?|programs?|hatcher(?:y|ies)|attention|anglers?|miscellaneous|profiles?|success|outfitters?|adventures?|guides?|services?|magazine|highlights|academy|if|when|please|remember|water|fly|habitat|forecast|conditions|temperatures?)\b/i;
/** A region of a state ("NORTHWEST ARKANSAS", "Southeast", "North-Central Iowa"); "West Point" is a lake. */
const REGION = /^(?:(?:north|south|east|west|northeast|northwest|southeast|southwest|central|middle|upper|lower|coastal)[\s-]*)+(?:georgia|arkansas|texas|iowa|ga|ar|tx|ia|region|area|district|zone)?$/i;
/** A heading that is a notice or a topic, not a place. */
const TOPIC = /\b(reports?|courtesy|reminders?|news|tips?|regulations?|info(?:rmation)?|updates?|calendar|best bets?|quick links|notes?|announcements?|contacts?|events?|awards?|programs?)\b|:/i;
/** A heading for waters in general ("Local Ponds"), not one lake. */
const GENERIC = /^(?:(?:small|mountain|state park|warm|warmwater|cold|coldwater|area|local|other|metro|metro area|private|farm|community|north georgia|public|multiple)\s+)*(?:lakes?|ponds?|rivers?|streams?|reservoirs?|impoundments?|waters?|pfas?|wmas?|public fishing areas?)(?:\s*(?:and|&|\/)\s*(?:lakes?|ponds?|rivers?|streams?|reservoirs?|impoundments?))?$/i;
/**
 * Words after a lake's name in a heading that say which fish or what topic, not where: "Lake Weiss
 * Mixed Bag", "Allatoona Linesides", "Lake Sugema Bluegill", "Toccoa River Walleye, Bass, and Yellow Perch".
 */
const AFTER_NAME = /^(?:and|&|mixed|bag|multi-?species|multiple|all|species|linesides?|hybrids?|trout|walleyes?|bass|crappies?|bream|bluegills?|stripers?|catfish|channel|flathead|bullheads?|perch|yellow|white|black|striped|spotted|largemouth|smallmouth|smallie|sunfish|fish|fishing|attractors?|habitat|enhancements?|levels?|debris|sampling|boat|ramps?|closures?|gon-?tel|everything|surprise|record|first|ice|report)$/i;
/** Lowercase words outside brackets, other than joining words: a sentence, not a name ("Lake Monticello angler reaps rewards of renovation"). */
const lowerWords = (h) => h.replace(/\([^()]*\)/g, ' ').split(/\s+/).filter((w) => /^[a-z]/.test(w) && !/^(?:of|the|and|at|in|on|to|de|du|la|des|below|above|near|incl\.?)$/.test(w)).length;
/** A fish's label inside a lake's report ("Bass:", "Black Crappie"), which stays with its lake. */
const FISHY = /\b(bass|largemouths?|smallmouths?|spots|crappies?|slabs|catfish|cats|bream|bluegills?|stripers?|hybrids?|walleyes?|saugers?|trout|redbreasts?|shellcrackers?|panfish|sunfish|carp|gar|perch|redfish|flounder|shad)\b/i;
/** A date as a heading ("Oct. 6, 2022"). */
const DATED = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i;
const isFishLabel = (h) => h.length <= 40 && FISHY.test(h) && !WATER.test(h) && !TOPIC.test(h);

/** Whether a heading names a body of water (a lake, river or public fishing area), not a region or a topic. */
export function isWater(heading) {
  const h = String(heading ?? '').trim();
  return h.length > 1 && h.length <= 90 && !TOPIC.test(h) && !GENERIC.test(h) && !DATED.test(h) && !REGION.test(h) && !AFTER_NAME.test(h)
    && !/[.?!]$|['’]s$/.test(h) && lowerWords(h) < 2 && (WATER.test(h) || !NOT_WATER.test(h));
}

/**
 * A lake's name from its heading: "LAKE LANIER IS 1.1 FOOT OVER FULL, 80’S" -> "Lake Lanier",
 * "MCDUFFIE PFA (More Info HERE)" -> "Mcduffie PFA", "Lake Conway Reservoir (under renovation)".
 */
export function lakeName(heading) {
  return cleanName(heading).name;
}

/** lakeName, and whether a fish or topic was cut from the end ("Matt Driver Crappie" is a guide, unless the post has a "Lake Matt Driver"). */
function cleanName(heading) {
  let h = String(heading).replace(/\s+/g, ' ').trim()
    .replace(/^\d+(?=[A-Z])/, '') // "9Arrowhead Lake"
    .replace(/\b([B-HJ-Z])\s+([a-z]{2,})/g, '$1$2') // "L ake Weiss": a word split by the page's markup
    .replace(/^[A-Z][\w.]*['’]s\s+(?=.*\b(?:lake|reservoir|river|pond|creek)\b)/i, '') // "LaFayette’s Queen City Lake"
    .replace(/^(?:(?:NORTH|SOUTH)(?:EAST|WEST)?|EAST|WEST|CENTRAL)(?:-(?:CENTRAL|EAST|WEST))?(?:\s+(?:ARKANSAS|GEORGIA|IOWA|TEXAS))?\s+(?=[A-Z][a-z])/, '') // "SOUTH-CENTRAL ARKANSAS White Oak Lake"
    .replace(/^On\s+(?=[A-Z])/, '') // "On Dierks Lake"
    .replace(/\s*[“"][^”"]*[”"]/g, '') // a guide's nickname for it
    .replace(/\s*\([^()]*\b(?:more info(?:rmation)?|courtesy|near|updated?|under renovation|click|see|remember|mixed bag|species|sampling)\b[^()]*\)/gi, '')
    // "West Point Lake (down 2.8 feet stained & low 50’s)": the water's level and color, not its name.
    .replace(/\s*\([^()]*\b(?:down|up|full|feet|ft|stained|clear|muddy|degrees|pool|(?:low|mid|high|upper|lower) \d+)\b[^()]*\)/gi, '')
    .replace(/\s*\([^)]*$/, '') // a bracket that isn't closed
    .replace(/\s+(?:is|are)\s+[\s\S]*$/i, '')
    .replace(/\s+[–—-]\s+[\s\S]*$/, '') // "Evans County PFA – Fishing during the Pre-Cold Front"
    .replace(/\s+at\s+(?:full|summer|winter|normal)\b[\s\S]*$/i, '') // "Lake Weiss at full pool, mid 80s"
    .replace(/\s+(?:down|up)\s+[\d.]+\s*(?:feet|foot|ft)\b[\s\S]*$/i, '') // "Lake Sinclair Down 1.5 Feet"
    .replace(/,\s*(?:clear|stained|muddy|full|down|up|\d)[\s\S]*$/i, '')
    .replace(/\s*(?:fishing\s+)?report(?:\s+\d+)?\s*$/i, '') // "Lake Lanier Fishing Report"; "Ken's Reservoir Reports" is a topic
    .replace(/-(?=(?:bass|crappie|stripers?|linesides?)\b)/gi, ' ') // "Lake Lanier-Bass"
    .replace(/[\s:–—|-]+$/, '');
  // Just the water's name: "Lake Weiss Mixed Bag" -> "Lake Weiss", "Allatoona Linesides" -> "Allatoona" (see resolveLake).
  const words = h.split(' ');
  let cut = false;
  while (words.length > 1 && AFTER_NAME.test(words[words.length - 1].replace(/[,.:;]+$/, ''))) { words.pop(); cut = true; }
  h = words.join(' ').replace(/[\s,:;–—|-]+$/, '');
  if (/^lake\s/i.test(h)) h = h.replace(/\s+lake$/i, ''); // "Lake Lanier Lake Level" -> "Lake Lanier"
  return { name: tidyHeading(h).replace(/\b(Pfa|Wma)\b/g, (m) => m.toUpperCase()).trim(), cut };
}

/** Whether a name says it is water ("Lake", "River", "PFA" ...), not just a name the reports use ("Clarks Hill"). */
export const namesWater = (name) => WATER.test(String(name ?? ''));

/**
 * "Hartwell" or "Clarks Hill" as the post itself calls it, "Lake Hartwell" or "Clarks Hill Lake",
 * when it does (so the app finds it under the lake's full name).
 */
export function resolveLake(name, plain) {
  if (WATER.test(name)) return name;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(plain).match(new RegExp(`\\b(?:lake\\s+${esc}|${esc}\\s+(?:lake|reservoir))\\b`, 'i'));
  if (!m) return name;
  return /^lake/i.test(m[0]) ? `Lake ${name}` : `${name} ${/reservoir$/i.test(m[0]) ? 'Reservoir' : 'Lake'}`;
}

const BLOCK = /<(h[1-6]|p|li|dt|dd|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const FILLER = /^(?:\s|&nbsp;|&#160;|<\/?(?:span|em|i|a|u|font|b|strong|big|small)\b[^>]*>)*/i;
const SEPARATOR = /^(?:<br\s*\/?>|&#821[12];|&[nm]dash;|[–—:-]|\((?:<[^>]+>)*\s*(?:updated?|(?:this |the )?(?:report )?courtesy)\b)/i;
/** "<strong>LAKE ALLATOONA</strong> is down 1.2 feet": the lake's level after its name. */
const LEVEL_AFTER = /^\s*(?:is|are)\s+(?:down|up|full|at|about|over|under|near|currently|still|now|holding|slightly|\d)/i;
/** "Lake Russell (full, clear & lower 50’s) – Bass fishing is fair": a paragraph that starts with its lake's name and a dash. */
const TEXT_LEAD = /^([A-Z][\w'’.]*(?:\s+(?:[A-Z][\w'’.]*|of|the)){0,5})\s*(\([^()]{1,150}\))?\s*[–—]\s+([\s\S]+)$/;
const textOf = (html) => htmlToText(html).replace(/[ \t]+/g, ' ').trim();

/**
 * The bold name a paragraph starts with, and the rest of the paragraph: "<b><i>Brewer Lake<br></i></b>
 * (updated ...)", "<strong>Altamaha River</strong> – Connie at ...", or a paragraph that is only bold
 * text. Null for a paragraph that merely has a bold word in its first sentence.
 */
export function leadOf(inner) {
  const m = String(inner).match(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (!m || textOf(inner.slice(0, m.index))) return null;
  const name = textOf(m[2]).replace(/\s+/g, ' ').replace(/[\s:–—-]+$/, '');
  // "LAKE HARTWELL IS FULL AND THE MID TO UPPER RIVER CHANNEL ... ARE STAINED." is a name and a level.
  if (!name || name.length > 300 || lakeName(name).length > 100) return null;
  const rest = inner.slice(m.index + m[0].length);
  const text = textOf(rest).replace(/^[–—:-]\s*/, '');
  // The name ends at a line break or a dash, inside the bold ("<b>Lake Russell (full) – </b>") or just after it.
  const ends = /<br\s*\/?>\s*(?:<\/[a-z]+>\s*)*$/i.test(m[2]) || /[–—:-]$/.test(textOf(m[2]));
  const level = WATER.test(name) && LEVEL_AFTER.test(textOf(rest));
  if (text && !ends && !level && !SEPARATOR.test(rest.replace(FILLER, ''))) return null;
  return { name, text, onlyBold: !text };
}

/**
 * Splits a many-lake report into { heading, text } parts, one per lake, for the layouts the state
 * archives have used over the years: lake names as headings, as bold paragraphs, or in bold at the
 * start of their paragraph. A fish's label ("Bass:") stays inside its lake's part, photo captions
 * are left out, and a river's areas ("White River" then "Cotter Area") are named "White River (Cotter Area)".
 */
export function lakeSections(html) {
  const out = [];
  let cur = null;
  let parent = null;
  for (const [, tag, attrs, inner] of String(html).replace(/<!--[\s\S]*?-->/g, ' ').matchAll(BLOCK)) {
    if (/wp-caption-text/.test(attrs)) continue;
    let head = null;
    let text = '';
    if (/^h/i.test(tag)) {
      text = textOf(inner).replace(/\s+/g, ' ');
      if (text.length <= 100) [head, text] = [text, ''];
    } else if (/^(p|dt)$/i.test(tag)) {
      const lead = leadOf(inner);
      const titled = (n) => /^(?:[A-Z][\w'’.]*\s?){2,4}$/.test(n) && isWater(n);
      const name = lead && lakeName(lead.name);
      const plain = textOf(inner).match(TEXT_LEAD);
      if (lead && (lead.onlyBold || WATER.test(name) || /^\(updated?\b/i.test(lead.text) || titled(name))) [head, text] = [lead.name, lead.text];
      else if (plain && (WATER.test(plain[1]) || titled(plain[1]))) [head, text] = [plain[1], `${plain[2] ? `${plain[2]} ` : ''}${plain[3]}`];
      else text = textOf(inner);
    } else text = textOf(inner);
    if (head !== null && isFishLabel(head)) [head, text] = [null, textOf(inner)];
    if (head === null && /^(p|dt)$/i.test(tag)) {
      // "Allatoona Bass (Report courtesy of ...) — ..." under a "Reservoirs" heading or after another
      // lake's part: that lake's part starts here (the line stays whole, for its fish label).
      const fish = text.match(FISH_LEAD);
      const named = fish && !fish[1].trim().split(/\s+/).some((w) => FISH_ADJ.test(w)) && lakeName(`${fish[1].trim()} Bass`);
      if (named && isWater(named) && !(cur?.heading && sameLake(lakeName(cur.heading), named))) head = named;
    }
    if (head === null || !head) {
      if (text && cur) cur.text += cur.text ? `\n${text}` : text;
      else if (text) (cur = { heading: '', text }) && out.push(cur);
      continue;
    }
    if (cur && !cur.text) {
      out.pop(); // a heading with nothing under it
      // "White River" then "Cotter Area"; not "RESERVOIR REPORT" then "Allatoona".
      if (cur.heading && WATER.test(cur.heading) && isWater(lakeName(cur.heading)) && !WATER.test(head) && isWater(head)) parent = lakeName(cur.heading);
    }
    if (WATER.test(head) || !isWater(head)) parent = null; // the next lake, or a region, ends a river's areas
    cur = { heading: parent ? `${parent} (${head})` : head, text };
    out.push(cur);
  }
  return out.filter((s) => s.text);
}

/** "Lake Allatoona" and "LAKE ALLATOONA (Report courtesy ...)", or "Allatoona Lake": the same water. */
function sameLake(a, b) {
  const core = (n) => n.toLowerCase().replace(/^lake\s+/, '').replace(/\s+(?:lake|reservoir)$/, '');
  return core(a).includes(core(b)) || core(b).includes(core(a));
}

/** A line that starts with a lake's name and one of its fish: "Allatoona Bass (courtesy of ...) —", "Lanier Crappie:". */
const FISH_LEAD = /^((?:[A-Z][\w'’.]*\s+){1,3}?)(?:[Ss]potted |[Ll]argemouth |[Ss]mallmouth |[Bb]lack |[Ww]hite |[Ss]triped )?(?:[Bb]ass|[Cc]rappie|[Ss]tripers?|[Ll]inesides?|[Hh]ybrids?|[Cc]atfish|[Bb]ream|[Ww]alleye)\s*\([^()]{0,160}\b(?:courtesy|[Rr]eport(?:ed)?|by)\b[^()]{0,160}\)/;
/** Words that make a fish's name, not a lake's: "Blue Catfish (by ...)", "Kentucky Bass (report ...)". */
const FISH_ADJ = /^(?:blue|flathead|channel|redear|redbreast|redeye|shoal|hybrid|kentucky|spotted|largemouth|smallmouth|black|white|striped|yellow|rock|warmouth|green|guadalupe|suwannee|bartram|coosa|alabama|florida|northern|trophy|big|keeper|slab|good|nice|the|more|some|few)$/i;

/**
 * "Allatoona Bass (report courtesy of Matt Driver) — Bass fishing is ..." -> "Bass — (report courtesy of
 * Matt Driver) Bass fishing is ...": a fish's label that bassCrappieOnly recognizes, so the whole
 * paragraph stays with it (or goes, for "Striper (...) — ...").
 */
export function fishFirst(line) {
  return String(line).replace(/^(?:[A-Z][\w'’.]*\s+){0,3}?((?:spotted |largemouth |smallmouth |black |white |striped )?(?:bass|crappie|stripers?|catfish|bream|walleye))\s*(\([^()]{1,120}\))\s*[—–-]\s+/i, '$1 — $2 ');
}

/** "(updated 10-8-2026)" in an Arkansas entry. */
const UPDATED = /\(\s*updated?:?\s*([\d/.-]+)\s*\)\s*/i;
/** Headings of notices, not reports, that a long section still shouldn't be kept for. */
const NOTICE = /\b(news|reminders?|regulations?|calendar|events?|quick links|announcements?|subscribe|classes|seminars?|workshops?|hatcher(?:y|ies)|attention)\b/i;

/**
 * One item per lake from a many-lake report (`trim`: only its bass and crappie parts are kept).
 * A part under a region or topic heading is kept, without a lake, only when it is a report in itself.
 */
function byLake(post, { requireWater = false } = {}) {
  const parts = lakeSections(post.html);
  if (!parts.some((s) => s.heading)) return requireWater ? [] : [{ title: post.title, url: post.url, date: post.date, text: parts.map((s) => s.text).join('\n'), trim: true }];
  const frag = fragments();
  const posted = new Date(post.time);
  const plain = htmlToText(post.html);
  return parts.flatMap((s) => {
    if (!s.heading) return [];
    const { name, cut } = cleanName(s.heading);
    let lake = isWater(name) ? resolveLake(name, plain) : undefined;
    if (lake && cut && !WATER.test(lake)) lake = undefined; // "Matt Driver Crappie": a guide's name, not a lake
    const note = s.text.slice(0, 400).match(UPDATED);
    if (!lake && (requireWater || s.text.length < 300 || NOTICE.test(s.heading))) return [];
    // An entry dated by its own "(updated ...)" note, unless the note is after the post or over a year before it (a typo).
    const when = note ? findDate(note[1], posted) : null;
    const date = when && when.getTime() <= post.time + 2 * DAY && when.getTime() > post.time - 365 * DAY ? iso(when.getTime()) : post.date;
    return [{
      title: lake ? `${lake} fishing report` : name ? `${name}: ${post.title}` : post.title, ...(lake ? { lake } : {}), url: `${post.url}#${frag(name || s.heading)}`,
      date, text: (note ? s.text.replace(UPDATED, '').trim() : s.text).split('\n').map(fishFirst).join('\n'), trim: true,
    }];
  });
}

/* ------------------------------------------------------------------ Georgia */

/** Georgia's weekly report (one a week since 2014; regional posts at first), split by lake. */
export const georgiaReport = (post) => byLake(post);

const georgia = {
  name: 'Georgia Wildlife Resources fishing report', kind: 'state', state: 'GA', url: 'https://georgiawildlife.blog', start: '2014-08-01',
  async collect({ get, after, before, order, emit, maxPages }) {
    for await (const p of wpPosts(get, this.url, { search: 'fishing report', after, before, order, per: 20, maxPages })) {
      emit(/fishing report/i.test(p.title) ? georgiaReport(p) : [], p.time);
    }
  },
};

/* ------------------------------------------------------------------ Arkansas */

/** Arkansas's weekly report: one entry per lake, dated by its "(updated 10-8-2026)" note. */
export const arkansasReport = (post) => byLake(post, { requireWater: true });

const arkansas = {
  name: 'Arkansas Game and Fish weekly fishing report', kind: 'state', state: 'AR', url: 'https://www.agfc.com', start: '2017-01-01',
  async collect({ get, after, before, order, emit, maxPages }) {
    for await (const p of wpPosts(get, this.url, { search: 'fishing report', after, before, order, per: 10, maxPages })) {
      emit(/fishing report/i.test(p.title) ? arkansasReport(p) : [], p.time);
    }
  },
};

/* ------------------------------------------------------------------ Crappie NOW */

const STOP = /^(The|This|That|These|Those|A|An|At|On|In|Of|Our|Their|His|Her|Its|Each|Every|Which|Whole|Entire|Home|Local|Same|Any|Big|Main|Upper|Lower|Crappie|Bass|Fishing|Tournament|Championship|Classic|Masters|National|Series|Trail|Open|Event|Report|Team|Anglers?|Pros?|And|For|With|From|To|When|While|After|Before|During|Spring|Summer|Fall|Winter|Conditions|Levels?|Records?|Association|Club|Maps?|Area|Is|Was|Has|January|February|March|April|May|June|July|August|September|October|November|December|Beautiful|Famous|Famed|Legendary|Renowned|Scenic|Historic|Mighty|Popular|Productive|Nearby|Massive|Huge|Giant|Fabulous|Northern|Southern|Eastern|Western|Lures?|Marina|Resort|Guides?|Service|Bait|Tackle|Dam|Slabs?|Here|There|Now|Today)$/;
const CAP = "[A-Z][\\w'’.-]*";
/** A word of a name before "Lake": "C.J." or "Truman", not "Lake." ending the sentence before. */
const PRE = "(?!(?:Lake|Reservoir)\\b)(?:(?:[A-Z]\\.){2,}|[A-Z][\\w'’-]*)";
/** "Lake Fork's" -> "Lake Fork", "Lake Eufaula." -> "Lake Eufaula", "Lake Blackshear GA" -> "Lake Blackshear", "KY Lake" -> "Kentucky Lake". */
const tidyName = (s) => s.replace(/['’]s$/, '').replace(/[.’'-]+$/, '')
  .replace(/\s+([A-Z]{2})$/, (m, st) => (Object.values(STATE_CODES).includes(st) ? '' : m)).replace(/^KY Lake$/, 'Kentucky Lake');
/** A word that ends a sentence ("Lake D’Arbonne. LA"), not an initial or "St.". */
const endsSentence = (w) => /\.$/.test(w) && !/^(?:[A-Z]\.)+$/.test(w) && !/^(?:St|Ft|Mt)\.$/.test(w);

/** Every lake or reservoir a story names, in order ("Grenada Lake", "Lake of the Ozarks", "Ross Barnett Reservoir"). */
export function findLakes(text) {
  const out = [];
  const re = new RegExp(`\\b(?:(Lake\\s+of\\s+the\\s+${CAP}|(?:Lake|Reservoir)\\s+${CAP}(?:\\s+${CAP})?)|((?:${PRE}\\s+){1,3})(Lake|Reservoir))\\b`, 'g');
  for (const m of String(text ?? '').matchAll(re)) {
    if (m[1]) {
      let words = m[1].split(/\s+/);
      // "Lake D’Arbonne. LA": the name ends with its sentence.
      const end = words.findIndex(endsSentence);
      if (end >= 0) words = words.slice(0, end + 1);
      // "Lake Washington Crappie Masters": stop at the first word that isn't part of a name.
      const cut = words.findIndex((w, i) => i > 0 && STOP.test(w.replace(/[.,]$/, '')));
      const name = tidyName((cut > 0 ? words.slice(0, cut) : words).join(' '));
      if (name.split(/\s+/).length > 1) out.push(name);
    } else {
      let words = m[2].trim().split(/\s+/);
      // "Tennessee’s Reelfoot Lake": the name starts after the state's (or anyone's) "’s".
      const owner = words.map((w) => /['’]s$/.test(w)).lastIndexOf(true);
      if (owner >= 0) words = words.slice(owner + 1);
      while (words.length && STOP.test(words[0])) words.shift();
      if (words.length && !words.some((w) => STOP.test(w))) out.push(tidyName(`${words.join(' ')} ${m[3]}`));
    }
  }
  return out;
}

/** The lake a story is about: the one in its title, else the one it names most (and at least half the time). */
export function storyLake(title, text) {
  const inTitle = findLakes(title)[0];
  if (inTitle) return inTitle;
  const counts = new Map();
  const all = findLakes(text);
  for (const l of all) counts.set(l, (counts.get(l) ?? 0) + 1);
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return top && n * 2 >= all.length ? top : undefined;
}

/** What a crappie story says about the bite: lures, depths, cover, colors, speeds. */
const PATTERN = /\b(jigs?|jigheads?|minnows?|spider[- ]?rig\w*|troll\w*|push(?:ing)?|long[- ]?lin\w*|crankbaits?|bobbers?|corks?|brush ?piles?|brush|stake ?beds?|stumps?|timber|docks?|ledges?|channels?|flats?|\d+(?:\.\d+)?\s*(?:to|-|–)\s*\d+\s*(?:feet|foot|ft)\b|\d+ (?:feet|foot|ft)\b|colou?rs?|chartreuse|plastics?|tubes?|livescope|forward[- ]facing|shoot\w* docks?|single[- ]pol\w*|vertical\w*|slip[- ]float\w*)\b/i;
/** A tournament story: who won, with how much. */
const TOURNAMENT = /\b(tournaments?|classic|championship|crappie masters|crappie usa|american crappie trail|qualifier|won|wins|winners?|weigh(?:ed|-in)?|pounds|lbs?)\b/i;

/** A state named next to the lake ("Weiss Lake, Alabama", "Grenada Lake in Mississippi"), or the one state the story names. */
export function stateNear(text, lake, title = '') {
  const names = Object.keys(STATE_CODES).sort((a, b) => b.length - a.length).join('|');
  if (lake) {
    const name = lake.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = String(text).match(new RegExp(`${name}(?:,| in| near [A-Z][\\w.' ]+,)\\s+(${names})\\b`))
      ?? `${title}\n${text}`.match(new RegExp(`\\b(${names})['’]s\\s+(?:[A-Z][\\w'’.-]*\\s+){0,3}?${name}`));
    if (m) return STATE_CODES[m[1]];
  }
  // Not the lake's own name: Lake Washington is in Mississippi.
  const without = (s) => (lake ? String(s).split(lake).join(' ') : String(s));
  return stateFrom([without(title)]) ?? stateFrom([without(String(text).slice(0, 3000))]);
}

/**
 * A Crappie NOW story about one lake, as its paragraphs about the bite. A destination story counts
 * as it is; a news story only when it is a tournament's (who won, and how). Roundups of many lakes
 * and stories with nothing about lures, depth or cover are left out.
 */
export function crappieNowStory(post, { destination = false } = {}) {
  const paras = [...post.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => htmlToText(m[1]).replace(/\s+/g, ' ').trim()).filter((p) => p.length > 30);
  const all = paras.join('\n');
  const lake = storyLake(post.title, all);
  const bite = paras.filter((p) => PATTERN.test(p));
  if (!lake || !bite.length || (!destination && !TOURNAMENT.test(`${post.title}\n${all.slice(0, 600)}`))) return [];
  const state = stateNear(all, lake, post.title);
  return [{ title: post.title, lake, url: post.url, date: post.date, text: bite.join('\n'), ...(state ? { state } : {}) }];
}

const crappieNow = {
  name: 'Crappie NOW', kind: 'news', url: 'https://crappienow.com', start: '2014-01-01',
  async collect({ get, after, before, order, emit, maxPages }) {
    // Every post (its tournament stories have no category of their own, and its older stories are
    // filed by year), with its Destinations category noted.
    const found = JSON.parse(await get(`${this.url}/wp-json/wp/v2/categories?search=destination&_fields=id,name,count`, JSON_TYPES));
    const destinations = new Set((Array.isArray(found) ? found : []).map((c) => c.id));
    for await (const p of wpPosts(get, this.url, { after, before, order, per: 20, maxPages })) {
      emit(crappieNowStory(p, { destination: p.categories.some((c) => destinations.has(c)) }), p.time);
    }
  },
};

/* ------------------------------------------------------------------ Texas */

const TPWD = 'https://tpwd.texas.gov/fishboat/fish';

/** The freshwater lakes in TPWD's fishing report search form: [{ code, name }]. */
export function tpwdLakes(html) {
  const group = String(html).match(/<optgroup\b[^>]*label="Freshwater"[^>]*>([\s\S]*?)<\/optgroup>/i)?.[1] ?? '';
  return [...group.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)]
    .map((o) => ({ code: o[1].trim(), name: texasLake(htmlToText(o[2])) }))
    .filter((l) => l.code && !/^all/i.test(l.code));
}

/** TPWD's short name as a lake's usual one: "Fork" -> "Lake Fork", "Martin Creek" -> "Martin Creek Lake"; rivers and "Canyon Lake" stay. */
export function texasLake(name) {
  if (/^lake\b|\b(?:lake|river)$/i.test(name)) return name;
  if (/\b(?:creek|pool)$/i.test(name)) return `${name} Lake`;
  return `Lake ${name}`;
}

export const tpwdYearUrl = (code, year) => `${TPWD}/action/reptform2.php?Submit=View+Report&archive=wholeyear&lake=${encodeURIComponent(code)}&water=Freshwater&yearcat=${year}`;
const TPWD_LATEST = `${TPWD}/action/reptform2.php?lake=allFresh&Submit=View+Report`;

/** One lake's reports for a year, each a date and a report ("... Report by Randy Britton, The Bait Shop."). */
export function tpwdYear(html, lake, url) {
  const out = [];
  for (const m of String(html).matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi)) {
    const text = htmlToText(m[2]);
    const d = findDate(htmlToText(m[1]), new Date(Date.UTC(2100, 0, 1)));
    if (!d || !text) continue;
    // "Report by Capt. Cory Vinson, Guaranteed Guide Service." (a period ends it unless it is in an abbreviation).
    const by = text.match(/\bReport(?:ed)? (?:provided )?by ((?:[^.]|\.(?=\S)|(?<=\b(?:Capt|Mr|Mrs|Ms|Dr|Jr|Sr|St|Ft|Lt|Sgt))\.)+)/i)?.[1]?.trim();
    out.push({ title: `${lake} fishing report`, lake, url: `${url}#${d.toISOString().slice(0, 10)}`, date: d.toISOString(), text, ...(by ? { by } : {}), trim: true });
  }
  return out;
}

const texas = {
  name: 'Texas Parks and Wildlife weekly fishing report', kind: 'state', state: 'TX', url: `${TPWD}/recreational/fishreport.phtml`,
  // A yearly page per lake (119 lakes), and a TX file holds about two years, so the backfill starts at 2023.
  start: '2023-01-01',
  async collect({ get, after, before, order, emit, maxPages }) {
    if (order === 'asc') {
      // The newest week's report says whether anything came after `after` (TPWD paused its reports in February 2026).
      const week = findDate(htmlToText(String(await get(TPWD_LATEST, HTML)).match(/class="report-week">([\s\S]*?)<\/span>/i)?.[1] ?? ''));
      if (week && week.getTime() <= after) return emit([], before);
    }
    const lakes = tpwdLakes(await get(this.url, HTML));
    if (!lakes.length) throw new Error('found no lakes in the report search form');
    const years = [];
    for (let y = new Date(after).getUTCFullYear(); y <= new Date(before).getUTCFullYear(); y++) years.push(y);
    if (order === 'desc') years.reverse();
    let pages = 0;
    for (const y of years) {
      const items = [];
      for (const lake of lakes) {
        if (pages++ >= maxPages) return emit(items, order === 'desc' ? before : after);
        const url = tpwdYearUrl(lake.code, y);
        let html;
        try { html = await get(url, HTML); } catch (e) { if (/HTTP 404/.test(String(e?.message))) continue; throw e; }
        items.push(...tpwdYear(html, lake.name, url).filter((it) => Date.parse(it.date) > after && Date.parse(it.date) <= before));
      }
      // A year is done once every lake's page is read.
      emit(items, order === 'desc' ? Math.max(after, Date.UTC(y, 0, 1)) : Math.min(before, Date.UTC(y + 1, 0, 1) - 1));
    }
  },
};

/* ------------------------------------------------------------------ Iowa */

/**
 * Iowa DNR's weekly report as reposted by KCHA News: regions, then a paragraph per lake whose fish
 * follow one another ("<strong>Black Crappie</strong> – Slow: ... <strong>Bluegill</strong> – Fair: ..."),
 * each fish put on its own line so only the bass and crappie lines are kept.
 */
export function iowaReport(post) {
  const html = post.html.replace(/(?:\s|&nbsp;|\u00a0)*(<strong>(?:(?!<\/?strong)[^<]){2,40}<\/strong>(?:\s|&nbsp;|\u00a0)*(?:&#8211;|&ndash;|–|-))/g, '<br />$1');
  return byLake({ ...post, html }, { requireWater: true }).map((it) => ({ ...it, text: it.text.replace(/\n?For (?:more )?information[\s\S]*$/i, '') }));
}

const iowa = {
  name: 'Iowa DNR weekly fishing report (KCHA News)', kind: 'state', state: 'IA', url: 'https://kchanews.com', start: '2017-01-01',
  async collect({ get, after, before, order, emit, maxPages }) {
    for await (const p of wpPosts(get, this.url, { search: 'fishing report', after, before, order, per: 20, maxPages })) {
      emit(/fishing report/i.test(p.title) && /iowa|dnr/i.test(`${p.title} ${p.html.slice(0, 2000)}`) ? iowaReport(p) : [], p.time);
    }
  },
};

/** In priority order. Each is read only where its robots.txt allows; see README "Angler reports". */
export const PAST_SOURCES = [georgia, arkansas, crappieNow, texas, iowa];
