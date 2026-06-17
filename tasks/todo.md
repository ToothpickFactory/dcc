# Build depth — attribute points · respec · deeper trees · class kits (M, server)

Roadmap §2: the RPG systems were deep but build growth stalled (base attrs zero forever,
trees stop ~level 6, bad forks locked, every class opens sword+rocks). All four shipped.

## What shipped
- **Per-level attribute points** (3/level, all 7 attrs). Reuses `base` as the spent store (already
  persisted + folded by `recomputePlayer`); only new persisted state is one `attrPoints` counter.
  New `spendAttr` handler + `ATTR_POINTS_PER_LEVEL` granted in `grantCharXp`'s level-up block.
- **Respec** — free, waiting-room only. `respec` handler refunds `sum(base)` → attrPoints + base→0,
  `talentSpent` → talentPoints + talents→{}, and strips `fromTalent` abilities from the bar.
- **Deeper trees** — spec nodes `maxRank: 2` + a row-3 `requires: 6` `maxRank: 3` mastery passive per
  class (5 new PASSIVES). Pure data; ranks already scaled in `talentPassives`. Web auto-inherits;
  Godot `Talents.gd` mirror updated.
- **Class kits** — `CLASS_KIT` in classes.ts; `applyClassKit` swaps the untouched sword+rocks opener
  at `chooseClass` (guarded so a customized bar is never clobbered).
- **Protocol 13 → 14**: `spendAttr`/`respec` ClientMsgs + `attrPoints` on SelfDTO. Godot DccConst → 14.
- **Clients**: attribute-spend panel + respec button + "rank x/N" on the K screen (Godot SkillsUI.gd +
  web skills.ts); `set_reached` gates the respec button.

## Verification (all green)
- `tsc --noEmit` (server+shared) and `-p tsconfig.client.json` clean.
- Full `npm test` green incl. new cases: talents (maxRank-2 spend, row-3 gating/ranks) and a
  progression integration test (attr point → +8 maxHp / +spellPower; mage kit swap + no-clobber guard;
  respec refund math + talent-grant strip) driving the REAL recomputePlayer/CLASS_KIT/talentSpent.
- Also fixed a pre-existing test breakage: teammate's destructible-decor merge made `stepProjectiles`
  read `ctx.props`; added `props: []` to the test fixture.
- Godot `--headless --import` parse-clean.
- Live (isolated wrangler + WS probes): protocol 14 served → the new `attr_points` migration ran on the
  EXISTING DB without crashing; `attrPoints` present on the wire; `spendAttr`/`respec` wired + guards
  hold (0-point spendAttr no-ops, invalid attr rejected, respec-when-not-reached no-ops, no crash).
  Live grind-to-level-up was blocked by maze pathfinding in the dumb bot — covered deterministically by
  the integration test instead.

## Out of scope (per plan)
Gold-cost respec; moving class-pick to spawn; new attribute types; per-attr soft caps; gear rebalance.
