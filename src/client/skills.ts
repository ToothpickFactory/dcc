import type { Net } from "./net";
import type { Ability } from "../shared/types";
import { ABILITY_NODES, EVOLUTIONS, canEvolve, charLevelOf, charXpForNext, evolveCost } from "../shared/skills";
import { CLASS_INFO, CLASS_MAIN_STAT, CLASS_ROLE, KLASSES } from "../shared/classes";
import { TALENT_TREES, canSpendTalent } from "../shared/talents";
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
  private talentBox = byId("talentBox");
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
    const s = this.net.self;
    const a = s?.abilities ?? [];
    const ab = a.map((x) => `${x.id}:${x.tier ?? 0}:${x.xp ?? 0}`).join(",");
    const tal = `${s?.chosenClass ?? ""}|${s?.talentPoints ?? 0}|${JSON.stringify(s?.talents ?? {})}`;
    return `${ab}|${s?.charXp ?? 0}|${JSON.stringify(s?.derived ?? {})}|${JSON.stringify(this.net.inv?.attrs ?? {})}|${tal}`;
  }

  // Does the player have a pending choice (pick a class, or unspent talent points)?
  classOrTalentPending(): boolean {
    const s = this.net.self;
    return !!s && (s.talentPoints ?? 0) > 0;
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
    this.renderTalents();
    this.list.innerHTML = "";
    a.forEach((ab, i) => this.list.appendChild(this.card(ab, i)));
  }

  // Class picker (before a class is chosen) or the point-buy talent tree.
  private renderTalents(): void {
    const self = this.net.self;
    if (!self) return;
    const box = this.talentBox;
    box.innerHTML = "";
    const pts = self.talentPoints ?? 0;

    if (!self.chosenClass) {
      if (pts <= 0) return; // no pending choice yet
      box.appendChild(section(`⚔️ Choose your class — <span class="pts">${pts} pt</span>`));
      const grid = document.createElement("div");
      grid.className = "classGrid";
      for (const k of KLASSES) {
        const info = CLASS_INFO[k];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "classbtn";
        b.innerHTML =
          `<span class="ico">${info.icon} <b>${esc(info.name)}</b></span>` +
          `<span class="ed">${esc(info.blurb)}</span>` +
          `<span class="role">${CLASS_ROLE[k]} · ${CLASS_MAIN_STAT[k]} · ${esc(info.armor)}</span>`;
        b.addEventListener("click", () => this.net.send({ t: "chooseClass", cls: k }));
        grid.appendChild(b);
      }
      box.appendChild(grid);
      return;
    }

    // Talent tree for the chosen class.
    const cls = self.chosenClass;
    const info = CLASS_INFO[cls];
    box.appendChild(section(`${info.icon} ${esc(info.name)} talents — <span class="pts">${pts} point${pts === 1 ? "" : "s"}</span>`));
    const grid = document.createElement("div");
    grid.className = "talGrid";
    for (const node of TALENT_TREES[cls]) {
      const rank = self.talents?.[node.id] ?? 0;
      const can = canSpendTalent(cls, self.talents ?? {}, pts, node.id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "talbtn" + (rank > 0 ? " taken" : "");
      b.disabled = !can;
      b.innerHTML =
        `<span class="ico">${node.icon ?? "•"} <b>${esc(node.name)}</b></span>` +
        `<span class="ed">${esc(node.desc ?? "")}</span>` +
        (rank > 0 ? `<span class="rk">✓ learned</span>` : node.requires ? `<span class="rk">needs ${node.requires} spent</span>` : "");
      b.addEventListener("click", () => this.net.send({ t: "spendTalent", node: node.id }));
      grid.appendChild(b);
    }
    box.appendChild(grid);
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
function section(html: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "invSection";
  d.innerHTML = html;
  return d;
}
function esc(s: string): string {
  return s.replace(/[<>&]/g, (ch) => (ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;"));
}
