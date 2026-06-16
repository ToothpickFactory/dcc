import type { BagState, InvState, Net } from "./net";
import { EQUIP_SLOTS, sellValue, type Attributes, type DerivedStats, type EquipSlot, type Item, type ItemSlot } from "../shared/items";
import type { Ability } from "../shared/types";

// The character / inventory screen + the loot-bag panel. Pure DOM over the
// elements declared in index.html. Works with mouse OR touch — every action is a
// tap/click on a tile, so phones get the same capability as desktop.

const SLOT_LABEL: Record<EquipSlot, string> = {
  helmet: "Head", chest: "Chest", legs: "Legs", gloves: "Hands",
  mainHand: "Main", offHand: "Off", ring1: "Ring", ring2: "Ring", amulet: "Neck",
};
const SLOT_EMOJI: Record<EquipSlot, string> = {
  helmet: "⛑️", chest: "🛡️", legs: "👖", gloves: "🧤", mainHand: "⚔️", offHand: "🗡️", ring1: "💍", ring2: "💍", amulet: "📿",
};
const ITEM_EMOJI: Record<ItemSlot, string> = {
  helmet: "⛑️", chest: "🛡️", legs: "👖", gloves: "🧤", weapon: "⚔️", ring: "💍", amulet: "📿", bag: "🎒", consumable: "🧪",
};
const ATTR_ABBR: Record<string, string> = { power: "PWR", spirit: "SPR", haste: "HST", vitality: "VIT", agility: "AGI", armor: "ARM" };

export class InventoryUI {
  private net: Net;
  private inv = byId("inventory");
  private loot = byId("lootPanel");
  private equip = byId("equipGrid");
  private bags = byId("bagGrid");
  private statPanel = byId("statPanel");
  private carry = byId("carryGrid");
  private carryCount = byId("carryCount");
  private goldEl = byId("invGold");
  private lootGrid = byId("lootGrid");
  private abilityBar = byId("abilityBar");
  private invBtn = byId("invBtn");
  private openBagId: string | null = null;
  private openBagItems: Item[] = [];
  private selectedSlot: number | null = null; // action-bar swap selection
  private barKey = "";

  constructor(net: Net) {
    this.net = net;
    byId("invClose").addEventListener("click", () => this.close());
    byId("lootClose").addEventListener("click", () => this.closeLoot());
    this.invBtn.addEventListener("click", () => this.toggle());
    byId("lootAll").addEventListener("click", () => {
      if (this.openBagId) this.net.send({ t: "takeLoot", bag: this.openBagId });
    });
    // Tapping the dark backdrop (not the card) closes the panel.
    this.inv.addEventListener("click", (e) => { if (e.target === this.inv) this.close(); });
    this.loot.addEventListener("click", (e) => { if (e.target === this.loot) this.closeLoot(); });

    net.onInv = (s) => { if (this.isOpen()) this.render(s); };
    net.onBag = (s) => this.onBag(s);
  }

  showButton(): void { this.invBtn.style.display = "block"; }

  // ---- Character screen ----
  isOpen(): boolean { return this.inv.style.display === "flex"; }
  toggle(): void { (this.isOpen() ? this.close() : this.open()); }
  open(): void {
    if (!this.net.inv) return;
    this.inv.style.display = "flex";
    this.selectedSlot = null;
    this.render(this.net.inv);
    this.renderBar();
  }
  close(): void { this.inv.style.display = "none"; }
  // Re-render if open (e.g. entering the waiting room toggles the sell buttons).
  refresh(): void { if (this.isOpen() && this.net.inv) this.render(this.net.inv); }

  // Keep the action-bar section live while the screen is open (the bar updates
  // from server state — loot, swaps, ammo). Called each frame by main when open.
  syncBar(): void {
    const abilities = this.net.self?.abilities ?? [];
    const key = abilities.map((a) => a.id).join(",") + ":" + this.selectedSlot;
    if (key === this.barKey) return;
    this.barKey = key;
    this.renderBar();
  }

  private renderBar(): void {
    const abilities = this.net.self?.abilities ?? [];
    this.barKey = abilities.map((a) => a.id).join(",") + ":" + this.selectedSlot;
    this.abilityBar.innerHTML = "";
    abilities.forEach((a, i) => {
      const tile = abilityTile(a, i === 0);
      if (i === this.selectedSlot) tile.classList.add("sel");
      tile.addEventListener("click", () => this.onBarTap(i));
      this.abilityBar.appendChild(tile);
    });
  }

  private onBarTap(i: number): void {
    if (this.selectedSlot === null) this.selectedSlot = i;
    else if (this.selectedSlot === i) this.selectedSlot = null; // tap again = deselect
    else {
      this.net.send({ t: "swapAbility", a: this.selectedSlot, b: i });
      this.selectedSlot = null;
    }
    this.renderBar(); // reflect selection immediately; the server confirms order
  }

