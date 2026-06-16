class_name Skills
## Skill / evolution data + math, ported 1:1 from src/shared/skills.ts.
## Pure static — no state. The server owns the actual progression; the client only
## needs the catalog (names/icons/flavor for evolution choices), the tree, and the
## cost/level math to render the Skills screen. Keep in lockstep with the TS.

# Catalog: node id -> the display fields a not-yet-owned evolution needs to show.
# (The ability on your bar already carries its own name/icon; only the evolution
# BUTTONS need the target node's name/icon/flavor.)
const NODES := {
	# ---- Sword line (melee cone) ----
	"sword": {"name": "Wooden Sword", "icon": "\U01f5e1️", "flavor": "A whittled training blade."},
	"cleaver": {"name": "Iron Cleaver", "icon": "\U01f52a", "flavor": "Heavier. Hits harder."},
	"greatcleaver": {"name": "Greatcleaver", "icon": "⚔️", "flavor": "A two-handed brute of a blade."},
	"executioner": {"name": "Executioner", "icon": "\U01fa93", "flavor": "One swing, one sentence."},
	"blastblade": {"name": "Blast Blade", "icon": "\U01f4a5", "flavor": "A wide arc of force in front of you."},
	"whirlwind": {"name": "Whirlwind", "icon": "\U01f300", "flavor": "Spin to win — hits all around you."},
	# ---- Rocks line (thrown projectile) ----
	"rocks": {"name": "Rocks", "icon": "\U01faa8", "flavor": "A pocketful of throwing stones."},
	"sharprocks": {"name": "Sharp Stones", "icon": "\U01f5ff", "flavor": "Knapped to an edge."},
	"boulder": {"name": "Boulder Toss", "icon": "\U01faa8", "flavor": "One big rock. It hurts."},
	"multishot": {"name": "Sling Volley", "icon": "\U01f3af", "flavor": "Three stones at once."},
	"scattershot": {"name": "Scattershot", "icon": "✴️", "flavor": "A cone of stinging shot."},
	# ---- Support line ----
	"mend": {"name": "Mend", "icon": "✨", "flavor": "Lob a mending bolt at an ally."},
	"wavemend": {"name": "Healing Wave", "icon": "\U01f30a", "flavor": "A fan of healing that mends several allies."},
}

# node id -> the evolutions you may choose when it matures.
const EVOLUTIONS := {
	"sword": ["cleaver", "blastblade"],
	"cleaver": ["greatcleaver"],
	"greatcleaver": ["executioner"],
	"blastblade": ["whirlwind"],
	"rocks": ["sharprocks", "multishot"],
	"sharprocks": ["boulder"],
	"multishot": ["scattershot"],
	"mend": ["wavemend"],
}

const CHAR_HP_PER_LEVEL := 12

# XP required to be ready to evolve at a given tier (deeper evolutions cost more).
static func evolve_cost(tier: int) -> int:
	return 15 + tier * 25  # 15, 40, 65, 90, ...

# Is this ability matured enough to evolve, and does it have anywhere to go?
static func can_evolve(ability: Dictionary) -> bool:
	var opts: Array = EVOLUTIONS.get(str(ability.get("id", "")), [])
	if opts.is_empty():
		return false
	return int(ability.get("xp", 0)) >= evolve_cost(int(ability.get("tier", 0)))

static func options_for(id: String) -> Array:
	return EVOLUTIONS.get(id, [])

# Total XP across the run -> a character level (each level costs a bit more).
static func char_level_of(char_xp: int) -> int:
	var lvl := 0
	var need := 40
	var acc := 0
	while char_xp >= acc + need:
		acc += need
		lvl += 1
		need += 35
	return lvl

# How far into the current character level, and how much the next one needs.
static func char_xp_for_next(char_xp: int) -> Dictionary:
	var need := 40
	var acc := 0
	while char_xp >= acc + need:
		acc += need
		need += 35
	return {"into": char_xp - acc, "need": need}
