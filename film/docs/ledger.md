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
| 8 | **Paper is the hero**: score ducks 8 dB under every fold, ostinato never plucks on a pull, snap is a high paper knock + mid body (no sub kick) | Sound critic: pad masked the foley by 4–12 dB and the snap was 91% sub-200 Hz | Constant music bed; kick-drum snap |
| 9 | **Koto note per crease climbing the pentatonic scale** | The music is played *by* the folding: progress is audible | Fixed melody unrelated to action |
| 10 | **Meta shown as a platform line + SDK credit, no logo** | Meta requires Brand Review approval for any logo use; "for Meta Quest" is the phrasing its guidelines allow | Redrawing the logo; "Made for … Meta VR Glasses" (unreleased device, reads as certification) |
| 11 | **Captions tightened by fact-check**: "Fold paper / with your hands.", "Every model comes alive." | "Fold real paper" could read as physical paper in MR; animation is per model, not per crease | Original wording |
| 12 | **Warm key light + tilt-shift** | The game's night palette read cold in macro; miniature focus makes the desk feel tiny and handmade | Neutral light (lavender paper) |
| 13 | **Captions placed low or in the sky, never over a model** | Fixes from the style frames: the lake line sat on the moon | Centred captions |
| 14 | **End on a lantern light-wipe into the washi card** | The game's reward (lanterns) becomes the transition into the sign-off | Fade to black |
| 15 | **H.264 CRF 16, preset slow; audio -16 LUFS, ≤ -1 dBTP after AAC** | At -14 the limiter took 5–14 dB off the snaps; -16 with a rebuilt snap keeps ASMR transients (limiter takes ≤ 3 dB off any crease, measured). Platforms turn louder files down, not quieter ones up much, so -16 costs little | -14 LUFS with heavy limiting |
| 16 | **Crinkle = resonant pings + noise, panned with the flap; mono-safe panning; decorrelated room** | Sound critic: crinkle read as static, small ITDs comb-filtered in mono | White-noise grains, fixed pan |
| 17 | **Short capped wrist** for the hand | A long forearm rose toward the overhead lens and hid the fox; tracked hands stop at the wrist anyway | Long forearm; open tube |
