/**
 * FOLD — a hands-first origami game for Meta Quest and Meta VR Glasses.
 * Built with the Immersive Web SDK.
 *
 * The landing page mounts immediately from a tiny chunk; the 3D runtime
 * streams in behind it, so the first paint never waits on WebXR code.
 */
import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/inter';
import { mountLanding } from './landing.js';

const landing = mountLanding();
void import('./boot.js').then(async ({ boot }) => {
  const world = await boot();
  landing.ready(world.xrEnabled);
  // Installed as a Quest app (TWA/PWA) there is no 2D page to tap: the app
  // icon tap is the user activation, so go straight into VR.
  const nav = navigator as Navigator & { xr?: XRSystem };
  if ('getDigitalGoodsService' in window && nav.xr) {
    void nav.xr
      .isSessionSupported('immersive-vr')
      .then((ok) => {
        if (!ok) return;
        landing.dismiss();
        (window as unknown as { fold: { enterVR(): void } }).fold.enterVR();
      })
      .catch(() => undefined);
  }
});
