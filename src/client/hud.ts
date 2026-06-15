import { DEFAULT_ABILITIES } from "../shared/abilities";
import type { Net } from "./net";

// Ability bar + status line + boss banner. The emergent class label is shown
// (decision #10). Ability slots are tappable for mobile (onCast).
export class Hud {
  private bar: HTMLDivElement;
  private status: HTMLDivElement;
  private bossbar: HTMLElement;
  private bossname: HTMLElement;
  private bossfill: HTMLElement;
  private cds: HTMLDivElement[] = [];

  constructor(onCast: (i: number) => void) {
    this.status = document.getElementById("status") as HTMLDivElement;
    this.bar = document.getElementById("abilities") as HTMLDivElement;
    this.bossbar = document.getElementById("bossbar") as HTMLElement;
    this.bossname = document.getElementById("bossname") as HTMLElement;
    this.bossfill = document.getElementById("bossfill") as HTMLElement;

    DEFAULT_ABILITIES.forEach((a, i) => {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.innerHTML =
        `<div class="key">${i + 1}</div>` +
        `<div class="icon">${a.icon ?? "?"}</div>` +
        `<div class="name">${a.name}</div>` +
        `<div class="cd"></div>`;
      this.bar.appendChild(slot);
      this.cds.push(slot.querySelector(".cd") as HTMLDivElement);
      const fire = (ev: Event) => {
        ev.preventDefault();
        onCast(i);
      };
      slot.addEventListener("touchstart", fire, { passive: false });
      slot.addEventListener("click", fire);
    });
  }

  update(net: Net) {
    const self = net.self;
    if (!self || !net.cur) return;
    DEFAULT_ABILITIES.forEach((a, i) => {
      const ready = self.cds[i] ?? 0;
      const remaining = Math.max(0, ready - net.cur!.tick);
      this.cds[i].style.transform = `scaleY(${Math.min(1, remaining / a.cd)})`;
    });

    const timer = net.floor ? Math.max(0, Math.round((net.floor.state.endsAt - net.cur.tick) / 1000)) : 0;
    this.status.innerHTML =
      `<b>${self.status === "spectator" ? "💀 SPECTATING" : "ALIVE"}</b> · ` +
      `HP ${self.hp}/${self.maxHp} · Class <b>${self.cls}</b> · ` +
      `Floor ${net.floor?.info.depth ?? "?"} (${net.floor?.info.theme ?? ""}) · ` +
      `Timer <b>${timer}s</b> · Players ${net.run?.players ?? 0}`;

    // Boss banner — driven off the boss entity in the snapshot.
    const boss = net.cur.ents.find((e) => e.kind === "boss");
    if (boss && boss.maxHp) {
      this.bossbar.style.display = "block";
      this.bossname.textContent = boss.name ?? "Boss";
      this.bossfill.style.width = `${(100 * (boss.hp ?? 0)) / boss.maxHp}%`;
    } else {
      this.bossbar.style.display = "none";
    }
  }
}
