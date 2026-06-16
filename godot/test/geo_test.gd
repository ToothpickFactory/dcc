extends GdUnitTestSuite
## Verifies the pure-logic ports in Geo.gd against the TS behaviour — the High-risk
## items from GODOT_PORT.md (geometry decode, collision determinism, line-of-sight).

# 4x3 grid, row-major y*4+x:
#   row 0: 0 1 1 0
#   row 1: 1 0 0 1
#   row 2: 0 0 1 1
# Base64 produced by the SERVER's exact encodeSolid (btoa over String.fromCharCode),
# so this also verifies the btoa <-> Marshalls.base64_to_raw wire contract.
const FIXTURE_B64 := "AAEBAAEAAAEAAAEB"
const GW := 4
const GH := 3
const CELL := 80.0

func _grid() -> Dictionary:
	return Geo.decode(FIXTURE_B64, GW, GH, CELL)

func test_decode_dimensions_and_bytes() -> void:
	var g := _grid()
	assert_int(g["w"]).is_equal(4)
	assert_int(g["h"]).is_equal(3)
	var solid: PackedByteArray = g["solid"]
	assert_int(solid.size()).is_equal(12)
	var expected := PackedByteArray([0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1])
	assert_bool(solid == expected).is_true()

func test_blocked_matches_grid() -> void:
	var g := _grid()
	# cell (1,0) is a wall
	assert_bool(Geo.blocked(g, 1.5 * CELL, 0.5 * CELL)).is_true()
	# cell (0,0) is open
	assert_bool(Geo.blocked(g, 0.5 * CELL, 0.5 * CELL)).is_false()
	# out of bounds is blocked (matches TS)
	assert_bool(Geo.blocked(g, -10.0, 10.0)).is_true()
	assert_bool(Geo.blocked(g, GW * CELL + 10.0, 10.0)).is_true()

func test_can_occupy_radius_overlap() -> void:
	var g := _grid()
	# centre of open cell (0,0), small radius fits
	assert_bool(Geo.can_occupy(g, 0.5 * CELL, 0.5 * CELL, 17.0)).is_true()
	# 5px left of the wall at (1,0); a 17px circle overlaps the wall -> blocked
	assert_bool(Geo.can_occupy(g, 1.0 * CELL - 5.0, 0.5 * CELL, 17.0)).is_false()

func test_move_blocked_by_wall_x() -> void:
	var g := _grid()
	# in open (0,0), try to step right into wall (1,0): X move rejected
	var start := Vector2(0.5 * CELL, 0.5 * CELL)
	var moved := Geo.move_with_collisions(g, start, CELL, 0.0, 17.0)
	assert_float(moved.x).is_equal_approx(start.x, 0.001)

func test_move_allowed_into_open() -> void:
	var g := _grid()
	# cell (2,1) open -> step left into (1,1) open: allowed
	var start := Vector2(2.5 * CELL, 1.5 * CELL)
	var moved := Geo.move_with_collisions(g, start, -CELL, 0.0, 5.0)
	assert_float(moved.x).is_less(start.x)

func test_line_of_sight_blocked_through_walls() -> void:
	var g := _grid()
	# (0,0) -> (3,0) along row 0 [0,1,1,0]: walls at x=1,2 between -> blocked
	assert_bool(Geo.line_of_sight(g, 0.5 * CELL, 0.5 * CELL, 3.5 * CELL, 0.5 * CELL)).is_false()

func test_line_of_sight_clear_between_open_cells() -> void:
	var g := _grid()
	# (1,1) open -> (2,1) open, adjacent, no wall between -> visible
	assert_bool(Geo.line_of_sight(g, 1.5 * CELL, 1.5 * CELL, 2.5 * CELL, 1.5 * CELL)).is_true()
