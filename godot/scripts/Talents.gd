class_name Talents
## Class + talent-tree data and gating, ported 1:1 from src/shared/classes.ts +
## src/shared/talents.ts. Pure static — the server owns the real state; the client
## only needs the catalog + can_spend math to render the class picker + talent grid.
## Keep in lockstep with the TS.

const KLASSES := ["warrior", "mage", "priest", "rogue", "hunter"]

const CLASS_MAIN_STAT := {
	"warrior": "strength", "mage": "intellect", "priest": "intellect",
	"rogue": "agility", "hunter": "agility",
}
const CLASS_ROLE := {
	"warrior": "dps", "mage": "dps", "priest": "healer", "rogue": "dps", "hunter": "dps",
}
const CLASS_INFO := {
	"warrior": {"name": "Warrior", "icon": "⚔️", "armor": "Plate", "blurb": "Plate-clad weapon master. Strength fuels heavy strikes; talent into a threat-holding tank or a relentless DPS."},
	"mage": {"name": "Mage", "icon": "\U0001f52e", "armor": "Cloth", "blurb": "Glass-cannon spellcaster. Intellect powers ranged bolts and a group haste burst."},
	"priest": {"name": "Priest", "icon": "✨", "armor": "Cloth", "blurb": "Light-wielding healer. Intellect scales heals, shields on allies, and group buffs — the trinity's anchor."},
	"rogue": {"name": "Rogue", "icon": "\U0001f5e1️", "armor": "Leather", "blurb": "Agile melee assassin. Agility and crit turn fast strikes into bursts of damage."},
	"hunter": {"name": "Hunter", "icon": "\U0001f3f9", "armor": "Mail", "blurb": "Ranged marksman. Agility drives volleys of thrown shots from a safe distance."},
}

