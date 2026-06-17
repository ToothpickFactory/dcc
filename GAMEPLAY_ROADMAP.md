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
- ✅ **Hard crowd control** — class-defining stun / root / freeze (talent-granted): warrior **Shield
  Bash** (wide cone stun), hunter **Concussive Shot** (ranged stun), rogue **Hamstring** (melee root),
  mage **Frost Nova** (AoE freeze + slow tail). A stun/freeze fully locks a foe out AND interrupts its
  wind-up (the floor's interrupt window vs. the boss); a root pins movement but it can still swing.
  Enemy-only (never CCs allies); rendered as a status tint (icy / dazed-pulse / dim-green) + a pop icon.
- ✅ **Melee combo loop** — light swings chain at half-cooldown into a heavy finisher (1.7× dmg, wider
  cone, 2.2× knockback) with a full-cooldown recovery; the chain resets after the finisher or if you
  pause >850ms. Felt via the faster→pause rhythm + scaled damage numbers + bigger knockback.
- ✅ **Target-assist on all slots** — casts snap toward the nearest enemy within a ±32° aim cone
  (≤560px), so fast swarms aren't pure precision-mouse.

## 2. Character systems & builds
The systems are surprisingly deep already (5 WoW classes, talent trees w/ spec forks, the trinity,
ability evolution, gear stats) — but largely **invisible/unfelt**.

- ✅ **Talent-point / class-pick HUD nudge** — a prioritized "Choose your class / Talent point ready /
  skill ready — press K" badge + toast surfaces the build system at level-up.
- ✅ **Show chosen class + role in the HUD** — status line shows e.g. "⚔️ Warrior · DPS" once a class is picked.
- ✅ **Per-level attribute points** — every character level grants 3 points to pour into any of the 7
  attrs (STR/AGI/INT/STA/CRIT/Haste/Armor) on the K screen; spent points live in `base` and feed derived
  stats. Base attrs are no longer zero-forever — tactile growth alongside gear.
- ✅ **Respec** — free in the waiting room (a two-tap button on the K screen). Refunds ALL spent attribute
  + talent points and strips talent-granted abilities from the bar, so a bad fork is never permanent.
- ✅ **Deeper talent trees** — spec nodes are now `maxRank: 2` and each tree gained a row-3 "mastery"
  passive (`requires: 6`, `maxRank: 3`), so builds keep developing to ~level 9+ (ranks scale the passive).
- ✅ **Class-flavored starting kits** — picking a class swaps the generic sword+rocks opener for a class
  kit (mage: arcane bolts, priest: mend+poke, rogue: blade+knives, hunter: thrown+volley), only if the
  opener is untouched — so class identity reads immediately.

## 3. Enemies, AI & encounter design
- ✅ **Attack telegraphs** (see §1).
- ✅ **Floor-depth stat scaling** — enemy HP +12%/floor, damage +8%/floor (boss too), so descending is
  genuinely deadlier, not just more crowded.
- ✅ **Lead-the-target ranged shots** — monster/boss bolts predict your movement, scaling with depth
  (floor 1 ≈ aim-at-current, capped ~0.35s lead deep), sharpening the dodge curve.
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

- ✅ **Loot-grant celebration** — the `t:"loot"` grant now fires a rarity-colored toast + sfx (+ a screen
  pop for epic/legendary).
- ✅ **Ground rarity beams** — loot bags glow/shimmer by best-item rarity (overbright for the high tiers),
  so you can spot a legendary across the room.
- ⬜ **Rolled affixes** (M, server) — named prefixes/suffixes ("Vicious … of the Bear") so two same-rarity
  drops differ; the loot lottery that makes "is this better?" meaningful.
- ✅ **Economy: a buy vendor** — a waiting-room shop (2 potions + 4 rotating gear, priced sellValue×4,
  plus a gold reroll) completes the sell-trash → buy-upgrade loop. Server-authoritative (validates gold
  + carry space before charging); a SHOP section in the inventory screen, waiting-room only.
- ⬜ **Uniques & sets** (L, server) — a handful of named drops with procs / set bonuses; the chase items
  that drive "one more floor."
- ✅ **Equip-vs-candidate stat delta** — carried/loot/shop tiles show green/red ± per attribute vs the item
  worn in that slot (mirrors compatibleSlots), so judging an upgrade is a glance, not manual math.
- ⬜ **Magic-find / luck** (M, server) — a stat that nudges drop rate/rarity, so farming compounds.

## 5. Co-op play & run progression
Drop-in co-op is solid (shared world, reconnect, assists, boss hoard). The trinity exists as data but
isn't *needed*; death is an instant dead-end.

- ✅ **Depth scaling** (see §3) — half of "make the trinity matter."
- ✅ **Shared party XP** — living allies within 600px of a kill get a 50% character-XP share, so tanks/
  healers level with the party (ability XP still goes to the killer's used ability).
- ✅ **Boss gates the stairs** — the exit stays shut until the floor's guardian is dead (with a client
  "Defeat the boss to descend" hint); each floor is now a guaranteed team fight.
- ⬜ **Downed / bleed-out + revive** (L, server) — *the* missing CoN pillar: a teammate's death becomes a
  recoverable crisis (stand over them / revive) instead of a spectator screen, and finally justifies healers/tanks.
- ⬜ **Party-size enemy scaling** (M, server) — a 4-player camp should be tougher than a solo one.
- ✅ **Ally HP bars + class nameplates** — a floating class-icon nameplate + HP bar above each teammate
  (billboarded, reads through walls for co-op); `klass`/hp/maxHp now broadcast per player. A healer can read
  party HP at a glance (and it's the readout revive will build on).
- ✅ **Loot etiquette** — the player who earns a kill owns the bag for an 8s priority window before others
  can take (anti-ninja); the bag dims + 🔒s for everyone else until the window passes.
- ⬜ **Meta-progression** (M, server) — spend lifetime XP on small persistent unlocks so a wiped run feeds the
  next one (the standard permadeath-fatigue fix). Today only a leaderboard number persists.

---

## Suggested next batches
**All S-tier items are now done ✅** (combat loop, build payoff + loot pop, shared XP, boss-gate,
lead-target, rarity beams). The remaining M/L work, by theme:
1. **Co-op cohesion** (L, server): downed/revive (the missing CoN pillar) + party-size scaling + ally HP bars.
2. **Encounter depth** (M→L, server): boss multi-phase → elite affixes → new archetypes (charger/bomber/summoner).
3. **Itemization depth** (M→L, server): rolled affixes → buy vendor (gold sink) → uniques/sets.
4. ~~**Build depth**: per-level attribute points → respec → deeper talent trees → class-flavored starting kits~~ — ✅ all done.
5. ~~**Combat depth**: hard CC (stun/root/freeze) → melee combo loop~~ — ✅ both done.

_See the audit (gameplay-vs-CoN) for the detailed current-state findings behind each item._
