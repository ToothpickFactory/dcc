import { INPUT_MS } from "../shared/constants";
import type { Net } from "./net";

// WASD/arrow movement + aim, with mobile touch support.
//  - Desktop: WASD or arrow keys move; the mouse aims; click or 1-4 fires.
//  - Mobile: touch-and-hold acts as a virtual stick (move toward the finger)
//    and aims there; tap the on-screen ability slots to fire.
// Either way the wire just carries a move vector + an aim angle, so the
// protocol is unaffected. Stream C / M3 adds pointer-lock mouselook.
export class Input {
  keys = new Set<string>();
  pointer = { x: 0, y: 0 }; // mouse OR active touch, in screen coords
  aim = 0; // radians — set each frame by main from the camera->ground raycast
  touchActive = false;
  private seq = 0;
  private lastSent = 0;
  private castIdx = -1;

  attach(canvas: HTMLElement) {
    addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      const n = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
      if (n >= 0) {
        this.castIdx = n;
        return;
      }
      if (k.startsWith("arrow")) e.preventDefault();
      this.keys.add(k);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.keys.clear()); // alt-tab shouldn't keep us walking

    canvas.addEventListener("mousemove", (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.castIdx = 0;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    const touch = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (t) {
        this.pointer.x = t.clientX;
        this.pointer.y = t.clientY;
        this.touchActive = true;
      }
      e.preventDefault();
    };
    canvas.addEventListener("touchstart", touch, { passive: false });
    canvas.addEventListener("touchmove", touch, { passive: false });
    canvas.addEventListener("touchend", (e) => {
      this.touchActive = false;
      e.preventDefault();
    }, { passive: false });
  }

  // Tapped from the on-screen ability bar (mobile) — queue a cast next frame.
  queueCast(i: number) {
    this.castIdx = i;
  }

  moveVec(): [number, number] {
    if (this.touchActive) {
      // Virtual stick: move toward the finger relative to screen center.
      const dx = this.pointer.x - innerWidth / 2;
      const dy = this.pointer.y - innerHeight / 2;
      const d = Math.hypot(dx, dy);
      if (d < 14) return [0, 0]; // dead zone
      return [dx / d, dy / d];
    }
    let x = 0;
    let y = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) y -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) y += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) x -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) x += 1;
    return [x, y];
  }

  // Called every animation frame; throttles input sends to INPUT_HZ, fires casts
  // immediately so they feel responsive.
  pump(net: Net, now: number) {
    if (this.castIdx >= 0) {
      net.send({ t: "cast", seq: ++this.seq, ability: this.castIdx, aim: this.aim });
      this.castIdx = -1;
    }
    if (now - this.lastSent >= INPUT_MS) {
      this.lastSent = now;
      net.send({ t: "input", seq: ++this.seq, mv: this.moveVec(), aim: this.aim });
    }
  }
}
