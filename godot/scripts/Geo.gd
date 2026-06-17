class_name Geo
## Pure-logic map toolkit, ported 1:1 from the TS client/server so the native client
## matches the authoritative sim exactly. Operates on a grid Dictionary:
##   {"w": int, "h": int, "cell": float, "solid": PackedByteArray}  (row-major y*w+x, 1=wall)
## Verified against the TS behaviour by godot/test/geo_test.gd.

## Decode the base64 collision grid from `floor.geometry` (server world-do.ts encodeSolid).
## `ground_b64` (optional) is the heightfield 2.5D layer (encodeGround: Int16 LE, 2 bytes/cell);
## decoded into a PackedInt32Array of per-cell px heights (empty = flat, e.g. a v15 server).
static func decode(b64: String, gw: int, gh: int, cell: float, ground_b64: String = "") -> Dictionary:
	var grid := {"w": gw, "h": gh, "cell": cell, "solid": Marshalls.base64_to_raw(b64)}
	var ground := PackedInt32Array()
	if ground_b64 != "":
		var raw := Marshalls.base64_to_raw(ground_b64)
		var n := gw * gh
		if raw.size() >= n * 2:
			ground.resize(n)
			for i in n:
				ground[i] = raw.decode_s16(i * 2) # little-endian signed 16-bit, mirrors encodeGround
	grid["ground"] = ground
	return grid

## Nearest-cell ground height (px). INTEGER-indexed — bit-identical to TS heightAt() (collision.ts).
## This is the canonical sampler the v2 step-up gate uses. Returns 0 when there is no height layer.
static func ground_step(grid: Dictionary, x: float, y: float) -> int:
	var ground: PackedInt32Array = grid.get("ground", PackedInt32Array())
	if ground.is_empty():
		return 0
	var cell: float = grid["cell"]
	var w: int = grid["w"]
	var h: int = grid["h"]
	var cx := int(floor(x / cell))
	var cy := int(floor(y / cell))
	if cx < 0: cx = 0
	elif cx >= w: cx = w - 1
	if cy < 0: cy = 0
	elif cy >= h: cy = h - 1
	return ground[cy * w + cx]

## Bilinear ground height (px) for SMOOTH rendering (mesh displacement, entity/camera seating).
## RENDER-ONLY — never feed this into the collision/step gate (that uses ground_step). Samples by
## cell CENTRES, so a position at a cell centre returns that cell's exact height.
static func ground_height(grid: Dictionary, x: float, y: float) -> float:
	var ground: PackedInt32Array = grid.get("ground", PackedInt32Array())
	if ground.is_empty():
		return 0.0
	var cell: float = grid["cell"]
	var w: int = grid["w"]
	var h: int = grid["h"]
	var gx := x / cell - 0.5
	var gy := y / cell - 0.5
	var x0 := int(floor(gx))
	var y0 := int(floor(gy))
	var fx := gx - float(x0)
	var fy := gy - float(y0)
	var x1 := clampi(x0 + 1, 0, w - 1)
	var y1 := clampi(y0 + 1, 0, h - 1)
	x0 = clampi(x0, 0, w - 1)
	y0 = clampi(y0, 0, h - 1)
	var h00 := float(ground[y0 * w + x0])
	var h10 := float(ground[y0 * w + x1])
	var h01 := float(ground[y1 * w + x0])
	var h11 := float(ground[y1 * w + x1])
	return lerpf(lerpf(h00, h10, fx), lerpf(h01, h11, fx), fy)

## True if (x,y) is outside the grid or inside a solid cell. (procgen/collision.ts: blocked)
static func blocked(grid: Dictionary, x: float, y: float) -> bool:
	var cell: float = grid["cell"]
	var w: int = grid["w"]
	var h: int = grid["h"]
	var cx := int(floor(x / cell))
	var cy := int(floor(y / cell))
	if cx < 0 or cy < 0 or cx >= w or cy >= h:
		return true
	return grid["solid"][cy * w + cx] == 1

