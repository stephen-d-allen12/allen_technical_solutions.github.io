"""Builds the hero backgrounds from the logo art: widens it to the left and extends the
circuit traces out to every edge, keeping them clear of the A and the ALLEN wordmark."""
from PIL import Image, ImageDraw, ImageFilter

SRC = "assets/img/logo-hero.jpg"
EXT = 1000           # pixels added on the left for desktop copy
S = 2                # supersample factor for smooth lines

im = Image.open(SRC).convert("RGB")
W, H = im.size

# 1. widen: stretched edge colour on the left, short feather into the art
edge = im.crop((0, 0, 30, H)).resize((1, H)).resize((EXT + 200, H))
base = Image.new("RGB", (W + EXT, H))
base.paste(edge, (0, 0))
mask = Image.new("L", (W, H), 255)
mp = mask.load()
F = 200
for x in range(F):
    for y in range(H):
        mp[x, y] = int(255 * x / F)
base.paste(Image.composite(im, base.crop((EXT, 0, EXT + W, H)), mask), (EXT, 0))

# 2. traces, in original-art coordinates (x offset by EXT on the wide canvas)
o = EXT
traces = [
    # left bundle: five parallel traces from the left edge that fan up-right and land in a staggered pad row
    # upper-left: branches off the vertical traces above the A, out to the left edge
    [(1680, 150), (1560, 150), (1500, 210), (0, 210)],
    [(1690, 120), (1540, 120), (1480, 180), (800, 180), (760, 140), (0, 140)],
    [(1450, 0), (1450, 60), (1400, 110), (0, 110)],
    # right side: off the big triangle's right edge, out to the right edge
    [(o + 1021, 420), (o + 1300, 420), (o + 1340, 380), (W + EXT, 380)],
    [(o + 990, 360), (o + 1180, 360), (o + 1220, 320), (W + EXT, 320)],
    [(o + 1283, 820), (o + 1400, 820), (o + 1440, 860), (W + EXT, 860)],
    [(o + 1230, 0), (o + 1230, 120), (o + 1290, 180), (W + EXT, 180)],
    # bottom: from under the wordmark to the bottom edge
    [(o + 560, 790), (o + 560, 860), (o + 520, 900), (o + 520, H)],
    [(o + 1000, 790), (o + 1040, 830), (o + 1040, H)],
    [(500, 750), (440, 810), (440, H)],
]
# left bundle geometry: horizontal at y_i, 45-degree rise to a pad; spacing kept at 30px
bundle_pads = []
for i in range(5):
    y = 560 + 30 * i
    xt = 1180 + 12 * i            # keeps the 45-degree legs 30px apart
    dx = 40 + 22 * i              # staggered lengths so pads sit in a row, not on top of each other
    pad = (xt + dx, y - dx)
    lead = [(0, y)]
    if i == 3:
        lead = [(0, 690), (860, 690), (900, 650)]
    if i == 4:
        lead = [(0, 730), (960, 730), (1010, 680)]
    traces.append(lead + [(xt, y), pad])
    bundle_pads.append(pad)

nodes = bundle_pads + [(1680, 150), (1690, 120),
         (o + 1021, 420), (o + 990, 360), (o + 1283, 820), (o + 560, 790), (o + 1000, 790), (500, 750)]

# stop each trace at the rim of its pad instead of running into the hole
R = 9
def trim(pts):
    pts = list(pts)
    for end, nxt in ((0, 1), (-1, -2)):
        if pts[end] in nodes:
            (x0, y0), (x1, y1) = pts[end], pts[nxt]
            L = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** .5
            pts[end] = (x0 + (x1 - x0) * R / L, y0 + (y1 - y0) * R / L)
    return pts
traces = [trim(t) for t in traces]

layer = Image.new("RGBA", ((W + EXT) * S, H * S), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)
sc = lambda pts, dx=0, dy=0: [((x + dx) * S, (y + dy) * S) for x, y in pts]
for t in traces:   # groove: dark shadow line, then a lit edge, like the embossed art
    d.line(sc(t, 0, 2), fill=(0, 2, 6, 150), width=3 * S, joint="curve")
    d.line(sc(t), fill=(62, 88, 134, 150), width=2 * S, joint="curve")
for x, y in nodes:
    r = R
    d.ellipse([((x - r) * S, (y - r + 2) * S), ((x + r) * S, (y + r + 2) * S)], outline=(0, 2, 6, 150), width=3 * S)
    d.ellipse([((x - r) * S, (y - r) * S), ((x + r) * S, (y + r) * S)], outline=(60, 86, 130, 140), width=2 * S)
layer = layer.resize((W + EXT, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.4))

wide = base.convert("RGBA")
wide.alpha_composite(layer)
wide = wide.convert("RGB")
wide.save("assets/img/hero-bg.jpg", quality=82, optimize=True, progressive=True)

# 3. narrow screens: the art itself with traces, fading into the page at the bottom
narrow = wide.crop((EXT, 0, EXT + W, H))
bg = Image.new("RGB", (W, H), (7, 13, 24))
m = Image.new("L", (W, H), 255)
mp = m.load()
FY = int(H * .22)
for y in range(H - FY, H):
    v = int(255 * (H - 1 - y) / FY)
    for x in range(W):
        mp[x, y] = v
Image.composite(narrow, bg, m).save("assets/img/hero-mobile.jpg", quality=80, optimize=True, progressive=True)
print("ok", wide.size)
