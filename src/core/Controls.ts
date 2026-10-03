import { clamp } from './math';
import { Input } from './Input';
import { GamepadInput, GP } from './gamepad';
import { TouchControls } from '../ui/TouchControls';

/**
 * The single source of player intent. Keyboard, touch, and gamepad all feed
 * the same analog move vector plus held modifiers and edge actions.
 *
 *   driving: throttle = move.y, steer = -move.x, Space / B = handbrake
 *   on foot: forward  = move.y, strafe = move.x
 *            Space = jump, Shift = sprint, C = crouch, Alt = walk
 *            J / left click = punch, G / right click = pick up
 *            E = shop interact, F = enter/exit a vehicle
 */
export class Controls {
  private readonly kb = new Input();
  private readonly pad = new GamepadInput();
  private readonly touch?: TouchControls;

  constructor(touchRoot?: HTMLElement) {
    if (touchRoot) this.touch = new TouchControls(touchRoot);
  }

  move(onFoot = false): { x: number; y: number } {
    let x = this.kb.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    let y = this.kb.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    if (this.touch) {
      const t = this.touch.stick();
      x += t.x;
      y += t.y;
    }
    const g = this.pad.move(onFoot);
    x += g.x;
    y += g.y;
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  /** Alt, or an analog stick held under half deflection with no keyboard. */
  walkMod(): boolean {
    if (this.kb.isDown('AltLeft') || this.kb.isDown('AltRight')) return true;
    const kb =
      this.kb.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) !== 0 ||
      this.kb.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) !== 0;
    if (kb) return false;
    const g = this.pad.move(true);
    const t = this.touch?.stick() ?? { x: 0, y: 0 };
    const mag = Math.hypot(g.x + t.x, g.y + t.y);
    return mag > 0.05 && mag < 0.5;
  }

  /** Driving only. Space is jump once you're on foot. */
  handbrake(): boolean {
    return this.kb.isDown('Space') || (this.touch?.handbrake ?? false) || this.pad.handbrake();
  }

  sprint(onFoot = false): boolean {
    return (
      this.kb.isDown('ShiftLeft') ||
      this.kb.isDown('ShiftRight') ||
      (this.touch?.sprint ?? false) ||
      this.pad.sprint(onFoot)
    );
  }

  jumpPressed(): boolean {
    const key = this.kb.wasPressed('Space');
    const tap = this.touch?.consumeJump() ?? false;
    return key || tap || this.pad.wasPressed(GP.A);
  }

  jumpHeld(): boolean {
    return this.kb.isDown('Space') || (this.touch?.jumpHeld ?? false) || this.pad.isDown(GP.A);
  }

  crouchPressed(): boolean {
    const key = this.kb.wasPressed('KeyC');
    const tap = this.touch?.consumeCrouch() ?? false;
    return key || tap || this.pad.wasPressed(GP.B);
  }

  /** Shop / talk. Does not enter a vehicle. */
  interactPressed(): boolean {
    const key = this.kb.wasPressed('KeyE');
    const tap = this.touch?.consumeInteract() ?? false;
    return key || tap || this.pad.wasPressed(GP.DU);
  }

  /** Enter or exit a vehicle. F on the keyboard, RB on a pad. */
  mountPressed(): boolean {
    const key = this.kb.wasPressed('KeyF');
    const tap = this.touch?.consumeEnter() ?? false;
    return key || tap || this.pad.wasPressed(GP.RB);
  }

  resetPressed(): boolean {
    const key = this.kb.wasPressed('KeyR');
    const tap = this.touch?.consumeReset() ?? false;
    return key || tap || this.pad.wasPressed(GP.BACK);
  }

  /** On-foot melee. J or left click. */
  attackPressed(): boolean {
    const key = this.kb.wasPressed('KeyJ') || this.kb.wasPressed('Mouse0');
    const tap = this.touch?.consumePunch() ?? false;
    return key || tap || this.pad.wasPressed(GP.X);
  }

  /** Pick-up placeholder. G or right click. No prop is grabbed yet. */
  grabPressed(): boolean {
    const key = this.kb.wasPressed('KeyG') || this.kb.wasPressed('Mouse2');
    const tap = this.touch?.consumeGrab() ?? false;
    return key || tap || this.pad.wasPressed(GP.Y);
  }

  /** Radio tuner step this frame: +1 next station, -1 previous, 0 none. */
  radioStep(): number {
    const next = this.kb.wasPressed('BracketRight');
    const prev = this.kb.wasPressed('BracketLeft');
    const tap = this.touch?.consumeRadio() ?? false;
    if (next || tap) return 1;
    if (prev) return -1;
    return 0;
  }

  /**
   * Look deltas in radians for this frame. Call once from render, not from
   * the fixed step, so a multi-step frame doesn't eat the mouse.
   */
  consumeLook(dt: number): { x: number; y: number } {
    const m = this.kb.consumeLook();
    const t = this.touch?.consumeLook() ?? { x: 0, y: 0 };
    const g = this.pad.look();
    return {
      x: m.x + t.x * 0.006 + g.x * 2.8 * dt,
      y: m.y + t.y * 0.006 + g.y * 2.8 * dt,
    };
  }

  endFrame(): void {
    this.kb.endFrame();
    this.pad.endFrame();
  }
}