## True if a circle of `radius` centred at (x,y) overlaps no wall. (collision.ts: canOccupy)
static func can_occupy(grid: Dictionary, x: float, y: float, radius: float) -> bool:
	var cell: float = grid["cell"]
	var w: int = grid["w"]
	var h: int = grid["h"]
	var solid: PackedByteArray = grid["solid"]
	var min_x := int(floor((x - radius) / cell))
	var max_x := int(floor((x + radius) / cell))
	var min_y := int(floor((y - radius) / cell))
	var max_y := int(floor((y + radius) / cell))
	for cy in range(min_y, max_y + 1):
		for cx in range(min_x, max_x + 1):
			if cx < 0 or cy < 0 or cx >= w or cy >= h:
				return false
			if solid[cy * w + cx] != 1:
				continue
			var left := cx * cell
			var top := cy * cell
			var nearest_x := clampf(x, left, left + cell)
			var nearest_y := clampf(y, top, top + cell)
			var ddx := x - nearest_x
			var ddy := y - nearest_y
			if ddx * ddx + ddy * ddy < radius * radius:
				return false
	return true

## Heightfield 2.5D step-up gate: a move is allowed only if the NEAREST-CELL ground heights differ
## by <= WALKABLE_DELTA. Integer math (ground_step) — bit-identical to TS canStep (collision.ts), so
## server and client never disagree at a cliff edge (no rubber-band). Flat terrain -> always true.
static func can_step(grid: Dictionary, fx: float, fy: float, tx: float, ty: float) -> bool:
	return abs(ground_step(grid, tx, ty) - ground_step(grid, fx, fy)) <= DccConst.WALKABLE_DELTA

## Axis-separated swept move: X first, then Y. (collision.ts: moveWithCollisions)
static func move_with_collisions(grid: Dictionary, pos: Vector2, dx: float, dy: float, radius: float) -> Vector2:
	var out := pos
	var nx := out.x + dx
	if can_occupy(grid, nx, out.y, radius):
		out.x = nx
	var ny := out.y + dy
	if can_occupy(grid, out.x, ny, radius):
		out.y = ny
	return out

## Grid line-of-sight (Amanatides–Woo). True if no solid cell lies between a and b;
## the target's own cell never self-blocks. (render.ts: canSee / minimap.ts: lineOfSight)
static func line_of_sight(grid: Dictionary, ax: float, ay: float, bx: float, by: float) -> bool:
	var cell: float = grid["cell"]
	var w: int = grid["w"]
	var h: int = grid["h"]
	var solid: PackedByteArray = grid["solid"]
	var cx := int(floor(ax / cell))
	var cy := int(floor(ay / cell))
	var ecx := int(floor(bx / cell))
	var ecy := int(floor(by / cell))
	var dx := bx - ax
	var dy := by - ay
	var step_x := int(sign(dx))
	var step_y := int(sign(dy))
	var inv_dx := INF
	var inv_dy := INF
	if dx != 0.0:
		inv_dx = 1.0 / absf(dx)
	if dy != 0.0:
		inv_dy = 1.0 / absf(dy)
	var t_max_x := INF
	var t_max_y := INF
	if dx != 0.0:
		t_max_x = (((cx + 1) * cell - ax) if step_x > 0 else (ax - cx * cell)) * inv_dx
	if dy != 0.0:
		t_max_y = (((cy + 1) * cell - ay) if step_y > 0 else (ay - cy * cell)) * inv_dy
	var t_delta_x := cell * inv_dx
	var t_delta_y := cell * inv_dy
	var guard := w + h + 2
	while guard > 0:
		guard -= 1
		if cx == ecx and cy == ecy:
			return true
		if t_max_x < t_max_y:
			cx += step_x
			t_max_x += t_delta_x
		else:
			cy += step_y
			t_max_y += t_delta_y
		if cx < 0 or cy < 0 or cx >= w or cy >= h:
			return true
		if cx == ecx and cy == ecy:
			return true
		if solid[cy * w + cx] == 1:
			return false
	return true
