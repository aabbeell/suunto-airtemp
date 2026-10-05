# ABOUTME: Composes a contact sheet of Air Temperature simulator screenshots (one row of labelled tiles per line of the grid).
# ABOUTME: Usage: uv run --with pillow python test/sheet.py out.png cols "label=shot.png" ... (tiles masked to the round display).
import sys
from PIL import Image, ImageDraw, ImageFont

out, cols, items = sys.argv[1], int(sys.argv[2]), [a.split('=', 1) for a in sys.argv[3:]]
imgs = [(lab, Image.open(p).convert('RGB')) for lab, p in items]
w, h = imgs[0][1].size
pad, lab_h = 24, 56
rows = (len(imgs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w + (cols + 1) * pad, rows * (h + lab_h) + (rows + 1) * pad), (34, 34, 38))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 26)
except OSError:
    font = ImageFont.load_default()
for i, (lab, im) in enumerate(imgs):
    r, c = divmod(i, cols)
    x = pad + c * (w + pad)
    y = pad + r * (h + lab_h + pad)
    # The round display: the tile is masked to the circle and outlined, so the edge the safe-area check uses is visible.
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, w - 1, h - 1), fill=255)
    sheet.paste(im, (x, y), mask)
    draw.ellipse((x, y, x + w - 1, y + h - 1), outline=(110, 110, 118), width=2)
    tw = draw.textlength(lab, font=font)
    draw.text((x + (w - tw) / 2, y + h + 14), lab, fill=(230, 230, 230), font=font)
sheet.save(out, optimize=True)
print(out, sheet.size)