# Per-class talent trees: each node {id,row,requires?,choiceGroup?,name,icon,desc}.
const TREES := {
	"warrior": [
		{"id": "w_cleave", "row": 0, "name": "Cleave", "icon": "\U0001f52a", "desc": "Unlock Iron Cleaver."},
		{"id": "w_tough", "row": 0, "choiceGroup": "w_spec", "name": "Toughness", "icon": "\U0001f6e1️", "desc": "Tank: +armor/stamina and 3× threat."},
		{"id": "w_blood", "row": 0, "choiceGroup": "w_spec", "name": "Bloodthirst", "icon": "\U0001fa78", "desc": "DPS: +strength and +crit."},
		{"id": "w_taunt", "row": 1, "requires": 2, "name": "Taunt", "icon": "\U0001f5ef️", "desc": "Unlock Taunt (hold aggro)."},
		{"id": "w_shield", "row": 1, "requires": 2, "name": "Shield Ward", "icon": "\U0001f6e1️", "desc": "Unlock an ally absorb shield."},
		{"id": "w_whirl", "row": 2, "requires": 4, "name": "Whirlwind", "icon": "\U0001f300", "desc": "Capstone: spin to hit all around."},
	],
	"mage": [
		{"id": "m_bolts", "row": 0, "name": "Arcane Bolts", "icon": "\U0001f537", "desc": "Unlock sharper ranged bolts."},
		{"id": "m_pyro", "row": 0, "choiceGroup": "m_spec", "name": "Pyromania", "icon": "\U0001f525", "desc": "+intellect and +crit."},
		{"id": "m_weave", "row": 0, "choiceGroup": "m_spec", "name": "Spellweave", "icon": "\U0001f30c", "desc": "+intellect (steady power)."},
		{"id": "m_multi", "row": 1, "requires": 2, "name": "Arcane Missiles", "icon": "\U0001f3af", "desc": "Unlock a 3-bolt volley."},
		{"id": "m_warp", "row": 1, "requires": 2, "name": "Time Warp", "icon": "\U0001fa78", "desc": "Unlock a group haste burst."},
		{"id": "m_scatter", "row": 2, "requires": 4, "name": "Arcane Barrage", "icon": "✴️", "desc": "Capstone: a cone of bolts."},
	],
	"priest": [
		{"id": "p_mend", "row": 0, "name": "Mend", "icon": "✨", "desc": "Unlock a healing bolt (allies only)."},
		{"id": "p_holy", "row": 0, "choiceGroup": "p_spec", "name": "Holy Light", "icon": "\U0001f31f", "desc": "+intellect (stronger heals)."},
		{"id": "p_div", "row": 0, "choiceGroup": "p_spec", "name": "Divinity", "icon": "\U0001f54a️", "desc": "+intellect and +stamina."},
		{"id": "p_shield", "row": 1, "requires": 2, "name": "Power Word: Shield", "icon": "\U0001f6e1️", "desc": "Unlock an ally absorb shield."},
		{"id": "p_inspire", "row": 1, "requires": 2, "name": "Inspire", "icon": "\U0001fa78", "desc": "Unlock a group haste burst."},
		{"id": "p_wave", "row": 2, "requires": 4, "name": "Wave of Mending", "icon": "\U0001f30a", "desc": "Capstone: heal several allies."},
	],
	"rogue": [
		{"id": "r_strike", "row": 0, "name": "Quick Strikes", "icon": "\U0001f52a", "desc": "Unlock faster melee strikes."},
		{"id": "r_deadly", "row": 0, "choiceGroup": "r_spec", "name": "Deadliness", "icon": "☠️", "desc": "+agility and +crit."},
		{"id": "r_swift", "row": 0, "choiceGroup": "r_spec", "name": "Swiftness", "icon": "\U0001f4a8", "desc": "+agility (speed + power)."},
		{"id": "r_blast", "row": 1, "requires": 2, "name": "Blade Flurry", "icon": "\U0001f4a5", "desc": "Unlock a wide melee arc."},
		{"id": "r_knives", "row": 1, "requires": 2, "name": "Throwing Knives", "icon": "\U0001f5ff", "desc": "Unlock thrown blades."},
		{"id": "r_fan", "row": 2, "requires": 4, "name": "Fan of Knives", "icon": "\U0001f300", "desc": "Capstone: strike all around."},
	],
	"hunter": [
		{"id": "h_aim", "row": 0, "name": "Steady Aim", "icon": "\U0001f3af", "desc": "Unlock sharper shots."},
		{"id": "h_mark", "row": 0, "choiceGroup": "h_spec", "name": "Marksman", "icon": "\U0001f3f9", "desc": "+agility and +crit."},
		{"id": "h_swift", "row": 0, "choiceGroup": "h_spec", "name": "Fleet", "icon": "\U0001f4a8", "desc": "+agility (speed + power)."},
		{"id": "h_multi", "row": 1, "requires": 2, "name": "Multi-Shot", "icon": "\U0001f3af", "desc": "Unlock a 3-shot volley."},
		{"id": "h_rapid", "row": 1, "requires": 2, "name": "Rapid Fire", "icon": "\U0001fa78", "desc": "Unlock a group haste burst."},
		{"id": "h_scatter", "row": 2, "requires": 4, "name": "Volley", "icon": "✴️", "desc": "Capstone: a cone of shots."},
	],
}

static func tree(klass: String) -> Array:
	return TREES.get(klass, [])

static func talent_spent(talents: Dictionary) -> int:
	var n := 0
	for v in talents.values():
		n += int(v)
	return n

# Mirror of canSpendTalent: enough points, rank room, row unlocked, no choice conflict.
static func can_spend(klass: String, talents: Dictionary, points: int, node_id: String) -> bool:
	if points <= 0:
		return false
	var t: Array = TREES.get(klass, [])
	var node: Dictionary = {}
	for n in t:
		if str(n.get("id", "")) == node_id:
			node = n
			break
	if node.is_empty():
		return false
	if int(talents.get(node_id, 0)) >= int(node.get("maxRank", 1)):
		return false
	if int(node.get("requires", 0)) > talent_spent(talents):
		return false
	var group := str(node.get("choiceGroup", ""))
	if group != "":
		for other in t:
			if str(other.get("id", "")) != node_id and str(other.get("choiceGroup", "")) == group and int(talents.get(str(other.get("id", "")), 0)) > 0:
				return false
	return true