  private render(s: InvState): void {
    const inv = s.inv;
    this.equip.innerHTML = "";
    for (const slot of EQUIP_SLOTS) {
      const it = inv.equipped[slot];
      const tile = it ? itemTile(it, SLOT_LABEL[slot]) : emptyTile(SLOT_EMOJI[slot], SLOT_LABEL[slot]);
      if (it) tile.addEventListener("click", () => this.net.send({ t: "unequip", slot }));
      this.equip.appendChild(tile);
    }
    this.bags.innerHTML = "";
    inv.bagEquip.forEach((b, i) => {
      const tile = b ? itemTile(b, "Bag") : emptyTile("🎒", "Bag");
      if (b) tile.addEventListener("click", () => this.net.send({ t: "unequipBag", index: i }));
      this.bags.appendChild(tile);
    });
    this.statPanel.innerHTML = renderStatRows(s.attrs, s.derived);
    this.goldEl.textContent = `🪙 ${s.gold}`;
    this.carryCount.textContent = `${inv.carried.length}/${s.capacity}`;
    this.carry.innerHTML = inv.carried.length ? "" : `<div class="invHint">Empty — loot bags or unequip gear here.</div>`;
    const canSell = this.net.self?.reached === true; // selling is a waiting-room action
    for (const it of inv.carried) {
      const tile = itemTile(it);
      // Consumables drink (heal self); everything else equips on tap.
      if (it.slot === "consumable") {
        tile.classList.add("usable");
        tile.title = "Drink to heal";
        tile.addEventListener("click", () => this.net.send({ t: "useItem", item: it.id }));
      } else {
        tile.addEventListener("click", () => this.net.send({ t: "equip", item: it.id }));
      }
      const drop = document.createElement("span");
      drop.className = "drop";
      drop.textContent = "🗑";
      drop.title = "Drop on the floor";
      drop.addEventListener("click", (e) => {
        e.stopPropagation();
        this.net.send({ t: "drop", item: it.id });
      });
      tile.appendChild(drop);
      if (canSell) {
        const sell = document.createElement("span");
        sell.className = "sell";
        sell.textContent = `🪙${sellValue(it)}`;
        sell.title = "Sell for gold";
        sell.addEventListener("click", (e) => {
          e.stopPropagation();
          this.net.send({ t: "sell", item: it.id });
        });
        tile.appendChild(sell);
      }
      this.carry.appendChild(tile);
    }
  }

  // Quick-use (Q key / mobile button): drink the first carried consumable.
  useFirstPotion(): void {
    const it = this.net.inv?.inv.carried.find((c) => c.slot === "consumable");
    if (it) this.net.send({ t: "useItem", item: it.id });
  }

  // ---- Loot bag ----
  requestLoot(bagId: string): void { this.net.send({ t: "openLoot", bag: bagId }); }
  lootOpenBagId(): string | null { return this.loot.style.display === "flex" ? this.openBagId : null; }
  closeLoot(): void { this.loot.style.display = "none"; this.openBagId = null; }

  private onBag(s: BagState): void {
    this.openBagId = s.id;
    this.openBagItems = s.items;
    if (s.items.length === 0) { this.closeLoot(); return; } // emptied -> auto-close
    this.loot.style.display = "flex";
    this.lootGrid.innerHTML = "";
    for (const it of s.items) {
      const tile = itemTile(it);
      tile.addEventListener("click", () => {
        if (this.openBagId) this.net.send({ t: "takeLoot", bag: this.openBagId, item: it.id });
      });
      this.lootGrid.appendChild(tile);
    }
  }
}

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function statStr(it: Item): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(it.attrs)) if (v) parts.push(`+${v} ${ATTR_ABBR[k] ?? k}`);
  if (it.bagSlots) parts.push(`+${it.bagSlots} slots`);
  return parts.join(" ");
}

function itemTile(it: Item, slotLabel?: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = `itile r-${it.rarity}`;
  d.innerHTML =
    (slotLabel ? `<span class="slotlbl">${slotLabel}</span>` : "") +
    `<span class="ico">${it.icon ?? ITEM_EMOJI[it.slot]}</span>` +
    `<span class="nm">${esc(it.name)}</span>` +
    `<span class="st">${esc(statStr(it))}</span>`;
  return d;
}

function abilityTile(a: Ability, isAuto: boolean): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "itile";
  const sub = a.ammo !== undefined ? `${a.ammo} left` : a.dmg < 0 ? `${Math.abs(a.dmg)} heal` : `${a.dmg} dmg`;
  d.innerHTML =
    (isAuto ? `<span class="badge">AUTO</span>` : "") +
    `<span class="ico">${a.icon ?? "?"}</span>` +
    `<span class="nm">${esc(a.name)}</span>` +
    `<span class="st">${sub}</span>`;
  return d;
}

function emptyTile(emoji: string, label: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "itile empty";
  d.innerHTML = `<span class="slotlbl">${label}</span><span class="ico">${emoji}</span>`;
  return d;
}

// Shared stat renderer — used by the character screen AND the skills panel so the
// formulas live in exactly one place.
export function renderStatRows(a: Attributes, d: DerivedStats): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const row = (k: string, v: string) => `<div><span class="k">${k}</span> ${v}</div>`;
  return [
    row("Max HP", String(Math.round(d.maxHp))),
    row("Move", String(Math.round(d.moveSpeed))),
    row("Power", `${a.power} · ${pct(d.spellPower)} dmg`),
    row("Spirit", `${a.spirit} · ${pct(d.healPower)} heal`),
    row("Haste", `${a.haste} · -${Math.round((1 - d.cdMult) * 100)}% cd`),
    row("Vitality", String(a.vitality)),
    row("Agility", String(a.agility)),
    row("Armor", `${a.armor} · ${pct(d.dr)} block`),
  ].join("");
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}
