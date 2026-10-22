/**
 * The two traffic stills the review kept rejecting: the street with traffic
 * on it, and the player in a car they took off the street.
 *
 * Both are shot against the real running game — real traffic, a real
 * carjack, a real driver in the seat — never posed.
 *
 *   URL=... OUT=... node scripts/nn-traffic-shots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';

const PINNED = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const EXE = existsSync(PINNED) ? PINNED : undefined;

const URL = process.env.URL ?? 'http://127.0.0.1:5244/?t=0.45';
const OUT = process.env.OUT ?? '/workspace/nn-handover/docs/pr-screenshots/task10';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
p.setDefaultTimeout(300000);
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));

await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(6000);
await p.evaluate(() => window.__skipSplash?.());

// The world has to be up and the street has to have traffic in it. The
// headless renderer runs the simulation about five times slower than wall
// clock, so the traffic needs real time to fill the lanes.
await p.waitForFunction(() => !!window.__nn?.vehicles?.carStates, null, { timeout: 300000 });
console.log('world up');
await p.waitForFunction(
  () => (window.__nn.vehicles.carStates() ?? []).filter((c) => c.active && c.role !== 'police').length >= 6,
  null,
  { timeout: 600000 },
);
console.log('traffic up');

const street = await p.evaluate(() => {
  const n = window.__nn;
  // Only the traffic on the carriageway: the AI cars in the kerb lanes. The
  // parked cars around the city share the list and would drag the framing
  // off the street.
  const cars = n.vehicles.carStates().filter(
    (c) => c.active && c.role === 'ai' && Math.abs(c.x) < 6,
  );
  // Frame the part of the street that actually has cars in it. The traffic
  // spans 140 m, so the middle of the street is often empty and a shot from
  // there shows a road with nothing on it.
  let bestZ = -20;
  let bestN = -1;
  for (const c of cars) {
    const n2 = cars.filter((o) => Math.abs(o.z - c.z) < 26).length;
    if (n2 > bestN) { bestN = n2; bestZ = c.z; }
  }
  const pl = n.player;
  pl.x = 1.7;
  pl.z = bestZ + 7;
  // Eye level down the carriageway: the traffic in both kerb lanes, the
  // arcade open on both sides, and nobody standing in a traffic lane.
  globalThis.freezeCam = true;
  n.camera.position.set(1.7, 2.6, bestZ + 21);
  n.camera.lookAt(1.7, 1.1, bestZ - 16);
  return { bestZ, bestN, cars: cars.length };
});
console.log('street', JSON.stringify(street));
await p.waitForTimeout(6000);
await p.screenshot({ path: `${OUT}/street-traffic.png`, timeout: 300000 });
console.log('  → street-traffic');

// ── Take a car off the street and drive it ──────────────────────────────────
const jack = await p.evaluate(() => {
  const n = window.__nn;
  const pl = n.player;
  const cars = n.vehicles.carStates().filter(
    (c) => c.active && c.role === 'ai' && Math.abs(c.x) > 2.2 && Math.abs(c.x) < 4.2,
  );
  if (!cars.length) return { ok: false };
  // A car pointed across the street cannot be driven away in a straight line,
  // and one that is still turning ends the shot wedged against a kerb. Take
  // one that is already lined up with its lane.
  const aligned = cars.filter((c) => Math.abs(Math.abs(Math.sin(c.heading)) - 1) < 0.25);
  const pool = aligned.length ? aligned : cars;
  const list = n.vehicles.positions();
  let best = -1;
  let bestD = 1e9;
  for (let i = 0; i < list.length; i += 1) {
    const c = pool.find((k) => Math.hypot(k.x - list[i].x, k.z - list[i].z) < 1.5);
    if (!c) continue;
    const d = Math.hypot(list[i].x - pl.x, list[i].z - pl.z);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) return { ok: false };
  const target = list[best];
  pl.x = target.x + 1.5;
  pl.z = target.z;
  return { ok: true, best, target };
});
console.log('jack', JSON.stringify(jack));
await p.waitForTimeout(2500);

// Press F until the game reports a car.
await p.keyboard.press('KeyF');
let jacked = false;
for (let i = 0; i < 30 && !jacked; i += 1) {
  await p.waitForTimeout(1500);
  jacked = await p.evaluate(() => !!(window.__nn.vehicles.playerPose?.() ?? null));
}
console.log('jacked', jacked);

// Drive: hold W so the car is actually rolling when the picture is taken.
// The headless renderer runs the simulation about five times slower than
// wall clock, so this needs real time to get the car up to speed.
await p.keyboard.down('KeyW');
await p.waitForTimeout(40000);
await p.keyboard.up('KeyW');
await p.waitForTimeout(2500);

const pose = await p.evaluate(() => {
  const n = window.__nn;
  const pp = n.vehicles.playerPose?.() ?? null;
  const pl = n.player;
  if (!pp) return { riding: false };
  globalThis.freezeCam = true;
  // Look at the driver's side of the car, from outside, so the seat and the
  // person in it are the subject rather than the road.
  // A three-quarter view from the carriageway, not from the pavement. The
  // last attempt put the camera 7 m to the side of the car, which is inside
  // the shopfronts — the shot was taken through a wall.
  const side = pp.x > 0 ? -1 : 1;
  const along = Math.abs(Math.sin(pp.heading)) > 0.5 ? 1 : 0;
  const cx = pp.x * 0.4 + side * 2.4;
  const cz = pp.z + (along ? 5.4 * Math.sign(Math.sin(pp.heading) || 1) : 4.6);
  n.camera.position.set(cx, 2.35, cz);
  n.camera.lookAt(pp.x, 0.8, pp.z);
  // Measure where the rider's body actually is, so a limb hanging through
  // the floor is a number and not an opinion.
  const box = window.__game?.riderBox?.() ?? null;
  return {
    riding: true, x: pp.x, z: pp.z, heading: pp.heading, speed: pp.speed,
    mode: window.__game?.mode, wanted: window.__game?.wanted, box,
  };
});
console.log('pose', JSON.stringify(pose));
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/jack-and-drive.png`, timeout: 300000 });
console.log('  → jack-and-drive');

console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
