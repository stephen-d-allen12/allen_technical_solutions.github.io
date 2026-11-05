#!/usr/bin/env python3
"""Build the WordPress version of the site: a classic theme that installs its own pages.

Run from the repo root, after `python3 build.py`:

    python3 wordpress/build_theme.py

Output: wordpress/dist/allen-technical-solutions/ (the theme folder).
On activation the theme creates every page (Home, Services, Contact, ...) with the
same content as the preview, sets Home as the front page and turns on pretty permalinks.
Pages that already exist are left alone, so edits made in WordPress are never overwritten.
"""
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402

SLUG = "allen-technical-solutions"
OUT = ROOT / "wordpress" / "dist" / SLUG
VERSION = "1.0.0"

# Page file -> WordPress slug ("search" is reserved by WordPress's own search URLs)
WP_SLUG = {"index": "home", "search": "site-search"}
SKIP_PAGES = {"404"}  # becomes the theme's 404.php instead of a page

PHP_HOME = "<?php echo esc_url( home_url( '/' ) ); ?>"
PHP_THEME = "<?php echo esc_url( get_template_directory_uri() ); ?>/"


def wp_slug(stem):
    return WP_SLUG.get(stem, stem)


def page_path(stem):
    """Path below the home URL for a page file stem ('' for the front page)."""
    return "" if stem == "index" else wp_slug(stem) + "/"


def rewrite_links(text, home, theme):
    """Turn the preview's relative links into WordPress URLs."""
    def fix(m):
        attr, val = m.group(1), m.group(2)
        if re.match(r"^(https?:|mailto:|tel:|#|data:|javascript:|//)", val):
            return m.group(0)
        path, frag = (val.split("#", 1) + [""])[:2]
        frag = "#" + frag if frag else ""
        path, query = (path.split("?", 1) + [""])[:2]
        query = "?" + query if query else ""
        if path.startswith("assets/"):
            new = theme + path
        elif path.startswith("fishfinder"):
            rest = path[len("fishfinder"):].lstrip("/")
            if rest == "" or rest.endswith("/"):
                rest += "index.html"
            new = theme + "static/fishfinder/" + rest
        elif path.endswith(".html"):
            new = home + page_path(path[:-5])
        else:
            return m.group(0)
        return f'{attr}="{new}{query}{frag}"'
    return re.sub(r'\b(href|src|action)="([^"]*)"', fix, text)


def main_content(stem):
    built = (ROOT / f"{stem}.html").read_text()
    m = re.search(r'<main id="main">\n?([\s\S]*)\n?</main>', built)
    return m.group(1).strip()


