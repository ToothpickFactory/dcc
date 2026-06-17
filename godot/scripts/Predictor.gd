class_name Predictor
extends RefCounted
## Client-side movement prediction, ported from src/client/predict.ts WITH the
## GODOT_PORT.md fix: predict at SelfDTO.derived.moveSpeed (the TS uses a flat
## PLAYER_SPEED — a latent bug). Soft 0.15 blend toward the authoritative position.

var x := 0.0
var y := 0.0
var _inited := false
var _grid: Dictionary = {}
var _dash_until := 0.0          # ms wall-clock; predicted dash burst active until then
var _dash_dir := Vector2.ZERO

func set_grid(g: Dictionary) -> void:
	_grid = g

# Begin a predicted dash burst (Main calls this when it sends a dash).
func dash(dir: Vector2) -> void:
	if dir.length() > 0.001:
		_dash_dir = dir.normalized()
	_dash_until = Time.get_ticks_msec() + DccConst.DASH_MS

func update(self_dto: Dictionary, mv: Vector2, dt: float) -> void:
	if self_dto.is_empty():
		return
	if not _inited:
		x = float(self_dto.get("x", 0.0))
		y = float(self_dto.get("y", 0.0))
		_inited = true
	# Predicted dash burst overrides input movement (mirrors server stepPlayer).
	if Time.get_ticks_msec() < _dash_until:
		var ddx := _dash_dir.x * DccConst.DASH_SPEED * dt
		var ddy := _dash_dir.y * DccConst.DASH_SPEED * dt
		if not _grid.is_empty():
			var dp := Geo.move_with_collisions(_grid, Vector2(x, y), ddx, ddy, DccConst.PLAYER_RADIUS)
			x = dp.x
			y = dp.y
		else:
			x += ddx
			y += ddy
		x += (float(self_dto.get("x", x)) - x) * 0.15
		y += (float(self_dto.get("y", y)) - y) * 0.15
		return
	var l := mv.length()
	if l > 0.0:
		var speed := DccConst.PLAYER_SPEED
		var derived: Variant = self_dto.get("derived", {})
		if derived is Dictionary and derived.has("moveSpeed"):
			speed = float(derived["moveSpeed"])
		var dx := (mv.x / l) * speed * dt
		var dy := (mv.y / l) * speed * dt
		if not _grid.is_empty():
			var p := Geo.move_with_collisions(_grid, Vector2(x, y), dx, dy, DccConst.PLAYER_RADIUS)
			x = p.x
			y = p.y
		else:
			x += dx
			y += dy
	x += (float(self_dto.get("x", x)) - x) * 0.15
	y += (float(self_dto.get("y", y)) - y) * 0.15
