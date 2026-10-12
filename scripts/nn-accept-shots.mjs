/**
 * Issue #6 acceptance screenshots for PR #7.
 *
 * Writes into /opt/cursor/artifacts and mirrors into MEDIA_DIR when set.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';

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
  const base = URL.split('?')[0];
  await page.goto(`${base}?${qs}`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.__skipSplash?.());
  await page.waitForTimeout(3500);
}

async function shot(name) {
  const path = join(OUT, `accept-${name}.png`);
  await page.screenshot({ path, timeout: 180000 });
  if (MEDIA) copyFileSync(path, join(MEDIA, `accept-${name}.png`));
  console.log('  →', name, path);
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
  await page.waitForTimeout(500);
}

/** Face the camera. Kenney Mini Characters are +Z-authored with a +90° model yaw. */
async function faceCam(dist = 2.6, height = 1.55, aim = 1.05) {
  await page.evaluate(([dist, height, aim]) => {
    const n = window.__nn;
    const pl = n.player;
    // Heading π faces −X; camera sits on −X looking back at the face.
    window.__game.teleport(pl.x, pl.z, Math.PI);
    n.camera.position.set(pl.x - dist, height, pl.z);
    n.camera.lookAt(pl.x, aim, pl.z);
    globalThis.freezeCam = true;
  }, [dist, height, aim]);
  await page.waitForTimeout(300);
}

function shopUnit(id) {
  return page.evaluate((id) => {
    const city = window.__nn?.city;
    if (!city?.shops) return null;
    for (const u of city.shops) {
      if (u.def?.id !== id) continue;
      const b = city.buildings?.[u.building];
      return {
        x: u.x,
        z: u.z,
        nx: u.nx,
        nz: u.nz,
        width: u.width,
        cx: b?.cx ?? u.x - u.nx * 4,
        cz: b?.cz ?? u.z,
        depth: b?.depth ?? 8,
      };
    }
    return null;
  }, id);
}

// ── 1–5: hero poses ─────────────────────────────────────────────────────────
console.log('hero poses');
await goto('t=0.45&hud=0&hero=1&mixer=0.55');
await page.evaluate(() => window.__game?.teleport?.(0, -20, 0));
await page.waitForTimeout(800);

await poseClip('idle', 0.55);
await faceCam(2.5, 1.5, 1.05);
await shot('hero-front');

await poseClip('sprint', 0.4);
await faceCam(2.7, 1.45, 1.0);
await shot('hero-run');

await poseClip('jump', 0.3);
await page.evaluate(() => {
  window.__nn.player.y = 1.15;
});
await faceCam(2.9, 1.85, 1.4);
await shot('hero-jump');

await poseClip('attack-melee-right', 0.4);
await page.evaluate(() => {
  window.__nn.player.y = 0;
});
await faceCam(2.6, 1.5, 1.05);
await shot('hero-punch');

await poseClip('pick-up', 0.55);
await faceCam(2.5, 1.35, 0.9);
await shot('hero-pickup');

// ── 6: 老友粉 doorhead ──────────────────────────────────────────────────────
console.log('fuji door');
await goto('t=0.45&hud=0');
const fuji = await shopUnit('fuji');
console.log('fuji', fuji);
if (fuji) {
  await page.evaluate((f) => {
    window.__game.teleport(f.x + f.nx * 5.5, f.z, Math.atan2(-f.nz, -f.nx));
  }, fuji);
  await page.waitForTimeout(1800);
  await page.evaluate((f) => {
    const n = window.__nn;
    n.camera.position.set(f.x + f.nx * 8.2, 2.8, f.z);
    n.camera.lookAt(f.x + f.nx * 0.3, 2.5, f.z);
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
  const unit = await shopUnit(shopIds[i]);
  if (!unit) {
    console.log('  miss', shopIds[i]);
    continue;
  }
  // Approach the door so the interior streamer builds the room, then look in
  // from the arcade (outside looking in) — avoids near-plane black walls.
  await page.evaluate((u) => {
    window.__game.teleport(u.x + u.nx * 1.2, u.z, Math.atan2(-u.nz, -u.nx));
  }, unit);
  for (let k = 0; k < 16; k++) await page.waitForTimeout(180);
  // Step just inside to force the shell, then pull the camera back out.
  await page.evaluate((u) => {
    window.__game.teleport(u.x - u.nx * 2.5, u.z, Math.atan2(-u.nz, -u.nx));
  }, unit);
  for (let k = 0; k < 10; k++) await page.waitForTimeout(180);
  const info = await page.evaluate(() => ({
    inside: window.__game?.interior === true,
    props: (window.__game?.interiorProps?.() ?? []).length,
    kit: window.__nn?.interiors ? true : false,
  }));
  console.log('  ', shopIds[i], info);
  await page.evaluate((u) => {
    const n = window.__nn;
    // From the arcade lip, looking inland at the counter / tables.
    n.camera.position.set(u.x + u.nx * 2.2, 1.85, u.z);
    n.camera.lookAt(u.cx - u.nx * 0.8, 1.05, u.cz);
    globalThis.freezeCam = true;
  }, unit);
  await page.waitForTimeout(700);
  await shot(`interior-${names[i]}`);
}

// ── 11: night street ────────────────────────────────────────────────────────
console.log('night');
await goto('t=0.82&hud=0');
await page.evaluate(() => window.__game.teleport(0, -35, Math.PI / 2));
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const n = window.__nn;
  const pl = n.player;
  n.camera.position.set(pl.x - 0.5, 2.6, pl.z + 10);
  n.camera.lookAt(pl.x + 2.5, 2.0, pl.z - 6);
  globalThis.freezeCam = true;
});
await page.waitForTimeout(800);
await shot('night-street');

console.log('errs:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
