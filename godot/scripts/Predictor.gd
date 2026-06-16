class_name Predictor
extends RefCounted
## Client-side movement prediction, ported from src/client/predict.ts WITH the
## GODOT_PORT.md fix: predict at SelfDTO.derived.moveSpeed (the TS uses a flat
## PLAYER_SPEED — a latent bug). Soft 0.15 blend toward the authoritative position.

var x := 0.0
var y := 0.0
var _inited := false
var _grid: Dictionary = {}

func set_grid(g: Dictionary) -> void:
	_grid = g

func update(self_dto: Dictionary, mv: Vector2, dt: float) -> void:
	if self_dto.is_empty():
		return
	if not _inited:
		x = float(self_dto.get("x", 0.0))
		y = float(self_dto.get("y", 0.0))
		_inited = true
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
