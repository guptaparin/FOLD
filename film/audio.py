"""
FOLD film score and sound design, synthesised from docs/timing.json.

Two buses:
  music  — koto (Karplus-Strong), pad, soft pulse, room tone. Sits low.
  sfx    — close-miked paper ASMR: touch ticks, crinkle grains that follow the
           speed of each fold, crease snaps, flips, sparkles, lanterns.
Output (48 kHz, 24-bit): audio/mix_raw.wav, audio/music_raw.wav, audio/sfx_raw.wav.
Loudness is normalised afterwards with ffmpeg (two-pass loudnorm).
"""
import json
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, "docs", "timing.json")))
FPS = T["fps"]
DUR = T["totalFrames"] / FPS
N = int(DUR * SR)
rng = np.random.default_rng(20261029)

music = np.zeros((2, N))
sfx = np.zeros((2, N))


def fs(frame):
    """Frame number to sample index."""
    return int(round(frame / FPS * SR))


def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, hi], btype="bandpass", fs=SR, output="sos")
    return sosfilt(sos, x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, btype="highpass", fs=SR, output="sos"), x)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, btype="lowpass", fs=SR, output="sos"), x)


def place(bus, sig, start, pan=0.0, gain=1.0):
    """Mix a mono signal in with constant-power pan and a tiny interaural delay."""
    if start >= N:
        return
    th = (pan + 1) * np.pi / 4
    gl, gr = np.cos(th), np.sin(th)
    # Interaural delay only for wide pans: small delays comb-filter in mono
    # (phone speakers) and kill the crinkle's top end.
    itd = int(abs(pan) * 0.00045 * SR) if abs(pan) >= 0.5 else 0
    for ch, g, d in ((0, gl, itd if pan > 0 else 0), (1, gr, itd if pan < 0 else 0)):
        s = start + d
        if s >= N:
            continue
        n = min(len(sig), N - s)
        if s < 0:
            continue
        bus[ch, s:s + n] += sig[:n] * g * gain


def env_ad(n, a, d_curve=4.0):
    t = np.linspace(0, 1, n)
    att = max(1, int(a * n))
    e = np.ones(n)
    e[:att] = np.linspace(0, 1, att)
    e[att:] = np.exp(-d_curve * np.linspace(0, 1, n - att))
    return e


def noise(n):
    return rng.standard_normal(n)


# ---------------------------------------------------------------------------
# Instruments

def koto(freq, dur=2.4, bright=0.55):
    """Karplus-Strong pluck with a soft body resonance."""
    n = int(dur * SR)
    # Loop length minus the averaging filter's half-sample delay; the
    # fraction is made up by a first-order allpass so high notes stay in tune.
    pf = SR / freq - 0.5
    p = max(2, int(pf))
    frac = pf - p
    C = (1 - frac) / (1 + frac)
    buf = rng.uniform(-1, 1, p)
    buf = lp(buf, 2000 + 5000 * bright, 1)
    out = np.zeros(n)
    idx = 0
    damp = 0.996
    prev = 0.0
    ax = 0.0
    ay = 0.0
    b = buf.copy()
    for i in range(n):
        cur = b[idx]
        nxt = b[(idx + 1) % p]
        v = damp * 0.5 * (cur + nxt)
        y = C * v + ax - C * ay
        ax, ay = v, y
        b[idx] = y
        out[i] = cur * 0.65 + prev * 0.35
        prev = cur
        idx = (idx + 1) % p
    out = bp(out, 90, 7000, 1) * env_ad(n, 0.002, 2.2)
    return out


def sine(freq, dur, a=0.3, decay=2.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * env_ad(n, a, decay)


def bell(freq, dur=1.6):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.76 * t)
         + 0.18 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-6 * t))
    return s * env_ad(n, 0.002, 5.0)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# D major pentatonic, rooted on D3 = 50.
PENTA = [0, 2, 4, 7, 9]


