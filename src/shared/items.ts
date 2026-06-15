// Universal gear / attribute / inventory model — shared by every entity
// (players AND monsters) and by client + server. Pure data + pure functions;
// no engine imports, so it's trivially testable and reusable.
import type { Rarity } from "./types";

// ---- Attributes -----------------------------------------------------------
// Six primary attributes. Gear grants them; derived gameplay stats fall out of
// them (see deriveStats). Monsters have their own attributes too.
export type AttrKey = "power" | "spirit" | "haste" | "vitality" | "agility" | "armor";
export const ATTR_KEYS: AttrKey[] = ["power", "spirit", "haste", "vitality", "agility", "armor"];
export type Attributes = Record<AttrKey, number>;

export function zeroAttrs(): Attributes {
  return { power: 0, spirit: 0, haste: 0, vitality: 0, agility: 0, armor: 0 };
}
export function addAttrs(into: Attributes, more: Partial<Attributes>): Attributes {
  for (const k of ATTR_KEYS) into[k] += more[k] ?? 0;
  return into;
}

// ---- Items + slots --------------------------------------------------------
// Where a character can equip things (Diablo/WoW style).
export type EquipSlot = "helmet" | "chest" | "legs" | "gloves" | "mainHand" | "offHand" | "ring1" | "ring2" | "amulet";
export const EQUIP_SLOTS: EquipSlot[] = ["helmet", "chest", "legs", "gloves", "mainHand", "offHand", "ring1", "ring2", "amulet"];

// What an item IS — drives which equip slot(s) accept it. `weapon` fits either
// hand; `ring` fits either ring slot; `bag` goes into a bag-equip slot.
export type ItemSlot = "helmet" | "chest" | "legs" | "gloves" | "weapon" | "ring" | "amulet" | "bag";

export interface Item {
  id: string;
  name: string;
  rarity: Rarity;
  slot: ItemSlot;
  attrs: Partial<Attributes>; // stat bonuses while equipped
  bagSlots?: number; // bags only: extra carry slots this container grants
  icon?: string;
  flavor?: string;
}

// Gold a piece of gear sells for, by rarity (shared so client can preview the
// price on the sell button). Tune freely — purely an economy knob.
const SELL_PRICE: Record<Rarity, number> = { common: 3, uncommon: 8, rare: 20, epic: 50, legendary: 120 };
export function sellValue(item: Item): number {
  return SELL_PRICE[item.rarity] ?? 1;
}

// ---- Inventory ------------------------------------------------------------
export const BASE_CARRY_SLOTS = 8; // the built-in backpack
export const BAG_EQUIP_SLOTS = 4; // how many bag containers you can equip

export interface Inventory {
  equipped: Partial<Record<EquipSlot, Item>>;
  bagEquip: (Item | null)[]; // length BAG_EQUIP_SLOTS — equipped bag containers
  carried: Item[]; // loose items; length <= carryCapacity(inv)
}

export function emptyInventory(): Inventory {
  return { equipped: {}, bagEquip: new Array(BAG_EQUIP_SLOTS).fill(null), carried: [] };
}

// Defensive rehydration of persisted blobs (a malformed/legacy row must never
// crash a join). Coerce to a valid shape, defaulting anything missing.
export function coerceAttrs(x: unknown): Attributes {
  const a = zeroAttrs();
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    for (const k of ATTR_KEYS) if (typeof o[k] === "number") a[k] = o[k] as number;
  }
  return a;
}
export function coerceInventory(x: unknown): Inventory {
  if (!x || typeof x !== "object") return emptyInventory();
  const o = x as Partial<Inventory>;
  const bagEquip = Array.isArray(o.bagEquip) ? o.bagEquip.slice(0, BAG_EQUIP_SLOTS) : [];
  while (bagEquip.length < BAG_EQUIP_SLOTS) bagEquip.push(null);
  return {
    equipped: o.equipped && typeof o.equipped === "object" ? o.equipped : {},
    bagEquip,
    carried: Array.isArray(o.carried) ? o.carried : [],
  };
}

export function carryCapacity(inv: Inventory): number {
  let cap = BASE_CARRY_SLOTS;
  for (const b of inv.bagEquip) if (b?.bagSlots) cap += b.bagSlots;
  return cap;
}
export function carriedFree(inv: Inventory): number {
  return carryCapacity(inv) - inv.carried.length;
}

// Every item the inventory holds — equipped gear, equipped bags, and loose
// items. Used to drop EVERYTHING into a loot bag on death.
export function allItems(inv: Inventory): Item[] {
  const out: Item[] = [];
  for (const s of EQUIP_SLOTS) {
    const it = inv.equipped[s];
    if (it) out.push(it);
  }
  for (const b of inv.bagEquip) if (b) out.push(b);
  out.push(...inv.carried);
  return out;
}

// Sum of base attributes + everything equipped (gear and bags can both carry
// stats). Loose carried items do NOT count — only what you're wearing.
export function aggregateAttrs(base: Attributes, inv: Inventory): Attributes {
  const total = { ...base };
  for (const s of EQUIP_SLOTS) {
    const it = inv.equipped[s];
    if (it) addAttrs(total, it.attrs);
  }
  for (const b of inv.bagEquip) if (b) addAttrs(total, b.attrs);
  return total;
}

