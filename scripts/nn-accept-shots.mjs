/**
 * Issue #6 acceptance screenshots for PR #7.
 *
 * Writes into OUT_DIR and mirrors into MEDIA_DIR when set.
 *
 * ONLY=interiors  — retake the four shop rooms only (default for polish loops)
 * ONLY=poly       — fenjiao (wok) + fuji-door + night-street (e-bike kerb)
 * ONLY=all        — full Issue #6 checklist
 */
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const URL = process.env.URL ?? 'http://localhost:5244/?t=0.45&hud=0';
const OUT = process.env.OUT_DIR ?? '/opt/cursor/artifacts';
const MEDIA = process.env.MEDIA_DIR ?? '';
const ONLY = (process.env.ONLY ?? 'all').toLowerCase();
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

/** Reject solid-black / tiny stills so fenjiao cannot slip through again. */
function assertRealShot(path) {
  const st = statSync(path);
  if (st.size < 20_000) throw new Error(`${path} too small (${st.size} B) — likely blank`);
  const buf = readFileSync(path);
  const slice = buf.subarray(Math.floor(buf.length * 0.2), Math.floor(buf.length * 0.8));
  const uniq = new Set(slice).size;
  if (uniq < 40) throw new Error(`${path} looks flat (uniq bytes ${uniq})`);
}

async function shot(name) {
  const path = join(OUT, `accept-${name}.png`);
  await page.screenshot({ path, timeout: 180000 });
  assertRealShot(path);
  if (MEDIA) copyFileSync(path, join(MEDIA, `accept-${name}.png`));
  console.log('  →', name, path, `${(statSync(path).size / 1024) | 0}KB`);
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

async function faceCam(dist = 2.6, height = 1.55, aim = 1.05) {
  await page.evaluate(([dist, height, aim]) => {
    const n = window.__nn;
    const pl = n.player;
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
        id: u.def.id,
        x: u.x,
        z: u.z,
        nx: u.nx,
        nz: u.nz,
        width: u.width,
        cx: b?.cx ?? u.x - u.nx * 4,
        cz: b?.cz ?? u.z,
        depth: b?.depth ?? 8,
        minX: (b?.cx ?? u.x) - (b?.depth ?? 8) / 2,
        maxX: (b?.cx ?? u.x) + (b?.depth ?? 8) / 2,
        minZ: (b?.cz ?? u.z) - (b?.width ?? u.width ?? 8) / 2,
        maxZ: (b?.cz ?? u.z) + (b?.width ?? u.width ?? 8) / 2,
      };
    }
    return null;
  }, id);
}

/** PIL-based lit-pixel check so mostly-black frames fail closed. */
function litFraction(path) {
  const out = execFileSync(
    'python3',
    [
      '-c',
      `from PIL import Image; im=Image.open(${JSON.stringify(path)}).convert("RGB").resize((64,36)); px=list(im.getdata()); print(sum(1 for c in px if sum(c)/3>30)/len(px))`,
    ],
    { encoding: 'utf8' },
  ).trim();
  return Number(out);
}

/**
 * Enter the shop, wait for tables, then try room frames until one is lit.
 * Prefers an inside three-quarter overlooking the tables (not the counter).
 */
