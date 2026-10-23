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
await p.waitForFunction(() => !!window.__nn?.vehicles?.carStates, null, { timeout: 600000 });
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
  // Put the player in the clear lane, but not inside a car. Dropped on top of
  // one, the protagonist stands in the bodywork with his head out of the
  // roof, and the picture reads as a person clipping through a vehicle.
  pl.x = 1.7;
  pl.z = bestZ + 7;
  for (let dz = 0; dz < 40; dz += 1.5) {
    for (const cand of [bestZ + 7 + dz, bestZ + 7 - dz]) {
      const busy = cars.some((c) => Math.hypot(c.x - 1.7, c.z - cand) < 3.2);
      if (!busy) { pl.z = cand; dz = 99; break; }
    }
  }
  // Eye level down the carriageway: the traffic in both kerb lanes, the
  // arcade open on both sides, and nobody standing in a traffic lane.
  globalThis.freezeCam = true;
  n.camera.position.set(1.7, 2.6, pl.z + 14);
  n.camera.lookAt(1.7, 1.1, pl.z - 16);
  return { bestZ, bestN, cars: cars.length };
});
console.log('street', JSON.stringify(street));
await p.waitForTimeout(6000);
// The traffic keeps moving while the frame is being set up, so a car can
// drive into the player between choosing a spot and taking the picture.
// Check once more, and move if it did.
const cleared = await p.evaluate(() => {
  const n = window.__nn;
  const pl = n.player;
  const cars = n.vehicles.carStates().filter((c) => c.active && c.role === 'ai');
  const near = cars.find((c) => Math.hypot(c.x - pl.x, c.z - pl.z) < 3.4);
  if (!near) return { ok: true };
  // Walk the player to the far side of the middle lane, away from the car.
  pl.x = near.x > 0 ? -1.7 : 1.7;
  return { ok: false, moved: true };
});
console.log('cleared', JSON.stringify(cleared));
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/street-traffic.png`, timeout: 600000 });
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
  // Stand on the driver's side of the car. China drives on the left, so the
  // seat is on the car's left; from the other side you look at the back of
  // the cabin and the driver is not in the picture at all. And stay over the
  // carriageway — a camera seven metres to the side of the car is inside the
  // shopfronts, and the shot is taken through a wall.
  const rx = Math.sin(pp.heading);
  const rz = Math.cos(pp.heading);
  const cx = Math.max(-4.0, Math.min(4.0, pp.x - rx * 6.4));
  const cz = pp.z - rz * 6.4;
  n.camera.position.set(cx, 2.45, cz);
  n.camera.lookAt(pp.x, 0.85, pp.z);
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
await p.screenshot({ path: `${OUT}/jack-and-drive.png`, timeout: 600000 });
console.log('  → jack-and-drive');

console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
