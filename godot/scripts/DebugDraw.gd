extends Node2D
## Temporary hit-box / attack-range debug overlay. Toggle with F3.
## Draws collision circles and melee reach for every entity,
## plus a swing cone during active wind-ups.
## Add this as a child of a CanvasLayer (layer 50) from Main.

var cam: Camera3D = null    # set by Main after instantiation
var ents: Array = []         # _net.ents reference, updated each frame
var you: String = ""         # local player id (_net.you)
var pred_x: float = 0.0     # predicted player position
var pred_y: float = 0.0
var self_dto: Dictionary = {}  # _net.self_dto — for player melee range

# Active wind-ups: entity_id -> expiry ms (Time.get_ticks_msec).
var _windups: Dictionary = {}

const COLOR_SELF    := Color(0.15, 1.00, 0.15, 0.90)  # bright green  — your hit box
const COLOR_ALLY    := Color(0.20, 0.70, 1.00, 0.80)  # cyan          — other players
const COLOR_MONSTER := Color(1.00, 0.25, 0.25, 0.85)  # red           — monster hit box
const COLOR_BOSS    := Color(1.00, 0.10, 0.90, 0.90)  # magenta       — boss hit box
const COLOR_REACH   := Color(1.00, 0.65, 0.10, 0.40)  # orange        — melee reach ring
const COLOR_WINDUP  := Color(1.00, 0.05, 0.05, 0.85)  # vivid red     — swing cone

# Called from Main._on_events() for every "windup" event.
func register_windup(entity_id: String, duration_ms: float) -> void:
	_windups[entity_id] = Time.get_ticks_msec() + duration_ms

func _draw() -> void:
	if cam == null:
		return
	var now := Time.get_ticks_msec()

	# ---- local player (use predicted position, not server-lagged DTO) ----
	_draw_circle_w(pred_x, pred_y, DccConst.PLAYER_RADIUS, COLOR_SELF, 2.0)
	var player_melee_r := _player_melee_range()
	var player_cone := _player_melee_cone()
	if player_melee_r > 0.0:
		_draw_circle_w(pred_x, pred_y, player_melee_r, COLOR_REACH, 1.0)
	if _windups.get(you, 0) > now and player_melee_r > 0.0:
		var self_aim := float(self_dto.get("aim", 0.0))
		_draw_cone_w(pred_x, pred_y, player_melee_r, self_aim, player_cone, COLOR_WINDUP)

	# ---- all other entities ----
	for e in ents:
		if not (e is Dictionary):
			continue
		var kind := str(e.get("kind", ""))
		var ex   := float(e.get("x",   0.0))
		var ey   := float(e.get("y",   0.0))
		var aim  := float(e.get("aim", 0.0))
		var eid  := str(e.get("id",    ""))

		match kind:
			"player":
				if eid == you:
					continue  # already drew self above using predicted pos
				_draw_circle_w(ex, ey, DccConst.PLAYER_RADIUS, COLOR_ALLY, 2.0)

			"monster":
				var mk      := str(e.get("monKind", "grunt"))
				var col_r   := _mon_col_radius(mk)
				var melee_r := _mon_melee_range(mk)
				_draw_circle_w(ex, ey, col_r,   COLOR_MONSTER, 2.0)
				_draw_circle_w(ex, ey, melee_r, COLOR_REACH,   1.0)
				if _windups.get(eid, 0) > now:
					_draw_cone_w(ex, ey, melee_r, aim, 0.75, COLOR_WINDUP)

			"boss":
				_draw_circle_w(ex, ey, DccConst.BOSS_RADIUS, COLOR_BOSS,  3.0)
				_draw_circle_w(ex, ey, 70.0,                 COLOR_REACH, 1.5)  # BOSS_MELEE_RANGE
				if _windups.get(eid, 0) > now:
					_draw_cone_w(ex, ey, 70.0, aim, 0.75, COLOR_WINDUP)

# ---- projection helpers -----------------------------------------------

func _to_scr(wx: float, wy: float) -> Vector2:
	return cam.unproject_position(Vector3(wx, 0.0, wy))

func _world_r_to_scr(wx: float, wy: float, r: float) -> float:
	return _to_scr(wx, wy).distance_to(_to_scr(wx + r, wy))

# ---- draw primitives (world-space input) --------------------------------

func _draw_circle_w(wx: float, wy: float, world_r: float, color: Color, width: float) -> void:
	var scr   := _to_scr(wx, wy)
	var scr_r := _world_r_to_scr(wx, wy, world_r)
	draw_arc(scr, scr_r, 0.0, TAU, 40, color, width)

func _draw_cone_w(wx: float, wy: float, world_r: float, aim: float, half_angle: float, color: Color) -> void:
	var scr   := _to_scr(wx, wy)
	var scr_r := _world_r_to_scr(wx, wy, world_r)
	var pts   := PackedVector2Array()
	pts.append(scr)
	const STEPS := 24
	for i in range(STEPS + 1):
		var a := aim - half_angle + (float(i) / float(STEPS)) * half_angle * 2.0
		pts.append(scr + Vector2(cos(a), sin(a)) * scr_r)
	pts.append(scr)
	draw_polyline(pts, color, 2.0)

# ---- entity stat lookups ------------------------------------------------

func _mon_col_radius(mk: String) -> float:
	match mk:
		"brute":    return DccConst.MONSTER_RADIUS_BRUTE
		"swarm":    return DccConst.MONSTER_RADIUS_SWARM
		"pirate":   return DccConst.MONSTER_RADIUS_PIRATE
		"sharkman": return DccConst.MONSTER_RADIUS_SHARKMAN
		"ranged":   return DccConst.MONSTER_RADIUS_RANGED
		"healer":   return DccConst.MONSTER_RADIUS_HEALER
		_:          return DccConst.MONSTER_RADIUS_GRUNT

func _mon_melee_range(mk: String) -> float:
	# Server constants: MONSTER_KINDS[kind].meleeRange (src/shared/constants.ts)
	match mk:
		"brute":    return 74.0
		"swarm":    return 42.0
		"pirate":   return 58.0
		"sharkman": return 68.0
		"ranged":   return 0.0   # ranged kiters don't melee
		"healer":   return 0.0
		_:          return 56.0  # grunt

func _player_melee_range() -> float:
	var abilities: Variant = self_dto.get("abilities", [])
	if not (abilities is Array):
		return 0.0
	for a in abilities as Array:
		if not (a is Dictionary):
			continue
		var dmg := int(a.get("dmg", 0))
		if dmg > 0 and not bool(a.get("isHeal", false)):
			return float(a.get("range", 0.0))
	return 0.0

func _player_melee_cone() -> float:
	var abilities: Variant = self_dto.get("abilities", [])
	if not (abilities is Array):
		return 0.75
	for a in abilities as Array:
		if not (a is Dictionary):
			continue
		var dmg := int(a.get("dmg", 0))
		if dmg > 0 and not bool(a.get("isHeal", false)):
			return float(a.get("cone", 0.75))
	return 0.75
