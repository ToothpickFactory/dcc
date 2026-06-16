class_name Spectate
extends RefCounted
## Spectate / waiting-room camera state machine, ported 1:1 from the spectate logic
## in src/client/main.ts (the `spectateTarget` / `spectateMode` / `followIdx` block
## around frame()).
##
## "Spectating" means your character has LEFT the floor — either you reached the
## stairs (safe waiting room) or you died (status == "spectator"). In both cases the
## live player entity is gone, so the camera can't follow it; instead it follows a
## spectate target:
##   - follow mode: ease toward a cycled living player entity (Tab cycles, default).
##   - free mode  : WASD / right-stick pans the camera (V toggles follow<->free).
##
## INTEGRATION (Main.gd drives this each frame):
##   var spectate := Spectate.new()
##   ...in _process(dt):
##     var r := spectate.update(_net, mv, Vector2(_pred.x, _pred.y), dt)
##     # camera + fog center:
##     _apply_cam_target(r["cam_target"])      # r.cam_target is the same as predictor pos when NOT spectating
##     # HUD:
##     if r["just_entered"]: _show_toast(r["toast_text"], r["toast_color"]); _hide_ability_bar()
##     if r["just_exited"]:  _show_ability_bar(); _hide_waiting_banner()
##     if r["spectating"]:   _set_waiting_banner(r["banner_text"], r["banner_sub"])
##   # input (Main reads keys and calls these):
##     if Input.is_action_just_pressed("spectate_cycle"): spectate.cycle()      # Tab
##     if Input.is_action_just_pressed("spectate_mode"):  spectate.toggle_mode() # V
##
## Tab/V handling lives in Main (it owns InputMap). The TS forces follow mode on Tab
## (`spectateMode = "follow"; followIdx++`), so cycle() mirrors that exactly.
##
## Floor-state banner count: the TS reads net.floor.state.living - .livingAtStairs to
## show "N players still on the floor". Godot's Net.gd stores floor STATE separately
## (Main may set `net.floor_state` or pass it). This module reads it defensively:
##   - if `net` has a `floor_state` Dictionary property -> use living/livingAtStairs
##   - else fall back to counting living player ents in cur (minus you).
## See `_remaining_on_floor()`.

const _EASE := 6.0            # follow-mode ease factor (TS: Math.min(1, dt*6))
const _PAN := 620.0           # free-pan speed px/s (TS: PAN = 620)
const _TOAST_REACHED := "✓ Reached the stairs — waiting for the party"
const _TOAST_DEAD := "💀 You died — spectating"
const _COLOR_REACHED := "#5dff9b"
const _COLOR_DEAD := "#ff8a8a"

var _target := Vector2.ZERO   # the camera-follow target (eased / panned)
var _mode := "follow"         # "follow" | "free"
var _follow_idx := 0
var _was_spectating := false

