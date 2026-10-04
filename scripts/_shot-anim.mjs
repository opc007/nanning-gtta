// 动画回归：按住键跑一段再截图，专门看走/跑/跳/出拳的骨骼姿态。
// 用法: SHOTS="walk:KeyW:2500" node scripts/_shot-anim.mjs
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5244/?t=0.45&hud=0';
const b = await chromium.launch({
  executablePath: '/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 900, height: 640 } });
p.setDefaultTimeout(180000);
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(4500);
await p.evaluate(() => window.__skipSplash?.());
await p.waitForTimeout(2000);

// 冻结镜头在角色侧前方，方便看清四肢
async function frame(dist, az, aim) {
  await p.evaluate(([d, a, h]) => {
    const n = window.__nn, pl = n.player;
    pl.heading = 0; pl.ph = 0;
    // Dead side-on. The heading is pinned to 0, so the character faces -Z and
    // a camera along +X is perpendicular to it. From three-quarter the legs
    // overlap into what reads as one leg passing through the other.
    n.camera.position.set(pl.x + d, pl.y + 1.1, pl.z);
    n.camera.lookAt(pl.x, pl.y + h, pl.z);
    globalThis.freezeCam = true;
  }, [dist, az, aim]);
}

const specs = (process.env.SHOTS ?? 'idle').split(';').filter(Boolean);
for (const spec of specs) {
  // name|keys|holdMs|tapMs|dist|aim — dist/aim override the default framing.
  // A jump carries the head out of frame at the default, which makes for a
  // poor acceptance shot even when the pose itself is right.
  const [name, keys, holdMs, tapMs, dist, aim] = spec.split('|');
  const down = (keys ?? '').split(',').filter(Boolean);
  for (const k of down) await p.keyboard.down(k);
  await p.waitForTimeout(Number(holdMs ?? 1200));
  if (tapMs) {
    for (let i = 0; i < 3; i++) { await p.keyboard.press('KeyJ'); await p.waitForTimeout(Number(tapMs)); }
  }
  await frame(Number(dist ?? 2.2), 1.15, Number(aim ?? 0.95));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `/workspace/anim-${name}.png`, timeout: 180000 });
  for (const k of down) await p.keyboard.up(k);
  console.log('  →', name);
}
console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
