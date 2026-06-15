import type { Ability } from "../shared/types";
import type { Net } from "./net";

// Action bar + status line + boss banner. The bar is now DRIVEN BY THE SERVER
// (self.abilities) — it rebuilds when the slot contents change (loot, swaps) and
// shows live cooldowns + ammo. Slot 1 is the auto-cast slot (marked AUTO).
// Slots are tappable for mobile (onCast).
export class Hud {
  private bar: HTMLDivElement;
  private status: HTMLDivElement;
  private bossbar: HTMLElement;
  private bossname: HTMLElement;
  private bossfill: HTMLElement;
  private onCast: (i: number) => void;
  private cds: HTMLDivElement[] = [];
  private ammos: (HTMLDivElement | null)[] = [];
  private barKey = "";

  constructor(onCast: (i: number) => void) {
    this.onCast = onCast;
    this.status = document.getElementById("status") as HTMLDivElement;
    this.bar = document.getElementById("abilities") as HTMLDivElement;
    this.bossbar = document.getElementById("bossbar") as HTMLElement;
    this.bossname = document.getElementById("bossname") as HTMLElement;
    this.bossfill = document.getElementById("bossfill") as HTMLElement;
  }

  private rebuild(abilities: Ability[]): void {
    this.bar.innerHTML = "";
    this.cds = [];
    this.ammos = [];
    abilities.forEach((a, i) => {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.innerHTML =
        `<div class="key">${i + 1}</div>` +
        (i === 0 ? `<div class="auto">AUTO</div>` : "") +
        `<div class="icon">${a.icon ?? "?"}</div>` +
        `<div class="name">${a.name}</div>` +
        (a.ammo !== undefined ? `<div class="ammo"></div>` : "") +
        `<div class="cd"></div>`;
      this.bar.appendChild(slot);
      this.cds.push(slot.querySelector(".cd") as HTMLDivElement);
      this.ammos.push(slot.querySelector(".ammo"));
      const fire = (ev: Event) => {
        ev.preventDefault();
        this.onCast(i);
      };
      slot.addEventListener("touchstart", fire, { passive: false });
      slot.addEventListener("click", fire);
    });
  }

  update(net: Net): void {
    const self = net.self;
    if (!self || !net.cur) return;
    const abilities = self.abilities ?? [];
    const key = abilities.map((a) => a.id).join(",") + ":" + abilities.length;
    if (key !== this.barKey) {
      this.barKey = key;
      this.rebuild(abilities);
    }
    const cdMult = self.derived?.cdMult ?? 1;
    abilities.forEach((a, i) => {
      const ready = self.cds[i] ?? 0;
      const remaining = Math.max(0, ready - net.cur!.tick);
      const dur = Math.max(1, a.cd * cdMult);
      if (this.cds[i]) this.cds[i].style.transform = `scaleY(${Math.min(1, remaining / dur)})`;
      const ammo = this.ammos[i];
      if (ammo && a.ammo !== undefined) {
        ammo.textContent = String(a.ammo);
        ammo.style.color = a.ammo === 0 ? "#ff6a6a" : a.ammo <= 5 ? "#ffd34d" : "#cdd6e8";
      }
    });

    const ended = net.run?.phase === "ended";
    const timer = !ended && net.floor ? Math.max(0, Math.round((net.floor.state.endsAt - Date.now()) / 1000)) : 0;
    const low = !ended && self.status === "alive" && timer <= 10;
    const flash = low && Math.floor(Date.now() / 350) % 2 === 0;
    const timerHtml = `Timer <b style="color:${low ? (flash ? "#ff3b3b" : "#ffd34d") : "inherit"}">${low ? "⚠ " : ""}${timer}s${low ? " — reach the stairs!" : ""}</b> · `;
    const state = ended ? "🏁 RUN OVER" : self.status === "spectator" ? "💀 SPECTATING" : "ALIVE";
    this.status.innerHTML =
      `<b>${state}</b> · HP ${self.hp}/${self.maxHp} · Class <b>${self.cls}</b> · ` +
      `Floor ${net.floor?.info.depth ?? "?"} (${net.floor?.info.theme ?? ""}) · ` +
      (ended ? "" : timerHtml) +
      `Players ${net.run?.players ?? 0}`;

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
