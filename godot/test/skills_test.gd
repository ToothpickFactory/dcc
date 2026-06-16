extends GdUnitTestSuite
## Verifies the skill/evolution math in Skills.gd against src/shared/skills.ts — the
## values that drive the Skills screen (evolve readiness, costs, character level).

func test_evolve_cost_curve() -> void:
	# 15 + tier*25  ->  15, 40, 65, 90
	assert_int(Skills.evolve_cost(0)).is_equal(15)
	assert_int(Skills.evolve_cost(1)).is_equal(40)
	assert_int(Skills.evolve_cost(2)).is_equal(65)
	assert_int(Skills.evolve_cost(3)).is_equal(90)

func test_can_evolve_needs_xp_and_a_branch() -> void:
	# Base sword can evolve once it reaches 15 xp.
	assert_bool(Skills.can_evolve({"id": "sword", "tier": 0, "xp": 14})).is_false()
	assert_bool(Skills.can_evolve({"id": "sword", "tier": 0, "xp": 15})).is_true()
	# greatcleaver is tier 2 (cost 65) and branches to executioner.
	assert_bool(Skills.can_evolve({"id": "greatcleaver", "tier": 2, "xp": 64})).is_false()
	assert_bool(Skills.can_evolve({"id": "greatcleaver", "tier": 2, "xp": 65})).is_true()
	# A mastered leaf (no EVOLUTIONS entry) can never evolve, however much xp.
	assert_bool(Skills.can_evolve({"id": "executioner", "tier": 3, "xp": 9999})).is_false()
	assert_bool(Skills.can_evolve({"id": "whirlwind", "tier": 2, "xp": 9999})).is_false()

func test_options_for_matches_tree() -> void:
	assert_array(Skills.options_for("sword")).contains_exactly(["cleaver", "blastblade"])
	assert_array(Skills.options_for("rocks")).contains_exactly(["sharprocks", "multishot"])
	assert_array(Skills.options_for("executioner")).is_empty()

func test_char_level_thresholds() -> void:
	# need: 40, 75, 110, ...  cumulative: 40, 115, 225
	assert_int(Skills.char_level_of(0)).is_equal(0)
	assert_int(Skills.char_level_of(39)).is_equal(0)
	assert_int(Skills.char_level_of(40)).is_equal(1)
	assert_int(Skills.char_level_of(114)).is_equal(1)
	assert_int(Skills.char_level_of(115)).is_equal(2)
	assert_int(Skills.char_level_of(224)).is_equal(2)
	assert_int(Skills.char_level_of(225)).is_equal(3)

func test_char_xp_for_next() -> void:
	var a := Skills.char_xp_for_next(0)
	assert_int(a["into"]).is_equal(0)
	assert_int(a["need"]).is_equal(40)
	var b := Skills.char_xp_for_next(40)
	assert_int(b["into"]).is_equal(0)
	assert_int(b["need"]).is_equal(75)
	var c := Skills.char_xp_for_next(50)
	assert_int(c["into"]).is_equal(10)
	assert_int(c["need"]).is_equal(75)
