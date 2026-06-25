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
##  - Native bonuses over the web build: gamepad left-stick movement and
##    face/shoulder/trigger buttons as fire; right stick drives the camera.
##
## Cast index mapping mirrors input.ts:
##   keys "1".."6" -> indices 0..5 ; left mouse button -> 0 (slot 1 / auto-cast).

# Slot-key -> ability index. input.ts uses ["1".."6"] -> 0..5; the action bar's
# slot 1 (index 0) is the auto/basic cast and also what left-click fires.
const _SLOT_KEYS := {
	KEY_1: 0, KEY_2: 1, KEY_3: 2, KEY_4: 3, KEY_5: 4, KEY_6: 5,
}

# Gamepad fire buttons -> the same ability indices. Face buttons cover slots 1-4
# (A/B/X/Y on Xbox-style pads); RB covers slot 5. RT (trigger axis) fires slot 6,
# handled separately below via threshold tracking.
const _PAD_BTN_CASTS := {
	JOY_BUTTON_A: 0,
	JOY_BUTTON_B: 1,
	JOY_BUTTON_X: 2,
	JOY_BUTTON_Y: 3,
	JOY_BUTTON_RIGHT_SHOULDER: 4,  # RB -> slot 5
}

var _cast_queue: Array[int] = []
var _dash_pressed := false  # Space / RS-click — drained by consume_dash()
var _rt_pressed := false    # tracks RT axis state to fire cast 5 on threshold cross
var _virtual_stick := Vector2.ZERO
var _last_mobile_aim := 0.0
var _last_move_aim := 0.0  # aim direction from last movement (gamepad fallback)
# Cached once in _ready() so aim_from() never calls OS.has_feature() per-frame.
var _is_mobile := false

func _ready() -> void:
	_is_mobile = OS.has_feature("mobile")
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
		if event.keycode == KEY_SPACE:
			_dash_pressed = true
			return
		var idx: int = int(_SLOT_KEYS.get(event.keycode, -1))
		if idx >= 0:
			_cast_queue.append(idx)
			return
	# Left-click fires slot 1 (index 0), like canvas mousedown button 0 in TS.
	# On mobile, emulate_mouse_from_touch is on so every tap becomes a click — skip it
	# there; ability buttons call queue_cast() directly instead.
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if not OS.has_feature("mobile"):
			_cast_queue.append(0)
		return
	# Gamepad buttons: RS-click = dodge/dash; face/RB = fire ability.
	# LB, LT, D-pad Up/Right, and right-stick camera are handled in Main._unhandled_input.
	if event is InputEventJoypadButton and event.pressed:
		if event.button_index == JOY_BUTTON_RIGHT_STICK:
			_dash_pressed = true
			return
		var pidx: int = int(_PAD_BTN_CASTS.get(event.button_index, -1))
		if pidx >= 0:
			_cast_queue.append(pidx)
			return
	# RT trigger (axis): queue cast 5 on each press (threshold crossing).
	if event is InputEventJoypadMotion and event.axis == JOY_AXIS_TRIGGER_RIGHT:
		var pressed := event.axis_value > 0.5
		if pressed and not _rt_pressed:
			_cast_queue.append(5)
		_rt_pressed = pressed

# True once per Space / RS-click press (drained by Main). The dodge/evade intent.
func consume_dash() -> bool:
	if _dash_pressed:
		_dash_pressed = false
		return true
	return false

# Raw move vector. Keyboard/arrows come from the move_* actions (their key events
# are bound in project.godot); the gamepad left stick is folded in so a pad walks
# too. NOT normalized — the Predictor normalizes, matching predict.ts/input.ts.
# On mobile, the virtual stick (set by MobileHud) overrides when a touch is active.
func move_vec() -> Vector2:
	var v := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	# Left stick (axes 0/1) via the same actions only if those actions also bind
	# joypad motion; bind it explicitly here so movement works on a bare InputMap.
	var stick := Vector2(
		Input.get_joy_axis(0, JOY_AXIS_LEFT_X),
		Input.get_joy_axis(0, JOY_AXIS_LEFT_Y))
	if stick.length() >= 0.5:  # match the action deadzone (0.5)
		v = stick
	if _virtual_stick.length() > 0.01:
		v = _virtual_stick
	return v

## Set by MobileHud while a joystick touch is active; pass Vector2.ZERO on release.
func set_virtual_stick(dir: Vector2) -> void:
	_virtual_stick = dir

# Aim radians from the pointer: raycast the active camera through the cursor onto
# the ground plane (y=0) and atan2 toward (px,py). On mobile, aim follows the
# virtual joystick. On gamepad (no mouse), aim follows movement direction as a
# fallback so the aim-assist can snap to nearby enemies.
func aim_from(camera: Camera3D, px: float, py: float) -> float:
	# On mobile aim follows the virtual joystick direction, not the mouse cursor.
	if _is_mobile:
		if _virtual_stick.length() > 0.01:
			_last_mobile_aim = atan2(_virtual_stick.y, _virtual_stick.x)
		return _last_mobile_aim
	if camera == null:
		return 0.0
	# If a gamepad left stick is active, keep aim pointing in the movement direction
	# so the aim-assist has a useful angle to snap from. Mouse movement overrides this.
	var stick := Vector2(
		Input.get_joy_axis(0, JOY_AXIS_LEFT_X),
		Input.get_joy_axis(0, JOY_AXIS_LEFT_Y))
	if stick.length() >= 0.5:
		_last_move_aim = atan2(stick.y, stick.x)
	var mouse := camera.get_viewport().get_mouse_position()
	var origin := camera.project_ray_origin(mouse)
	var dir := camera.project_ray_normal(mouse)
	var plane := Plane(Vector3.UP, 0.0)
	var hit: Variant = plane.intersects_ray(origin, dir)
	if hit == null:
		return _last_move_aim
	var p: Vector3 = hit
	# World maps (x,y)->(x,0,y); aim toward the hit's XZ relative to the player.
	return atan2(p.z - py, p.x - px)

# Drain the queued ability indices (FIFO). Main sends each as a {t:"cast"} with
# its own seq, exactly as pump() fires one queued cast per call in TS.
func take_casts() -> Array:
	if _cast_queue.is_empty():
		return []
	var out := _cast_queue
	_cast_queue = []
	return out

# Mobile / on-screen ability bar tap -> queue a cast, mirroring queueCast(i).
func queue_cast(i: int) -> void:
	_cast_queue.append(i)

