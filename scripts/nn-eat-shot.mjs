/**
 * One still: a bowl of noodles, and the blood back in the player's body.
 *
 * The panel is a real DOM panel and the purchase is a real click, so the
 * health number in the shot is the game's own arithmetic.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const PINNED = '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const EXE = existsSync(PINNED) ? PINNED : undefined;
const URL = process.env.URL ?? 'http://127.0.0.1:5244/?t=0.45';
const OUT = '/workspace/nn-handover/docs/pr-screenshots/task8';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
p.setDefaultTimeout(300000);
const errs = [];
p.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
await p.goto(URL, { waitUntil: 'load' });
await p.waitForTimeout(6000);
await p.evaluate(() => window.__skipSplash?.());
await p.waitForFunction(() => !!(window.__nn?.session?.shops ?? window.__nn?.shops), null, { timeout: 420000 });
await p.waitForTimeout(6000);

const shops = await p.evaluate(() => {
  const s = window.__nn.session?.shops ?? window.__nn.shops;
  const units = s.states ?? s.units ?? s.shops ?? s.list ?? [];
  const n = window.__nn;
  const pl = n.player;
  const pick = units.find((u) => /老友/.test(u.unit?.def?.name ?? '')) ?? units[0];
  if (!pick) return { ok: false, count: units.length };
  const x = pick.unit?.x ?? pick.x ?? 0;
  const z = pick.unit?.z ?? pick.z ?? 0;
  // Stand under the arcade, in front of the shop.
  pl.x = x > 0 ? 6.0 : -6.0;
  pl.z = z;
  return {
    ok: true,
    name: pick.unit?.def?.name ?? null,
    items: (pick.unit?.def?.items ?? []).map((i) => ({ id: i.id, name: i.name, price: i.price, fill: i.fill })),
    at: [x, z],
  };
});
console.log('SHOPS', JSON.stringify(shops));
await p.waitForTimeout(4000);

const focused = await p.evaluate(() => {
  const s = window.__nn.session.shops;
  return { focused: s.focused?.unit?.def?.name ?? null };
});
console.log('FOCUSED', JSON.stringify(focused));

// Get bloodied first: a bowl of noodles only means something when the bar
// was low. `health` is a getter, so the way to lose it is the way the game
// loses it — somebody swings at you.
await p.evaluate(() => {
  const c = window.__nn.session?.crowd;
  c?.onSwing?.(0, 0, 40);
});
await p.waitForTimeout(1500);
const before = await p.evaluate(() => window.__game?.health ?? null);
// The headless renderer runs at about one frame a second, so a key press
// can land between two frames. Press E until the shop's price buttons are
// really there, and stop as soon as they are.
let panel = null;
for (let i = 0; i < 6; i += 1) {
  await p.keyboard.press('KeyE');
  await p.waitForTimeout(2500);
  panel = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((x) => /¥/.test(x.textContent ?? ''));
    return { count: btns.length, open: !!document.querySelector('button') };
  });
  if (panel.count) break;
}
console.log('PANEL', JSON.stringify(panel));
const clicked = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((x) => /¥/.test(x.textContent ?? ''));
  if (!btns.length) return null;
  btns[0].click();
  return btns[0].textContent?.trim() ?? null;
});
console.log('CLICKED', clicked, 'health before', before);
await p.waitForTimeout(5000);
const after = await p.evaluate(() => window.__game?.health ?? null);
console.log('HEALTH', before, '->', after);
await p.screenshot({ path: `${OUT}/eat-heal.png`, timeout: 300000 });
console.log('  → eat-heal', before, after);
console.log('errs:', errs.length ? errs.slice(0, 3) : 'none');
await b.close();
