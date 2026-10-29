# What a human should check before posting

1. **Listen once on headphones and once on a phone speaker.** All the measurements pass: −16 LUFS, ≤ −1 dBTP after AAC, every crease within 1 ms of its frame, and nothing collapses in mono. Measurements can't judge taste, though. Check that the paper crinkle feels pleasant rather than scratchy, and that the snaps aren't too sharp at your volume.
2. **The Meta line.** The end card says "For Meta Quest · Built with Meta's Immersive Web SDK". This follows Meta's third-party phrasing guidance ("for Meta Quest"). The film deliberately uses **no Meta logo**: Meta requires Brand Review approval for any use of its logo. Don't add one unless Meta approves it.
3. **The Meta VR Glasses aren't named.** They haven't shipped, so FOLD hasn't been tested on them. Once you've tested on real hardware, you can add "and Meta VR Glasses" in `film/index.html` and re-render frames 880–959.
4. **This is a teaser, not the required demo.** Devpost asks for footage of the project "as viewed on a Meta VR device" (emulator capture is accepted). The teaser's hand is a stylised render driven by the real fold engine. Submit your autopilot or emulator recording as the main video, and use this film as the trailer or thumbnail video and for social posts.
5. **Watch the hook (0–5 s) at full size.** Check that the first fold feels slow and luxurious, not sluggish. To make it snappier, change `fold("tent", 0, 40, 46, 120)` in `film/timing.py`. Change the `snap` frame in steps of 10 so it stays on the beat.
6. **Captions.** All five lines are backed by code (see `docs/facts.json`). If you change a word, check it against the game.

## Re-render recipe
```
cd fold && npm install && npx vite --config film/vite.config.ts &      # film page on :5199
python3 film/timing.py && python3 film/audio.py && bash film/master.sh  # timing + sound
python3 film/tools/render.py OUT 0 960                                  # frames (~5 s each on CPU)
bash film/tools/encode.sh OUT DELIVERY                                  # MP4 + music-only
python3 film/tools/qa.py OUT DELIVERY/FOLD-film-16x9.mp4                # quality bar
```
