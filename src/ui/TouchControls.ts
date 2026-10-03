import { stickVector } from '../core/math';
import {
  createElement,
  type IconNode,
  Car,
  Hand,
  ChevronsRight,
  RotateCcw,
  Radio,
  Grab,
  Maximize,
  Minimize,
  ArrowUp,
  ArrowDown,
  Package,
} from 'lucide';

/** Build a lucide SVG sized for a control, transparent to pointer events. */
function icon(node: IconNode, size = 30): SVGElement {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.style.pointerEvents = 'none';
  return svg;
}

/**
 * On-screen controls for touch devices: a left analog joystick (steer +
 * throttle when driving, move direction on foot) and right-hand action
 * buttons. Exposes the same shape of intent the keyboard does — an analog
 * move vector plus held/edge buttons — so `Controls` can merge the two
 * without either side knowing about the other.
 *
 * Pointer events (not touch events) drive it, so Chromium's synthetic touch in
 * tests and real fingers both work; move/up are tracked on `window` so a drag
 * that slides off the knob keeps following.
 */
export class TouchControls {
  private readonly vec = { x: 0, y: 0 };
  private brakeHeld = false;
  private sprintHeld = false;
  private enterEdge = false;
  private resetEdge = false;
  private radioEdge = false;
  private punchEdge = false;
  private jumpEdge = false;
  private jumpDown = false;
  private crouchEdge = false;
  private grabEdge = false;
  private interactEdge = false;
  private lookDx = 0;
  private lookDy = 0;
  private lookPointer: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;

  private stickPointer: number | null = null;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly radius = 58;

  constructor(root: HTMLElement) {
    // Kill browser pinch/double-tap zoom that touch-action alone misses on iOS
    // Safari. Multi-finger touchmove and Safari gesture events would otherwise
    // zoom/pan the whole page mid-game.
    const block = (e: Event): void => e.preventDefault();
    window.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, {
      passive: false,
    });
    document.addEventListener('gesturestart', block);
    document.addEventListener('gesturechange', block);
    document.addEventListener('dblclick', block);

    root.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:5;' +
      'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';

    this.base = div(
      root,
      'tc-stick',
      'position:absolute;left:calc(26px + env(safe-area-inset-left));' +
        'bottom:calc(26px + env(safe-area-inset-bottom));width:140px;height:140px;border-radius:50%;' +
        'background:rgba(20,26,40,.4);border:2px solid rgba(255,255,255,.18);pointer-events:auto;touch-action:none;',
    );
    this.knob = div(
      this.base,
      'tc-knob',
      'position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;border-radius:50%;' +
        'background:rgba(230,238,255,.55);border:2px solid rgba(255,255,255,.5);pointer-events:none;',
    );

