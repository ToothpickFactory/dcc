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

# ---- heightfield 2.5D: ground layer wire round-trip + samplers ----
# 4x3 Int16 ground (row-major y*4+x), incl. negatives + Int16 extremes, encoded by the SERVER's
# exact encodeGround (Int16 little-endian, 2 bytes/cell -> btoa). Verifies the signed wire contract
# AND that ground_step (nearest-cell, the v2 gate sampler) is bit-identical to TS heightAt.
const GROUND_B64 := "AAAQAPD/ZAAyAAAAnP8YAPn/yAAAgP9/"
const GROUND_VALS := [0, 16, -16, 100, 50, 0, -100, 24, -7, 200, -32768, 32767]

func _hgrid() -> Dictionary:
	return Geo.decode(FIXTURE_B64, GW, GH, CELL, GROUND_B64)

func test_ground_decode_signed_roundtrip() -> void:
	var g := _hgrid()
	var ground: PackedInt32Array = g["ground"]
	assert_int(ground.size()).is_equal(12)
	for i in GROUND_VALS.size():
		assert_int(ground[i]).is_equal(GROUND_VALS[i]) # signed 16-bit survives the wire

func test_ground_step_nearest_cell_matches_values() -> void:
	var g := _hgrid()
	# ground_step at any point in a cell == that cell's stored height (the v2 gate sampler)
	for cy in GH:
		for cx in GW:
			var v: int = GROUND_VALS[cy * GW + cx]
			assert_int(Geo.ground_step(g, (cx + 0.5) * CELL, (cy + 0.5) * CELL)).is_equal(v)

func test_ground_height_at_cell_centre_equals_value() -> void:
	var g := _hgrid()
	# bilinear render sampler returns the exact cell value at a cell centre
	assert_float(Geo.ground_height(g, 0.5 * CELL, 0.5 * CELL)).is_equal_approx(0.0, 0.01)
	assert_float(Geo.ground_height(g, 3.5 * CELL, 0.5 * CELL)).is_equal_approx(100.0, 0.01)
	assert_float(Geo.ground_height(g, 2.5 * CELL, 1.5 * CELL)).is_equal_approx(-100.0, 0.01)
	# midpoint between (0,0)=0 and (1,0)=16 is the average
	assert_float(Geo.ground_height(g, 1.0 * CELL, 0.5 * CELL)).is_equal_approx(8.0, 0.01)

func test_ground_absent_is_flat() -> void:
	var g := Geo.decode(FIXTURE_B64, GW, GH, CELL) # no ground arg (v15-style)
	assert_int(Geo.ground_step(g, 0.5 * CELL, 0.5 * CELL)).is_equal(0)
	assert_float(Geo.ground_height(g, 0.5 * CELL, 0.5 * CELL)).is_equal_approx(0.0, 0.01)

# Step-up gate golden vector (the SAME fixture + point pairs are asserted in TS index.test.ts, so
# canStep and Geo.can_step are proven bit-identical — the parity guard against cliff-edge rubber-band).
func _c(cx: int) -> float:
	return (float(cx) + 0.5) * CELL

func test_can_step_gate_matches_golden() -> void:
	var g := _hgrid()
	# WALKABLE_DELTA = 24. heights: (0,0)=0 (1,0)=16 (2,0)=-16 (3,0)=100 / (1,1)=0 (3,1)=24
	assert_bool(Geo.can_step(g, _c(0), _c(0), _c(1), _c(0))).is_true()   # |0-16|=16 <= 24
	assert_bool(Geo.can_step(g, _c(1), _c(0), _c(2), _c(0))).is_false()  # |16-(-16)|=32 > 24
	assert_bool(Geo.can_step(g, _c(1), _c(1), _c(3), _c(1))).is_true()   # |0-24|=24 == 24 (inclusive)
	assert_bool(Geo.can_step(g, _c(3), _c(1), _c(3), _c(0))).is_false()  # |24-100|=76 > 24
	assert_bool(Geo.can_step(g, _c(2), _c(2), _c(3), _c(2))).is_false()  # Int16 extremes -> huge
	assert_bool(Geo.can_traverse_slope(g, _c(1), _c(0), _c(2), _c(0))).is_false() # cell-centre 32px jump still blocks
	assert_bool(Geo.can_traverse_slope(g, 1.0 * CELL, 0.5 * CELL, 1.15 * CELL, 0.5 * CELL)).is_true() # smooth hill edge is climbable
	assert_bool(Geo.can_traverse_slope(g, 2.95 * CELL, 0.5 * CELL, 3.1 * CELL, 0.5 * CELL)).is_false() # large cliff face still blocks
	# absent height layer -> always walkable (flat)
	var flat := Geo.decode(FIXTURE_B64, GW, GH, CELL)
	assert_bool(Geo.can_step(flat, _c(0), _c(0), _c(3), _c(2))).is_true()
	assert_bool(Geo.can_traverse_slope(flat, _c(0), _c(0), _c(3), _c(2))).is_true()
