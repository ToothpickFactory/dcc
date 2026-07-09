class_name CompanionQuips
## In-character ambient one-liners for recruited companions, keyed by compKlass
## (see EntitySprite.gd's _update_companion_quip). Purely cosmetic flavor text —
## no gameplay effect, no server round-trip.

const LINES := {
	"barbarian": [
		"More walls! MORE WALLS TO HIT!",
		"I have not eaten a whole goat in... too long.",
		"Why sneak? Sneaking is for people with small axes.",
		"Is that treasure? SMASH IT OPEN TO FIND OUT.",
		"My mother said I'd never amount to anything. She was standing too close to a boulder when she said it.",
		"This dungeon smells like my gym sock collection. I approve.",
		"Quiet? Why would I be quiet. WHO IS QUIET NOW.",
		"I once wrestled a bear for fun. The bear did not consent to the fun.",
	],
	"cleric": [
		"I heal you and this is the thanks I get — you walking into more spikes.",
		"The light guides us. Also I would like some snacks; the light does not provide snacks.",
		"I've blessed this floor. It's still full of skeletons, but blessed skeletons.",
		"Please stop standing in the fire. The light frowns upon fire-standing.",
		"I forgive you for that last mistake. I am keeping a list, though.",
		"Faith, hope, and a truly excellent healing spell — that's all a body needs.",
		"I prayed for patience. Then you picked a fight with three skeletons at once.",
		"Every wound you take is a personal insult to my professional pride.",
	],
	"paladin": [
		"Justice walks with us today. Justice is currently stepping in something unpleasant.",
		"I swore an oath to protect the innocent. You, less so, but I'll manage.",
		"Evil shall not pass! ...unless it's really persistent, then maybe.",
		"My blade is honor made steel. Also it's pointy, which helps.",
		"A true hero never retreats. A true hero also knows when 'retreat' is called 'tactics.'",
		"I have never once told a lie. Except about how many push-ups I can do.",
		"Righteousness is its own reward. So is not dying, which I'd also like.",
		"By my honor, this floor shall know order! ...and also several small fires, apparently.",
	],
	"ranger": [
		"I can track a deer for three days through a forest. This dungeon has no deer. I am unqualified.",
		"Bit stuffy in here. I miss trees. Trees don't talk back.",
		"I've got a bead on that monster's weak point. It's 'all of it,' mostly.",
		"Fought a bear once. Won. Didn't gloat. This is me not gloating.",
		"You call this a maze? I once got lost in a well-labeled national park.",
		"My bow doesn't miss. My jokes, apparently, do.",
		"There's a draft coming from the east wall. Also possibly a horde. Hard to say.",
		"I talk to animals. This skeleton is not technically an animal, so we're at an impasse.",
	],
	"rogue": [
		"That chest was practically begging to be opened. I was just being polite.",
		"'Borrowing' is just stealing with better PR.",
		"I didn't pick that lock, it simply... let me in.",
		"Relax, nobody saw that. Except you. And now this dungeon's read my diary.",
		"I've got sticky fingers and a stickier moral compass.",
		"Subtlety is an art form. You, swinging that axe, are more of a car alarm.",
		"Trust me. That's usually when the bad stuff happens, but trust me anyway.",
		"I'm not saying I stole your last potion. I'm saying check your inventory and don't ask questions.",
	],
	"wizard": [
		"Do you know how many years of study it takes to conjure a simple fireball? Neither do I, I skipped that lecture.",
		"Ah yes, a wall. I too could have identified that.",
		"My spellbook weighs more than my dignity, and I've lost plenty of both down here.",
		"That was not a misfire. That was an... experimental application.",
		"I've read seventeen tomes on dungeon lore. None of them mentioned this smell.",
		"Magic is simply science that hasn't finished arguing with itself yet.",
		"Do try to stand slightly less in the blast radius next time.",
		"I once turned a man into a newt. He got better. Mostly.",
	],
}

## Random line for a companion class, or "" if the class is unknown/empty.
static func random_line(klass: String) -> String:
	var pool: Variant = LINES.get(klass, [])
	if pool is Array and not pool.is_empty():
		return pool[randi() % pool.size()]
	return ""
