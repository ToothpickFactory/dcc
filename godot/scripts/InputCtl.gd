extends Node
## Port of src/client/input.ts — movement vector + aim + a cast queue.
##
## TS notes that shape this port (input.ts):
##  - moveVec(): WASD/arrows produce a RAW (un-normalized) [x,y]; the Predictor
##    normalizes. Touch is a virtual stick: a vector from screen-center to the
##    finger, normalized, with a 14px dead zone.
##  - pump(): casts fire IMMEDIATELY (one queued index per frame via castIdx),
##    input is throttled to INPUT_MS, and cast+input share one seq counter.
##
## Division of labour for the Godot client:
##  - Main owns the cadence (INPUT_MS throttle) and the seq counter, exactly as
##    TS main.ts drives input.pump(net, now). So this Node only PRODUCES intent:
##      move_vec()  -> the raw move vector (keyboard/arrows OR gamepad left stick)
##      aim_from()  -> aim radians from a camera->ground raycast (Main passes cam+pos)
##      take_casts()-> drains queued ability indices (keys 1-6, left-click, gamepad)
##  - Native bonuses over the web build: gamepad left-stick movement, gamepad
##    face/shoulder buttons as fire, and right-stick aim (used only when Main asks).
##
## Cast index mapping mirrors input.ts:
##   keys "1".."6" -> indices 0..5 ; left mouse button -> 0 (slot 1 / auto-cast).

# Slot-key -> ability index. input.ts uses ["1".."6"] -> 0..5; the action bar's
# slot 1 (index 0) is the auto/basic cast and also what left-click fires.
const _SLOT_KEYS := {
	KEY_1: 0, KEY_2: 1, KEY_3: 2, KEY_4: 3, KEY_5: 4, KEY_6: 5,
}

# Gamepad fire buttons -> the same ability indices. Face buttons cover slots 1-4
# (A/B/X/Y on Xbox-style pads); this is the native-pad bonus the web build lacks.
const _PAD_BTN_CASTS := {
	JOY_BUTTON_A: 0,         # slot 1 / basic — also the most reachable button
	JOY_BUTTON_B: 1,
	JOY_BUTTON_X: 2,
	JOY_BUTTON_Y: 3,
	JOY_BUTTON_RIGHT_SHOULDER: 0,  # handy alias for "fire basic"
}

# Stick dead zones. The move action deadzone (0.5) is already baked into the
# InputMap; the right stick (aim) gets its own so a resting pad doesn't twitch aim.
const _AIM_STICK_DEADZONE := 0.25

var _cast_queue: Array[int] = []
# Right-stick aim, in radians, when the stick is pushed past the dead zone; NAN
# when the stick is idle so callers can fall back to the pointer aim.
var _stick_aim: float = NAN

func _ready() -> void:
	# Register movement actions in CODE so they don't depend on project.godot's
	# (fragile) text serialization. Physical keycodes => layout-independent WASD.
	_ensure_action(&"move_left", [KEY_A, KEY_LEFT])
	_ensure_action(&"move_right", [KEY_D, KEY_RIGHT])
	_ensure_action(&"move_up", [KEY_W, KEY_UP])
	_ensure_action(&"move_down", [KEY_S, KEY_DOWN])
	if OS.get_environment("DCC_DEBUG") != "":
		print("[DBG] move actions bound: right=", InputMap.action_get_events(&"move_right").size(),
			" up=", InputMap.action_get_events(&"move_up").size())

func _ensure_action(action: StringName, keys: Array) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action, 0.5)
	InputMap.action_erase_events(action)
	for k in keys:
		var ev := InputEventKey.new()
		ev.physical_keycode = k
		InputMap.action_add_event(action, ev)

func _unhandled_input(event: InputEvent) -> void:
	# Keyboard slot keys 1-6 (queue a cast; never normalized through actions so we
	# get one discrete press per keystroke, matching the TS keydown handler).
	if event is InputEventKey and event.pressed and not event.echo:
		var idx: int = int(_SLOT_KEYS.get(event.keycode, -1))
		if idx >= 0:
			_cast_queue.append(idx)
			return
	# Left-click fires slot 1 (index 0), like canvas mousedown button 0 in TS.
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_cast_queue.append(0)
		return
	# Gamepad fire buttons (native bonus).
	if event is InputEventJoypadButton and event.pressed:
		var pidx: int = int(_PAD_BTN_CASTS.get(event.button_index, -1))
		if pidx >= 0:
			_cast_queue.append(pidx)

# Raw move vector. Keyboard/arrows come from the move_* actions (their key events
# are bound in project.godot); the gamepad left stick is folded in so a pad walks
# too. NOT normalized — the Predictor normalizes, matching predict.ts/input.ts.
func move_vec() -> Vector2:
	var v := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	# Left stick (axes 0/1) via the same actions only if those actions also bind
	# joypad motion; bind it explicitly here so movement works on a bare InputMap.
	var stick := Vector2(
		Input.get_joy_axis(0, JOY_AXIS_LEFT_X),
		Input.get_joy_axis(0, JOY_AXIS_LEFT_Y))
	if stick.length() >= 0.5:  # match the action deadzone (0.5)
		v = stick
	return v

# Aim radians from the pointer: raycast the active camera through the cursor onto
# the ground plane (y=0) and atan2 toward (px,py). Mirrors renderer.aimFromPointer
# (camera->ground projection) + the world (x,y)->Vector3(x,0,y) mapping. If a
# right-stick aim is active it wins (native pad bonus), like right-stick mouselook.
func aim_from(camera: Camera3D, px: float, py: float) -> float:
	if not is_nan(_stick_aim):
		return _stick_aim
	if camera == null:
		return 0.0
	var mouse := camera.get_viewport().get_mouse_position()
	var origin := camera.project_ray_origin(mouse)
	var dir := camera.project_ray_normal(mouse)
	var plane := Plane(Vector3.UP, 0.0)
	var hit: Variant = plane.intersects_ray(origin, dir)
	if hit == null:
		return 0.0
	var p: Vector3 = hit
	# World maps (x,y)->(x,0,y); aim toward the hit's XZ relative to the player.
	return atan2(p.z - py, p.x - px)

# Drain the queued ability indices (FIFO). Main sends each as a {t:"cast"} with
# its own seq, exactly as pump() fires one queued cast per call in TS.
func take_casts() -> Array:
	# Fold the right stick into the aim cache each drain so aim_from() can prefer it.
	_update_stick_aim()
	if _cast_queue.is_empty():
		return []
	var out := _cast_queue
	_cast_queue = []
	return out

# Mobile / on-screen ability bar tap -> queue a cast, mirroring queueCast(i).
func queue_cast(i: int) -> void:
	_cast_queue.append(i)

# Right-stick -> aim radians (native bonus). Cached so aim_from() can prefer it
# over the pointer when the stick is pushed; NAN when idle to fall back to mouse.
func _update_stick_aim() -> void:
	var rx := Input.get_joy_axis(0, JOY_AXIS_RIGHT_X)
	var ry := Input.get_joy_axis(0, JOY_AXIS_RIGHT_Y)
	var v := Vector2(rx, ry)
	if v.length() >= _AIM_STICK_DEADZONE:
		# Stick (x,y) maps onto world XZ; right = +x, down = +z (toward camera).
		_stick_aim = atan2(v.y, v.x)
	else:
		_stick_aim = NAN
