/**
 * Unified "pinchers": hands first, then controllers, then the desktop mouse.
 *
 * Each pointer reports a pinch point (between thumb and index tips), the index
 * tip for poking buttons, a target ray for far interactions, and pinch edges.
 * Hands are read straight from WebXR joint poses so the fold feels 1:1 with
 * the player's fingers.
 */
import type { World } from '@iwsdk/core';
import { Matrix4, Quaternion, Vector2, Vector3 } from '@iwsdk/core';

export type PointerKind = 'hand' | 'controller' | 'mouse' | 'none';

export class Pointer {
  kind: PointerKind = 'none';
  /** World-space point where the pinch happens. */
  readonly pinchPos = new Vector3();
  /** World-space index fingertip, used for poking UI. */
  readonly tipPos = new Vector3();
  readonly rayOrigin = new Vector3();
  readonly rayDir = new Vector3(0, 0, -1);
  pinching = false;
  pinchDown = false;
  pinchUp = false;
  /** 0 (open) .. 1 (pinched), for visual feedback. */
  strength = 0;
  /** True when this pointer has no ray worth trusting (e.g. hand lost). */
  rayValid = false;
  constructor(readonly id: 'left' | 'right' | 'mouse') {}

  setPinch(on: boolean): void {
    this.pinchDown = on && !this.pinching;
    this.pinchUp = !on && this.pinching;
    this.pinching = on;
  }
}

// Hysteresis keeps a pinch from chattering at the threshold.
const PINCH_ON = 0.018;
const PINCH_OFF = 0.032;

export class InputHub {
  readonly left = new Pointer('left');
  readonly right = new Pointer('right');
  readonly mouse = new Pointer('mouse');
  readonly all: Pointer[] = [this.left, this.right, this.mouse];
  /** Gaze ray (head forward, or the eye-tracked ray when available). */
  readonly gazeOrigin = new Vector3();
  readonly gazeDir = new Vector3(0, 0, -1);
  private ndc = new Vector2();
  private mouseDown = false;
  /** Set on press, cleared once a frame has seen it, so instant clicks count. */
  private mouseLatch = false;
  private mouseMoved = false;
  private m = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private t = new Vector3();
  private i = new Vector3();
  private seen = { left: false, right: false };

  constructor(private world: World) {
    const el = world.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointermove', this.onMove);
    el.style.touchAction = 'none';
  }

