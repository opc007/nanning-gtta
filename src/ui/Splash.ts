/**
 * Start splash: a CSS title card on black.
 *
 * This used to be `public/splash.png` — a 2.7 MB title image inherited from the
 * upstream project, carrying that project's name. A CSS card is ~0 bytes of
 * asset, scales to any viewport, and can say what this game actually is.
 * Click / tap / any key / any gamepad button continues. Fade-to-black then
 * fade-from-black. The first gesture also unlocks audio (autoplay policy).
 * Given an id so the e2e harness can remove it before testing.
 */
export function showSplash(container: HTMLElement, onContinue?: () => void): void {
  const overlay = document.createElement('div');
  overlay.id = 'splash';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:100;background:#080706;display:flex;' +
    'flex-direction:column;align-items:center;justify-content:center;transition:opacity .6s ease;' +
    'touch-action:none;cursor:pointer;';

  // Warm lantern glow behind the title, so the card is not a black rectangle.
  const glow = document.createElement('div');
  glow.style.cssText =
    'position:absolute;width:min(150vw,1200px);height:min(150vw,1200px);border-radius:50%;' +
    'background:radial-gradient(circle,rgba(255,168,40,.16),rgba(255,120,30,.05) 45%,transparent 70%);' +
    'animation:splashBreathe 5s ease-in-out infinite;';
  overlay.appendChild(glow);

  const card = document.createElement('div');
  card.style.cssText = 'position:relative;text-align:center;transition:opacity .4s ease;';

  const kicker = document.createElement('div');
  kicker.textContent = 'NANNING · GUANGXI';
  kicker.style.cssText =
    'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:clamp(9px,1.5vw,13px);' +
    'letter-spacing:.55em;color:rgba(255,210,74,.72);margin-bottom:1.4em;';

  const title = document.createElement('div');
  title.textContent = '南宁街头';
  title.style.cssText =
    'font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;' +
    'font-size:clamp(46px,11vw,132px);font-weight:900;letter-spacing:.16em;' +
    'color:#f3ece0;text-shadow:0 0 40px rgba(255,168,40,.35),0 6px 26px rgba(0,0,0,.9);';

  const sub = document.createElement('div');
  sub.textContent = '半城绿树半城楼 · 友仔，食粉未？';
  sub.style.cssText =
    'font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;' +
    'font-size:clamp(12px,2.1vw,20px);letter-spacing:.2em;color:rgba(243,236,224,.62);margin-top:1.1em;';

  const rule = document.createElement('div');
  rule.style.cssText = 'width:min(56vw,340px);height:1px;margin:2.2em auto 0;background:linear-gradient(90deg,transparent,rgba(255,210,74,.5),transparent);';

  const feats = document.createElement('div');
  feats.textContent = '买奶茶　·　嗦老友粉　·　逛夜市　·　砸铺子　·　飙电瓶车';
  feats.style.cssText =
    'font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;' +
    'font-size:clamp(10px,1.7vw,14px);letter-spacing:.14em;color:rgba(243,236,224,.42);margin-top:1.9em;';

  card.append(kicker, title, sub, rule, feats);
  overlay.appendChild(card);

  const cardStyle = document.createElement('style');
  cardStyle.textContent = '@keyframes splashBreathe{0%,100%{opacity:.75;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}';
  overlay.appendChild(cardStyle);

  const img = card; // the fade target — one element, one animation

  const hint = document.createElement('div');
  hint.textContent = '点击 / 按任意键 开始';
  hint.style.cssText =
    'position:absolute;bottom:7%;left:0;right:0;text-align:center;' +
    'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;' +
    'color:rgba(255,210,74,.85);text-shadow:0 1px 3px #000;transition:opacity .4s ease;' +
    'letter-spacing:.3em;' +
    'animation:splashPulse 1.4s ease-in-out infinite;';
  const style = document.createElement('style');
  style.textContent = '@keyframes splashPulse{0%,100%{opacity:.35}50%{opacity:.9}}';
  overlay.appendChild(hint);

  container.appendChild(overlay);

  let dismissed = false;
  let padRaf = 0;

  const cleanup = (): void => {
    removeEventListener('pointerdown', dismiss);
    removeEventListener('keydown', dismiss);
    cancelAnimationFrame(padRaf);
  };

  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    onContinue?.(); // unlock audio — covers the gamepad path (no DOM gesture event)
    cleanup();
    // Phase 1 — fade the title out to pure black.
    img.style.opacity = '0';
    hint.style.opacity = '0';
    hint.style.animation = 'none';
    // Phase 2 — fade the black away, revealing (fading in) the game.
    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => overlay.remove(), 650);
    }, 420);
  };

  addEventListener('pointerdown', dismiss);
  addEventListener('keydown', dismiss);

  // Gamepads aren't event-driven — poll for any pressed button while shown.
  const pollPad = (): void => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.buttons.some((b) => b.pressed)) {
        dismiss();
        return;
      }
    }
    padRaf = requestAnimationFrame(pollPad);
  };
  padRaf = requestAnimationFrame(pollPad);

  // Test hook: tear the splash down instantly (cancels the poll + listeners),
  // instead of removing the element and leaking the rAF loop.
  (window as Window & { __skipSplash?: () => void }).__skipSplash = (): void => {
    cleanup();
    overlay.remove();
  };
}
