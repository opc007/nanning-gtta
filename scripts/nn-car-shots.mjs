/**
 * Two pictures of one car, close up, for the reviewer to look at the
 * bodywork: the side and the three-quarter. The street shots are too small
 * and too far away to tell a car from a red box.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const PINNED = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const EXE = existsSync(PINNED) ? PINNED : undefined;
const URL = process.env.URL ?? 'http://127.0.0.1:5244/?t=0.45';
const OUT = process.env.OUT ?? '/workspace/nn-handover/docs/pr-screenshots/task11';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
p.setDefaultTimeout(600000);
p.on('pageerror', (e) => console.log('ERR', e.message.split('\n')[0]));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(6000);
await p.evaluate(() => window.__skipSplash?.());
await p.waitForFunction(() => !!window.__nn?.vehicles?.carStates, null, { timeout: 600000 });
await p.waitForFunction(
  () => (window.__nn.vehicles.carStates() ?? []).filter((c) => c.active && c.role === 'ai' && Math.abs(c.x) < 5).length >= 2,
  null,
  { timeout: 600000 },
);

const where = await p.evaluate(() => {
  const n = window.__nn;
  const cars = n.vehicles.carStates().filter((c) => c.active && c.role === 'ai' && Math.abs(c.x) < 5);
  const c = cars[0];
  globalThis.freezeCam = true;
  return { x: c.x, z: c.z, heading: c.heading };
});
console.log('CAR', JSON.stringify(where));

// Along the carriageway, not across it: the arcade is three metres deep
// with the shopfronts behind it, so a camera pulled sideways ends up inside
// a shop looking out through the columns.
await p.evaluate(([x, z, h]) => {
  const n = window.__nn;
  const a = h + Math.PI / 2;
  const cx = Math.max(-4.0, Math.min(4.0, x + Math.cos(a) * 4.2));
  const cz = z + Math.sin(a) * 4.2;
  n.camera.position.set(cx, 1.75, cz);
  n.camera.lookAt(x, 0.8, z);
}, [where.x, where.z, where.heading]);
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/car-side.png`, timeout: 600000 });
console.log('  → car-side');

await p.evaluate(([x, z, h]) => {
  const n = window.__nn;
  const a = h - 0.8;
  const cx = Math.max(-4.0, Math.min(4.0, x + Math.cos(a) * 4.4));
  const cz = z + Math.sin(a) * 4.4;
  n.camera.position.set(cx, 2.0, cz);
  n.camera.lookAt(x, 0.8, z);
}, [where.x, where.z, where.heading]);
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/car-34.png`, timeout: 600000 });
console.log('  → car-34');

// Close on the greenhouse: this is the shot that proves the cabin is a
// cabin and not a hole with a lid over it.
await p.evaluate(([x, z, h]) => {
  const n = window.__nn;
  const a = h + Math.PI / 2;
  const cx = Math.max(-4.0, Math.min(4.0, x + Math.cos(a) * 2.9));
  const cz = z + Math.sin(a) * 2.9;
  n.camera.position.set(cx, 1.35, cz);
  n.camera.lookAt(x, 1.05, z);
}, [where.x, where.z, where.heading]);
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/glass-after.png`, timeout: 600000 });
console.log('  → glass-after');
await b.close();
