"""Builds the hero backgrounds from the logo art: widens it to the left and extends the
circuit traces out to every edge, keeping them clear of the A and the ALLEN wordmark."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from hero_traces import EXT, NODES, PAD_R, TRACES, trim  # noqa: E402

SRC = "assets/img/logo-hero.jpg"
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

# 2. traces: geometry lives in hero_traces.py so the animated overlay matches exactly
traces = [trim(t) for t in TRACES]
nodes = NODES
R = PAD_R

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
