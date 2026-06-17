# Co-op cohesion + economy batch (4 features)

All bundle into ONE protocol bump (14 → 15). Server-authoritative throughout; Godot is the
primary client (web kept protocol-compatible, no new web UI this batch).

## Protocol (src/protocol.ts → v15)
- EntityDTO: populate `hp`/`maxHp` for players (already optional fields); add `klass?: Klass`
  (other players' chosen class for nameplates); add `owner?: string` + `ownerUntil?: number` (loot bags).
- ClientMsg: `{t:"buyItem", id}`, `{t:"reroll"}`.
- ServerMsg: `{t:"shop", items: ShopEntry[], rerollCost}` where ShopEntry = `{item, price}`.

## Feature 2 — Loot etiquette (server)
- LootBagState gains `owner?`, `ownerUntil?`. `OWNER_PRIORITY_MS = 8000`, `LOOT_OWNER_*` in constants.
- Thread killer id to the bag: `dropLoot(...ownerId?)`; `rollDrops(m, ownerId?)`; combat.ts passes
  `sourceIsPlayer ? sourceId : undefined` (monster + player-death paths); boss hoard → topThreat id.
- `takeLoot`: deny if `bag.owner && bag.owner !== p.id && now < bag.ownerUntil` (preview still allowed).
- Broadcast owner/ownerUntil on the lootbag DTO (only while the window is live).
- Godot: dim + 🔒 a bag owned by someone else during the window (EntitySprite lootbag state).

## Feature 4 — Buy vendor (server + Godot)
- PlayerState gains transient `shop: ShopItem[]` (`{item, price}`) + `shopRerollAt`. Not persisted.
- `generateShop(p)`: 2 potions (fixed price) + 4 gear via `generateItem(depth, rollGearRarity,...)`,
  priced `sellValue * BUY_MARKUP` (4). Built on `markReached`; rerolled on `reroll` (gold cost).
- Handlers `buyItem(p,id)` / `reroll(p)`: gate `reached`; validate gold + `carriedFree`; deduct,
  `addItem`, remove from stock, persist, `sendInv`, `sendShop`. Wire into handleInput.
- `sendShop(p)` → `{t:"shop", items, rerollCost}`. Sent on markReached + after buy/reroll.
- Godot: a SHOP section in InventoryUI (waiting-room only): item tiles w/ price + buy-on-tap +
  a reroll button. Net stores the shop msg; InventoryUI renders it.

## Feature 1 — Ally HP bars + class nameplates (server bit + Godot)
- Broadcast `hp`/`maxHp`/`klass` for players in `broadcast()`.
- Godot EntitySprite: for NON-self players, a floating Label3D nameplate (class icon + name) + a
  2-quad HP bar (Sprite3D, centered=false, fill scaled by ratio), billboarded + no_depth_test.
  SpriteLayer passes hp/maxHp/klass into the sprite each frame.

## Feature 3 — Equip-vs-candidate stat delta (Godot, client-only)
- InventoryUI: for carried + loot + shop items, show green/red ± per attr vs the equipped item in
  the candidate's slot. Mirror `compatibleSlots` (ItemSlot→EquipSlot) in GDScript; compare attrs.

## Verify
- tsc (server+shared+client) clean; full `npm test` green (patch any fixtures for new state fields).
- Godot `--headless --import` parse-clean.
- Live (isolated wrangler): protocol 15; 2 WS connections → player DTO carries hp/maxHp/klass; a
  kill bag carries owner+ownerUntil and a non-owner take is denied; on reach, a `shop` msg arrives;
  buy deducts gold + adds item. Screenshot the vendor + an ally nameplate if feasible.

## Review
All four shipped in one protocol bump (14 → 15), committed `dede11c`.
- Ally bars: `klass` added to the player EntityDTO (hp/maxHp were already broadcast); EntitySprite floats
  a Label3D nameplate + 2 Sprite3D HP-bar quads above other players (billboard + no_depth_test).
- Loot etiquette: killer id threaded dropLoot/rollDrops from combat.ts; takeLoot denies non-owners during
  LOOT_OWNER_MS (8s); bag DTO carries owner/ownerUntil; Godot dims + locks others' bags.
- Stat delta: `_delta_node` in InventoryUI (mirrors compatibleSlots) on carried/loot/shop tiles.
- Vendor: PlayerState.shop (transient), generated on markReached; buyItem/reroll handlers gate on reached
  + validate gold/carry before charging; `shop` ServerMsg; SHOP section in the inventory (waiting room).

Verified: tsc (server+shared+client) clean; full npm test green; Godot --import parse-clean; live
(isolated wrangler) — protocol 15, two connections each see the other's hp/maxHp on the wire, and a
friendly-fire kill produces a corpse bag carrying owner+ownerUntil (loot etiquette).

Not live-verified (impractical without reaching the boss-gated waiting room): the vendor buy/reroll UX and
the take-deny path — both are straightforward server logic (tsc-clean, mirror sellItem's validated pattern)
with the `shop` message round-trip wired on both ends.

## Out of scope / follow-ups
Web client got protocol compatibility only (no vendor/ally-bar UI this batch). Round-robin loot (chose a
simple owner window). Party-size scaling, downed/revive remain the big co-op items.
