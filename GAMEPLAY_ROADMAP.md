# Gameplay Roadmap — toward a Champions-of-Norrath feel

The north star is **Champions of Norrath** (PS2 co-op action-RPG): tight read-and-evade
combat, deep character builds, a satisfying loot shower, telegraphed enemies, and drop-in
co-op you depend on. This doc captures the improvements from the gameplay audit, with status,
effort (S/M/L), and whether each needs **server** work or is **client-only**.

Status: ✅ done · 🔜 next / high-value · ⬜ planned

---

## 1. Controls & moment-to-moment combat
The CoN core: a readable attack you dodge, then punish. The engine is twin-stick (WASD + mouse
aim, slot abilities, slot-1 auto-cast).

- ✅ **Dodge / dash** with i-frames (Space / LB) — server-authoritative burst + client prediction.
- ✅ **Enemy attack telegraphs** — melee winds up before it lands (whiffs if you step out); boss
  melee + bolt-fan telegraph too. Rendered as an orange charge tint + ❗ marker.
- ✅ **Knockback / stagger** — player hits shove enemies (per-kind resistance) and cancel their wind-up.
- ✅ **Hit feel** — flash, screenshake, hit-stop on kills, gamepad rumble, projectile trails (earlier juice pass).
- 🔜 **Hard crowd control** (M, server) — stuns / roots / freezes so a mage/rogue/warrior play
  differently. Today the only CC is a 50% slow + taunt.
- ⬜ **Melee combo loop** (M, server) — chained light/heavy swings with commit windows, instead of a
  single instant cone, so melee has rhythm and weight.
- ⬜ **Target-assist on all slots** (S) — slot-1 auto-aims at the nearest enemy; extend a light
  aim-assist to the other slots so fast swarms aren't pure precision-mouse.

## 2. Character systems & builds
The systems are surprisingly deep already (5 WoW classes, talent trees w/ spec forks, the trinity,
ability evolution, gear stats) — but largely **invisible/unfelt**.

