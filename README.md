# FOLD

**A little paper world, folded by hand.** A hands-first origami game for Meta Quest
and Meta VR Glasses, built with the Immersive Web SDK (WebXR).

Pinch a corner, pull it around the crease, let go to press it flat. Every model you
fold lifts off the mat, relaxes into shape and walks into a paper-theatre diorama to
fix something in the world: a shelter for a firefly, a boat for a lantern, a cup for
a wilted moon flower. Six chapters, a Daily Fold with a new sheet every day, and a
desk shelf of everything you've made.

Entry for the Meta VR Start Developer Competition 2026 — Gaming track, New Experience.

## Play

| Where | How |
| --- | --- |
| Meta Quest / Meta VR Glasses | Open the URL in Meta Quest Browser → **Enter VR**. Hands only; no controllers needed |
| Any desktop browser | **Play in browser**, then click and drag the glowing dot to fold |
| Controllers | Trigger or grip works as a pinch, with a haptic tick on each crease |
| Mixed reality | On Quest 3 / 3S, **Fold on your real desk (MR)** drops the sky and the desk and puts the paper world in your room via passthrough |
| Installed app | As a PWA / Store app it enters VR straight from the app icon |

Hands-only touches: run a fingertip along a fresh crease to sharpen it; poke paper tags to
press them; on Meta VR Glasses, gaze + pinch uses the real eye-tracked ray.

Settings on the desk: Easy folds (lower snap point), Gaze + pinch, Bold guides, Sound, Recenter.

## Run it locally

```sh
npm install
npm run dev        # dev server + Immersive Web Emulator (IWER) on https://localhost:8081
npm run build      # production build into dist/
npm run preview    # serve dist/ locally
```

Requires Node 20.19+ (or 22.12+). To try it on a headset during development, open the
`network` URL printed by `npx @iwsdk/cli dev status` on a Quest on the same Wi-Fi and
accept the local certificate warning.

## Deploy (Vercel)

1. Push this folder to a GitHub repository.
2. In Vercel: **Add New → Project**, import the repo. Framework preset **Vite**,
   build command `npm run build`, output directory `dist`.
3. Deploy. The HTTPS URL is the playable build you submit. (`base: './'` means any host
   that serves HTTPS works, including GitHub Pages.)

## Recording the demo video

With `npm run dev` running, open the app in Chrome, open DevTools and run:

```js
fold.autopilot([0, 2, 4, 5]) // chapters to fold, 0-based
```

It enters VR in the emulator, switches to hand tracking and folds each chapter with an
emulated hand in real time — reach, pinch, pull, release. Screen-record the window.

## How it's built

```
src/
  index.ts            landing page first (21 KB), then lazy-loads the 3D runtime
  landing.ts          2D landing page; silhouettes drawn by the fold engine itself
  boot.ts             IWSDK World.create + FoldGame system
  game/
    fold/engine.ts    the folding engine: convex facets, split, rotate, re-stack
    fold/models.ts    six origami models written like real diagrams
    game.ts           the game system: menu → intro → fold → life → act → done
    input.ts          hand joints → pinch points, rays; controllers; mouse
    paper-view.ts     facet meshes + fold guides (handle, ghost, crease line)
    life.ts           relaxing creases open so finished models gain volume
    dioramas.ts       six cut-paper stages, each with its problem and act
    env.ts            dusk sky, paper moon, lantern lake, desk, folding stand
    textures.ts       procedural washi paper, patterns, wood, mat
    audio.ts          procedural paper rustle, crease snap, Karplus–Strong koto
    ui.ts             pokeable / pinchable paper-tag buttons
    save.ts           progress, resume, daily streak (localStorage)
tools/
  preview.ts          folds every model headlessly → SVG contact sheet per step
  play-chapter.mjs    plays a chapter with real mouse drags (iwsdk browser run)
```

**The fold engine.** The sheet is a set of convex facets, each holding its polygon in
paper coordinates and a rigid transform into fold space. A step resolves its hinge from
named paper points ("bring this corner to that one"), splits every selected facet the
hinge crosses, rotates the moving side about the hinge and re-stacks layers so a flap
lands on top in reverse order. Turn-overs, partial folds and top-layer-only folds are
supported, so the same model file works no matter how the sheet was turned before.

**Hands.** Thumb-tip and index-tip joint poses are read straight from the XR frame. The
pinch point's angle around the hinge is the fold angle, so the flap follows the
fingers. A pinch with hysteresis (1.8 cm on, 3.2 cm off), a 6 cm grab radius, and a
snap past 55% of the fold keep it reliable.

Everything — textures, scenery, music, sound — is generated at runtime; the app downloads
no assets.

## Testing

```sh
npx tsx tools/preview.ts > out.svg   # visual check of every fold step
npm run typecheck
```

With the dev server started with `--allow-browser-automation`:

```sh
CHAPTER=4 npx @iwsdk/cli browser run tools/play-chapter.mjs
```

The in-page test API is `window.fold` (`start`, `autoFold`, `tick`, `screenOf`,
`worldOf`, `pointers`, `state`, `stats`, and for marketing shots `camera`, `holdAt`,
`cleanShot`).

## Credits

Design, code, art and audio: Parin Gupta. Built on the
[Immersive Web SDK](https://github.com/facebook/immersive-web-sdk) and Three.js.
Fonts: Fraunces and Inter (SIL Open Font License).
