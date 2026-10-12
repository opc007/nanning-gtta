/**
 * Issue #6 acceptance screenshots for PR #7.
 *
 * Writes into /opt/cursor/artifacts and mirrors into the Project store media
 * folder when MEDIA_DIR is set.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';

const URL = process.env.URL ?? 'http://localhost:5244/?t=0.45&hud=0';
const OUT = process.env.OUT_DIR ?? '/opt/cursor/artifacts';
const MEDIA = process.env.MEDIA_DIR ?? '';
const PINNED = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const EXE = existsSync(PINNED) ? PINNED : undefined;

mkdirSync(OUT, { recursive: true });
if (MEDIA) mkdirSync(MEDIA, { recursive: true });

const b = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
page.setDefaultTimeout(180000);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));

async function goto(qs) {
  const u = new URL(URL);
  // Rebuild with override query
  const base = URL.split('?')[0];
  await page.goto(`${base}?${qs}`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.__skipSplash?.());
  await page.waitForTimeout(2500);
  // Wait for Kenney kit / arcade / clip character
  await page.waitForTimeout(2000);
}

async function shot(name) {
  const path = join(OUT, `accept-${name}.png`);
  await page.screenshot({ path, timeout: 180000 });
  if (MEDIA) copyFileSync(path, join(MEDIA, `accept-${name}.png`));
  console.log('  →', name, path);
}

async function freezeCam(d, h, az, ah = 1.1) {
  await page.evaluate(([d, h, az, ah]) => {
    const n = window.__nn;
    const pl = n.player;
    n.camera.position.set(pl.x + Math.cos(az) * d, h, pl.z + Math.sin(az) * d);
    n.camera.lookAt(pl.x, ah, pl.z);
    globalThis.freezeCam = true;
  }, [d, h, az, ah]);
}

async function poseClip(clip, t) {
  await page.evaluate(([clip, t]) => {
    const a = window.__nn?.avatar;
    if (!a?.play) return;
    if (clip === 'attack-melee-right' || clip === 'pick-up') {
      a.setOneShot?.(clip, 0.45);
    } else {
      a.play(clip, 0.01);
    }
    a.setMixerTime?.(t, true);
  }, [clip, t]);
  await page.waitForTimeout(400);
}

// ── 1–5: hero poses ─────────────────────────────────────────────────────────
console.log('hero poses');
await goto('t=0.45&hud=0&hero=1&mixer=0.6');
await page.evaluate(() => {
  window.__game?.teleport?.(0, 0, Math.PI / 2);
});
await page.waitForTimeout(800);
await poseClip('idle', 0.6);
await freezeCam(2.4, 1.55, 0.35, 1.05);
await shot('hero-front');

await poseClip('sprint', 0.45);
await freezeCam(2.6, 1.5, 0.5, 1.0);
await shot('hero-run');

await poseClip('jump', 0.35);
await page.evaluate(() => {
  // Lift the avatar a little so the jump reads as airborne in a still.
  const pl = window.__nn.player;
  pl.y = 1.1;
});
await freezeCam(2.8, 1.7, 0.55, 1.35);
await shot('hero-jump');

await poseClip('attack-melee-right', 0.4);
await page.evaluate(() => { window.__nn.player.y = 0; });
await freezeCam(2.5, 1.5, 0.4, 1.05);
await shot('hero-punch');

await poseClip('pick-up', 0.5);
await freezeCam(2.4, 1.4, 0.45, 0.95);
await shot('hero-pickup');

// ── 6: 老友粉 doorhead ──────────────────────────────────────────────────────
console.log('fuji door');
await goto('t=0.45&hud=0');
const fuji = await page.evaluate(() => {
  const shops = window.__nn?.city?.shops ?? [];
  const s = shops.find((x) => x.def?.id === 'fuji' || x.def?.id === 'fuji');
  // city.shops are ShopUnit
  const units = window.__nn?.city?.shops;
  if (!units) return null;
  for (const u of units) {
    if (u.def?.id === 'fuji') return { x: u.x, z: u.z, nx: u.nx, nz: u.nz, width: u.width };
  }
  return null;
});
console.log('fuji', fuji);
if (fuji) {
  await page.evaluate((f) => {
    // Stand in the carriageway looking at the shopfront.
    const x = f.x + f.nx * 4.5;
    const z = f.z;
    window.__game.teleport(x, z, Math.atan2(-f.nz, -f.nx) + Math.PI);
  }, fuji);
  await page.waitForTimeout(1500);
  await freezeCam(7.5, 2.4, Math.atan2(fuji.nz, fuji.nx) + Math.PI, 2.2);
  // Better: look from street toward shop
  await page.evaluate((f) => {
    const n = window.__nn;
    const pl = n.player;
    // Camera on carriageway, looking at fascia
    n.camera.position.set(f.x + f.nx * 7.5, 2.6, f.z);
    n.camera.lookAt(f.x + f.nx * 0.2, 2.4, f.z);
    globalThis.freezeCam = true;
  }, fuji);
  await page.waitForTimeout(600);
  await shot('fuji-door');
}

// ── 7–10: four shop interiors ───────────────────────────────────────────────
console.log('interiors');
const shopIds = ['fuji', 'zhongshan-fenjiao', 'rongji', 'hengzhou'];
const names = ['laoyou', 'fenjiao', 'bbq', 'milktea'];
for (let i = 0; i < shopIds.length; i++) {
  const id = shopIds[i];
  const unit = await page.evaluate((id) => {
    for (const u of window.__nn?.city?.shops ?? []) {
      if (u.def?.id === id) return { x: u.x, z: u.z, nx: u.nx, nz: u.nz, cx: u.cx ?? u.x - u.nx * 3, cz: u.cz ?? u.z };
    }
    return null;
  }, id);
  if (!unit) {
    console.log('  miss', id);
    continue;
  }
  // Walk into the shop shell so InteriorView streams it in.
  await page.evaluate((u) => {
    window.__game.teleport(u.x - u.nx * 2.8, u.z, Math.atan2(u.nz, u.nx));
  }, unit);
  await page.waitForTimeout(2200);
  await page.evaluate((u) => {
    const n = window.__nn;
    const px = u.x - u.nx * 2.2;
    const pz = u.z;
    n.camera.position.set(px + u.nx * 0.4, 1.7, pz + 1.8);
    n.camera.lookAt(u.x - u.nx * 4.5, 1.2, u.z);
    globalThis.freezeCam = true;
  }, unit);
  await page.waitForTimeout(500);
  await shot(`interior-${names[i]}`);
}

// ── 11: night street ────────────────────────────────────────────────────────
console.log('night');
await goto('t=0.79&hud=0');
await page.evaluate(() => {
  window.__game.teleport(0, -40, Math.PI / 2);
});
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const n = window.__nn;
  const pl = n.player;
  n.camera.position.set(pl.x + 1.5, 3.2, pl.z + 12);
  n.camera.lookAt(pl.x, 2.2, pl.z - 8);
  globalThis.freezeCam = true;
});
await page.waitForTimeout(800);
await shot('night-street');

console.log('errs:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
