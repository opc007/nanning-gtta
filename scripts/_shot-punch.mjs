// 出拳姿态回归。
// swiftshader 只有 ~4 fps，等真实按键时序再截图永远抓不到拳头伸直的那一帧，
// 所以这里直接驱动 rig 到指定的 punch 进度再取景。
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

for (const k of (process.env.PROGRESS ?? '0.7').split(',')) {
  await p.evaluate((punch) => {
    const n = window.__nn, pl = n.player, rig = n.avatar;
    // The avatar's yaw is copied from the player every frame, so a world-space
    // camera lands at an arbitrary angle to the punch depending on where the
    // player happens to be facing. Pin the facing first, then place the camera
    // relative to it. heading 0 faces +X, which is the direction the punch
    // extends.
    pl.heading = 0; pl.ph = 0;
    // Side-on to the punch, which is the only angle that shows an extension
    // in full: at 45 degrees the fist foreshortens into the body and the
    // whole thing reads as the arm waving beside the torso.
    // Measured, not guessed: with the heading pinned to 0 the punch extends
    // along -Z, so the camera goes exactly along +X — perpendicular to the
    // extension and at shoulder height. The previous 0.5 m Z offset tilted it
    // into a three-quarter, where an outstretched arm foreshortens into a
    // shape that reads as "arms held out".
    n.camera.position.set(pl.x, pl.y + 1.3, pl.z - 2.6);
    n.camera.lookAt(pl.x, pl.y + 1.3, pl.z);
    globalThis.freezeCam = true;
    // The loop re-drives the rig every frame, so hold the punch by feeding the
    // same value in a rAF right before the screenshot lands.
    globalThis.__forcePunch = Number(punch);
    rig.update(0, 1 / 60, { state: 'idle', stateTime: 0, vy: 0, punch: Number(punch) });
  }, k);
  // swiftshader runs at ~4 fps: the game loop re-drives the rig every frame, so a
  // short wait here caught the punch before the loop had rendered a frame with
  // it, which is why the shot came out as a near-T-pose.
  await p.waitForTimeout(1400);
  await p.evaluate((punch) => {
    window.__nn.avatar.update(0, 1 / 60, { state: 'idle', stateTime: 0, vy: 0, punch: Number(punch) });
  }, k);
  await p.screenshot({ path: `/workspace/punch-${k}.png`, timeout: 180000 });
  console.log('  → punch', k);
}
console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