- 🔜 **Talent-point / class-pick HUD nudge** (S, client) — players gain a talent point at level-up and
  never know to press K. A pulsing "Talent point — press K" badge (and a loud first-time "Choose your
  class") exposes the whole build system. *Highest-value, near-free.*
- 🔜 **Show chosen class + role in the HUD** (S, client) — the status line shows the *emergent* playstyle
  label, not your picked Warrior/Mage + trinity role. Data already on SelfDTO.
- ⬜ **Per-level attribute points** (M, server) — pour points into STR/AGI/INT/STA/CRIT each level. Today
  base attrs are zero forever and all stat identity is RNG gear; this is the missing CoN tactile growth.
- ⬜ **Respec** (M, server) — free in the waiting room (or gold). Permadeath already punishes mistakes;
  a locked bad fork on top kills experimentation.
- ⬜ **Deeper talent trees** (M, data) — ranked nodes (maxRank>1) + a couple more rows so builds keep
  developing past ~level 6 (the data model already supports ranks).
- ⬜ **Class-flavored starting kits** (M, server) — a Mage opening with a bolt, a Priest with mend, etc.,
  instead of everyone starting sword+rocks — so class choice matters in the first 60 seconds.

## 3. Enemies, AI & encounter design
- ✅ **Attack telegraphs** (see §1).
- ✅ **Floor-depth stat scaling** — enemy HP +12%/floor, damage +8%/floor (boss too), so descending is
  genuinely deadlier, not just more crowded.
- 🔜 **Lead-the-target ranged shots** (S, server) — deeper floors predict your movement instead of always
  aiming at your current position, sharpening the dodge curve cheaply.
- ⬜ **Boss multi-phase mechanics** (M, server) — phase transitions at 66% / 33% HP (radial bolt ring,
  summon adds, brief enrage) so the floor climax is a real encounter, not a bigger grunt.
- ⬜ **Elite / champion packs + affixes** (L, server) — tag some camp monsters elite with rolled affixes
  (fast / shielded / frenzied / vampiric / explodes-on-death) + outline; the texture of an ARPG run and
  the hook for better loot.
- ⬜ **New enemy archetypes with abilities** (L, server) — charger (dashes, sidestep it), bomber (AoE on
  death), summoner (spawns swarms + AoE puddles) — enemies that pose different *problems*, not just stats.

## 4. Loot & reward loop
Two parallel loot systems (playstyle-tailored **ability grants** + equippable **gear**). Gear is generic;
the headline ability grant currently arrives **silently** on the native client.

- 🔜 **Loot-grant celebration** (S, client) — the Godot client drops the `t:"loot"` message; add a
  rarity-colored toast + pop + sfx so a boss legendary actually *lands*. *Cheap, high-impact.*
- 🔜 **Ground rarity beams** (S, server+client) — tint loot bags by best-item rarity + a soft light beam,
  so you can spot a legendary across the room (CoN's signature loot-shower payoff).
- ⬜ **Rolled affixes** (M, server) — named prefixes/suffixes ("Vicious … of the Bear") so two same-rarity
  drops differ; the loot lottery that makes "is this better?" meaningful.
- ⬜ **Economy: a buy vendor** (M, server) — gold is sell-only today (a dead-end number). A waiting-room
  shop (potions + rotating stat gear / reroll) completes the sell-trash → buy-upgrade loop.
- ⬜ **Uniques & sets** (L, server) — a handful of named drops with procs / set bonuses; the chase items
  that drive "one more floor."
- ⬜ **Equip-vs-candidate stat delta** (M, client) — green/red +/- per attribute vs your equipped item, so
  the loot sweep is a glance, not manual math.
- ⬜ **Magic-find / luck** (M, server) — a stat that nudges drop rate/rarity, so farming compounds.

## 5. Co-op play & run progression
Drop-in co-op is solid (shared world, reconnect, assists, boss hoard). The trinity exists as data but
isn't *needed*; death is an instant dead-end.

- ✅ **Depth scaling** (see §3) — half of "make the trinity matter."
- 🔜 **Shared party XP** (S, server) — XP is killer-only today, punishing tanks/healers who rarely last-hit.
  Split among nearby/threat-drawing allies so the party levels together.
- 🔜 **Boss gates the stairs** (S, server) — the boss is skippable; gating turns each floor into a guaranteed
  team fight + shared-loot beat.
- ⬜ **Downed / bleed-out + revive** (L, server) — *the* missing CoN pillar: a teammate's death becomes a
  recoverable crisis (stand over them / revive) instead of a spectator screen, and finally justifies healers/tanks.
- ⬜ **Party-size enemy scaling** (M, server) — a 4-player camp should be tougher than a solo one.
- ⬜ **Ally HP bars + class nameplates** (M, client) — you can't see a teammate's HP mid-fight; needed for a
  healer to play their role and for revive to read.
- ⬜ **Loot etiquette** (M, server) — a short owner-priority window / round-robin on bags to avoid ninja-looting.
- ⬜ **Meta-progression** (M, server) — spend lifetime XP on small persistent unlocks so a wiped run feeds the
  next one (the standard permadeath-fatigue fix). Today only a leaderboard number persists.

---

## Suggested next batches
1. **Build payoff + loot pop** (all S, client-mostly): talent-point nudge, show class+role, loot-grant
   celebration, ground rarity beams — surfaces deep systems that already exist, near-free.
2. **Co-op cohesion** (S→L, server): shared XP + boss-gates-stairs (S) → downed/revive + party scaling (L).
3. **Encounter depth** (M→L, server): boss phases → elite affixes → new archetypes.
4. **Itemization depth** (M→L, server): rolled affixes → buy vendor → uniques/sets.

_See the audit (gameplay-vs-CoN) for the detailed current-state findings behind each item._
