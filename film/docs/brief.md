# FOLD — film brief

| Line | Choice | Why |
|---|---|---|
| mode | product (with a launch-story arc) | The game is the hero; its own engine renders every shot. |
| subject | FOLD, a hands-first origami game for Meta Quest and Meta VR Glasses | User request. |
| viewer | Meta VR Start Competition judges and players scrolling Devpost / socials | They care about hands-first craft, delight, and "can I try it now". |
| end state | Feel the satisfaction of a crease; know it is FOLD, hands-first, for Meta Quest & Meta VR Glasses; go to the URL | The last second shows name, platforms, URL. |
| length | 32 s, 16:9, 1920×1080 | Fits the top of a <3 min demo video or a social post; 12 bars at 90 bpm. |
| frame rate | 30 fps | Paper folds read smoothly; one beat = exactly 20 frames at 90 bpm. |
| brand | Derived from the product: dusk navy, ember orange, washi cream, lantern gold; Fraunces + Inter | Matches the game and landing page. |
| facts | docs/facts.json (competition text + the game itself) | Only claims on screen. |
| assets | Captured from the live product: the real fold engine, paper textures, dioramas and environment are imported and rendered, not imitated | "Rebuild as live components". |
| style | Close, tactile, ASMR: macro paper, raking lantern light, crisp folds | User asked for ASMR, not generic motion design. |
| sound | music + sfx, synthesised in code (paper crinkle grains, crease snaps, koto, pad) | ASMR detail with full control; no licensed audio. |
| autonomy | unattended | The user asked for a finished film. |
| toolchain | Three.js page (Vite) driven frame by frame by Playwright, encoded with ffmpeg | Reuses the game's own renderer and engine. |
| sign-off | FOLD · "a little paper world, folded by hand" · Made for Meta Quest & Meta VR Glasses · fold-blond.vercel.app | Name, platform, call to action. |

## Meta brand note
The official Meta logo is not redrawn (logos must come from the source file). The end card sets
"Made for Meta Quest & Meta VR Glasses" in type and reserves a slot: drop Meta's official SVG at
`film/public/meta-logo.svg` and re-render to place it. Check Meta's brand guidelines before using the mark.
