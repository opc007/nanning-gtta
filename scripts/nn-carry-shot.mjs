/**
 * One picture: the protagonist carrying somebody over their shoulder.
 *
 * Shot before anything else happens — no fight, so no wanted level and no
 * police running through the frame, and the loneliest person on the street
 * so the only two people in shot are the carrier and the carried.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const PINNED = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const EXE = existsSync(PINNED) ? PINNED : undefined;
const URL = process.env.URL ?? 'http://127.0.0.1:5244/?t=0.45';
const OUT = process.env.OUT ?? '/workspace/nn-handover/docs/pr-screenshots/task7';
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
await p.waitForFunction(() => (window.__nn?.crowd?.talkers?.length ?? 0) >= 8, null, { timeout: 600000 });
await p.waitForTimeout(6000);

const setup = await p.evaluate(() => {
  const c = window.__nn.crowd;
  const arr = c.talkers;
  const n = window.__nn;
  const pl = n.player;
  // The loneliest person on the street: carrying somebody out of the middle
  // of a crowd puts a bystander in every frame.
  let t = null;
  let loneliest = -1;
  for (const x of arr) {
    let nearest = 99;
    for (const o of arr) {
      if (o === x) continue;
      nearest = Math.min(nearest, Math.hypot(o.x - x.x, o.z - x.z));
    }
    if (nearest > loneliest) { loneliest = nearest; t = x; }
  }
  if (!t) return { ok: false };
  pl.x = t.x + 1.25;
  pl.z = t.z;
  pl.heading = Math.atan2(-(t.z - pl.z), t.x - pl.x);
  return { ok: true, loneliest: +loneliest.toFixed(2) };
});
console.log('SETUP', JSON.stringify(setup));
await p.waitForTimeout(3000);

// G picks them up. The key is pressed several times: the headless renderer
// runs at about a frame a second, and a key pressed between two frames is
// never seen.
let carrying = false;
for (let i = 0; i < 8 && !carrying; i += 1) {
  // Re-aim every time. The crowd keeps walking while the key is pressed,
  // and the grab only takes somebody who is in front of you.
  await p.evaluate(() => {
    const c = window.__nn.crowd;
    const arr = c.talkers;
    const n = window.__nn;
    const pl = n.player;
    let t = null;
    let loneliest = -1;
    for (const x of arr) {
      if (x.combat === 'down' || x.combat === 'carried') continue;
      let nearest = 99;
      for (const o of arr) {
        if (o === x) continue;
        nearest = Math.min(nearest, Math.hypot(o.x - x.x, o.z - x.z));
      }
      if (nearest > loneliest) { loneliest = nearest; t = x; }
    }
    if (!t) return;
    pl.x = t.x + 1.1;
    pl.z = t.z;
    pl.heading = Math.atan2(-(t.z - pl.z), t.x - pl.x);
  });
  await p.waitForTimeout(1200);
  await p.keyboard.press('KeyG');
  await p.waitForTimeout(1800);
  carrying = await p.evaluate(() => !!window.__nn.crowd.carrying?.());
}
console.log('carrying', carrying);
await p.waitForTimeout(2000);

// Walk out of the way of the parked cars. The "press F to get in" prompt
// over a bonnet in the middle of the picture is not a picture of a carry.
const moved = await p.evaluate(() => {
  const n = window.__nn;
  const pl = n.player;
  const v = n.vehicles;
  for (let z = 0; z < 40; z += 2.5) {
    for (const cand of [pl.z + z, pl.z - z]) {
      const near = v.carStates().filter((c) => c.active && c.role !== 'police' &&
        Math.hypot(c.x - pl.x, c.z - cand) < 5.5);
      if (!near.length) {
        pl.z = cand;
        return { ok: true, z: +cand.toFixed(1) };
      }
    }
  }
  return { ok: false };
});
console.log('moved clear of the cars', JSON.stringify(moved));
await p.waitForTimeout(3000);

// From the side, at shoulder height. Shot from the front the carried body
// is behind the carrier and reads as somebody crouching at their heels.
await p.evaluate(() => {
  const n = window.__nn;
  const pl = n.player;
  globalThis.freezeCam = true;
  // Along the street, not across it. The traffic lanes are at the kerb, so a
  // camera four metres to the side of somebody in the middle of the road
  // ends up inside a parked car — and the picture is a yellow bonnet.
  // Along the street it stays in the clear lane and still looks at the carry
  // side-on, because the carrier is facing across the road.
  n.camera.position.set(pl.x, 1.75, pl.z + 4.6);
  n.camera.lookAt(pl.x, 1.3, pl.z);
});
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/carry.png`, timeout: 600000 });
console.log('  → carry');
console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