// ---- Derived gameplay stats ----------------------------------------------
export interface DerivedStats {
  maxHp: number;
  moveSpeed: number; // px/s
  spellPower: number; // outgoing damage multiplier
  healPower: number; // outgoing heal multiplier
  cdMult: number; // cooldown multiplier (<= 1; lower = faster)
  dr: number; // incoming damage reduction, 0..DR_CAP
}

// Scaling factors (one place to balance). baseMaxHp/baseSpeed come from the
// ENTITY (players vs each monster kind differ), so this stays universal.
export const STAT = {
  hpPerVit: 8,
  speedPerAgi: 0.015, // +1.5% move speed per agility
  dmgPerPower: 0.04, // +4% damage per power
  healPerSpirit: 0.05,
  cdPerHaste: 0.03,
  armorK: 60, // armor for ~50% DR
  drCap: 0.75,
};

export function deriveStats(baseMaxHp: number, baseSpeed: number, a: Attributes): DerivedStats {
  return {
    maxHp: baseMaxHp + a.vitality * STAT.hpPerVit,
    moveSpeed: baseSpeed * (1 + a.agility * STAT.speedPerAgi),
    spellPower: 1 + a.power * STAT.dmgPerPower,
    healPower: 1 + a.spirit * STAT.healPerSpirit,
    cdMult: 1 / (1 + a.haste * STAT.cdPerHaste),
    dr: Math.min(STAT.drCap, a.armor / (a.armor + STAT.armorK)),
  };
}

// ---- Mutations (return ok/error; never throw) -----------------------------
export interface InvResult {
  ok: boolean;
  error?: string;
}

// Which equip slots a loose item can occupy (in preference order).
export function compatibleSlots(slot: ItemSlot): EquipSlot[] {
  switch (slot) {
    case "helmet": return ["helmet"];
    case "chest": return ["chest"];
    case "legs": return ["legs"];
    case "gloves": return ["gloves"];
    case "amulet": return ["amulet"];
    case "weapon": return ["mainHand", "offHand"];
    case "ring": return ["ring1", "ring2"];
    case "bag": return [];
  }
}

export function findCarried(inv: Inventory, itemId: string): number {
  return inv.carried.findIndex((i) => i.id === itemId);
}

// Put an item in the first free carry slot. False if the bag is full.
export function addItem(inv: Inventory, item: Item): boolean {
  if (carriedFree(inv) <= 0) return false;
  inv.carried.push(item);
  return true;
}

// Equip a carried item. Gear swaps with whatever's in the slot (1 out, 1 in, so
// capacity is preserved). Bags only equip into an EMPTY bag slot.
export function equip(inv: Inventory, itemId: string): InvResult {
  const idx = findCarried(inv, itemId);
  if (idx < 0) return { ok: false, error: "not in inventory" };
  const item = inv.carried[idx];

  if (item.slot === "bag") {
    const free = inv.bagEquip.findIndex((b) => b === null);
    if (free < 0) return { ok: false, error: "no free bag slot — unequip a bag first" };
    inv.carried.splice(idx, 1);
    inv.bagEquip[free] = item;
    return { ok: true };
  }

  const slots = compatibleSlots(item.slot);
  if (slots.length === 0) return { ok: false, error: "not equippable" };
  const target = slots.find((s) => !inv.equipped[s]) ?? slots[0];
  const prev = inv.equipped[target];
  inv.carried.splice(idx, 1); // freed a slot
  inv.equipped[target] = item;
  if (prev) inv.carried.push(prev); // swap back into the freed slot
  return { ok: true };
}

// Move an equipped gear piece back to carry. Needs a free carry slot.
export function unequip(inv: Inventory, slot: EquipSlot): InvResult {
  const item = inv.equipped[slot];
  if (!item) return { ok: false, error: "slot is empty" };
  if (carriedFree(inv) <= 0) return { ok: false, error: "inventory full" };
  delete inv.equipped[slot];
  inv.carried.push(item);
  return { ok: true };
}

// Unequip a bag container. Removing it shrinks capacity, so it's refused if the
// remaining slots couldn't hold the current items plus the bag itself.
export function unequipBag(inv: Inventory, index: number): InvResult {
  const bag = inv.bagEquip[index];
  if (!bag) return { ok: false, error: "no bag there" };
  const freed = bag.bagSlots ?? 0;
  if (carriedFree(inv) - freed < 1) return { ok: false, error: "make room before unequipping that bag" };
  inv.bagEquip[index] = null;
  inv.carried.push(bag);
  return { ok: true };
}

// Remove an item from anywhere in the inventory (carried, gear, or bag slot).
export function removeAnywhere(inv: Inventory, itemId: string): Item | null {
  const ci = findCarried(inv, itemId);
  if (ci >= 0) return inv.carried.splice(ci, 1)[0];
  for (const s of EQUIP_SLOTS) {
    if (inv.equipped[s]?.id === itemId) {
      const it = inv.equipped[s]!;
      delete inv.equipped[s];
      return it;
    }
  }
  for (let i = 0; i < inv.bagEquip.length; i++) {
    if (inv.bagEquip[i]?.id === itemId) {
      const it = inv.bagEquip[i]!;
      inv.bagEquip[i] = null;
      return it;
    }
  }
  return null;
}
