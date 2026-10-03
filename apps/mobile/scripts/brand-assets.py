# Builds apps/mobile/assets from docs/brand: python3 apps/mobile/scripts/brand-assets.py (Pillow).
#
# Logos: trimmed to their ink and downscaled, since 2172px wide is far more than a phone
# shows at 3x. Mascots: the owner's files sit on the brand navy, not transparent, so the
# navy is keyed out by distance from it: anything that departs from the navy keeps that
# much opacity. The result is only right on the Midnight background (near enough the
# same navy); never put these cut-outs on a white card.

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
BRAND = os.path.join(ROOT, "docs", "brand")
OUT = os.path.join(ROOT, "apps", "mobile", "assets")
os.makedirs(os.path.join(OUT, "brand"), exist_ok=True)


def save(im, path):
    im.save(path, optimize=True)
    print(f"{os.path.relpath(path, ROOT)}  {im.size[0]}x{im.size[1]}  {os.path.getsize(path) // 1024} KB  aspect {im.size[0] / im.size[1]:.4f}")


def logo(name, width, pad=0):
    im = Image.open(os.path.join(BRAND, "logos", name)).convert("RGBA")
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    im = im.crop(box)
    if pad:
        canvas = Image.new("RGBA", (im.size[0] + 2 * pad, im.size[1] + 2 * pad), (0, 0, 0, 0))
        canvas.paste(im, (pad, pad))
        im = canvas
    h = round(im.size[1] * width / im.size[0])
    return im.resize((width, h), Image.LANCZOS)


def keyed(name, bg, max_side):
    """The navy background turned to alpha, the figure cropped, and downscaled."""
    im = Image.open(os.path.join(BRAND, "mascot", name)).convert("RGB")
    out = []
    for r, g, b in im.getdata():
        d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
        a = min(255, d * 255 // 190)
        if a == 0:
            out.append((0, 0, 0, 0))
            continue
        # Un-blend from the navy so a half-transparent glow pixel composites back to the
        # colour the owner's file shows, instead of a darker one.
        k = 255 / a
        out.append((
            max(0, min(255, round(bg[0] + (r - bg[0]) * k))),
            max(0, min(255, round(bg[1] + (g - bg[1]) * k))),
            max(0, min(255, round(bg[2] + (b - bg[2]) * k))),
            a,
        ))
    res = Image.new("RGBA", im.size)
    res.putdata(out)
    box = res.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    res = res.crop(box)
    scale = max_side / max(res.size)
    if scale < 1:
        res = res.resize((round(res.size[0] * scale), round(res.size[1] * scale)), Image.LANCZOS)
    return res


# The official lockup on Welcome and the splash; "by TurboLabs" on every inner screen.
save(logo("hangoverbot-roster-protection.png", 1200), os.path.join(OUT, "brand", "hangoverbot-roster-protection.png"))
save(logo("hangoverbot-by-turbolabs.png", 900), os.path.join(OUT, "brand", "hangoverbot-by-turbolabs.png"))
# The splash is the same lockup with room around it; expo-splash-screen sizes it by width.
save(logo("hangoverbot-roster-protection.png", 1200, pad=60), os.path.join(OUT, "splash-icon.png"))

# Mascots for Midnight only: the head peeking in on Home, the flying figure on Welcome.
save(keyed("pose-flying.png", (6, 13, 32), 600), os.path.join(OUT, "brand", "robot-peek.png"))
save(keyed("flying-thumbs-up.png", (0, 5, 36), 600), os.path.join(OUT, "brand", "robot-flying.png"))

# The icons the brand README derived from the owner's flying robot. iOS wants no alpha.
Image.open(os.path.join(BRAND, "icons", "icon-1024.png")).convert("RGB").save(os.path.join(OUT, "icon.png"), optimize=True)
Image.open(os.path.join(BRAND, "icons", "adaptive-icon-1024.png")).convert("RGB").save(os.path.join(OUT, "adaptive-icon.png"), optimize=True)
print("icon.png and adaptive-icon.png copied from docs/brand/icons")

# Android status-bar icon: a white silhouette, alpha only. The robot's visor with its two
# arched eyes cut out.
n = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
d = ImageDraw.Draw(n)
d.rounded_rectangle([6, 22, 90, 76], radius=22, fill=(255, 255, 255, 255))
for cx in (34, 62):
    d.arc([cx - 13, 36, cx + 13, 64], start=200, end=340, fill=(0, 0, 0, 0), width=8)
save(n, os.path.join(OUT, "notification-icon.png"))
