"""Generate the small looping coin animation used by g cf."""

from math import cos, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "coin-flip.gif"
FONT_PATH = Path("C:/Windows/Fonts/segoeuib.ttf")
SCALE = 3
SIZE = (180, 150)
FRAMES = []

for index in range(16):
    phase = 2 * pi * index / 16
    face = "H" if cos(phase) >= 0 else "T"
    width = max(7, round(abs(cos(phase)) * 55))
    rise = round(13 * abs(sin(phase)))
    frame = Image.new("RGB", (SIZE[0] * SCALE, SIZE[1] * SCALE), "#313338")
    draw = ImageDraw.Draw(frame)
    cx, cy = 90 * SCALE, (82 - rise) * SCALE
    shadow_width = round((45 - rise / 2) * SCALE)
    draw.ellipse(
        (cx - shadow_width, 125 * SCALE, cx + shadow_width, 132 * SCALE),
        fill="#202127",
    )
    left, top, right, bottom = cx - width * SCALE, cy - 55 * SCALE, cx + width * SCALE, cy + 55 * SCALE
    draw.ellipse((left - 4 * SCALE, top, right + 4 * SCALE, bottom), fill="#9c610f")
    draw.ellipse((left, top, right, bottom), fill="#ffd260")
    if width > 18:
        draw.ellipse(
            (left + 8 * SCALE, top + 8 * SCALE, right - 8 * SCALE, bottom - 8 * SCALE),
            outline="#b77b1f",
            width=3 * SCALE,
        )
        label_font = ImageFont.truetype(str(FONT_PATH), min(54, width) * SCALE)
        label_box = draw.textbbox((0, 0), face, font=label_font)
        draw.text(
            (cx - (label_box[2] - label_box[0]) / 2, cy - (label_box[3] - label_box[1]) / 2 - label_box[1]),
            face,
            font=label_font,
            fill="#6d450d",
        )
    draw.text((9 * SCALE, 7 * SCALE), "CRAFTLAND", font=ImageFont.truetype(str(FONT_PATH), 16 * SCALE), fill="#ffda78")
    FRAMES.append(frame.resize(SIZE, Image.Resampling.LANCZOS))

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
FRAMES[0].save(
    OUTPUT,
    save_all=True,
    append_images=FRAMES[1:],
    optimize=True,
    duration=55,
    loop=0,
    disposal=2,
)
print(OUTPUT)
