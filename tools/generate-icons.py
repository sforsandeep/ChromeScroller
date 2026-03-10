#!/usr/bin/env python3
"""
Generate camera icon PNG files for ChromeScroller extension.
Usage: python tools/generate-icons.py
Requires: pip install Pillow
"""

import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


def draw_camera(size):
    """Draw a camera icon at the given pixel size."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Scale factor: design space is 32x32
    s = size / 32.0

    def sc(v):
        return int(round(v * s))

    # Camera body (dark rounded rectangle)
    body_color = (26, 26, 26, 240)
    draw.rounded_rectangle(
        [sc(2), sc(8), sc(30), sc(27)],
        radius=max(1, sc(3)),
        fill=body_color,
        outline=(255, 255, 255, 220),
        width=max(1, sc(1.5))
    )

    # Viewfinder bump (top centre)
    draw.rounded_rectangle(
        [sc(11), sc(5), sc(21), sc(10)],
        radius=max(1, sc(2)),
        fill=body_color,
        outline=(255, 255, 255, 220),
        width=max(1, sc(1.5))
    )

    # Lens outer ring (white circle, no fill)
    lens_cx, lens_cy, lens_r = sc(16), sc(17), sc(7)
    draw.ellipse(
        [lens_cx - lens_r, lens_cy - lens_r, lens_cx + lens_r, lens_cy + lens_r],
        fill=None,
        outline=(255, 255, 255, 220),
        width=max(1, sc(1.5))
    )

    # Lens glass (semi-transparent blue)
    glass_r = sc(5)
    draw.ellipse(
        [lens_cx - glass_r, lens_cy - glass_r, lens_cx + glass_r, lens_cy + glass_r],
        fill=(100, 180, 255, 90),
        outline=(170, 221, 255, 180),
        width=max(1, sc(1))
    )

    # Lens reflection dot (only visible at larger sizes)
    if size >= 32:
        ref_cx, ref_cy = sc(13.5), sc(14.5)
        ref_r = max(1, sc(1.2))
        draw.ellipse(
            [ref_cx - ref_r, ref_cy - ref_r, ref_cx + ref_r, ref_cy + ref_r],
            fill=(255, 255, 255, 178)
        )

    # Shutter button (red circle, top-right of body)
    sb_cx, sb_cy = sc(26), sc(10)
    sb_r = max(1, sc(2))
    draw.ellipse(
        [sb_cx - sb_r, sb_cy - sb_r, sb_cx + sb_r, sb_cy + sb_r],
        fill=(204, 51, 51, 230),
        outline=(255, 255, 255, 200),
        width=max(1, sc(1))
    )

    return img


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, '..', 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 32, 48, 128]:
        img = draw_camera(size)
        path = os.path.join(icons_dir, f'icon{size}.png')
        img.save(path, 'PNG')
        print(f"Created {path}")

    print("Done! All icons generated successfully.")
