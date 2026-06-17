# Hard crowd control — stuns / roots / freezes (M, server)

Roadmap §1: give classes defining CC so a mage/rogue/warrior/hunter play differently.
Today the only CC is a 50% slow + taunt.

## Design
Two primitives, three flavors, **enemy-only** (player abilities CC monsters/boss):
- **root** — can't move (speed→0); can still swing/shoot if in range.
- **stun** — can't move AND can't act; cancels any pending wind-up (interrupt).
- **freeze** — a stun flavored as ice; leaves a short slow tail on thaw.

State: monsters + boss get `ccUntil` + `ccKind` (""|"stun"|"root"|"freeze").
Stun/freeze > root priority (a root never downgrades an active stun).

## Class CC abilities (talent grants, row 1, requires 2)
- warrior `shieldbash` — melee, wide cone, **stun**.
- hunter  `concussive` — ranged bolt, **stun**.
- rogue   `hamstring`  — melee, narrow cone, **root**.
- mage    `frostnova`  — self-AoE (cone 2π), **freeze** + slow tail.

## Tasks
- [ ] types.ts: `CcKind`; Ability `stunMs?`/`rootMs?`/`freeze?`.
- [ ] constants.ts: `FREEZE_SLOW_TAIL_MS`.
- [ ] state.ts: Monster/Boss `ccUntil`+`ccKind`; Projectile `stunMs?/rootMs?/freeze?`.
- [ ] combat.ts: `applyCc()` (enemy-only; sets timers, interrupts wind-up, emits fx).
- [ ] projectiles.ts: thread CC onto projectiles + melee cone; exclude CC abils from combo.
- [ ] monsters.ts: stun=skip AI, root=speed 0; reset on respawn.
- [ ] boss.ts: stun=return, root=no chase (still melee/cast).
- [ ] protocol.ts: v12→13; EntityDTO `cc?`; GameEvent `cc`.
- [ ] world-do.ts: init fields on spawn; broadcast `cc`.
- [ ] skills.ts + talents.ts: 4 abilities + 4 talent nodes.
- [ ] Godot mirrors: DccConst v13; Talents.gd nodes; EntitySprite cc tint; SpriteLayer set_cc; Main cc fx pop.
- [ ] tests: patch MonsterState literals; tsc; godot import; WS probe (stun freezes a monster).

## Review
Done + verified. Two primitives (`ccUntil`+`ccKind` on monsters & boss), three flavors:
- **stun/freeze** → `continue`/`return` in the AI (no act, no move) + interrupt the pending wind-up.
- **root** → `speed = 0` (one line; movement no-ops, attacks still resolve).
- **freeze** = ice-flavored stun + a `FREEZE_SLOW_TAIL_MS` slow on thaw (monsters only — boss has no slow).
`applyCc()` is the single funnel (enemy-only guard, stun/freeze > root priority, emits a `cc` fx).
CC abilities are excluded from the melee combo so they stay deliberate cooldowns. Four talent-granted
abilities, one CC type each spread across delivery: shieldbash (melee stun), concussive (ranged stun),
hamstring (melee root), frostnova (AoE freeze). Protocol 12→13 (`EntityDTO.cc` + `cc` GameEvent).

Verified: `tsc` clean; projectiles test +8 CC checks pass through the real castAbility/updateMonsters/
applyCc/applyDamage code; talents+skills tests green; Godot `--import` parse-clean; live server reports
protocol 13; wire probe shows monster/boss DTOs well-formed with `cc` correctly omitted when idle.

Out of scope (future): enemy archetypes that CC the player (the inverse); diminishing returns on
repeated CC; a priest CC (kept support-pure for now).
