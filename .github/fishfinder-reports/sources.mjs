// Where the angler reports job looks. Each source returns plain items:
// { title, url, date (ISO, or omitted for an undated page: the job then uses the date it first saw
// that text), text, by?, lake?, state?, kind?, trim? }. `trim` marks a report that covers many fish:
// the job keeps only what it says about bass and crappie. Checked October 2026; see README
// "Angler reports".
import { between, findDate, htmlToText, namesBassOrCrappie, parseFeed, sections, slug, stateFrom, tidyHeading } from './lib.mjs';

const FEED = 'application/rss+xml, application/atom+xml, application/xml, text/xml';
const HTML = 'text/html';
const iso = (d) => d?.toISOString();
const abs = (href, base) => new URL(decodeEntitiesInHref(href), base).href;
const decodeEntitiesInHref = (h) => h.replace(/&amp;/g, '&');

/** Link fragments named after each entry's heading, so an entry keeps its link when the page reorders. */
function fragments() {
  const used = new Map();
  return (s) => {
    const id = slug(s);
    const n = (used.get(id) ?? 0) + 1;
    used.set(id, n);
    return n === 1 ? id : `${id}-${n}`;
  };
}

/** A feed whose posts are each about one lake or one topic (or, with `split`, a roundup to split by heading). */
function feed({ name, kind, state, url, keep = () => true, split = false }) {
  return {
    name, kind, state, url,
    async collect({ fetchText }) {
      const items = parseFeed(await fetchText(url, { accept: FEED })).filter(keep);
      return items.flatMap((it) => {
        const st = state ?? stateFrom(it.categories ?? []);
        if (!split) return [{ ...it, state: st }];
        const parts = sections(it.html ?? '');
        if (!parts.length) return [{ ...it, state: st, trim: true }];
        const frag = fragments();
        return parts.map((p) => ({
          title: `${p.heading}: ${it.title}`, lake: p.heading, url: `${it.url}#${frag(p.heading)}`,
          date: iso(findDate(p.text.slice(0, 80))) ?? it.date, text: p.text, state: st, by: it.by, trim: true,
        }));
      });
    },
  };
}

/**
 * A web page of per-lake entries under headings. `part` is a [start, end] pair of patterns that
 * fence off the report from the site's menus; `levels` picks the heading tags; `lake` cleans a
 * heading into a lake name; the date comes from the heading, the entry's first lines, `pageDate`,
 * or when the job first saw the text.
 */
function page({ name, kind, state, url, part, levels, bold = true, entryDate = true, pageDate, lake = (h) => h, by, keep = () => true }) {
  return {
    name, kind, state, url,
    async collect({ fetchText }) {
      const raw = await fetchText(url, { accept: HTML });
      const html = part ? between(raw, part[0], part[1]) : raw;
      const whole = pageDate ? pageDate(html) : null;
      const frag = fragments();
      return sections(html, { levels, bold }).filter(keep).map((p) => {
        const lk = lake(p.heading);
        const d = (entryDate ? findDate(p.heading) ?? findDate(p.text.slice(0, 120)) : null) ?? whole;
        return {
          title: `${lk} fishing report`, lake: lk, url: `${url}#${frag(lk)}`, text: p.text, state, trim: true,
          ...(d ? { date: d.toISOString() } : {}),
          ...(by ? { by: by(p) } : {}),
        };
      });
    },
  };
}

/** Oklahoma's weekly report: a box per lake with its date, each fish's rating, and the game warden's name. */
const odwc = {
  name: 'Oklahoma Department of Wildlife Conservation', kind: 'state', state: 'OK', url: 'https://www.wildlifedepartment.com/fishing/fishingreport',
  async collect({ fetchText }) {
    const html = await fetchText(this.url, { accept: HTML });
    return html.split(/<div class="bg-blue[^"]*">/).slice(1).flatMap((box) => {
      const h = box.match(/<h4>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h4>/i);
      if (!h) return [];
      const lake = htmlToText(h[2]).replace(/\s+Report$/i, '');
      const body = box.slice(h.index + h[0].length).split(/<\/div>/i)[0];
      const by = htmlToText(body.match(/<p[^>]*>\s*Report submitted by([\s\S]*?)<\/p>/i)?.[1] ?? '').replace(/\s+/g, ' ');
      const text = htmlToText(body.replace(/<p[^>]*>\s*Report submitted by[\s\S]*?<\/p>/i, ''));
      return [{ title: `${lake} fishing report`, lake, url: `${this.url}#${slug(lake)}`, date: iso(findDate(text.slice(0, 40))), text, by: by || undefined, trim: true }];
    });
  },
};

