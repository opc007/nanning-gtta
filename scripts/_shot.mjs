/**
 * Screenshot rig. Positions the camera RELATIVE to the player, so framing is
 * stable no matter where the map puts them, and drives real input so the shots
 * show the game actually running rather than a posed still.
 */
import { chromium } from 'playwright';
const URL = process.env.URL;
const b = await chromium.launch({ executablePath: '/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 640 }, ignoreHTTPSErrors: true });
p.setDefaultTimeout(180000);
const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(4500);
await p.evaluate(() => window.__skipSplash?.());
await p.waitForTimeout(2000);

/** spec: name | dist,height,azimuth | aimHeight | settle | keys */
for (const spec of (process.env.SHOTS ?? '').split(';').filter((s) => s && s.trim())) {
  const [name, cam, aimH, settle, keys] = spec.split('|');
  if (keys) for (const k of keys.split(',')) await p.keyboard.press(k.trim());
  if (cam !== 'auto') {
    const [d, h, az] = cam.split(',').map(Number);
    await p.evaluate(([d, h, az, ah]) => {
      const n = window.__nn, pl = n.player;
      // Place the camera on a circle around the player, then look at them.
      const a = az;
      n.camera.position.set(pl.x + Math.cos(a) * d, h, pl.z + Math.sin(a) * d);
      n.camera.lookAt(pl.x, ah, pl.z);
      globalThis.freezeCam = true;
    }, [d, h, az, Number(aimH ?? 1.1)]);
  }
  await p.waitForTimeout(Number(settle ?? 900));
  await p.screenshot({ path: `/workspace/shot-${name}.png`, timeout: 180000 });
  console.log('  →', name);
}
console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
