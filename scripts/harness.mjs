/**
 * Test harness. The blocker for every automated check so far has been that
 * synthetic key events never reached the game: the canvas was never focused, so
 * the input layer was listening to a document nobody had given focus to.
 *
 * So: click the canvas for real (which also takes pointer lock, the way a
 * player enters), then drive. Everything downstream — perf numbers, walk tests,
 * ram tests — needs this to work first.
 */
import { chromium } from 'playwright';
export async function open(opts = {}) {
  const b = await chromium.launch({
    executablePath: '/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'],
  });
  // Small by default on purpose. Under swiftshader the cost is fill rate, not
  // game logic, so a 320x200 window runs the simulation at a speed where tests
  // finish; pass a real viewport only when you want a screenshot.
  const p = await b.newPage({ viewport: opts.viewport ?? { width: 320, height: 200 }, ignoreHTTPSErrors: true });
  p.setDefaultTimeout(opts.timeout ?? 120000);
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
  await p.goto(opts.url ?? 'http://127.0.0.1:4173/?hud=0&t=0.79', { waitUntil: 'load' });
  await p.waitForTimeout(4500);
  await p.evaluate(() => window.__skipSplash?.());
  await p.waitForTimeout(1200);
  // Take focus the way a player does: click the canvas.
  const box = await p.locator('canvas').first().boundingBox();
  if (box) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(1200);
  return { b, p, errs };
}

/** Hold keys for `ms`, then release. */
export async function hold(p, keys, ms) {
  for (const k of keys) await p.keyboard.down(k);
  await p.waitForTimeout(ms);
  for (const k of keys) await p.keyboard.up(k);
  await p.waitForTimeout(250);
}

/** Read the bits of world state a gameplay assertion needs. */
export async function probe(p) {
  return p.evaluate(() => {
    const n = window.__nn, pl = n.player;
    return {
      x: +pl.x.toFixed(3), y: +pl.y.toFixed(3), z: +pl.z.toFixed(3),
      speed: +pl.speed.toFixed(3), heading: +pl.heading.toFixed(3),
      grounded: pl.grounded,
    };
  });
}