/** Arkansas Game and Fish posts a weekly report as a news post, with a part per lake. */
const agfc = {
  name: 'Arkansas Game and Fish weekly fishing report', kind: 'state', state: 'AR', url: 'https://www.agfc.com/feed/',
  async collect({ fetchText }) {
    const posts = parseFeed(await fetchText(this.url, { accept: FEED })).filter((p) => /weekly fishing report/i.test(p.title)).slice(0, 2);
    const out = [];
    for (const p of posts) {
      const html = p.html && p.html.length > 3000 ? p.html : await fetchText(p.url, { accept: HTML });
      const frag = fragments();
      // Each lake's name is bold italic at the end of a paragraph; its report starts "(updated 10-8-2026)".
      for (const s of sections(html, { bold: false, marks: /<b>\s*<i>((?:(?!<\/i>)[\s\S]){2,160})<\/i>\s*<\/b>\s*<\/p>/gi }).filter((x) => /^\(updated?\b/i.test(x.text))) {
        const d = s.text.match(/^\(updated? ([\d/-]+)\)/i);
        out.push({ title: `${s.heading} fishing report`, lake: s.heading, url: `${p.url}#${frag(s.heading)}`, text: s.text.replace(/^\(updated? [\d/-]+\)\s*/i, ''),
          date: iso(d ? findDate(d[1]) : null) ?? p.date, trim: true });
      }
    }
    return out;
  },
};

/** Georgia's weekly report is a blog post whose feed has only a teaser, so read the post itself and split it by lake. */
const gaBlog = {
  name: 'Georgia Wildlife Resources fishing report', kind: 'state', state: 'GA', url: 'https://georgiawildlife.blog/category/fishing/feed/',
  async collect({ fetchText }) {
    const posts = parseFeed(await fetchText(this.url, { accept: FEED }));
    const isReport = (p) => /georgia fishing report/i.test(p.title);
    const out = posts.filter((p) => !isReport(p));
    for (const p of posts.filter(isReport).slice(0, 2)) {
      const html = await fetchText(p.url, { accept: HTML });
      // Regions are h1 ("SOUTHEAST GEORGIA"), lakes and rivers h4 ("ALTAMAHA RIVER") or a bold paragraph.
      const body = between(html, /<div class="(?:post|entry)-content/i, /class="[^"]*(?:sharedaddy|sd-title|jp-relatedposts|post-navigation)|id="comments"|<footer/i);
      const parts = sections(body, { levels: 'h[1-5]' });
      if (!parts.length) { out.push({ ...p, text: htmlToText(body) || p.text, trim: true }); continue; }
      const frag = fragments();
      for (const s of parts) {
        const lake = tidyHeading(s.heading);
        out.push({ title: `${lake} fishing report`, lake, url: `${p.url}#${frag(lake)}`, date: p.date, text: s.text, trim: true });
      }
    }
    return out;
  },
};

/** Iowa's report lists each lake with a line per fish ("Largemouth Bass - Fair", a tip, "Last updated on 10/01/2026"). */
const iowa = {
  name: 'Iowa DNR fishing report', kind: 'state', state: 'IA', url: 'https://programs.iowadnr.gov/lakemanagement/FishingReport/',
  async collect({ fetchText }) {
    const html = await fetchText(this.url, { accept: HTML });
    return html.split(/<h4>\s*(?=<a\b)/i).slice(1).flatMap((b) => {
      const a = b.match(/^<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) return [];
      const lake = htmlToText(a[2]);
      const fish = [...b.split(/<h3\b/i)[0].matchAll(/<h6>([\s\S]*?)<\/h6>\s*(?:<span>([\s\S]*?)<\/span>)?/gi)]
        .map((m) => ({ head: htmlToText(m[1]).replace(/\s+/g, ' '), note: htmlToText(m[2] ?? '').replace(/\s+/g, ' ') }))
        .filter((f) => namesBassOrCrappie(f.head));
      if (!fish.length) return [];
      const dates = fish.map((f) => findDate(f.note.match(/Last updated on ([\d/]+)/i)?.[1] ?? '')).filter(Boolean);
      const text = fish.map((f) => `${f.head}: ${f.note.replace(/^Comment:\s*/i, '').replace(/\s*Last updated on [\d/]+\.?\s*$/i, '')}`).join('\n');
      return [{ title: `${lake} fishing report`, lake, url: abs(a[1], this.url), text, ...(dates.length ? { date: iso(new Date(Math.max(...dates.map(Number)))) } : {}) }];
    });
  },
};

/** Indiana's report is a table: waterbody, report, date. */
const indiana = {
  name: 'Indiana DNR fishing reports', kind: 'state', state: 'IN', url: 'https://www.in.gov/dnr/fish-and-wildlife/fishing/indiana-fishing-reports/',
  async collect({ fetchText }) {
    const html = await fetchText(this.url, { accept: HTML });
    const frag = fragments();
    return [...html.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi)].flatMap((r) => {
      const lake = htmlToText(r[1]);
      const d = findDate(htmlToText(r[3]));
      return lake ? [{ title: `${lake} fishing report`, lake, url: `${this.url}#${frag(lake)}`, text: htmlToText(r[2]), date: iso(d), trim: true }] : [];
    });
  },
};

/** Kentucky Lake guides each post a weekly report on their own page; the list page has only a teaser. */
const kyLake = {
  name: 'Kentucky Lake fishing reports', kind: 'guide', state: 'KY', url: 'https://www.explorekentuckylake.com/fishing/reports',
  async collect({ fetchText, previous }) {
    const html = between(await fetchText(this.url, { accept: HTML }), /<h2>Fishing Report Summaries/i, /<h3>About Our Fishing Reports/i);
    const out = [];
    for (const card of html.split(/<hr\s*\/?>/i)) {
      const h = card.match(/<h3[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!h) continue;
      const ps = [...card.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => htmlToText(m[1]));
      const url = abs(h[1], this.url);
      const title = htmlToText(h[2]);
      const date = iso(findDate(ps.find((p) => /^For /i.test(p)) ?? ''));
      let text = (ps.at(-1) ?? '').replace(/\s*Read More\.*$/i, '');
      const before = previous(url);
      if (before && before.date === date && before.title === title) text = before.text ?? text;
      else {
        try {
          const full = await fetchText(url, { accept: HTML });
          const at = full.indexOf(h[2].trim().slice(0, 30));
          const body = htmlToText(between(at > 0 ? full.slice(at) : full, null, /About Our Fishing Reports|<footer|class="sidebar/i));
          if (body.length > text.length && body.length < 20000) text = body;
        } catch { /* the teaser will do */ }
      }
      out.push({ title, lake: 'Kentucky Lake', url, date, text, by: ps[0], trim: true });
    }
    return out;
  },
};

/** SportfishingReport.com's freshwater cards (mostly California and the West); the card has a teaser, the report page the rest and the state. */
const sfr = {
  name: 'SportfishingReport.com freshwater', kind: 'guide', url: 'https://www.sportfishingreport.com/fish_reports/freshwater.php',
  async collect({ fetchText, previous }) {
    const html = await fetchText(this.url, { accept: HTML });
    const cards = html.split(/<div class="report-card-container/i).slice(1).flatMap((c) => {
      const a = c.match(/<a href="([^"]+)"><strong>([\s\S]*?)<\/strong><\/a>/i);
      const bottom = c.match(/<div class="report-card-bottom">([\s\S]*?)<\/div>/i)?.[1] ?? '';
      if (!a) return [];
      const [by, lake, when] = htmlToText(bottom).split('\n').map((s) => s.trim());
      return [{ title: htmlToText(a[2]), url: abs(a[1], this.url), teaser: htmlToText(c.match(/<div class="report-card-text">([\s\S]*?)<a /i)?.[1] ?? ''), by, lake, date: iso(findDate(when ?? '')) }];
    });
    const otherFish = /\b(trout|rainbows?|browns|salmon|kokanee|stocking|stocked|stripers?|catfish|cats|carp|sturgeon|yellowtail|tuna)\b/i;
    let fetched = 0;
    const out = [];
    for (const c of cards) {
      const head = `${c.title} ${c.teaser}`;
      if (otherFish.test(head) && !namesBassOrCrappie(head)) continue;
      let { teaser: text, lake } = c;
      let state;
      const before = previous(c.url);
      if (before) ({ text = text, state } = before);
      else if (fetched < 15) {
        fetched++;
        try {
          // The report page: "<a>Cachuma Lake</a> - Santa Barbara, CA", then the report itself.
          const full = await fetchText(c.url, { accept: HTML });
          const where = full.match(/<h4[^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*-\s*[^,<]+,\s*([A-Z]{2})\b/);
          if (where) [lake, state] = [htmlToText(where[1]), where[2]];
          const body = htmlToText(full.match(/class="[^"]*report_descript_data[^"]*">([\s\S]*?)<\/div>/i)?.[1] ?? '');
          if (body.length > text.length) text = body;
        } catch { /* the teaser will do */ }
      }
      out.push({ title: c.title, url: c.url, date: c.date, text, by: c.by, lake, state, trim: true });
    }
    return out;
  },
};

/**
 * Texas Parks and Wildlife's weekly freshwater report: every lake on one page, each a link and a
 * paragraph ("GOOD. Water stained; 63 degrees. Bass fair ... Report by ..."). On hold since
 * February 2026 while TPWD reworks it, so older than the job keeps until it starts again.
 */
const tpwd = {
  name: 'Texas Parks and Wildlife weekly fishing report', kind: 'state', state: 'TX', url: 'https://tpwd.texas.gov/fishboat/fish/action/reptform2.php?lake=allFresh&Submit=View+Report',
  async collect({ fetchText }) {
    const html = await fetchText(this.url, { accept: HTML });
    const week = findDate(htmlToText(html.match(/class="report-week">([\s\S]*?)<\/span>/i)?.[1] ?? ''));
    return [...html.matchAll(/<dt>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi)].map((m) => {
      const text = htmlToText(m[3]);
      return { title: `${htmlToText(m[2])} fishing report`, lake: htmlToText(m[2]), url: abs(m[1], this.url), text, date: iso(week),
        by: text.match(/Report by ([^.]+(?:\.[^.]+)?)\.?$/i)?.[1], trim: true };
    });
  },
};

const FRESHWATER = /\b(bass|largemouth|smallmouth|crappie|slabs?|lake|reservoir)\b/i;

export const SOURCES = [
  // State wildlife agencies (many include guide and bait shop reports).
  odwc,
  agfc,
  gaBlog,
  page({
    name: 'Tennessee Wildlife Resources Agency', kind: 'state', state: 'TN', url: 'https://www.tn.gov/twra/fishing/weekly-fishing-report.html',
    part: [/<h2>Fishing Reports/i, /<h2>(?:Trout Reports|Video)/i], levels: 'h3', bold: false,
    lake: (h) => h.replace(/\s*[-–—]\s*\d{1,2}\/\d{1,2}.*$/, '').trim(),
    by: (p) => p.text.match(/^(?:Report|Forecast) Contributor\s*[-–—]\s*(.+)/i)?.[1],
  }),
  iowa,
  tpwd,
  page({
    name: 'South Carolina DNR freshwater fishing trends', kind: 'state', state: 'SC', url: 'https://dnr.sc.gov/news/freshwater.html',
    part: [/<h1>Freshwater Fishing Trends/i, /<h4>Stay Connected|<footer/i], levels: 'h3', bold: false, entryDate: false,
  }),
  indiana,
  page({
    name: 'New York DEC fishing hotline', kind: 'state', state: 'NY', url: 'https://www.dec.ny.gov/outdoor/9218.html',
    part: [/<h2>[A-Z][a-z]+ \d{1,2}/, /<h3>Additional Fishing Report Sources/i], levels: 'h3', bold: false, entryDate: false,
    // "October 2 to October 9, 2026": the hotline is dated by the end of its week.
    pageDate: (html) => {
      const h2 = htmlToText(html.match(/<h2>([\s\S]*?)<\/h2>/i)?.[1] ?? '');
      const year = h2.match(/\b20\d\d\b/)?.[0] ?? '';
      const end = h2.split(/\bto\b|[-–]/).pop() ?? '';
      return findDate(/\b20\d\d\b/.test(end) ? end : `${end} ${year}`);
    },
  }),
  // Guide reports.
  kyLake,
  sfr,
  // Forums.
  feed({ name: 'GON forum: freshwater fishing', kind: 'forum', state: 'GA', url: 'https://forum.gon.com/forums/freshwater-fishing.7/index.rss' }),
  feed({ name: "Wayne's Words forum (Lake Powell)", kind: 'forum', url: 'https://wayneswords.net/forums/-/index.rss' }),
  // News and tournaments.
  feed({ name: 'Major League Fishing', kind: 'news', url: 'https://majorleaguefishing.com/feed/' }),
  feed({ name: 'Carolina Sportsman', kind: 'news', url: 'https://www.carolinasportsman.com/category/fishing/freshwater-fishing/feed/' }),
  feed({ name: 'Crappie NOW', kind: 'news', url: 'https://crappienow.com/feed/' }),
  feed({ name: 'Louisiana Sportsman', kind: 'news', state: 'LA', url: 'https://www.louisianasportsman.com/feed/', keep: (it) => FRESHWATER.test(`${it.title} ${it.text}`) }),
  feed({ name: 'Mississippi Sportsman', kind: 'news', state: 'MS', url: 'https://mississippisportsman.com/feed/', keep: (it) => FRESHWATER.test(`${it.title} ${it.text}`) }),
  feed({ name: 'Outdoor News fishing reports', kind: 'news', url: 'https://www.outdoornews.com/fishing-reports/feed/' }),
  feed({ name: 'Wired2Fish', kind: 'news', url: 'https://www.wired2fish.com/feed' }),
];
// Not read, because they turn away automated readers (HTTP 403 to our named User-Agent, October 2026):
// Kansas KDWP reservoir reports, GON's lake reports, Lone Star Outdoor News, crappie.com's forum.
// Anglers still reach them through the web searches in the app's Links list.
