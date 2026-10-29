"""
FOLD film timing authority.

Writes docs/timing.json. Both the picture (film/main.ts) and the sound
(film/audio.py) read it, so every fold, snap and cut lands on the beat.

30 fps, 90 bpm: one beat is exactly 20 frames, one bar 80 frames.
"""
import json
import os

FPS = 30
BPM = 90
BEAT = 20            # frames per beat
BAR = BEAT * 4       # 80
TOTAL = 960          # 32 s, 12 bars

scenes = [
    {"id": "hook",    "start": 0,   "end": 160, "note": "macro: first fold of the tent sheet"},
    {"id": "reveal",  "start": 160, "end": 240, "note": "crane to overhead, tent opens, unfold + flip"},
    {"id": "fox",     "start": 240, "end": 400, "note": "fox folded on the beat, pops alive, unfold + flip"},
    {"id": "flurry",  "start": 400, "end": 480, "note": "swan in seven half-beat folds"},
    {"id": "lake",    "start": 480, "end": 560, "note": "swan lifts, glides into the lake, moonrise"},
    {"id": "foxpath", "start": 560, "end": 640, "note": "fox lights the lanterns on the path"},
    {"id": "canyon",  "start": 640, "end": 720, "note": "paper plane carries the letter, lighthouse"},
    {"id": "shelf",   "start": 720, "end": 800, "note": "six models on the desk"},
    {"id": "release", "start": 800, "end": 880, "note": "lanterns rise over the lake"},
    {"id": "end",     "start": 880, "end": 960, "note": "end card"},
]

folds = []


def fold(model, step, pinch, pull_start, snap, hand=True, kind="fold"):
    folds.append({"model": model, "step": step, "pinch": pinch, "pullStart": pull_start,
                  "snap": snap, "hand": hand, "kind": kind})


# Hook: one slow, luxurious fold. Pinch on beat 2, crease on beat 6.
fold("tent", 0, 40, 46, 120)

# Fox: one fold per beat, crease ON the beat. Step 5 is the turn-over.
FOX_KINDS = ["fold", "fold", "fold", "fold", "fold", "flip"]
for i in range(6):
    snap = 260 + i * BEAT
    fold("fox", i, snap - 11, snap - 10, snap, True, FOX_KINDS[i])

# Swan flurry: seven folds, one per half-beat; the hand steps back.
SWAN_KINDS = ["fold", "fold", "flip", "fold", "fold", "fold", "fold"]
for i in range(7):
    snap = 410 + i * (BEAT // 2)
    fold("swan", i, snap - 9, snap - 8, snap, False, SWAN_KINDS[i])

# Transitions made of content: the finished model unfolds to a flat square
# and turns over, revealing the next sheet's paper.
morphs = [
    {"from": "tent", "to": "fox", "unfold": [212, 228], "flip": [226, 240]},
    {"from": "fox", "to": "swan", "unfold": [380, 392], "flip": [390, 400]},
]

# Life moments.
life = [
    {"model": "tent", "open": [150, 196]},
    {"model": "fox", "open": [362, 378]},
    {"model": "swan", "open": [480, 508], "glide": [500, 546], "land": 546},
]

type_cards = [
    {"text": "Fold real paper.", "in": 126, "out": 200, "where": "crease"},
    {"text": "with your hands.", "in": 168, "out": 236, "where": "low"},
    {"text": "Every fold comes alive.", "in": 500, "out": 556, "where": "low"},
    {"text": "Six chapters.", "in": 730, "out": 796, "where": "low"},
    {"text": "A new sheet every day.", "in": 808, "out": 872, "where": "sky"},
]

# Act timing for the diorama shots (seconds of act time per film second).
acts = {
    "foxpath": {"start": 560, "speed": 1.35, "offset": 0.0, "hopT": 0.55},
    "canyon": {"start": 640, "speed": 1.3, "offset": 2.0, "dur": 4.5},
}

# Lantern progress on the lake: one more chapter lit at each payoff.
progress = [[0, 0.0], [120, 1 / 6], [360, 2 / 6], [470, 3 / 6], [546, 4 / 6], [600, 5 / 6], [700, 1.0]]

release_frame = 806      # all lanterns lift
wipe = [862, 892]        # lantern fills the frame and opens onto the end card

# Derived audio-facing events.
events = []
for f in folds:
    events.append({"type": "pinch", "frame": f["pinch"], "hand": f["hand"]})
    events.append({"type": "pull", "frame": f["pullStart"], "end": f["snap"], "kind": f["kind"]})
    events.append({"type": "snap", "frame": f["snap"], "kind": f["kind"], "model": f["model"]})
for m in morphs:
    events.append({"type": "unfold", "frame": m["unfold"][0], "end": m["unfold"][1]})
    events.append({"type": "turn", "frame": m["flip"][0], "end": m["flip"][1]})
for l in life:
    events.append({"type": "shimmer", "frame": l["open"][0], "end": l["open"][1]})
events.append({"type": "glide", "frame": 500, "end": 546})
events.append({"type": "splash", "frame": 546})
events.append({"type": "moonrise", "frame": 540})
fp = acts["foxpath"]
hop = fp["hopT"] / fp["speed"] * FPS
for i in range(6):
    events.append({"type": "hop", "frame": round(fp["start"] + hop * i), "i": i})
for i in range(3):
    events.append({"type": "lantern", "frame": round(fp["start"] + hop * (1 + 2 * i)), "i": i})
cy = acts["canyon"]
events.append({"type": "flight", "frame": 640, "end": 712})
events.append({"type": "beam", "frame": round(cy["start"] + (cy["dur"] - cy["offset"]) / cy["speed"] * FPS)})
for i in range(6):
    events.append({"type": "keepsake", "frame": 726 + i * 11, "i": i})
events.append({"type": "release", "frame": release_frame})
events.append({"type": "wipe", "frame": wipe[0], "end": wipe[1]})
events.append({"type": "endchord", "frame": 880})
events.sort(key=lambda e: e["frame"])

out = {
    "fps": FPS, "bpm": BPM, "beatFrames": BEAT, "barFrames": BAR, "totalFrames": TOTAL,
    "width": 1920, "height": 1080,
    "beats": list(range(0, TOTAL + 1, BEAT)),
    "downbeats": list(range(0, TOTAL + 1, BAR)),
    "scenes": scenes, "folds": folds, "morphs": morphs, "life": life,
    "type": type_cards, "acts": acts, "progress": progress,
    "release": release_frame, "wipe": wipe, "events": events,
    "cutsOnBeat": [s["start"] for s in scenes],
}
here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(here, "docs"), exist_ok=True)
os.makedirs(os.path.join(here, "public"), exist_ok=True)
for p in (os.path.join(here, "docs", "timing.json"), os.path.join(here, "public", "timing.json")):
    with open(p, "w") as fh:
        json.dump(out, fh, indent=1)
offbeat = [s["start"] for s in scenes if s["start"] % BEAT]
snaps_off = [f["snap"] for f in folds if f["snap"] % (BEAT // 2)]
print(f"{len(events)} events, {len(folds)} folds; scene cuts off-beat: {offbeat}; snaps off half-beat: {snaps_off}")
