/**
 * The shop front with the e-bike parked under the arcade, shot from inside
 * the same bay as the scooter so that no column stands between the camera
 * and the vehicle. Shot from the street the colonnade is always in the way,
 * and a column in front of the scooter reads as the scooter being inside it.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const PINNED = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const EXE = existsSync(PINNED) ? PINNED : undefined;
const URL = process.env.URL ?? 'http://127.0.0.1:5244/?t=0.79';
const OUT = process.env.OUT ?? '/workspace/nn-handover/docs/pr-screenshots/task6';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
p.setDefaultTimeout(600000);
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(6000);
await p.evaluate(() => window.__skipSplash?.());
await p.waitForFunction(() => !!window.__nn?.scene?.getObjectByName('nn-poly-ebikes'), null, { timeout: 600000 });
await p.waitForTimeout(6000);

const spot = await p.evaluate(() => {
  const g = window.__nn.scene.getObjectByName('nn-poly-ebikes');
  const n = window.__nn;
  // Take a scooter on the shop side, and stand in the same bay as it.
  const c = g.children[0];
  const x = c.position.x;
  const z = c.position.z;
  globalThis.freezeCam = true;
  n.camera.fov = 52;
  n.camera.near = 0.1;
  n.camera.position.set(x - 1.2, 1.7, z - 4.2);
  n.camera.lookAt(x, 0.8, z);
  n.camera.updateProjectionMatrix();
  n.camera.updateMatrixWorld(true);
  return { x: +x.toFixed(2), z: +z.toFixed(2), count: g.children.length };
});
console.log('SPOT', JSON.stringify(spot));
await p.waitForTimeout(6000);
await p.screenshot({ path: `${OUT}/fuji-door.png`, timeout: 600000 });
console.log('  → fuji-door');
console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