def penta(i, root=62):
    return root + PENTA[i % 5] + 12 * (i // 5)


# ---------------------------------------------------------------------------
# Paper sound design

def touch(gain=1.0):
    """Fingertip meeting paper: a tiny dry tick with a soft skin thump."""
    n = int(0.03 * SR)
    tick = hp(noise(n), 3500) * env_ad(n, 0.01, 40)
    body = lp(noise(n), 700) * env_ad(n, 0.05, 18) * 0.6
    return (tick * 0.5 + body) * gain


def crinkle(dur, speed_curve, density=1400.0, bright=1.0):
    """
    Granular paper crinkle. Grain rate follows the fold speed curve, so the
    sound is busiest exactly where the flap moves fastest.
    """
    n = int(dur * SR)
    out = np.zeros(n)
    t = np.linspace(0, 1, n)
    rate = np.interp(t, np.linspace(0, 1, len(speed_curve)), speed_curve)
    # Expected grains: integrate rate.
    p = rate * density / SR
    hits = np.nonzero(rng.random(n) < p)[0]
    for h in hits:
        g = int(rng.uniform(0.0004, 0.004) * SR)
        if h + g >= n:
            continue
        dec = np.exp(-np.linspace(0, rng.uniform(3, 9), g))
        # Paper crackle is many tiny resonant buckles, not white noise: blend a
        # short ringing ping with the noise grain.
        ping = np.sin(2 * np.pi * rng.uniform(1800, 6500) * np.arange(g) / SR + rng.uniform(0, 6.28))
        grain = (0.6 * ping + 0.4 * noise(g)) * dec
        out[h:h + g] += grain * rng.uniform(0.15, 1.0) ** 1.6
    crack = bp(out, 1400 * bright, min(9000, 7000 * bright), 3)
    # Low "sheet bending" body under the grains, slowly breathing.
    wob = 0.6 + 0.4 * np.sin(np.linspace(0, 9 * np.pi, n) + rng.uniform(0, 6)) ** 2
    body = bp(noise(n), 300, 900, 2) * rate ** 1.5 * wob * 0.1
    return crack * 1.0 + body


def snap(gain=1.0, tone=1.0):
    """
    A crease pressed flat: crisp transient, a fingernail 'zip' along the fold,
    and a soft low thump of paper against the mat.
    """
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    click = hp(noise(n), 4200, 4) * np.exp(-t * 900)
    # Zip: band sweeping up quickly.
    zn = int(0.07 * SR)
    z = noise(zn)
    zip_ = np.zeros(zn)
    for k, (lo, hi) in enumerate([(2500, 4500), (3500, 6500), (5000, 9000), (6500, 12000)]):
        seg = slice(k * zn // 4, (k + 1) * zn // 4)
        zip_[seg] = bp(z, lo, hi, 2)[seg]
    zip_ *= env_ad(zn, 0.1, 3) * 0.55
    # Paper on the mat: a short, high knock (not a sub kick) plus a 30 ms
    # mid "paper body" burst, so the crease reads as paper, not drum.
    thump = np.sin(2 * np.pi * (170 * tone) * t * (1 - 0.35 * t)) * np.exp(-t * 60) * 0.2
    bn = int(0.03 * SR)
    body = bp(noise(bn), 1200, 3000, 2) * env_ad(bn, 0.04, 6) * 0.4
    out = click * 1.3 + thump
    out[:zn] += zip_
    out[:bn] += body
    return out * gain


def whoosh(dur, lo=300, hi=2600, flutter=0.0, gain=1.0):
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    x = noise(n)
    # Moving band: split in chunks for a cheap sweep.
    out = np.zeros(n)
    chunks = 12
    for k in range(chunks):
        a, b = k * n // chunks, (k + 1) * n // chunks
        c = lo * (hi / lo) ** np.sin(np.pi * (k + 0.5) / chunks)
        out[a:b] = bp(x, c * 0.6, min(c * 1.7, 20000), 2)[a:b]
    e = np.sin(np.pi * t) ** 1.5
    if flutter:
        e *= 0.65 + 0.35 * np.sin(2 * np.pi * flutter * t * dur) ** 2
    return lp(out, 9000, 1) * e * gain


def sparkle(count=6, base=86, spread=0.32):
    n = int((spread + 1.4) * SR)
    out = np.zeros(n)
    for i in range(count):
        s = bell(midi(base + PENTA[(i * 2) % 5] + 12 * (i % 2)), 1.2) * 0.2
        st = int(i * spread / count * SR)
        out[st:st + len(s)] += s[: n - st]
    return out


def plip():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 1500 * np.exp(-t * 10) + 650
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ad(n, 0.02, 9) * 0.5


def hum(dur, f=110):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 1.5 * t) + 0.25 * np.sin(2 * np.pi * f * 3 * t)
    return lp(s, 900) * np.sin(np.pi * np.linspace(0, 1, n)) ** 2


# ---------------------------------------------------------------------------
# Music bus

beat = T["beatFrames"]
bar = T["barFrames"]
# Chords per bar (I vi IV V ...) in D: semitone offsets from D3 (50).
prog = [[0, 7, 16], [0, 7, 16], [9, 16, 21], [5, 12, 21], [7, 14, 23], [0, 7, 16],
        [9, 16, 21], [5, 12, 19], [7, 14, 23], [0, 7, 16], [5, 12, 21], [0, 7, 16, 19]]
def tri(f, t):
    return 2 / np.pi * np.arcsin(np.sin(2 * np.pi * f * t))


b = 0
while b < len(prog):
    chord = prog[b]
    run = 1
    while b + run < len(prog) and prog[b + run] == chord:
        run += 1  # hold repeated chords instead of re-attacking them
    start = fs(b * bar)
    length = run * 80 / FPS + 1.2
    level = 0.015 if b < 3 else 0.04
    n = int(length * SR)
    t = np.arange(n) / SR
    e = np.minimum(1, t / 0.9) * np.exp(-np.maximum(0, t - (length - 1.2)) * 2.0)
    for k, st in enumerate(chord):
        f = midi(50 + st)
        tone = (tri(f * 0.997, t) + tri(f * 1.003, t)) * 0.5
        place(music, hp(lp(tone * e, 1200, 2), 180) * level, start, pan=(k - 1) * 0.35)
    b += run

# Octave bloom for the release (bar 10): the arc lands on the lanterns.
n = int((80 / FPS + 2.0) * SR)
t = np.arange(n) / SR
bloom = sum(tri(midi(m) * d, t) for m in (74, 78, 81) for d in (0.997, 1.003))
bloom = lp(bloom, 2400, 2) * np.sin(np.pi * np.minimum(1, t / (n / SR))) ** 1.5 * 0.018
place(music, bloom, fs(10 * bar - 40), pan=0.0)

# Koto ostinato: from bar 1, a gentle figure on the off-beats.
figure = [4, 2, 3, 1]
for b in range(1, 11):
    for k in range(4):
        fr = b * bar + k * beat + beat // 2
        if b in (4, 5) and k % 2 == 0:  # thin out under the flurry
            continue
        if any(abs(fr - f["pullStart"]) < 4 for f in T["folds"]):
            continue  # never pluck on top of a pull: the paper speaks first
        note = penta(figure[(b + k) % 4], 62)
        place(music, koto(midi(note), 1.6, 0.4) * 0.12, fs(fr), pan=0.25 if k % 2 else -0.25)

# Soft pulse on downbeats once the rhythm starts (bars 3–10): felt, not heard.
for b in range(3, 11):
    if b == 9:
        continue
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    k = np.sin(2 * np.pi * 52 * t * (1 - 0.3 * t)) * np.exp(-t * 9)
    place(music, k * 0.07, fs(b * bar))

# Room tone: brown noise, very low, the "close microphone" air.
brown = np.cumsum(noise(N))
brown = hp(brown - np.mean(brown), 40)
brown /= np.max(np.abs(brown)) + 1e-9
air = lp(brown, 900) * 0.012
music[0] += air
music[1] += np.roll(air, 37)

# ---------------------------------------------------------------------------
# SFX bus, event by event

snap_count = 0
for e in T["events"]:
    fr = e["frame"]
    k = e["type"]
    if k == "pinch":
        place(sfx, touch(0.9 if e["hand"] else 0.4), fs(fr), pan=0.25)
    elif k == "pull":
        dur = (e["end"] - fr) / FPS
        steps = 24
        # Speed curve of an ease-in-out fold: slow, fast, slow.
        x = np.linspace(0, 1, steps)
        curve = np.sin(np.pi * x) ** 1.2 + 0.08
        if e["kind"] == "flip":
            place(sfx, whoosh(dur + 0.05, 260, 1800, flutter=14, gain=0.55), fs(fr), pan=0.1)
            curve *= 0.5
        # Sparse, articulated crackles (ASMR), not a wash of noise.
        cr = crinkle(dur, curve, density=380 if dur > 1 else 620) * 0.75
        # The crinkle travels with the flap: eight overlapping segments swept across.
        side = (snap_count % 2) * 2 - 1
        segs = 8
        L = len(cr)
        for si in range(segs):
            a0, a1 = si * L // segs, min(L, (si + 1) * L // segs + 240)
            w = np.ones(a1 - a0)
            r = min(240, len(w) // 2)
            w[:r] = np.linspace(0, 1, r)
            w[-r:] = np.linspace(1, 0, r)
            place(sfx, cr[a0:a1] * w, fs(fr) + a0, pan=side * (-0.3 + 0.6 * si / (segs - 1)))
    elif k == "snap":
        big = e["model"] == "tent"
        g = 1.35 if big else (0.75 if e["model"] == "fox" else 0.6)
        if e["kind"] == "flip":
            place(sfx, snap(0.45, 0.8), fs(fr), pan=0.0)
        else:
            place(sfx, snap(g, 1.0 if big else 1.15), fs(fr), pan=0.2 * ((snap_count % 2) * 2 - 1))
        # A reward pluck that climbs with every crease (musical, but a real event).
        note = penta(3 + snap_count % 7, 62) if not big else 74
        place(sfx, koto(midi(note), 1.4, 0.7) * (0.22 if big else 0.14), fs(fr), pan=0.1)
        snap_count += 1
    elif k == "unfold":
        dur = (e["end"] - fr) / FPS
        place(sfx, crinkle(dur, np.array([0.3, 1, 1, 0.8, 0.4]), density=900, bright=1.0) * 0.6, fs(fr), pan=-0.1)
        place(sfx, whoosh(dur, 500, 3000, gain=0.25), fs(fr))
    elif k == "turn":
        dur = (e["end"] - fr) / FPS
        place(sfx, whoosh(dur + 0.1, 220, 1600, flutter=18, gain=0.7), fs(fr))
        place(sfx, touch(0.5), fs(e["end"]), pan=0.0)
    elif k == "shimmer":
        place(sfx, sparkle(6, 86, 0.5) * 0.5, fs(fr), pan=0.0)
    elif k == "glide":
        place(sfx, whoosh((e["end"] - fr) / FPS, 200, 1200, gain=0.3), fs(fr), pan=-0.2)
    elif k == "splash":
        place(sfx, plip(), fs(fr), pan=-0.15)
    elif k == "moonrise":
        n = int(3.6 * SR)
        t = np.arange(n) / SR
        swell = sum(np.sin(2 * np.pi * midi(62 + s) * t) for s in (0, 7, 12, 16, 19))
        swell = lp(swell, 2400) * np.sin(np.pi * np.minimum(1, t / 3.6)) ** 2 * 0.05
        place(music, swell, fs(fr))
    elif k == "hop":
        n = int(0.05 * SR)
        tap = lp(noise(n), 1600) * env_ad(n, 0.05, 20) * 0.35
        place(sfx, tap, fs(fr), pan=-0.4 + 0.16 * e["i"])
        place(sfx, koto(midi(penta(4 + e["i"], 62)), 1.0, 0.5) * 0.1, fs(fr), pan=-0.4 + 0.16 * e["i"])
    elif k == "lantern":
        place(sfx, bell(midi(86 + PENTA[e["i"] * 2 % 5]), 1.6) * 0.18, fs(fr), pan=-0.3 + 0.3 * e["i"])
        n = int(0.3 * SR)
        place(sfx, lp(noise(n), 400) * env_ad(n, 0.3, 6) * 0.25, fs(fr), pan=-0.3 + 0.3 * e["i"])
    elif k == "flight":
        place(sfx, touch(0.6), fs(fr), pan=-0.5)
        place(sfx, whoosh((e["end"] - fr) / FPS, 250, 2200, gain=0.3), fs(fr), pan=-0.5)
    elif k == "beam":
        place(sfx, hum(1.4, 98) * 0.12, fs(fr), pan=0.35)
        place(sfx, bell(midi(93), 1.4) * 0.12, fs(fr), pan=0.35)
    elif k == "keepsake":
        n = int(0.04 * SR)
        place(sfx, bp(noise(n), 700, 3000) * env_ad(n, 0.02, 25) * 0.3, fs(fr), pan=-0.6 + 0.24 * e["i"])
        place(sfx, koto(midi(penta(2 + e["i"], 62)), 1.2, 0.5) * 0.09, fs(fr), pan=-0.6 + 0.24 * e["i"])
    elif k == "release":
        for i in range(9):
            place(sfx, bell(midi(81 + PENTA[i % 5] + 12 * (i // 5)), 2.0) * 0.12, fs(fr + i * 6), pan=np.sin(i * 1.7) * 0.6)
        place(sfx, whoosh(2.4, 150, 900, gain=0.2), fs(fr))
    elif k == "wipe":
        place(sfx, whoosh((e["end"] - fr) / FPS + 0.2, 300, 2400, gain=0.4), fs(fr))
    elif k == "endchord":
        for i, m in enumerate([50, 57, 62, 66, 69, 74]):
            place(sfx, koto(midi(m), 3.0, 0.6) * 0.16, fs(fr) + int(i * 0.035 * SR), pan=-0.4 + 0.16 * i)
        place(sfx, bell(midi(86), 2.6) * 0.08, fs(fr + 4))

# ---------------------------------------------------------------------------
# Space: a small, warm room (generated impulse response), more on music.


def room(seconds, decay, tone):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = noise(n) * np.exp(-t * decay)
    ir = lp(ir, tone, 1)
    ir[0] = 1.0
    return ir / np.sum(np.abs(ir)) * 40


irs_m = (room(2.6, 2.4, 5000), room(2.6, 2.4, 5000))
irs_s = (room(0.9, 7.0, 7000), room(0.9, 7.0, 7000))
for bus, irs, wet in ((music, irs_m, 0.35), (sfx, irs_s, 0.18)):
    for ch in range(2):
        w = fftconvolve(bus[ch], irs[ch])[:N]
        bus[ch] = bus[ch] * (1 - wet) + w * wet * 0.5

# Gentle fades so the first and last samples are clean.
fade_in = int(0.02 * SR)
fade_out = int(1.5 * SR)
for bus in (music, sfx):
    bus[:, :fade_in] *= np.linspace(0, 1, fade_in)
    bus[:, -fade_out:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fade_out))

# Duck the score 8 dB under every fold (pull to just after the crease).
duck = np.ones(N)
ramp = int(0.03 * SR)
for f in T["folds"]:
    a, b2 = fs(f["pullStart"] - 3), min(N, fs(f["snap"] + 6))
    duck[a:b2] = np.minimum(duck[a:b2], 10 ** (-8 / 20))
duck = np.convolve(duck, np.ones(ramp) / ramp, mode="same")
music *= duck
music *= 1.5  # sits ~7 LU under the paper sounds
mix = music + sfx


SCALE = 0.7 / (np.max(np.abs(mix)) + 1e-9)


def write(name, x):
    # One shared scale, so the three files keep their true balance.
    y = np.clip(x * SCALE, -1, 1)
    wavfile.write(os.path.join(HERE, "audio", name), SR, (y.T * (2 ** 31 - 1)).astype(np.int32))


os.makedirs(os.path.join(HERE, "audio"), exist_ok=True)
write("mix_raw.wav", mix)
write("music_raw.wav", music)
write("sfx_raw.wav", sfx)
print("wrote", round(DUR, 2), "s;", snap_count, "creases")