def php_str(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def header_footer():
    header = (ROOT / "src/parts/header.html").read_text()
    footer = (ROOT / "src/parts/footer.html").read_text()
    # current-menu highlighting is decided per request in PHP
    header = re.sub(r"\{\{cur:(\w+)\}\}", r"__CUR_\1__", header)
    header = build.render(header)
    footer = build.render(footer)
    header = rewrite_links(header, PHP_HOME, PHP_THEME)
    footer = rewrite_links(footer, PHP_HOME, PHP_THEME)
    header = re.sub(r"__CUR_(\w+)__", r"<?php echo ats_cur( '\1' ); ?>", header)
    return header, footer


HEADER_PHP = """<?php
/**
 * Site header.
 *
 * @package Allen_Technical_Solutions
 */
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?> data-page="<?php echo esc_attr( ats_page_key() ); ?>">
<?php wp_body_open(); ?>
__HEADER__
<main id="main">
"""

FOOTER_PHP = """</main>
__FOOTER__
<?php wp_footer(); ?>
</body>
</html>
"""

PAGE_PHP = """<?php
/**
 * Pages (every page of the site, including the front page).
 *
 * @package Allen_Technical_Solutions
 */
get_header();
while ( have_posts() ) :
	the_post();
	the_content();
endwhile;
get_footer();
"""

INDEX_PHP = """<?php
/**
 * Fallback template (blog posts, archives, WordPress search results).
 *
 * @package Allen_Technical_Solutions
 */
get_header();
?>
<section class="page-hero">
  <div class="wrap">
    <h1><?php echo esc_html( is_singular() ? get_the_title() : wp_strip_all_tags( get_the_archive_title() ) ); ?></h1>
  </div>
</section>
<section class="section">
  <div class="wrap">
<?php
if ( have_posts() ) :
	while ( have_posts() ) :
		the_post();
		if ( is_singular() ) :
			the_content();
		else :
			?>
    <article class="card" style="margin-bottom:24px">
      <h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
      <?php the_excerpt(); ?>
    </article>
			<?php
		endif;
	endwhile;
	the_posts_pagination();
else :
	echo '<p>' . esc_html__( 'Nothing here yet.', 'allen-technical-solutions' ) . '</p>';
endif;
?>
  </div>
</section>
<?php
get_footer();
"""

FUNCTIONS_PHP = r"""<?php
/**
 * Allen Technical Solutions theme.
 *
 * @package Allen_Technical_Solutions
 */

define( 'ATS_VERSION', '__VERSION__' );

add_action( 'after_setup_theme', function () {
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script' ) );
} );

add_action( 'wp_enqueue_scripts', function () {
	$uri = get_template_directory_uri();
	wp_enqueue_style( 'ats-fonts', 'https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap', array(), null );
	wp_enqueue_style( 'ats-style', $uri . '/assets/css/style.css', array(), ATS_VERSION );
	wp_enqueue_script( 'ats-main', $uri . '/assets/js/main.js', array(), ATS_VERSION, array( 'strategy' => 'defer', 'in_footer' => false ) );
	wp_localize_script( 'ats-main', 'ATS', array(
		'home'   => trailingslashit( home_url( '/' ) ),
		'index'  => $uri . '/search-index.json',
		'search' => home_url( '/site-search/' ),
	) );
} );

add_action( 'wp_head', function () {
	$uri = get_template_directory_uri();
	echo '<meta name="theme-color" content="#0B1424">' . "\n";
	echo '<meta name="darkreader-lock">' . "\n";
	if ( ! has_site_icon() ) {
		echo '<link rel="icon" href="' . esc_url( $uri . '/assets/img/favicon.png' ) . '" type="image/png">' . "\n";
	}
	$desc = is_singular() ? get_post_meta( get_queried_object_id(), '_ats_description', true ) : '';
	if ( ! $desc ) {
		$desc = get_bloginfo( 'description' );
	}
	echo '<meta name="description" content="' . esc_attr( $desc ) . '">' . "\n";
	echo '<meta property="og:title" content="' . esc_attr( wp_get_document_title() ) . '">' . "\n";
	echo '<meta property="og:description" content="' . esc_attr( $desc ) . '">' . "\n";
	echo '<meta property="og:image" content="' . esc_url( $uri . '/assets/img/og-image.jpg' ) . '">' . "\n";
}, 1 );

// Same browser-tab titles as the preview ("Contact | Allen Technical Solutions").
add_filter( 'document_title_separator', function () {
	return '|';
} );
add_filter( 'pre_get_document_title', function ( $title ) {
	if ( is_front_page() ) {
		$t = get_post_meta( get_queried_object_id(), '_ats_title', true );
		return $t ? $t : $title;
	}
	return $title;
} );

/** Which top-menu item to highlight on this page. */
function ats_cur( $key ) {
	$nav = is_singular() ? get_post_meta( get_queried_object_id(), '_ats_nav', true ) : '';
	return $nav === $key ? 'is-current' : '';
}

/** The preview's page name (index, contact, ...) for the body's data-page attribute. */
function ats_page_key() {
	if ( is_front_page() ) {
		return 'index';
	}
	if ( is_404() ) {
		return '404';
	}
	$key = is_singular() ? get_post_meta( get_queried_object_id(), '_ats_key', true ) : '';
	return $key ? $key : 'page';
}

/** Create the site's pages, front page and permalinks. Never overwrites an existing page. */
function ats_install_pages() {
	// Page content has forms and inline SVG, which only an administrator may save unfiltered.
	// If nobody qualifying is signed in yet, the 'init' hook below retries on the next admin visit.
	if ( ! current_user_can( 'unfiltered_html' ) ) {
		return;
	}
	kses_remove_filters();
	$pages = require get_template_directory() . '/inc/pages.php';
	$home  = trailingslashit( home_url( '/' ) );
	$theme = trailingslashit( get_template_directory_uri() );
	$ids   = array();
	$order = 0;
	foreach ( $pages as $p ) {
		$existing = get_page_by_path( $p['slug'], OBJECT, 'page' );
		if ( $existing ) {
			$ids[ $p['slug'] ] = $existing->ID;
			continue;
		}
		$content = file_get_contents( get_template_directory() . '/content/' . $p['slug'] . '.html' );
		$content = str_replace( array( '{{home}}', '{{theme}}' ), array( $home, $theme ), $content );
		$id      = wp_insert_post( wp_slash( array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => $p['title'],
			'post_name'    => $p['slug'],
			'post_content' => "<!-- wp:html -->\n" . $content . "\n<!-- /wp:html -->",
			'menu_order'   => $order++,
			'meta_input'   => array(
				'_ats_key'         => $p['key'],
				'_ats_nav'         => $p['nav'],
				'_ats_title'       => $p['doc_title'],
				'_ats_description' => $p['description'],
			),
		) ) );
		if ( ! is_wp_error( $id ) ) {
			$ids[ $p['slug'] ] = $id;
		}
	}
	if ( isset( $ids['home'] ) ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', $ids['home'] );
	}
	if ( 'Just another WordPress site' === get_option( 'blogdescription' ) || '' === get_option( 'blogdescription' ) ) {
		update_option( 'blogdescription', 'Engineering, Consulting & Software' );
	}
	if ( ! get_option( 'permalink_structure' ) ) {
		update_option( 'permalink_structure', '/%postname%/' );
	}
	flush_rewrite_rules();
	update_option( 'ats_pages_installed', ATS_VERSION );
	kses_init();
}
add_action( 'after_switch_theme', 'ats_install_pages' );

// Also install when the theme was activated some other way (e.g. a database import).
add_action( 'init', function () {
	if ( get_option( 'ats_pages_installed' ) !== ATS_VERSION && current_user_can( 'unfiltered_html' ) ) {
		ats_install_pages();
	}
}, 20 );
"""

STYLE_CSS = """/*
Theme Name: Allen Technical Solutions
Theme URI: https://allentechnicalsolutions.net
Author: Allen Technical Solutions
Description: Engineering, consulting, software and web development. Activating the theme creates all of the site's pages with their content and sets Home as the front page. The design's stylesheet is assets/css/style.css.
Version: __VERSION__
Requires at least: 6.3
Requires PHP: 7.4
License: All rights reserved
Text Domain: allen-technical-solutions
*/
"""


def patch_main_js(js):
    js = js.replace(
        'fetch("search-index.json").then((r) => r.json())',
        'fetch(ATS.index).then((r) => r.json()).then((list) => list.map((e) => Object.assign({}, e, { url: ATS.home + e.url })))',
    )
    js = js.replace('href="search.html?q=${', 'href="${ATS.search}?q=${')
    js = js.replace('<a href="contact.html">ask us directly</a>', '<a href="${ATS.home}contact/">ask us directly</a>')
    assert "search-index.json" not in js and ".html" not in js.replace("innerHTML", ""), "main.js still has preview links"
    return js


def search_index():
    entries = json.loads((ROOT / "search-index.json").read_text())
    for e in entries:
        path, frag = (e["url"].split("#", 1) + [""])[:2]
        e["url"] = page_path(path[:-5]) + ("#" + frag if frag else "")
    return json.dumps(entries, indent=1)


def fishfinder(dest):
    shutil.copytree(ROOT / "fishfinder", dest, ignore=shutil.ignore_patterns("README.md"))
    # Directory URLs may not resolve to index.html on every server, so link to the files.
    for p in dest.rglob("*.html"):
        t = p.read_text()
        t = re.sub(r'href="(\./|app/)"', lambda m: f'href="{m.group(1)}index.html"', t)
        t = t.replace('href="./#', 'href="./index.html#')
        p.write_text(t)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "inc").mkdir(parents=True)
    (OUT / "content").mkdir()

    shutil.copytree(ROOT / "assets", OUT / "assets")
    (OUT / "assets/js/main.js").write_text(patch_main_js((ROOT / "assets/js/main.js").read_text()))
    (OUT / "search-index.json").write_text(search_index())
    fishfinder(OUT / "static" / "fishfinder")

    header, footer = header_footer()
    (OUT / "header.php").write_text(HEADER_PHP.replace("__HEADER__", header))
    (OUT / "footer.php").write_text(FOOTER_PHP.replace("__FOOTER__", footer))
    (OUT / "page.php").write_text(PAGE_PHP)
    (OUT / "index.php").write_text(INDEX_PHP)
    (OUT / "functions.php").write_text(FUNCTIONS_PHP.replace("__VERSION__", VERSION))
    (OUT / "style.css").write_text(STYLE_CSS.replace("__VERSION__", VERSION))
    shutil.copy(ROOT / "assets/img/og-image.jpg", OUT / "screenshot.jpg")

    # 404 template
    body404 = rewrite_links(main_content("404"), PHP_HOME, PHP_THEME)
    (OUT / "404.php").write_text("<?php\n/**\n * Page not found.\n *\n * @package Allen_Technical_Solutions\n */\nget_header();\n?>\n" + body404 + "\n<?php\nget_footer();\n")

    # Page content + manifest. Home first so it gets menu_order 0.
    stems = sorted((p.stem for p in (ROOT / "src/pages").glob("*.html")), key=lambda s: (s != "index", s))
    rows = []
    for stem in stems:
        if stem in SKIP_PAGES:
            continue
        meta, _ = build.parse(ROOT / "src/pages" / f"{stem}.html")
        slug = wp_slug(stem)
        content = rewrite_links(main_content(stem), "{{home}}", "{{theme}}")
        (OUT / "content" / f"{slug}.html").write_text(content + "\n")
        title = "Home" if stem == "index" else html.unescape(meta.get("heading") or meta["title"])
        doc_title = meta["title"] if stem == "index" else f"{meta['title']} | {build.SITE_NAME}"
        rows.append(
            "\tarray( 'slug' => {}, 'key' => {}, 'title' => {}, 'nav' => {}, 'doc_title' => {}, 'description' => {} ),".format(
                php_str(slug), php_str(stem), php_str(title), php_str(meta.get("nav", "")),
                php_str(doc_title), php_str(meta.get("description", "")),
            )
        )
    (OUT / "inc/pages.php").write_text(
        "<?php\n/**\n * Pages the theme creates on activation (content in /content).\n *\n * @package Allen_Technical_Solutions\n */\n\nreturn array(\n"
        + "\n".join(rows) + "\n);\n"
    )
    leftovers = [p for p in OUT.rglob("*") if p.is_file() and p.suffix in (".php", ".html") and "static" not in p.parts
                 and re.search(r'(href|src|action)="(?!https?:|mailto:|tel:|#|\{\{|<\?php|data:)[^"]+\.html', p.read_text())]
    assert not leftovers, f"preview links left in {leftovers}"
    print(f"theme: {OUT.relative_to(ROOT)} ({len(rows)} pages)")


if __name__ == "__main__":
    main()