async function shootInterior(defId, name) {
  const unit = await shopUnit(defId);
  if (!unit) {
    console.log('  miss', defId);
    return;
  }

  await page.evaluate((u) => {
    window.__game.teleport(u.x + u.nx * 0.8, u.z, Math.atan2(-u.nz, -u.nx));
  }, unit);
  for (let k = 0; k < 8; k++) await page.waitForTimeout(120);
  await page.evaluate((u) => {
    window.__game.teleport(u.x - u.nx * 2.8, u.z, Math.atan2(-u.nz, -u.nx));
  }, unit);

  let meta = null;
  for (let attempt = 0; attempt < 45; attempt++) {
    await page.waitForTimeout(160);
    meta = await page.evaluate((u) => {
      const inside = window.__game?.interior === true;
      const props = (window.__game?.interiorProps?.() ?? []).filter(
        (p) => p.x > u.minX && p.x < u.maxX && p.z > u.minZ && p.z < u.maxZ,
      );
      const tables = props.filter((p) => String(p.prop).includes('table'));
      const stools = props.filter((p) => String(p.prop).includes('stool'));
      if (!inside || tables.length < 1) return null;
      const tx = tables.reduce((s, p) => s + p.x, 0) / tables.length;
      const tz = tables.reduce((s, p) => s + p.z, 0) / tables.length;
      const midX = (u.minX + u.maxX) / 2;
      const midZ = (u.minZ + u.maxZ) / 2;
      const pad = 1.4;
      const zHi = Math.min(u.maxZ - pad, midZ + 2.6);
      const zLo = Math.max(u.minZ + pad, midZ - 2.6);
      // Inside three-quarters first (room + tables). Arcade last — often hits fascia.
      const candidates = [
        { x: u.x - u.nx * 1.8, y: 1.7, z: zHi, label: 'aisle+Z' },
        { x: u.x - u.nx * 1.8, y: 1.7, z: zLo, label: 'aisle-Z' },
        { x: u.x - u.nx * 2.2, y: 1.85, z: zHi, label: 'deep+Z' },
        { x: u.x - u.nx * 2.2, y: 1.85, z: zLo, label: 'deep-Z' },
        { x: u.x - u.nx * 1.4, y: 1.75, z: zHi, label: 'door+Z' },
        { x: u.x - u.nx * 1.4, y: 1.75, z: zLo, label: 'door-Z' },
        { x: midX + u.nx * 1.2, y: 2.05, z: midZ + 0.4, label: 'center-high' },
      ];
      return {
        tables: tables.length,
        stools: stools.length,
        props: props.length,
        aim: { x: tx, y: 0.9, z: tz },
        // Keep the player inside (fill light) but on the opposite flank so they
        // sit behind the camera frustum once __hideAvatar is on.
        stand: { x: midX, z: midZ },
        candidates,
      };
    }, unit);
    if (meta) break;
  }
  if (!meta) throw new Error(`${defId}: room never streamed (no tables)`);
  console.log('  ', defId, { tables: meta.tables, stools: meta.stools, props: meta.props });

  const path = join(OUT, `accept-interior-${name}.png`);
  let best = null;
  let bestPath = null;
  for (const eye of meta.candidates) {
    await page.evaluate(
      ([f, eye]) => {
        const n = window.__nn;
        globalThis.__hideAvatar = true;
        window.__game.teleport(f.stand.x, f.stand.z, 0);
        n.camera.near = 0.1;
        n.camera.fov = 58;
        n.camera.position.set(eye.x, eye.y, eye.z);
        n.camera.lookAt(f.aim.x, f.aim.y, f.aim.z);
        n.camera.updateProjectionMatrix();
        n.camera.updateMatrixWorld(true);
        globalThis.freezeCam = true;
      },
      [meta, eye],
    );
    await page.waitForTimeout(700);
    const tryPath = join(OUT, `accept-interior-${name}__try-${eye.label}.png`);
    await page.screenshot({ path: tryPath, timeout: 180000 });
    let lit = 0;
    try {
      lit = litFraction(tryPath);
    } catch {
      lit = 0;
    }
    const kb = (statSync(tryPath).size / 1024) | 0;
    console.log(`    try ${eye.label}: ${kb}KB lit=${lit.toFixed(2)}`);
    if (!best || lit > best.lit) {
      best = { eye, lit };
      bestPath = tryPath;
    }
    if (lit >= 0.45 && statSync(tryPath).size >= 40_000) break;
  }
  if (!best || best.lit < 0.35 || !bestPath) {
    throw new Error(`${defId}: no lit room frame (best lit=${best?.lit ?? 0})`);
  }
  // Re-shoot the winner into the canonical filename (fresh frame, no try suffix).
  await page.evaluate(
    ([f, eye]) => {
      const n = window.__nn;
      globalThis.__hideAvatar = true;
      window.__game.teleport(f.stand.x, f.stand.z, 0);
      n.camera.near = 0.1;
      n.camera.fov = 58;
      n.camera.position.set(eye.x, eye.y, eye.z);
      n.camera.lookAt(f.aim.x, f.aim.y, f.aim.z);
      n.camera.updateProjectionMatrix();
      n.camera.updateMatrixWorld(true);
      globalThis.freezeCam = true;
    },
    [meta, best.eye],
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path, timeout: 180000 });
  assertRealShot(path);
  const lit = litFraction(path);
  if (lit < 0.35) throw new Error(`${path} still too dark (lit=${lit})`);
  if (MEDIA) copyFileSync(path, join(MEDIA, `accept-interior-${name}.png`));
  console.log('  →', `interior-${name}`, path, `${(statSync(path).size / 1024) | 0}KB`, `lit=${lit.toFixed(2)}`);
  await page.evaluate(() => {
    globalThis.__hideAvatar = false;
  });
}

async function waitPolyEbikes() {
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => {
      const g = window.__nn?.scene?.getObjectByName?.('nn-poly-ebikes');
      return g?.children?.length ?? 0;
    });
    if (n > 0) return n;
    await page.waitForTimeout(200);
  }
  return 0;
}

async function shootFujiDoor() {
  console.log('fuji door');
  await goto('t=0.45&hud=0');
  const nBikes = await waitPolyEbikes();
  console.log('  poly ebikes:', nBikes);
  const fuji = await shopUnit('fuji');
  if (!fuji) return;
  // Carriageway so kerb scooters sit between camera and fascia.
  await page.evaluate((f) => {
    window.__game.teleport(0, f.z, Math.atan2(-f.nz, -f.nx));
  }, fuji);
  await page.waitForTimeout(1800);
  await page.evaluate((f) => {
    const n = window.__nn;
    globalThis.__hideAvatar = true;
    n.camera.position.set(f.nx * 0.35, 2.15, f.z + 3.4);
    n.camera.lookAt(f.x + f.nx * 0.2, 1.35, f.z);
    globalThis.freezeCam = true;
  }, fuji);
  await page.waitForTimeout(600);
  await shot('fuji-door');
  await page.evaluate(() => {
    globalThis.__hideAvatar = false;
  });
}

