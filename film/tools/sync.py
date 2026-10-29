"""Measure crease-snap onsets in the SFX bus against picture snap frames."""
import json, os, sys
import numpy as np
from scipy.io import wavfile
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(HERE, 'docs', 'timing.json')))
sr, x = wavfile.read(os.path.join(HERE, 'audio', sys.argv[1] if len(sys.argv) > 1 else 'sfx_raw.wav'))
x = x.astype(np.float64)
if x.ndim > 1: x = x.mean(1)
hop = int(sr * 0.002); n = len(x) // hop
e = 10 * np.log10((x[:n * hop].reshape(n, hop) ** 2).sum(1) + 1e-12)
d = np.maximum(0, np.diff(e))
errs = []
for f in T['folds']:
    i = int(f['snap'] / 30 / 0.002)
    k = int(np.argmax(d[i - 50:i + 50])) - 50
    errs.append(round(k * 0.002 * 30, 2))
print(json.dumps({'snap_offsets_frames': errs, 'max_abs_frames': max(abs(v) for v in errs)}))
