"""Contact sheet: N evenly spaced frames, labelled with frame number and scene.
  python3 film/tools/sheet.py FRAMES_DIR OUT.png [N=16]"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(HERE, 'docs', 'timing.json')))
FR, OUT = sys.argv[1], sys.argv[2]; N = int(sys.argv[3]) if len(sys.argv) > 3 else 16
total = T['totalFrames']
picks = [round(i * (total - 1) / (N - 1)) for i in range(N)]
cols = 4; rows = (N + cols - 1) // cols; w, h = 480, 270
sheet = Image.new('RGB', (cols * w, rows * (h + 26)), (14, 16, 30))
dr = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
except Exception: font = ImageFont.load_default()
for i, f in enumerate(picks):
    p = os.path.join(FR, f'f{f:04d}.png')
    if not os.path.exists(p): continue
    im = Image.open(p).convert('RGB').resize((w, h), Image.LANCZOS)
    x, y = (i % cols) * w, (i // cols) * (h + 26)
    sheet.paste(im, (x, y))
    scene = next((s['id'] for s in T['scenes'] if s['start'] <= f < s['end']), T['scenes'][-1]['id'])
    dr.text((x + 8, y + h + 4), f'#{f}  {f/30:5.2f}s  {scene}', fill=(240, 230, 210), font=font)
sheet.save(OUT); print(OUT, picks)
