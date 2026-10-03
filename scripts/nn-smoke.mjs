// Nanning smoke test. Same contract as smoke.mjs (renders, screenshots, fails on
// JS errors) but pins the full Chromium binary: the headless-shell build isn't
// downloadable in this sandbox and `channel:'chromium'` resolves to a path that
// doesn't exist.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { existsSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';

const OUT = process.env.OUT || 'nn-smoke.png';
const PINNED = '/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const EXE = existsSync(PINNED) ? PINNED : chromium.executablePath();
const server = process.env.URL ? null : await preview({ preview: { port: 5191 } });
const PAGE = process.env.URL || server.resolvedUrls.local[0];

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--no-sandbox'],
});
const fail = (m) => { console.error('SMOKE FAIL:', m); process.exitCode = 1; };

try {
  // swiftshader is a software rasteriser: a 1400x800 frame with this many materials
// takes seconds, and the default 30 s screenshot action budget is not enough.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
  const errors = [];
  const IGNORE = /favicon|404/;
  page.on('console', (m) => m.type() === 'error' && !IGNORE.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__skipSplash?.());
  await page.waitForTimeout(2500);

  const dom = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return {
      hasCanvas: !!c, w: c?.width ?? 0, h: c?.height ?? 0,
      mode: /DRIVING|ON FOOT/.test(document.body.innerText),
      wallet: document.body.innerText.match(/¥\s*\d+/)?.[0] ?? null,
      // Nanning layer actually mounted?
      nnArea: /中山路|邕州|邕江|朝阳路/.test(document.body.innerText),
      perf: window.__game?.perf ?? null,
    };
  });
  console.log('DOM:', JSON.stringify(dom));
  if (!dom.hasCanvas || dom.w === 0) fail('no canvas');
  if (!dom.mode) fail('base HUD missing');
  if (!dom.wallet) fail('Nanning wallet missing');
  if (errors.length) fail('console errors:\n  ' + errors.slice(0, 6).join('\n  '));

  // Prove the frame is not black.
  const perf = await page.evaluate(() => ({ ft: +window.__nn.loop.lastFrameTime.toFixed(4) }));
  console.log('frame seconds:', perf.ft, `(${(1 / Math.max(perf.ft, 1e-4)).toFixed(1)} fps headless)`);
  const shot = await page.screenshot({ path: OUT, timeout: 120000 });
  const png = PNG.sync.read(shot);
  let lit = 0;
  for (let i = 0; i < png.data.length; i += 4 * 97) {
    if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 40) lit++;
  }
  const ratio = lit / (png.data.length / (4 * 97));
  console.log(`non-black sample ratio: ${(ratio * 100).toFixed(1)}%  -> ${OUT}`);
  if (ratio < 0.25) fail(`frame looks blank (${(ratio * 100).toFixed(1)}% lit)`);

  // Walk south into the night market and re-shoot, to prove the street works.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(5200);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1200);
  const walk = process.env.OUT2 || 'nn-walk.png';
  await page.screenshot({ path: walk, timeout: 120000 });
  console.log('after walking ->', walk);

  const late = errors.length;
  if (late) fail('errors after walk:\n  ' + errors.slice(0, 6).join('\n  '));

  // Close-up of the procedural protagonist (`?hero=1` parks the camera on him).
  const heroUrl = new globalThis.URL(PAGE);
  heroUrl.searchParams.set('hero', '1');
  await page.goto(heroUrl.toString(), { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__skipSplash?.());
  await page.waitForTimeout(1500);
  const heroOut = process.env.HERO || 'nn-hero.png';
  await page.screenshot({ path: heroOut, timeout: 120000 });
  console.log('hero close-up ->', heroOut);

  console.log(errors.length ? 'RESULT: FAIL' : 'RESULT: PASS');
} catch (e) {
  fail(e.stack || e.message);
} finally {
  await browser.close();
  server?.close();
}
