import type { Net } from "./net";
import type { Ability } from "../shared/types";
import { ABILITY_NODES, EVOLUTIONS, canEvolve, charLevelOf, charXpForNext, evolveCost } from "../shared/skills";
import { renderStatRows } from "./inventory";

// The Skills screen (E): per-ability level + XP, and — when an ability has
// matured — the branching evolution choices to pick. Plus the character level.
// Pure DOM; works on desktop and touch (every action is a tap).
export class SkillsUI {
  private net: Net;
  private panel = byId("skills");
  private list = byId("skillList");
  private charLevel = byId("charLevel");
  private charStats = byId("charStats");
  private btn = byId("skillsBtn");
  private key = "";

  constructor(net: Net) {
    this.net = net;
    byId("skillsClose").addEventListener("click", () => this.close());
    this.btn.addEventListener("click", () => this.toggle());
    this.panel.addEventListener("click", (e) => { if (e.target === this.panel) this.close(); });
  }

  showButton(): void { this.btn.style.display = "block"; }
  isOpen(): boolean { return this.panel.style.display === "flex"; }
  toggle(): void { (this.isOpen() ? this.close() : this.open()); }
  open(): void { this.panel.style.display = "flex"; this.key = ""; this.render(); }
  close(): void { this.panel.style.display = "none"; }

  // Any ability ready to evolve? Drives the button glow + the level-up toast.
  anyReady(): boolean {
    return (this.net.self?.abilities ?? []).some(canEvolve);
  }
  setGlow(on: boolean): void { this.btn.classList.toggle("glow", on); }

  // A render key that also tracks stat changes (gear/level), so the stats block
  // re-renders when attributes or derived stats move — not just on ability XP.
  private renderKey(): string {
    const a = this.net.self?.abilities ?? [];
    const ab = a.map((x) => `${x.id}:${x.tier ?? 0}:${x.xp ?? 0}`).join(",");
    return `${ab}|${this.net.self?.charXp ?? 0}|${JSON.stringify(this.net.self?.derived ?? {})}|${JSON.stringify(this.net.inv?.attrs ?? {})}`;
  }

  // Re-render while open as XP/level/stat changes come in (cheap key check).
  syncIfOpen(): void {
    if (!this.isOpen()) return;
    const k = this.renderKey();
    if (k === this.key) return;
    this.key = k;
    this.render();
  }

  private render(): void {
    const self = this.net.self;
    if (!self) return;
    const a = self.abilities ?? [];
    this.key = this.renderKey();
    const lvl = charLevelOf(self.charXp);
    const { into, need } = charXpForNext(self.charXp);
    this.charLevel.innerHTML = `<div class="clvl">Character <b>Level ${lvl}</b></div>` + xpBar(into, need);
    // Live stat breakdown (attrs from the inv message, derived from self). Reuses
    // the character-screen renderer so the formulas live in one place.
    const attrs = this.net.inv?.attrs;
    this.charStats.innerHTML = attrs ? `<div class="skstats">${renderStatRows(attrs, self.derived)}</div>` : "";
    this.list.innerHTML = "";
    a.forEach((ab, i) => this.list.appendChild(this.card(ab, i)));
  }

  private card(ab: Ability, slot: number): HTMLElement {
    const tier = ab.tier ?? 0;
    const xp = ab.xp ?? 0;
    const cost = evolveCost(tier);
    const opts = EVOLUTIONS[ab.id] ?? [];
    const ready = canEvolve(ab);
    const c = document.createElement("div");
    c.className = "skcard";
    c.innerHTML =
      `<div class="skhead"><span class="ico">${ab.icon ?? "?"}</span><span class="nm">${esc(ab.name)}</span><span class="lv">Lv ${tier + 1}</span></div>` +
      (opts.length
        ? xpBar(Math.min(xp, cost), cost) + (ready ? `<div class="ready">✨ Ready to evolve — choose a path:</div>` : `<div class="sub">${xp} / ${cost} XP to evolve · keep using it</div>`)
        : `<div class="sub">Mastered — no further evolutions.</div>`);
    if (ready) {
      const row = document.createElement("div");
      row.className = "evrow";
      for (const to of opts) {
        const node = ABILITY_NODES[to];
        if (!node) continue;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "evbtn";
        b.innerHTML = `<span class="ico">${node.icon ?? "?"}</span><b>${esc(node.name)}</b><span class="ed">${esc(node.flavor ?? "")}</span>`;
        b.addEventListener("click", () => this.net.send({ t: "evolve", slot, to }));
        row.appendChild(b);
      }
      c.appendChild(row);
    }
    return c;
  }
}

function xpBar(into: number, need: number): string {
  const pct = need > 0 ? Math.min(100, (100 * into) / need) : 100;
  return `<div class="xpbar"><div class="xpfill" style="width:${pct}%"></div><span class="xptxt">${into} / ${need} XP</span></div>`;
}
function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}
function esc(s: string): string {
  return s.replace(/[<>&]/g, (ch) => (ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;"));
}
