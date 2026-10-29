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
});
