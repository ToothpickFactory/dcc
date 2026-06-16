// Unit test for the universal gear/attribute/inventory model.
//   node --experimental-strip-types src/shared/items.test.ts  (npm run test:items)
import {
  addAttrs,
  addItem,
  aggregateAttrs,
  allItems,
  carryCapacity,
  compatibleSlots,
  deriveStats,
  emptyInventory,
  equip,
  removeAnywhere,
  unequip,
  unequipBag,
  zeroAttrs,
  type Item,
} from "./items.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}${detail ? "  — " + detail : ""}`);
  }
}

let seq = 0;
function item(slot: Item["slot"], attrs: Partial<Item["attrs"]> = {}, extra: Partial<Item> = {}): Item {
  return { id: `it_${++seq}`, name: `${slot} ${seq}`, rarity: "common", slot, attrs, ...extra };
}

// ---- attributes ------------------------------------------------------------
{
  const a = addAttrs(zeroAttrs(), { power: 3, armor: 10 });
  check("addAttrs sums", a.power === 3 && a.armor === 10 && a.spirit === 0);
}

// ---- aggregate + derive ----------------------------------------------------
{
  const inv = emptyInventory();
  addItem(inv, item("helmet", { vitality: 5, armor: 20 }));
  addItem(inv, item("weapon", { power: 10 }));
  equip(inv, inv.carried[0].id);
  equip(inv, inv.carried[0].id); // after first equip, the weapon is now carried[0]
  const total = aggregateAttrs({ ...zeroAttrs(), power: 1 }, inv);
  check("aggregate counts equipped only", total.power === 11 && total.vitality === 5 && total.armor === 20, JSON.stringify(total));

  const d = deriveStats(100, 230, total);
  check("vitality raises maxHp", d.maxHp === 100 + 5 * 8, String(d.maxHp));
  check("power raises spellPower", Math.abs(d.spellPower - (1 + 11 * 0.04)) < 1e-9, String(d.spellPower));
  check("armor gives diminishing DR in (0,0.75)", d.dr > 0 && d.dr < 0.75);
  check("no haste → cdMult 1", deriveStats(100, 230, zeroAttrs()).cdMult === 1);
}

// ---- equip placement: rings + weapons fill both slots ----------------------
{
  const inv = emptyInventory();
  addItem(inv, item("ring"));
  addItem(inv, item("ring"));
  const r1 = inv.carried[0].id, r2 = inv.carried[1].id;
  equip(inv, r1);
  equip(inv, r2);
  check("two rings fill ring1 + ring2", inv.equipped.ring1?.id === r1 && inv.equipped.ring2?.id === r2);

  const inv2 = emptyInventory();
  addItem(inv2, item("weapon"));
  addItem(inv2, item("weapon"));
  const w1 = inv2.carried[0].id, w2 = inv2.carried[1].id;
  equip(inv2, w1);
  equip(inv2, w2);
  check("two weapons fill mainHand + offHand", inv2.equipped.mainHand?.id === w1 && inv2.equipped.offHand?.id === w2);
}

// ---- bags expand capacity --------------------------------------------------
{
  const inv = emptyInventory();
  check("base capacity is 8", carryCapacity(inv) === 8);
  addItem(inv, item("bag", {}, { bagSlots: 6 }));
  equip(inv, inv.carried[0].id);
  check("equipping a +6 bag → capacity 14", carryCapacity(inv) === 14, String(carryCapacity(inv)));
}

// ---- capacity is enforced --------------------------------------------------
{
  const inv = emptyInventory();
  let added = 0;
  for (let i = 0; i < 20; i++) if (addItem(inv, item("helmet"))) added++;
  check("addItem stops at capacity (8)", added === 8 && inv.carried.length === 8, String(added));
}

// ---- unequip needs room; unequipBag guards overflow ------------------------
{
  const inv = emptyInventory();
  addItem(inv, item("helmet"));
  equip(inv, inv.carried[0].id);
  // fill the 8 carry slots
  while (addItem(inv, item("gloves"))) {}
  check("unequip refused when carry is full", unequip(inv, "helmet").ok === false);

  const inv2 = emptyInventory();
  addItem(inv2, item("bag", {}, { bagSlots: 4 }));
  equip(inv2, inv2.carried[0].id); // capacity 12
  while (addItem(inv2, item("gloves"))) {} // fill all 12
  check("unequipBag refused when it would overflow", unequipBag(inv2, 0).ok === false);
}

// ---- allItems + removeAnywhere (the death-drop path) -----------------------
{
  const inv = emptyInventory();
  addItem(inv, item("helmet"));
  addItem(inv, item("bag", {}, { bagSlots: 4 }));
  addItem(inv, item("ring"));
  equip(inv, inv.carried[0].id); // helmet
  equip(inv, inv.carried.find((i) => i.slot === "bag")!.id); // bag
  const everything = allItems(inv);
  check("allItems returns gear + bag + carried", everything.length === 3, String(everything.length));

  const gone = removeAnywhere(inv, inv.equipped.helmet!.id);
  check("removeAnywhere pulls from a gear slot", gone !== null && inv.equipped.helmet === undefined);
}

// ---- consumables are carried-only (never equippable) -----------------------
{
  check("consumable has no compatible equip slots", compatibleSlots("consumable").length === 0);

  const inv = emptyInventory();
  addItem(inv, item("consumable", {}, { consumable: { healPct: 0.35 } }));
  const id = inv.carried[0].id;
  const res = equip(inv, id);
  check("equipping a consumable is refused", res.ok === false);
  check("consumable stays in carry after a failed equip", inv.carried.some((i) => i.id === id));
  check("consumable contributes no attrs", aggregateAttrs(zeroAttrs(), inv).power === 0);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall item checks passed");
