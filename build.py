#!/usr/bin/env python3
"""Static build for the Allen Technical Solutions design preview.

src/parts/*.html  -> shared template parts (WordPress: parts/header.html, parts/footer.html)
src/pages/*.html  -> one file per page; front matter, then '---', then body
Outputs <name>.html at the repo root plus search-index.json for site search.

Run:  python3 build.py
"""
import html
import json
import re
from pathlib import Path

from src.icons import BRAND_MARK, icon
from src.hero_traces import svg_overlay

ROOT = Path(__file__).parent
SRC = ROOT / "src"
SITE_NAME = "Allen Technical Solutions"

SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:image" content="assets/img/og-image.jpg">
<meta name="theme-color" content="#0B1424">
<link rel="icon" href="assets/img/favicon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body data-page="{slug}">
{header}
<main id="main">
{hero}{body}
</main>
{footer}
<script src="assets/js/main.js" defer></script>
</body>
</html>
"""

PAGE_HERO = """<section class="page-hero">
  {circuit}
  <div class="wrap">
    <div class="breadcrumb"><a href="index.html">Home</a>{crumb} / {heading}</div>
    <h1>{heading}</h1>
    <p>{lead}</p>
  </div>
</section>
"""

CIRCUIT = """<svg class="circuit-bg" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="none" stroke="#8DBBFF" stroke-width="1.2">
  <path d="M0 80h220l40 40h180l30-30h140"/><circle cx="614" cy="90" r="6"/>
  <path d="M0 300h160l50-50h120"/><circle cx="336" cy="250" r="6"/>
  <path d="M1200 60h-240l-40 40H780"/><circle cx="774" cy="100" r="6"/>
  <path d="M1200 330h-180l-60-60H840l-30 30h-90"/><circle cx="714" cy="300" r="6"/>
  <path d="M900 0v80l40 40v90"/><circle cx="940" cy="216" r="6"/>
  <path d="M420 400v-70l-40-40v-60"/><circle cx="380" cy="224" r="6"/>
</svg>"""


def parse(path: Path):
    raw = path.read_text()
    head, body = raw.split("\n---\n", 1)
    meta = {}
    for line in head.strip().splitlines():
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip()
    return meta, body


def render(text: str, nav: str = "") -> str:
    text = text.replace("{{brand_mark}}", BRAND_MARK)
    text = text.replace("{{circuit}}", CIRCUIT)
    panels = iter(range(1, 100))
    text = re.sub(r"\{\{hero_traces\}\}", lambda m: svg_overlay(next(panels)), text)
    text = text.replace("{{chev}}", icon("chev").replace("<svg ", '<svg class="chev" ', 1))
    text = re.sub(r"\{\{icon:(\w+)\}\}", lambda m: icon(m.group(1)), text)
    text = re.sub(
        r"\{\{cur:(\w+)\}\}",
        lambda m: "is-current" if m.group(1) == nav else "",
        text,
    )
    return text


def strip_tags(s: str) -> str:
    s = re.sub(r"<(script|style|svg)[\s\S]*?</\1>", " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def index_entries(slug, meta, body):
    url = f"{slug}.html"
    entries = [{
        "title": meta["title"],
        "url": url,
        "summary": meta.get("description", ""),
        "keywords": meta.get("keywords", ""),
        "text": strip_tags(body)[:3000],
    }]
    # Each anchored section becomes its own result, so "PayPal" lands on billing.html#pay
    for m in re.finditer(r'<(section|div|article)[^>]*\bid="([\w-]+)"[^>]*>([\s\S]*?)(?=<(?:section|div|article)[^>]*\bid="|$)', body):
        sec_id, chunk = m.group(2), m.group(3)
        h = re.search(r"<h[23][^>]*>([\s\S]*?)</h[23]>", chunk)
        if not h:
            continue
        text = strip_tags(chunk)
        entries.append({
            "title": f"{strip_tags(h.group(1))} · {meta['title']}",
            "url": f"{url}#{sec_id}",
            "summary": text[len(strip_tags(h.group(1))):][:160].strip(),
            "keywords": "",
            "text": text[:1500],
        })
    return entries


def main():
    header = (SRC / "parts/header.html").read_text()
    footer = (SRC / "parts/footer.html").read_text()
    pages = sorted((SRC / "pages").glob("*.html"))
    index, sitemap = [], []
    parsed = [(p.stem, *parse(p)) for p in pages]

    for slug, meta, body in parsed:
        if meta.get("sitemap", "yes") != "no":
            sitemap.append((meta.get("heading") or meta["title"], f"{slug}.html", meta.get("description", "")))

    for slug, meta, body in parsed:
        if slug == "sitemap":
            body += '<section class="section"><div class="wrap"><ul class="results">' + "".join(
                f'<li><a href="{u}"><h3>{html.escape(t)}</h3><p>{html.escape(d)}</p></a></li>'
                for t, u, d in sitemap
            ) + "</ul></div></section>"
        hero = ""
        if meta.get("heading"):
            crumb = meta.get("crumb", "")
            if crumb:
                label, href = crumb.split("|")
                crumb = f' / <a href="{href}">{label}</a>'
            hero = PAGE_HERO.format(
                heading=meta["heading"], lead=meta.get("lead", ""), crumb=crumb, circuit="{{circuit}}"
            )
        title = meta["title"] if slug == "index" else f"{meta['title']} | {SITE_NAME}"
        out = SHELL.format(
            title=html.escape(title),
            description=html.escape(meta.get("description", "")),
            slug=slug,
            header=header,
            hero=hero,
            body=body,
            footer=footer,
        )
        (ROOT / f"{slug}.html").write_text(render(out, meta.get("nav", "")))
        if meta.get("search", "yes") != "no":
            index.extend(index_entries(slug, meta, render(body)))

    (ROOT / "search-index.json").write_text(json.dumps(index, indent=1))
    print(f"built {len(parsed)} pages, {len(index)} search entries")


if __name__ == "__main__":
    main()