    this.base.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      this.moveStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) this.moveStick(e.clientX, e.clientY);
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.vec.x = 0;
      this.vec.y = 0;
      this.knob.style.transform = 'translate(0px,0px)';
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // A 2x2 grid keeps every button on screen even on a short landscape phone
    // (a tall column pushed the top button off the top edge).
    const pad = div(
      root,
      'tc-buttons',
      'position:absolute;right:calc(20px + env(safe-area-inset-right));' +
        'bottom:calc(20px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(2,66px);' +
        'grid-auto-rows:66px;gap:12px;pointer-events:none;',
    );
    this.holdButton(pad, 'tc-enter', Car, 'enter / exit', () => (this.enterEdge = true));
    this.holdButton(
      pad,
      'tc-brake',
      Hand,
      'handbrake',
      () => (this.brakeHeld = true),
      () => (this.brakeHeld = false),
    );
    this.holdButton(
      pad,
      'tc-sprint',
      ChevronsRight,
      'sprint',
      () => (this.sprintHeld = true),
      () => (this.sprintHeld = false),
    );
    this.holdButton(pad, 'tc-reset', RotateCcw, 'reset', () => (this.resetEdge = true));
    this.holdButton(pad, 'tc-radio', Radio, 'radio', () => (this.radioEdge = true));
    this.holdButton(pad, 'tc-punch', Grab, 'punch', () => (this.punchEdge = true));
    this.holdButton(
      pad,
      'tc-jump',
      ArrowUp,
      'jump',
      () => {
        this.jumpEdge = true;
        this.jumpDown = true;
      },
      () => (this.jumpDown = false),
    );
    this.holdButton(pad, 'tc-crouch', ArrowDown, 'crouch', () => (this.crouchEdge = true));
    this.holdButton(pad, 'tc-grab', Package, 'pick up', () => (this.grabEdge = true));
    this.holdButton(pad, 'tc-interact', Radio, 'interact', () => (this.interactEdge = true));

    // Right-half drag orbits the camera. Buttons sit above this layer.
    const look = div(
      root,
      'tc-look',
      'position:absolute;left:50%;top:0;right:0;bottom:0;pointer-events:auto;touch-action:none;z-index:1;',
    );
    pad.style.zIndex = '2';
    look.addEventListener('pointerdown', (e) => {
      if (this.lookPointer !== null) return;
      this.lookPointer = e.pointerId;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
      e.preventDefault();
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.lookDx += e.clientX - this.lookLastX;
      this.lookDy += e.clientY - this.lookLastY;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
    });
    const endLook = (e: PointerEvent): void => {
      if (e.pointerId !== this.lookPointer) return;
      this.lookPointer = null;
    };
    window.addEventListener('pointerup', endLook);
    window.addEventListener('pointercancel', endLook);

    this.addFullscreenButton(root);
  }

  /**
   * Top-right fullscreen toggle. Uses the Fullscreen API where it exists
   * (Android Chrome, iPadOS, desktop). iPhone Safari has no element-fullscreen
   * API at all — there the real path is Add to Home Screen (the PWA meta tags in
   * index.html make that launch chrome-less), so the button just no-ops there.
   */
  private addFullscreenButton(root: HTMLElement): void {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => void;
    };
    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => void;
    };
    const btn = div(
      root,
      'tc-fullscreen',
      'position:absolute;top:calc(14px + env(safe-area-inset-top));' +
        'right:calc(14px + env(safe-area-inset-right));width:54px;height:54px;border-radius:50%;z-index:3;' +
        'pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(20,26,40,.55);border:2px solid rgba(255,255,255,.22);color:#e8ecf5;',
    );
    btn.setAttribute('aria-label', 'fullscreen');
    const isFull = (): boolean => !!(document.fullscreenElement || doc.webkitFullscreenElement);
    const paint = (): void => {
      btn.replaceChildren(icon(isFull() ? Minimize : Maximize, 26));
    };
    paint();
    document.addEventListener('fullscreenchange', paint);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (isFull()) {
        (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
      } else {
        (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
      }
    });
  }

  private moveStick(clientX: number, clientY: number): void {
    const r = this.base.getBoundingClientRect();
    const v = stickVector(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2), this.radius);
    this.vec.x = v.x;
    this.vec.y = v.y;
    this.knob.style.transform = `translate(${v.x * this.radius}px,${-v.y * this.radius}px)`;
  }

  private holdButton(
    parent: HTMLElement,
    id: string,
    glyph: IconNode,
    label: string,
    onDown: () => void,
    onUp?: () => void,
  ): void {
    const b = div(
      parent,
      id,
      'width:66px;height:66px;border-radius:50%;pointer-events:auto;touch-action:none;' +
        'display:flex;align-items:center;justify-content:center;' +
        'background:rgba(20,26,40,.55);border:2px solid rgba(255,255,255,.22);color:#e8ecf5;',
    );
    b.appendChild(icon(glyph));
    b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', (e) => {
      onDown();
      b.style.background = 'rgba(90,120,180,.7)';
      e.preventDefault();
    });
    const up = (e: PointerEvent): void => {
      if (onUp) onUp();
      b.style.background = 'rgba(20,26,40,.55)';
      e.preventDefault();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }

  stick(): { x: number; y: number } {
    return this.vec;
  }
  get handbrake(): boolean {
    return this.brakeHeld;
  }
  get sprint(): boolean {
    return this.sprintHeld;
  }
  consumeEnter(): boolean {
    const e = this.enterEdge;
    this.enterEdge = false;
    return e;
  }
  consumeReset(): boolean {
    const r = this.resetEdge;
    this.resetEdge = false;
    return r;
  }
  consumeRadio(): boolean {
    const r = this.radioEdge;
    this.radioEdge = false;
    return r;
  }
  consumePunch(): boolean {
    const p = this.punchEdge;
    this.punchEdge = false;
    return p;
  }
  get jumpHeld(): boolean {
    return this.jumpDown;
  }
  consumeJump(): boolean {
    const j = this.jumpEdge;
    this.jumpEdge = false;
    return j;
  }
  consumeCrouch(): boolean {
    const c = this.crouchEdge;
    this.crouchEdge = false;
    return c;
  }
  consumeGrab(): boolean {
    const g = this.grabEdge;
    this.grabEdge = false;
    return g;
  }
  consumeInteract(): boolean {
    const i = this.interactEdge;
    this.interactEdge = false;
    return i;
  }
  /** Pixels of right-half drag since the last consume. */
  consumeLook(): { x: number; y: number } {
    const x = this.lookDx;
    const y = this.lookDy;
    this.lookDx = 0;
    this.lookDy = 0;
    return { x, y };
  }
}

function div(parent: HTMLElement, id: string, css: string): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = css;
  parent.appendChild(el);
  return el;
}
