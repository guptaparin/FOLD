# FOLD — Devpost submission (ready to paste)

**Submission name:** FOLD

**Tagline (≤140):** Fold paper with your hands, crease by crease. Every model you make comes alive in a little paper world.
(103 characters)

**Track:** Gaming **Division:** New Experience (built entirely during the competition window)

**Playable build (IWSDK / WebXR link):** https://fold-blond.vercel.app
On Meta Quest: open the link in Meta Quest Browser → **Enter VR**. Hands only, no controllers needed.

**Demo video:** YouTube link (public), file `FOLD-demo.mp4`

**Source (optional):** https://github.com/guptaparin/FOLD

---

## Description

### Inspiration
Origami is the most hands-first craft there is: no tools, just fingers, paper and a crease. We wanted a VR game where your hands don't press buttons. They do the actual thing. You pinch a corner of a sheet, pull it around a fold line and let go to press the crease flat. Each finished model then has a job in a small cut-paper world.

### What it is
FOLD is a seated, hands-first origami game across six chapters. Each chapter is a problem in a paper diorama:
- a firefly caught in the rain needs a **Shelter**;
- a lantern needs a **Boat**;
- a lost path needs a **Fox** to light it;
- a wilted moon flower needs a **Water Cup**;
- a letter needs a **Paper Plane**;
- a dark lake needs a **Moon Swan**.

When you finish folding a model, it lifts off the mat, relaxes into a 3D shape and walks into its world to fix it. Every model also joins a shelf on your desk.

Each day's **Daily Fold** gives everyone the same new sheet, with a streak to keep, as a reason to come back. A first chapter takes about five minutes.

### How we built it
- **Platform:** the Immersive Web SDK (WebXR, Three.js, ECS), hosted on Vercel, so it opens from a link with no install.
- **Fold engine:** our own. The sheet is a set of convex paper facets. Each fold splits the facets along the crease, rotates the moving layer around the hinge in real time while your fingers pull it, then re-stacks the layers. The six models are written step by step like real origami diagrams.
- **Hands:** the pinch point comes from the WebXR thumb-tip and index-tip joint poses. The flap follows your fingers around the crease and presses flat when you let go past the snap point: just over halfway, or about a quarter of the way with Easy folds. You can run a fingertip along a fresh crease to sharpen it, and poke paper tags to press them.
- **Other input:** controllers work as a fallback (trigger or grip, with haptics). Gaze + pinch is ready for eye-tracked devices.
- **Mixed reality:** on Quest 3 and 3S, "Fold on your real desk" puts the paper world in your room through passthrough.
- **Assets:** no art or audio files. All paper textures, patterns, dioramas and sound are procedural: paper rustle that follows the fold's speed, a crease snap, and a Karplus–Strong koto that plucks a note for each crease.
- **Comfort and accessibility:** seated, within arm's reach, with no locomotion. Easy folds (a lower snap point), Bold guides and Recenter are on the desk.

### Challenges
Getting the flap to follow a pinch around an arbitrary crease without jitter, and keeping layered folds (squash and petal steps) correct. We also had to stay hands-first end to end, menus included.

### What's next
More chapters and a free-fold sandbox, a shared Daily Fold leaderboard, multiplayer "fold together" over the shelf, and publishing to the Meta Horizon Store as a PWA.

---

## How hand interactions are implemented (optional field)
- **Pinch:** read from the WebXR hand-joint poses (thumb-tip and index-tip distance, with hysteresis).
- **Grab:** the pinch point grabs the glowing handle on the current flap. The flap angle follows the projection of your hand around the crease axis.
- **Release:** releasing past the snap point commits the fold, with a sound and a crease glow.
- **Fingertip:** a fingertip drawn along a crease sharpens it.
- **Buttons:** UI buttons are paper tags you poke or pinch.
- **Fallback:** everything also works with controllers (trigger = pinch) and with a mouse in the browser.

## What excites us about VR
Hands make a craft feel real. Folding paper is satisfying because your fingers do the work, and VR is the only screen where that can happen.
