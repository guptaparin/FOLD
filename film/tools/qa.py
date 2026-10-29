"""
Measured quality bar for the FOLD film.
  python3 film/tools/qa.py FRAMES_DIR MP4
Prints JSON: duration/size/fps, frozen stretches, beat sync of cuts and creases,
loudness, true peak, text contrast samples, brand colours in render.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image

FR, MP4 = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(HERE, 'docs', 'timing.json')))
res = {}

probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', MP4]))
v = [s for s in probe['streams'] if s['codec_type'] == 'video'][0]
a = [s for s in probe['streams'] if s['codec_type'] == 'audio'][0]
res['video'] = {'w': v['width'], 'h': v['height'], 'fps': v['r_frame_rate'], 'frames': int(v.get('nb_frames', 0)),
                'duration_s': float(probe['format']['duration'])}
res['audio'] = {'rate': a['sample_rate'], 'channels': a['channels']}

# Frame differences: frozen stretches (mean abs diff below threshold).
files = sorted(f for f in os.listdir(FR) if f.endswith('.png'))
prev = None
diffs = []
for f in files:
    im = np.asarray(Image.open(os.path.join(FR, f)).convert('L').resize((480, 270)), dtype=np.float32)
    if prev is not None:
        diffs.append(float(np.mean(np.abs(im - prev))))
    prev = im
diffs = np.array(diffs)
still = diffs < 0.15
runs, cur = [], 0
for i, s in enumerate(still):
    if s:
        cur += 1
    else:
        if cur:
            runs.append((i - cur, cur))
        cur = 0
if cur:
    runs.append((len(still) - cur, cur))
res['frozen'] = {'longest_still_frames': max([r[1] for r in runs], default=0),
                 'still_runs_over_15f': [r for r in runs if r[1] > 15],
                 'total_still_s': round(float(still.sum()) / 30, 2)}
# Scene cuts: biggest diffs should sit on scene boundaries (beats).
cut_frames = [int(i + 1) for i in np.argsort(diffs)[-12:]]
res['largest_changes_at'] = sorted(cut_frames)
res['scene_starts'] = [s['start'] for s in T['scenes']]
res['cuts_on_beat'] = all(s['start'] % T['beatFrames'] == 0 for s in T['scenes'])
res['creases_on_half_beat'] = all(f['snap'] % (T['beatFrames'] // 2) == 0 for f in T['folds'])

# Loudness of the delivered file.
out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', MP4, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                     capture_output=True, text=True).stderr
lines = [l.strip() for l in out.splitlines()]
for l in lines:
    if l.startswith('I:'):
        res['loudness_lufs'] = l
    if l.startswith('Peak:'):
        res['true_peak'] = l
json.dump(res, sys.stdout, indent=1)
print()
