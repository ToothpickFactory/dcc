# Plan — Batch 1: Build payoff + loot pop (highest ROI)

Why this batch: every item is **S-effort and mostly client-only**, and each **surfaces a deep
system that already exists** (talents, classes, the playstyle-tailored loot grant) but is
currently invisible. Maximum felt improvement per hour, near-zero risk.

Protocol: items 1–3 are client-only (no wire change). Item 4 adds one optional `rarity` field
to the lootbag DTO → **bump to PROTOCOL_VERSION 11** and bundle. Clients rebuild via the launcher.

---

## 1. Loot-grant celebration  (client-only)  ✅ verified by: trigger a grant → toast+sfx
The server already sends `{ t:"loot", grant:{ id, ability, rarity, flavor } }` (world-do.ts:1167/1185)
but the Godot `Net._handle` drops it in `_: pass` — the headline reward is **silent**.
- [ ] `Net.gd`: add `signal loot_received(grant)` + a `"loot"` case → `loot_received.emit(m.get("grant", {}))`.
- [ ] `Main.gd`: connect it → rarity-colored center toast (e.g. `⚔ Heroic Cataclysm! (epic)`), play the
      `"evolve"`/`"loot"` sfx, and a brief flash/pop scaled by rarity. Rarity→color map (common→legendary).

## 2. Talent-point / class-pick nudge  (client-only)  ✅ verified by: DCC_TOKEN to a leveled save → badge shows
Players gain a talent point at level-up and never learn to press K. Data is already on SelfDTO
(`talentPoints`, `chosenClass`).
- [ ] `Main.gd`: in `_process`, if `chosenClass` is empty → loud "✨ Choose your class — press K";
      else if `talentPoints > 0` → pulsing "Talent point ready — press K" badge. Reuse the `_skill_hint`
      pattern (hide while the K screen is open). Keep the existing ability-evolve hint too.

## 3. Show chosen class + role in the HUD  (client-only)  ✅ verified by: screenshot with a class picked
The status line shows the *emergent* playstyle `cls`, not the picked class. SelfDTO has `chosenClass`.
- [ ] `Hud.gd`: when `chosenClass` is set, show `CLASS_INFO.name + icon` and `CLASS_ROLE` (e.g. "⚔️ Warrior · DPS")
      in the status line instead of (or alongside) the emergent label. Mirror the tiny CLASS_INFO/CLASS_ROLE
      maps client-side (5 classes).

## 4. Ground rarity beams  (server +1 field, client tint)  ✅ verified by: probe lootbag DTO + screenshot near a bag
Loot bags render a flat gold billboard; you can't spot a legendary across the room.
- [ ] `protocol.ts`: `EntityDTO.rarity?: string` (lootbags); **bump PROTOCOL_VERSION to 11**. `DccConst` → 11.
- [ ] `world-do.ts`: lootbag DTO (≈:1297) add `rarity: bestRarity(b.items)` (highest rarity in the bag).
- [ ] `EntitySprite.gd` / `SpriteLayer.gd`: tint the lootbag sprite by rarity (+ a soft pulse/glow),
      using a rarity→color map (reuse InventoryUI.RARITY_BORDER palette).

---

## Verification (each step)
- Server `npx tsc --noEmit` clean; Godot `--import` parse-clean; smoke vs local v11 = 0 errors / 0 mismatch; GdUnit4 12/12.
- Loot pop: trigger a floor-end/boss grant (or bot run) and confirm the toast+sfx fire.
- Beams: WS probe confirms lootbag DTO carries `rarity`; screenshot near a bag shows the tint.
- Nudge / class HUD: use the `DCC_TOKEN` dev hook to rebind a leveled character and screenshot the badge + class line.

## Out of scope (later batches, per GAMEPLAY_ROADMAP.md)
Co-op cohesion (shared XP, boss-gates-stairs, downed/revive), encounter depth (boss phases, elites),
itemization depth (affixes, vendor, uniques). Tracked in GAMEPLAY_ROADMAP.md.

## Review
Scope expanded (per "do all S-tier efforts") to **all 8 S-tier roadmap items**, done in one batch:
1. ✅ Loot-grant celebration (client) · 2. ✅ Talent/class nudge (client) · 3. ✅ Class+role HUD (client)
· 4. ✅ Ground rarity beams (protocol v11) · 5. ✅ Target-assist on slots (client) · 6. ✅ Shared party XP
(server) · 7. ✅ Boss gates stairs (server + client hint) · 8. ✅ Lead-the-target ranged (server).
Protocol bumped 10 → 11 (lootbag rarity). Verified: server tsc clean; Godot import + smoke vs v11 =
0 errors / 0 mismatch; GdUnit4 12/12; live probes confirmed protocol 11 + lootbag `rarity` populated.
All ✅ in GAMEPLAY_ROADMAP.md. Remaining work is M/L (co-op revive, encounter/itemization/build depth).
