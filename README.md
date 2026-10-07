# Allen Technical Solutions — website design preview

Static HTML/CSS/JS preview of the Allen Technical Solutions website, hosted on GitHub Pages.
It is the design pass for a future **WordPress** site; nothing here needs a server.

## Edit and rebuild

Pages live in `src/pages/` and the shared header/footer in `src/parts/`. After editing, run:

```
python3 build.py
```

That regenerates every `*.html` file at the repo root and `search-index.json` (used by the header search box).

## How this maps to WordPress

| Preview | WordPress block theme |
|---|---|
| `assets/css/style.css` `:root` tokens | `theme.json` colour palette, fonts, spacing |
| `src/parts/header.html`, `footer.html` | `parts/header.html`, `parts/footer.html` template parts |
| Mega menus | Navigation block (or Max Mega Menu plugin) |
| Home hero slideshow + electron tracers | Custom block pattern; the theme enqueues the same script and the trace SVG from `src/hero_traces.py` (no slider plugin needed) |
| Header search + suggestions | Search block + SearchWP / Relevanssi (live AJAX search) |
| Cart, checkout, Client Portal | WooCommerce (Cart, Checkout, My Account) |
| Pay an Invoice | WooCommerce + Stripe (WooPayments or Stripe Gateway) and PayPal Payments; or WP Simple Pay |
| Support tickets, knowledge base | A helpdesk plugin such as Fluent Support or Awesome Support |
| Quote / contact forms | Fluent Forms, WPForms or Gravity Forms |
| Book a Call | Amelia, Bookly or a Calendly embed |
| Monthly plans | WooCommerce Subscriptions |
| Software downloads (try or buy) | WooCommerce downloadable products + a license-key plugin such as License Manager for WooCommerce (or Easy Digital Downloads with Software Licensing); trials as free downloadable products |

## Brand colour

Primary blue `#1E74F0` (a medium "trust" blue, the most widely preferred colour in consumer surveys),
with `#4A93FF` for highlights on dark backgrounds and navy `#0B1424` taken from the logo.
