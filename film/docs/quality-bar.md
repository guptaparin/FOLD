# Quality bar — measured results

| Check | Target | Result | Pass |
|---|---|---|---|
| Duration | 32 s | 32.0 s, 960 frames | ✅ |
| Size / fps | 1920×1080, 30 fps | 1920×1080, 30/1 | ✅ |
| Frame one finished | a designed image, not a fade-in | Patterned sheet, pinch target, warm key (f0000) | ✅ |
| Frozen stretches | none > 0.5 s | longest still run 6 frames (0.20 s) | ✅ |
| Cuts on the beat | every scene start on a 20-frame beat | True | ✅ |
| Creases on the grid | every snap on a half-beat | True | ✅ |
| Picture/sound sync | ≤ 1 frame | every crease snap within 0.96 frame (sfx bus onset vs snap frame) | ✅ |
| Loudness (delivered AAC) | streaming-safe, ASMR dynamics | -16.1 LUFS integrated (−16 chosen to keep transients) | ✅ |
| True peak (delivered AAC) | ≤ −1 dBTP | -1.6 dBFS | ✅ |
| Snap limiting | ≤ 3 dB taken off any crease | ≤ 2.9 dB | ✅ |
| Mono compatibility | no comb filtering | ≤ 0.1 dB dip at 4–8 kHz in mono | ✅ |
| Caption hold | ≥ 1.8 s each, never over a model or the moon | 1.9–2.7 s; placed over mat/sky (verified by critics) | ✅ |
| Claims | every on-screen claim sourced | docs/facts.json cites code lines | ✅ |
| Brand | Meta referenced correctly, no unapproved logo | "For Meta Quest · Built with Meta’s Immersive Web SDK" | ✅ |

## Critic loop (fresh subagents)
1. Fact-check → 4 wording fixes (captions, platform line, no logo). Applied.
2. Sound critic → 6 issues (snap = sine kick, pad masking, static crinkle, mono combing, koto tuning, flat arc). Applied.
3. Sound re-check → 4/6 pass, 7 follow-ups (koto sharp, snap too thin, duck pumping…). Applied; re-measured.
4. Director review → 2 blockers (edge-on flip frames, stray frames before 720) + 6 should-fix. Applied.
5. Director re-review → blockers fixed; 2 should-fix (caption hold, swan headroom) + hand pop + framing. Applied.
6. Final sign-off → see delivery note.