/** Fenjiao room framed on the counter steamer + wok (not the dining aisle). */
async function shootFenjiaoWok() {
  console.log('fenjiao wok');
  const unit = await shopUnit('zhongshan-fenjiao');
  if (!unit) throw new Error('zhongshan-fenjiao missing');
  await page.evaluate((u) => {
    window.__game.teleport(u.x + u.nx * 0.8, u.z, Math.atan2(-u.nz, -u.nx));
  }, unit);
  for (let k = 0; k < 8; k++) await page.waitForTimeout(120);
  await page.evaluate((u) => {
    window.__game.teleport(u.x - u.nx * 2.8, u.z, Math.atan2(-u.nz, -u.nx));
  }, unit);

  let aim = null;
  for (let attempt = 0; attempt < 45; attempt++) {
    await page.waitForTimeout(160);
    aim = await page.evaluate((u) => {
      if (!window.__game?.interior) return null;
      const props = (window.__game?.interiorProps?.() ?? []).filter(
        (p) => p.x > u.minX && p.x < u.maxX && p.z > u.minZ && p.z < u.maxZ,
      );
      const pot = props.find((p) => p.prop === 'pot');
      const steamer = props.find((p) => p.prop === 'steamer');
      const target = pot ?? steamer;
      if (!target) return null;
      return {
        pot: !!pot,
        steamer: !!steamer,
        aim: { x: target.x, y: 0.85, z: target.z },
        eye: {
          x: target.x + u.nx * 2.4,
          y: 1.65,
          z: target.z + (u.nz === 0 ? 1.6 : 0),
        },
        stand: { x: (u.minX + u.maxX) / 2, z: (u.minZ + u.maxZ) / 2 },
      };
    }, unit);
    if (aim) break;
  }
  if (!aim) throw new Error('fenjiao: pot/steamer never streamed');
  console.log('  ', aim);

  await page.evaluate(([f]) => {
    const n = window.__nn;
    globalThis.__hideAvatar = true;
    window.__game.teleport(f.stand.x, f.stand.z, 0);
    n.camera.near = 0.1;
    n.camera.fov = 55;
    n.camera.position.set(f.eye.x, f.eye.y, f.eye.z);
    n.camera.lookAt(f.aim.x, f.aim.y, f.aim.z);
    n.camera.updateProjectionMatrix();
    n.camera.updateMatrixWorld(true);
    globalThis.freezeCam = true;
  }, [aim]);
  await page.waitForTimeout(700);
  const path = join(OUT, 'accept-interior-fenjiao.png');
  await page.screenshot({ path, timeout: 180000 });
  assertRealShot(path);
  const lit = litFraction(path);
  if (lit < 0.35) throw new Error(`${path} too dark (lit=${lit})`);
  if (MEDIA) copyFileSync(path, join(MEDIA, 'accept-interior-fenjiao.png'));
  console.log('  → interior-fenjiao', path, `${(statSync(path).size / 1024) | 0}KB`, `lit=${lit.toFixed(2)}`);
  await page.evaluate(() => {
    globalThis.__hideAvatar = false;
  });
}

async function shootNightStreet() {
  console.log('night');
  await goto('t=0.82&hud=0');
  await waitPolyEbikes();
  // Mid-street where spaced kerb scooters land (~ STREET_Z0+25+45k).
  await page.evaluate(() => window.__game.teleport(0, -35, Math.PI / 2));
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const n = window.__nn;
    globalThis.__hideAvatar = true;
    // Look down the street with the west kerb (scooters) in the left third.
    n.camera.position.set(1.2, 2.4, -28);
    n.camera.lookAt(-2.5, 1.1, -50);
    globalThis.freezeCam = true;
  });
  await page.waitForTimeout(800);
  await shot('night-street');
  await page.evaluate(() => {
    globalThis.__hideAvatar = false;
  });
}

// ── Optional: hero / door / night (skipped when ONLY=interiors|poly) ─────────
if (ONLY === 'all') {
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

  await shootFujiDoor();
}

if (ONLY === 'poly') {
  await shootFujiDoor();
}

// ── Shop interiors ──────────────────────────────────────────────────────────
if (ONLY === 'all' || ONLY === 'interiors' || ONLY === 'poly') {
  console.log('interiors');
  if (ONLY === 'interiors' || ONLY === 'poly') await goto('t=0.45&hud=0');
  // Give the Kenney furniture kit a moment after boot before entering rooms.
  await page.waitForTimeout(2500);

  if (ONLY === 'poly') {
    await shootFenjiaoWok();
  } else {
    const shops = [
      ['fuji', 'laoyou'],
      ['zhongshan-fenjiao', 'fenjiao'],
      ['rongji', 'bbq'],
      ['hengzhou', 'milktea'],
    ];
    for (const [id, name] of shops) {
      await shootInterior(id, name);
    }
  }
}

if (ONLY === 'all' || ONLY === 'poly') {
  await shootNightStreet();
}

console.log('errs:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
