"""Circuit-trace geometry for the home hero, shared by make_hero.py (bakes the traces into
hero-bg.jpg) and build.py (emits the same paths as an SVG overlay that the animated
electron tracers run along). Coordinates are pixels on the 2601x942 wide hero image."""

EXT = 1000             # pixels added on the left of the 1601px logo art
W, H = 1601 + EXT, 942
o = EXT

# Pads that belong to the logo art itself (the lit A), wide-canvas coordinates
A_TOP, A_BL, A_BR = (1815, 230), (1625, 490), (1964, 494)
A_PAD_R = 25

# --- baked traces ---------------------------------------------------------
TRACES = [
    # upper-left: branches off the vertical traces above the A, out to the left edge
    [(1680, 150), (1560, 150), (1500, 210), (0, 210)],
    [(1690, 120), (1540, 120), (1480, 180), (800, 180), (760, 140), (0, 140)],
    [(1450, 0), (1450, 60), (1400, 110), (0, 110)],
    # right side: off the big triangle's right edge, out to the right edge
    [(o + 1021, 420), (o + 1300, 420), (o + 1340, 380), (W, 380)],
    [(o + 990, 360), (o + 1180, 360), (o + 1220, 320), (W, 320)],
    [(o + 1283, 820), (o + 1400, 820), (o + 1440, 860), (W, 860)],
    [(o + 1230, 0), (o + 1230, 120), (o + 1290, 180), (W, 180)],
    # feed into the A's bottom-right pad from the right edge
    [A_BR, (2230, 494), (2262, 526), (W, 526)],
    # bottom: from under the wordmark to the bottom edge
    [(o + 560, 790), (o + 560, 860), (o + 520, 900), (o + 520, H)],
    [(o + 1000, 790), (o + 1040, 830), (o + 1040, H)],
    [(500, 750), (440, 810), (440, H)],
]

# left bundle: horizontal at y_i, 45-degree rise to a staggered pad row (legs 30px apart).
# The top trace no longer stops at a pad: it carries on into the A's bottom-left pad.
BUNDLE = []
BUNDLE_PADS = []
for i in range(5):
    y = 560 + 30 * i
    xt = 1180 + 12 * i
    dx = 40 + 22 * i
    lead = [(0, y)]
    if i == 3:
        lead = [(0, 690), (860, 690), (900, 650)]
    if i == 4:
        lead = [(0, 730), (960, 730), (1010, 680)]
    if i == 0:
        BUNDLE.append(lead + [(xt, y), (1250, 490), A_BL])
        continue
    pad = (xt + dx, y - dx)
    BUNDLE.append(lead + [(xt, y), pad])
    BUNDLE_PADS.append(pad)
TRACES += BUNDLE

NODES = BUNDLE_PADS + [(1680, 150), (1690, 120), (o + 1021, 420), (o + 990, 360),
                       (o + 1283, 820), (o + 560, 790), (o + 1000, 790), (500, 750)]
PAD_R = 9


def trim(pts):
    """Stop a trace at the rim of the pad it ends in instead of running into the hole."""
    pts = list(pts)
    for end, nxt in ((0, 1), (-1, -2)):
        r = PAD_R if pts[end] in NODES else A_PAD_R if pts[end] in (A_TOP, A_BL, A_BR) else 0
        if r:
            (x0, y0), (x1, y1) = pts[end], pts[nxt]
            L = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** .5
            pts[end] = (x0 + (x1 - x0) * r / L, y0 + (y1 - y0) * r / L)
    return pts


# --- electron routes (direction of travel; end="pad" flashes the pad on arrival) ----
def _rev(t):
    return list(reversed(t))

# the A's own lit traces
A_LEFT_LEG = [A_BL, A_TOP]
A_RIGHT_LEG = [A_BR, (1834, 265)]
A_BAR_1 = [(1712, 375), (1787, 375)]
A_BAR_2 = [(1645, 463), (1677, 463), (1713, 420), (1842, 420)]

ROUTES = [
    # main feeds: from the edges, through the A
    dict(id="feed-left", pts=BUNDLE[0][:-1] + A_LEFT_LEG, end="pad", weight=4, big=True,
         branches=[("bar-1", (1712, 375)), ("bar-2", (1645, 463))]),
    dict(id="feed-right", pts=_rev(TRACES[7])[:-1] + A_RIGHT_LEG, end="tip", weight=3, big=True),
    dict(id="bar-1", pts=A_BAR_1, end="pad", weight=0),
    dict(id="bar-2", pts=A_BAR_2, end="pad", weight=0),
    # bundle traces from the left edge to their pads
    *[dict(id=f"bundle-{i}", pts=b, end="pad", weight=1) for i, b in enumerate(BUNDLE[1:], 1)],
    # upper-left, right and bottom traces, edge to pad
    dict(id="ul-1", pts=_rev(TRACES[0]), end="pad", weight=1),
    dict(id="ul-2", pts=_rev(TRACES[1]), end="pad", weight=1),
    dict(id="ul-3", pts=_rev(TRACES[2]), end="edge", weight=.6),
    dict(id="r-1", pts=_rev(TRACES[3]), end="pad", weight=1.4),
    dict(id="r-2", pts=_rev(TRACES[4]), end="pad", weight=1.4),
    dict(id="r-3", pts=_rev(TRACES[5]), end="pad", weight=1),
    dict(id="r-4", pts=_rev(TRACES[6]), end="edge", weight=.6),
    dict(id="b-1", pts=_rev(TRACES[8]), end="pad", weight=1),
    dict(id="b-2", pts=_rev(TRACES[9]), end="pad", weight=1),
    dict(id="b-3", pts=_rev(TRACES[10]), end="pad", weight=.8),
]


def svg_overlay():
    """Hidden route paths for the hero overlay; main.js animates electrons along them."""
    def d(pts):
        return "M" + " L".join(f"{x:g} {y:g}" for x, y in pts)
    paths = []
    for r in ROUTES:
        attrs = f'data-route="{r["id"]}" data-end="{r["end"]}" data-weight="{r["weight"]}"'
        if r.get("big"):
            attrs += ' data-big="1"'
        if r.get("branches"):
            attrs += ' data-branches="' + ";".join(f"{b},{x},{y}" for b, (x, y) in r["branches"]) + '"'
        paths.append(f'    <path {attrs} d="{d(r["pts"])}"/>')
    return (f'<svg class="hero-traces" viewBox="0 0 {W} {H}" preserveAspectRatio="xMaxYMid slice" '
            'aria-hidden="true" focusable="false">\n'
            '  <defs><radialGradient id="spark-halo"><stop offset="0" stop-color="#CFEBFF" stop-opacity=".95"/>'
            '<stop offset=".35" stop-color="#3FA2FF" stop-opacity=".4"/><stop offset="1" stop-color="#1E74F0" stop-opacity="0"/>'
            '</radialGradient></defs>\n  <g class="hero-routes">\n' + "\n".join(paths) +
            '\n  </g>\n  <g class="hero-sparks"></g>\n</svg>')