  dispose(): void {
    const el = this.world.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointermove', this.onMove);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.mouseDown = true;
    this.mouseLatch = true;
    this.updateNdc(e);
  };
  private onUp = (): void => {
    this.mouseDown = false;
  };
  private onMove = (e: PointerEvent): void => {
    this.mouseMoved = true;
    this.updateNdc(e);
  };
  private updateNdc(e: PointerEvent): void {
    const r = this.world.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  get presenting(): boolean {
    return this.world.renderer.xr.isPresenting;
  }

  update(): void {
    const xr = this.world.renderer.xr;
    const cam = this.world.camera;
    // Gaze: head forward. (On Meta VR Glasses an eye-tracked gaze source
    // replaces this automatically through the same ray.)
    const rig = this.world.player;
    if (rig.gazeOrigin === 'tracked') {
      // Real eye tracking (Meta VR Glasses): use the gaze ray itself.
      rig.eyeSpace.getWorldPosition(this.gazeOrigin);
      rig.eyeSpace.getWorldDirection(this.gazeDir).negate();
    } else {
      cam.getWorldPosition(this.gazeOrigin);
      cam.getWorldDirection(this.gazeDir);
    }

    if (!xr.isPresenting) {
      this.left.kind = this.right.kind = 'none';
      this.left.setPinch(false);
      this.right.setPinch(false);
      const p = this.mouse;
      p.kind = 'mouse';
      cam.updateMatrixWorld();
      p.rayOrigin.setFromMatrixPosition(cam.matrixWorld);
      p.rayDir.set(this.ndc.x, this.ndc.y, 0.5).unproject(cam).sub(p.rayOrigin).normalize();
      p.rayValid = true;
      // A press and release inside one frame still counts as one pinch frame.
      const down = this.mouseDown || this.mouseLatch;
      this.mouseLatch = false;
      p.setPinch(down);
      p.strength = down ? 1 : 0;
      this.mouseMoved = false;
      return;
    }
    this.mouse.kind = 'none';
    this.mouse.setPinch(false);

    const frame = xr.getFrame() as XRFrame | null;
    const ref = xr.getReferenceSpace();
    const session = xr.getSession();
    this.seen.left = this.seen.right = false;
    if (frame && ref && session) {
      this.world.player.updateMatrixWorld();
      const rig = this.world.player.matrixWorld;
      for (const src of session.inputSources) {
        const hand = src.handedness;
        if (hand !== 'left' && hand !== 'right') continue;
        if (this.seen[hand]) continue;
        const p = hand === 'left' ? this.left : this.right;
        if (src.hand) {
          if (this.readHand(frame, ref, src, p, rig)) this.seen[hand] = true;
        } else if (src.gripSpace || src.targetRaySpace) {
          if (this.readController(frame, ref, src, p, rig)) this.seen[hand] = true;
        }
      }
    }
    for (const p of [this.left, this.right]) {
      if (!this.seen[p.id as 'left' | 'right']) {
        p.kind = 'none';
        p.rayValid = false;
        p.setPinch(false);
        p.strength = 0;
      }
    }
  }

  private toWorld(pose: XRPose | undefined | null, rig: Matrix4, out: Vector3): boolean {
    if (!pose) return false;
    const t = pose.transform.position;
    out.set(t.x, t.y, t.z).applyMatrix4(rig);
    return true;
  }

  private readHand(frame: XRFrame, ref: XRReferenceSpace, src: XRInputSource, p: Pointer, rig: Matrix4): boolean {
    const hand = src.hand!;
    const thumbJ = hand.get('thumb-tip');
    const indexJ = hand.get('index-finger-tip');
    if (!thumbJ || !indexJ || !frame.getJointPose) return false;
    const thumb = frame.getJointPose(thumbJ, ref);
    const index = frame.getJointPose(indexJ, ref);
    if (!this.toWorld(thumb, rig, this.t) || !this.toWorld(index, rig, this.i)) return false;
    p.kind = 'hand';
    p.tipPos.copy(this.i);
    p.pinchPos.copy(this.t).add(this.i).multiplyScalar(0.5);
    const d = this.t.distanceTo(this.i);
    const on = p.pinching ? d < PINCH_OFF : d < PINCH_ON;
    // Native select (the system pinch) also counts, for robustness.
    p.setPinch(on);
    p.strength = Math.min(1, Math.max(0, (0.07 - d) / (0.07 - PINCH_ON)));
    this.readRay(frame, ref, src, p, rig);
    return true;
  }

  private readController(
    frame: XRFrame,
    ref: XRReferenceSpace,
    src: XRInputSource,
    p: Pointer,
    rig: Matrix4,
  ): boolean {
    const grip = src.gripSpace ? frame.getPose(src.gripSpace, ref) : null;
    const ray = frame.getPose(src.targetRaySpace, ref);
    const pose = grip ?? ray;
    if (!pose) return false;
    p.kind = 'controller';
    this.toWorld(pose, rig, p.pinchPos);
    // Nudge the pinch point forward of the grip to roughly where fingers are.
    const o = pose.transform.orientation;
    this.q.set(o.x, o.y, o.z, o.w);
    this.m.extractRotation(rig);
    this.v.set(0, -0.01, -0.05).applyQuaternion(this.q).transformDirection(this.m).multiplyScalar(0.05);
    p.pinchPos.add(this.v);
    p.tipPos.copy(p.pinchPos);
    const pad = src.gamepad;
    const trig = pad?.buttons[0]?.value ?? 0;
    const squeeze = pad?.buttons[1]?.value ?? 0;
    const v = Math.max(trig, squeeze);
    p.setPinch(p.pinching ? v > 0.3 : v > 0.6);
    p.strength = v;
    this.readRay(frame, ref, src, p, rig);
    return true;
  }

  private readRay(frame: XRFrame, ref: XRReferenceSpace, src: XRInputSource, p: Pointer, rig: Matrix4): void {
    const ray = frame.getPose(src.targetRaySpace, ref);
    if (!ray) {
      p.rayValid = false;
      return;
    }
    const t = ray.transform;
    p.rayOrigin.set(t.position.x, t.position.y, t.position.z).applyMatrix4(rig);
    this.q.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
    this.m.extractRotation(rig);
    p.rayDir.set(0, 0, -1).applyQuaternion(this.q).transformDirection(this.m).normalize();
    p.rayValid = true;
  }
}

/** Closest distance between a ray and a point, and the ray parameter there. */
export function rayPointDistance(o: Vector3, d: Vector3, p: Vector3, out: { t: number }): number {
  const vx = p.x - o.x;
  const vy = p.y - o.y;
  const vz = p.z - o.z;
  const t = Math.max(0, vx * d.x + vy * d.y + vz * d.z);
  out.t = t;
  const cx = o.x + d.x * t - p.x;
  const cy = o.y + d.y * t - p.y;
  const cz = o.z + d.z * t - p.z;
  return Math.hypot(cx, cy, cz);
}
