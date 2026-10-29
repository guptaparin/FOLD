# FOLD film — decision ledger

| # | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 1 | **Product mode, 32 s, 16:9, 30 fps** | A Devpost/YouTube teaser; long enough for three folds and four worlds, short enough to watch twice | 60 s (sags in the middle); 9:16 (judges watch on desktop) |
| 2 | **Direction "One sheet"**: a single sheet keeps turning into the next model | Each transition is made of content (unfold → turn over → new paper), not a generic wipe | "Desk to world" (more cuts, less paper); "Lantern count" (too abstract) |
| 3 | **All picture rendered from the real game code** (fold engine, papers, dioramas) | Everything shown is real gameplay: no shot promises something the game can't do | After Effects mock-ups; screen capture of the emulator (cursor, UI chrome) |
| 4 | **Deterministic frame-by-frame render** (seeded random, `film.frame(n)`) | Exact sync: every crease lands on its frame; re-renders are identical | Real-time screen capture (dropped frames, drift) |
| 5 | **90 bpm, 1 beat = 20 frames** | Integer frames per beat at 30 fps makes every cut and crease exactly on the grid | 96/100 bpm (fractional frames) |
| 6 | **Sound: ASMR paper first, music second** | The brief asked for ASMR, not generic stock music: paper crackle follows fold speed, each crease snaps, turn-overs flutter | Licensed track (generic, rights) |
| 7 | **All audio synthesised** (Karplus–Strong koto, pad, granular paper) | No licensing; every sound is placed by `timing.json` events | Sample packs |
| 8 | **Snaps 14–20 dB above music** | Paper is the hero; music is the room | Equal balance (paper got lost) |
| 9 | **Koto note per crease climbing the pentatonic scale** | The music is played *by* the folding: progress is audible | Fixed melody unrelated to action |
| 10 | **Meta shown as the platform line, not a redrawn logo** | Meta's marks must come from Meta's official brand assets and follow its guidelines; a hand-drawn imitation would misuse the mark | Drawing the infinity logo by hand |
| 11 | **Official-logo slot** `film/public/meta-logo.svg` | Drop in the official file and re-render the end card only; the layout already reserves its space | — |
| 12 | **Warm key light + tilt-shift** | The game's night palette read cold in macro; miniature focus makes the desk feel tiny and handmade | Neutral light (lavender paper) |
| 13 | **Captions placed low or in the sky, never over a model** | Fixes from the style frames: the lake line sat on the moon | Centred captions |
| 14 | **End on a lantern light-wipe into the washi card** | The game's reward (lanterns) becomes the transition into the sign-off | Fade to black |
| 15 | **H.264 CRF 16, preset slow, -14 LUFS / ≤ -1 dBTP** | Upload targets (YouTube/Devpost) normalise to -14; slow preset chosen for final quality | veryfast (fine for drafts only) |