## Per-frame update. Returns a result Dictionary; Main applies cam_target to the
## camera + fog and wires the HUD from the banner/toast fields.
##
## net           : the Net node (reads self_dto, cur, optional floor_state)
## mv            : movement vector this frame (free-pan input in spectate)
## predictor_pos : the local predicted player position (cam target while in play,
##                 and the snapshot anchor on first entering spectate)
## dt            : frame delta seconds
##
## Result keys:
##   cam_target   : Vector2 — where camera + fog should center this frame
##   spectating   : bool    — character has left the floor (reached || dead)
##   reached      : bool    — reached the stairs (waiting room) vs dead
##   mode         : String  — "follow" | "free"
##   just_entered : bool    — first frame of spectating this episode
##   just_exited  : bool    — first frame back in play (e.g. new run / respawn)
##   toast_text   : String  — enter toast (only meaningful when just_entered)
##   toast_color  : String  — enter toast color
##   banner_text  : String  — waiting banner main line (when spectating)
##   banner_sub   : String  — waiting banner sub line (controls hint)
func update(net, mv: Vector2, predictor_pos: Vector2, dt: float) -> Dictionary:
	var self_dto: Dictionary = _self_of(net)
	var reached := bool(self_dto.get("reached", false))
	var dead := str(self_dto.get("status", "alive")) == "spectator"
	var spectating := reached or dead

	var just_entered := false
	var just_exited := false

	if spectating and not _was_spectating:
		# Enter spectate: snapshot the camera to the (now-gone) player's last spot,
		# reset to follow mode, follow the first living player. (TS: on enter.)
		just_entered = true
		_target = predictor_pos
		_mode = "follow"
		_follow_idx = 0
	elif not spectating and _was_spectating:
		just_exited = true

	_was_spectating = spectating

	var cam_target := predictor_pos
	if spectating:
		var players := _living_players(net)
		if _mode == "follow" and players.size() > 0:
			var t: Dictionary = players[_follow_idx % players.size()]
			var k: float = min(1.0, dt * _EASE)   # ease toward the followed player
			_target.x += (float(t.get("x", _target.x)) - _target.x) * k
			_target.y += (float(t.get("y", _target.y)) - _target.y) * k
		else:
			# free-pan (or follow with nobody left): mv drives the camera
			_target.x += mv.x * _PAN * dt
			_target.y += mv.y * _PAN * dt
		cam_target = _target

	var toast_text := ""
	var toast_color := ""
	if just_entered:
		toast_text = _TOAST_REACHED if reached else _TOAST_DEAD
		toast_color = _COLOR_REACHED if reached else _COLOR_DEAD

	var banner_text := ""
	var banner_sub := ""
	if spectating:
		var ctrl := "Tab: next player · V: free-cam" if _mode == "follow" else "WASD: pan · V: follow"
		if reached:
			var remaining := _remaining_on_floor(net)
			var noun := "player" if remaining == 1 else "players"
			banner_text = "🚪 Waiting room — %d %s still on the floor" % [remaining, noun]
			banner_sub = "%s · I: inventory & sell" % ctrl
		else:
			banner_text = "💀 Spectating"
			banner_sub = ctrl

	return {
		"cam_target": cam_target,
		"spectating": spectating,
		"reached": reached,
		"mode": _mode,
		"just_entered": just_entered,
		"just_exited": just_exited,
		"toast_text": toast_text,
		"toast_color": toast_color,
		"banner_text": banner_text,
		"banner_sub": banner_sub,
	}

## Tab: advance to the next living player AND force follow mode (matches TS:
## `spectateMode = "follow"; followIdx++`). No-op effect until the next update().
func cycle() -> void:
	_mode = "follow"
	_follow_idx += 1

## V: toggle follow <-> free pan.
func toggle_mode() -> void:
	_mode = "free" if _mode == "follow" else "follow"

## Current mode ("follow" | "free"). Convenience for callers that don't keep update()'s result.
func mode() -> String:
	return _mode

## Are we currently spectating? (Reflects the last update() call.)
func is_spectating() -> bool:
	return _was_spectating

# --- internals -------------------------------------------------------------

func _self_of(net) -> Dictionary:
	if net == null:
		return {}
	var s: Variant = net.self_dto
	return s if s is Dictionary else {}

func _ents_of(net) -> Array:
	# Prefer cur.ents (the rendered snapshot, like TS net.cur.ents); fall back to net.ents.
	if net == null:
		return []
	var cur: Variant = net.cur
	if cur is Dictionary and cur.has("ents") and cur["ents"] is Array:
		return cur["ents"]
	var e: Variant = net.ents
	return e if e is Array else []

func _living_players(net) -> Array:
	# Living player entities to follow. The TS filters kind === "player"; players are
	# only present in the snapshot while in play, and dead ones drop out, so this is
	# effectively "living players" — but skip any flagged dead for safety.
	var out: Array = []
	for e in _ents_of(net):
		if typeof(e) != TYPE_DICTIONARY:
			continue
		if str(e.get("kind", "")) != "player":
			continue
		if bool(e.get("dead", false)):
			continue
		out.append(e)
	return out

func _remaining_on_floor(net) -> int:
	# TS: net.floor.state.living - net.floor.state.livingAtStairs.
	# Godot Net may expose floor state as `floor_state` (set by Main on the `floor`
	# message). If present, mirror the TS exactly; else approximate by counting
	# living player ents (best-effort — the snapshot only carries on-floor players).
	if net != null:
		var fs: Variant = _get_prop(net, "floor_state")
		if fs is Dictionary and not fs.is_empty():
			var living := int(fs.get("living", 0))
			var at_stairs := int(fs.get("livingAtStairs", 0))
			return max(0, living - at_stairs)
	return _living_players(net).size()

func _get_prop(obj, name: String) -> Variant:
	# Safe property read: returns the value if the object exposes it, else null.
	# Avoids a hard dependency on Net having `floor_state` (it's optional).
	if obj == null:
		return null
	for p in obj.get_property_list():
		if p.get("name", "") == name:
			return obj.get(name)
	return null
