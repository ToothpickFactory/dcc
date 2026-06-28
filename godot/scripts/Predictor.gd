class_name Predictor
extends RefCounted
## Client-side movement prediction, ported from src/client/predict.ts WITH the
## GODOT_PORT.md fix: predict at SelfDTO.derived.moveSpeed (the TS uses a flat
## PLAYER_SPEED — a latent bug). Soft 0.15 blend toward the authoritative position.

var x := 0.0
var y := 0.0
var _inited := false
var _grid: Dictionary = {}
var _props: Array = []          # [{x,y,r}, ...] live props/characters the server collides with
var _dash_until := 0.0          # ms wall-clock; predicted dash burst active until then
var _dash_dir := Vector2.ZERO

func set_grid(g: Dictionary) -> void:
	_grid = g

# Live destructible props (server blocks on these via propBlocking). Without this the client
# predicts straight through them and the server snaps you back — the rubber-band / "stuck" bug.
func set_props(props: Array) -> void:
	_props = props

# Walls AND props, mirroring the server's canOccupyWorld (sim/collision.ts).
func _occupy(nx: float, ny: float, radius: float) -> bool:
	if not Geo.can_occupy(_grid, nx, ny, radius):
		return false
	for p in _props:
		var rr: float = radius + float(p.r)
		var ddx: float = nx - float(p.x)
		var ddy: float = ny - float(p.y)
		if ddx * ddx + ddy * ddy >= rr * rr:
			continue
		var fdx: float = x - float(p.x)
		var fdy: float = y - float(p.y)
		if fdx * fdx + fdy * fdy < rr * rr and ddx * ddx + ddy * ddy >= fdx * fdx + fdy * fdy:
			continue
		return false
	return true

# Axis-separated swept move against walls + props (mirrors server
# movePlayerWithWorldCollisions). The heightfield is visual terrain for players,
# so hills never become invisible stairs or snag points.
func _move(px: float, py: float, dx: float, dy: float, radius: float) -> Vector2:
	var ox := px
	var oy := py
	if _occupy(ox + dx, oy, radius):
		ox += dx
	if _occupy(ox, oy + dy, radius):
		oy += dy
	return Vector2(ox, oy)

# Reconcile the predicted position toward the authoritative one. FRAME-RATE INDEPENDENT
# (exp smoothing) — a fixed per-frame blend chases the 20Hz server staircase too tightly at
# high refresh rates, which reads as chunky/juddery movement. Big errors (respawn / floor
# change / teleport) snap; everything else eases gently so prediction stays smooth.
func _reconcile(self_dto: Dictionary, dt: float) -> void:
	var sx := float(self_dto.get("x", x))
	var sy := float(self_dto.get("y", y))
	var ex := sx - x
	var ey := sy - y
	if ex * ex + ey * ey > 120.0 * 120.0:
		x = sx
		y = sy
		return
	var k := 1.0 - exp(-8.0 * dt)  # ~0.13/frame at 60fps, ~0.06 at 120fps — consistent per second
	x += ex * k
	y += ey * k

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
			var dp := _move(x, y, ddx, ddy, DccConst.PLAYER_RADIUS)
			x = dp.x
			y = dp.y
		else:
			x += ddx
			y += ddy
		_reconcile(self_dto, dt)
		return
	var l := mv.length()
	if l > 0.0:
		var speed := DccConst.PLAYER_SPEED
		var derived: Variant = self_dto.get("derived", {})
		if derived is Dictionary and derived.has("moveSpeed"):
			speed = float(derived["moveSpeed"])
		# Mirror movement.ts: a slow (frost) halves move speed. Without this the client over-predicts
		# under frost and _reconcile claws it back every tick = rubber-band. Dash branch ignores slow.
		if bool(self_dto.get("slowed", false)):
			speed *= DccConst.SLOW_FACTOR
		var dx := (mv.x / l) * speed * dt
		var dy := (mv.y / l) * speed * dt
		if not _grid.is_empty():
			var p := _move(x, y, dx, dy, DccConst.PLAYER_RADIUS)
			x = p.x
			y = p.y
		else:
			x += dx
			y += dy
	_reconcile(self_dto, dt)
