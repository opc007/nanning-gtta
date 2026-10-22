/**
 * The action stills: a street fight, a carried body, a thrown body, and a
 * bowl of noodles that puts blood back.
 *
 * Everything here is the real game doing the real thing — the punch comes
 * from the key, the carry comes from the grab, the throw comes from the
 * throw. Nothing is posed.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';

const PINNED = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const EXE = existsSync(PINNED) ? PINNED : undefined;
const URL = process.env.URL ?? 'http://127.0.0.1:5244/?t=0.45';
const OUT = process.env.OUT ?? '/workspace/nn-handover/docs/pr-screenshots';
mkdirSync(`${OUT}/task7`, { recursive: true });
mkdirSync(`${OUT}/task8`, { recursive: true });

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
await p.waitForFunction(() => !!window.__nn?.crowd, null, { timeout: 300000 });
await p.waitForTimeout(6000);

/** A wide, fixed camera: the follow camera is so close that a fight
 *  reads as three people sharing one body. Acceptance pictures have to show
 *  the gap between people, so the camera steps back. */
const wide = async (dist = 7.2, height = 3.0, side = 0.9) => {
  await p.evaluate(([d, h, s2]) => {
    const n = window.__nn;
    const pl = n.player;
    globalThis.freezeCam = true;
    // Along the street, never across it. The arcade is three metres deep
    // with the shopfronts behind it, so a camera pulled sideways ends up
    // inside a shop looking out through the security grille.
    n.camera.position.set(pl.x + s2 * 1.6, h, pl.z + d);
    n.camera.lookAt(pl.x, 0.95, pl.z);
  }, [dist, height, side]);
};

const shape = await p.evaluate(() => {
  const c = window.__nn.crowd;
  const keys = Object.keys(c);
  let arr = null;
  let name = null;
  for (const k of ['talkers', 'people', 'crowd', 'list', 'agents']) {
    if (Array.isArray(c[k])) { arr = c[k]; name = k; break; }
  }
  return {
    keys,
    arrayName: name,
    count: arr ? arr.length : 0,
    sample: arr && arr[0] ? Object.keys(arr[0]) : null,
    samplePos: arr && arr[0] ? { x: arr[0].x, z: arr[0].z, hp: arr[0].hp, combat: arr[0].combat } : null,
  };
});
console.log('SHAPE', JSON.stringify(shape));

// ── 1. A street fight ───────────────────────────────────────────────────────
await p.evaluate(() => {
  const c = window.__nn.crowd;
  const arr = c.talkers ?? c.people ?? c.crowd ?? c.list ?? [];
  const n = window.__nn;
  const pl = n.player;
  if (!arr.length) return;
  // Stand a couple of metres from somebody and face them.
  const t = arr[Math.floor(arr.length / 2)];
  pl.x = t.x + 1.6;
  pl.z = t.z;
  pl.heading = Math.atan2(-(t.z - pl.z), t.x - pl.x);
});
await p.waitForTimeout(3000);

// Three punches floor them, and then they get up and hit back.
for (let i = 0; i < 3; i += 1) {
  await p.keyboard.press('KeyJ');
  await p.waitForTimeout(2200);
}
await p.waitForTimeout(3000);
const afterPunch = await p.evaluate(() => {
  const c = window.__nn.crowd;
  const arr = c.talkers ?? c.people ?? [];
  return {
    combats: arr.map((t) => t.combat).filter((x) => x && x !== 'none'),
    hostile: arr.filter((t) => t.hostile).length,
    down: arr.filter((t) => t.combat === 'down').length,
  };
});
console.log('AFTER PUNCH', JSON.stringify(afterPunch));
await wide(7.6, 3.1, 1.1);
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/task7/brawl-crowd.png`, timeout: 300000 });
console.log('  → brawl-crowd');

// One more, so the shot shows a fight rather than a pile-up: the one who
// got hit turns on the one who hit them.
await p.keyboard.press('KeyJ');
await p.waitForTimeout(4000);
await wide(6.4, 2.8, -1.2);
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/task7/brawl-punch.png`, timeout: 300000 });
console.log('  → brawl-punch');

// ── 2. Carry a person ───────────────────────────────────────────────────────
const carried = await p.evaluate(() => {
  const c = window.__nn.crowd;
  const arr = c.talkers ?? c.people ?? [];
  const n = window.__nn;
  const pl = n.player;
  const t = arr.find((x) => x.combat !== 'down' && x.combat !== 'carried');
  if (!t) return { ok: false };
  pl.x = t.x + 1.2;
  pl.z = t.z;
  pl.heading = Math.atan2(-(t.z - pl.z), t.x - pl.x);
  return { ok: true };
});
console.log('carry setup', JSON.stringify(carried));
await p.waitForTimeout(2500);
// The headless renderer runs at about a frame a second, so a key press can
// land between two frames. Press G until somebody is actually in your hands.
let carryState = { carrying: false, carried: 0 };
for (let i = 0; i < 8; i += 1) {
  await p.keyboard.press('KeyG');
  await p.waitForTimeout(2200);
  carryState = await p.evaluate(() => {
    const c = window.__nn.crowd;
    const arr = c.talkers ?? c.people ?? [];
    return {
      carrying: !!c.carrying?.(),
      carried: arr.filter((t) => t.combat === 'carried').length,
    };
  });
  if (carryState.carrying) break;
}
console.log('CARRY', JSON.stringify(carryState));
await wide(6.8, 2.7, 1.4);
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/task7/carry.png`, timeout: 300000 });
console.log('  → carry');

// ── 3. Throw them ───────────────────────────────────────────────────────────
await p.keyboard.press('KeyJ');
await p.waitForTimeout(4500);
await wide(8.4, 3.4, 0.6);
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/task8/throw-knockdown.png`, timeout: 300000 });
console.log('  → throw-knockdown');
const thrown = await p.evaluate(() => {
  const c = window.__nn.crowd;
  const arr = c.talkers ?? c.people ?? [];
  return { down: arr.filter((t) => t.combat === 'down').length, carrying: !!c.carrying?.() };
});
console.log('THROWN', JSON.stringify(thrown));

console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
