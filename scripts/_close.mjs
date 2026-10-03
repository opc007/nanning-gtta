// Close-up portrait shots: a character is judged at 3 m, not at 20.
import { chromium } from 'playwright';
import { preview } from 'vite';
const server = await preview({ preview: { port: 5220 } });
const b = await chromium.launch({ executablePath: '/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 620 } });
p.setDefaultTimeout(150000);
const errs=[]; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
await p.goto(server.resolvedUrls.local[0], { waitUntil: 'load' });
await p.waitForTimeout(4000);
await p.evaluate(() => window.__skipSplash?.());
await p.waitForTimeout(3000);
const info = await p.evaluate(() => {
  const n = window.__nn;
  return { cam: [n.camera.position.x, n.camera.position.y, n.camera.position.z].map(v=>+v.toFixed(1)),
           player: [n.player.x, n.player.z].map(v=>+v.toFixed(1)) };
});
console.log('cam', info.cam, 'player', info.player);
// Drop the camera to a portrait framing in front of the player.
await p.evaluate(() => {
  const n = window.__nn, pl = n.player;
  n.camera.position.set(pl.x + 2.6, 1.55, pl.z - 3.4);
  n.camera.lookAt(pl.x, 1.05, pl.z);
  n.__freeze = true;
});
await p.waitForTimeout(2500);
await p.screenshot({ path: process.env.OUT || '/workspace/portrait.png', timeout: 150000 });
console.log('errs:', errs.length ? errs.slice(0,3) : 'none');
await b.close(); server.close();
