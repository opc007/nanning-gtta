/**
 * Street-level shot of 中山路, framed from the actual layout data rather than
 * a fixed guess: find the two building runs, stand at one end of the street,
 * and look down it. `?t=` picks daylight or dusk.
 */
import { chromium } from 'playwright';
const URL = process.env.URL;
const b = await chromium.launch({ executablePath: '/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1100, height: 680 }, ignoreHTTPSErrors: true });
p.setDefaultTimeout(180000);
const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(4500);
await p.evaluate(() => window.__skipSplash?.());
await p.waitForTimeout(2500);

const info = await p.evaluate(() => {
  const n = window.__nn;
  const bs = n.city?.buildings ?? [];
  const kinds = {};
  for (const x of bs) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  return { count: bs.length, kinds, first: bs.slice(0, 3), player: { x: n.player.x, z: n.player.z } };
});
console.log(JSON.stringify(info).slice(0, 900));

for (const spec of (process.env.SHOTS ?? '').split(';').filter(s => s && s.trim())) {
  const [name, d, h, aimH, ax, az] = spec.split('|');
  await p.evaluate(([d, h, ah, ax, az]) => {
    const n = window.__nn, pl = n.player;
    n.camera.position.set(pl.x + ax * d, h, pl.z + az * d);
    n.camera.lookAt(pl.x, ah, pl.z);
    globalThis.freezeCam = true;
  }, [Number(d), Number(h), Number(aimH ?? 1.4), Number(ax), Number(az)]);
  await p.waitForTimeout(1100);
  await p.screenshot({ path: `/workspace/zl-${name}.png`, timeout: 180000 });
  console.log('  →', name);
}
console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
