extends Node3D
## Integrated client (GODOT_PORT.md Phases 1–3): connects to the live /ws, builds the
## floor from server geometry, and drives the ported systems — sprites/animation, the
## line-of-sight fog shader, themed tiles/props, HUD, inventory, minimap, and the
## spectate/waiting camera. The server is unchanged (it just sends floor.geometry).
##
## Verified here: parse-clean import + GdUnit4 logic tests. Visual/interactive behaviour
## (shader look, animation, UI feel) needs a display — run `godot --path godot res://scenes/Main.tscn`.

@export var server_url := DccConst.DEFAULT_WS_URL
@export var player_name := "GodotHero"

var _net                       # Net (Node)
var _world: World
var _fog: Fog
var _decor: WorldDecor
var _sprites: SpriteLayer
var _cam: Camera3D
var _inp                       # InputCtl (Node)
var _hud: Hud
var _inv: InventoryUI
var _minimap: Minimap
var _spectate := Spectate.new()
var _pred := Predictor.new()
var _seq := 0
var _input_accum := 0.0

func _ready() -> void:
	# Dev overrides: DCC_WS points at a server (e.g. ws://127.0.0.1:8787/ws for local
	# wrangler dev); DCC_SMOKE runs a bounded headless integration smoke then quits.
	var ws_override := OS.get_environment("DCC_WS")
	if ws_override != "":
		server_url = ws_override
	if OS.get_environment("DCC_SMOKE") != "":
		get_tree().create_timer(7.0).timeout.connect(func(): get_tree().quit())

	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color8(0x0b, 0x0e, 0x14)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color.WHITE
	env.environment = e
	add_child(env)

	_cam = Camera3D.new()
	_cam.fov = 55
	_cam.far = 8000
	add_child(_cam)

	# Net first — modules bind to it.
	_net = preload("res://scripts/Net.gd").new()
	add_child(_net)

	_world = World.new()
	add_child(_world)

	_fog = Fog.new()
	add_child(_fog)

	_decor = WorldDecor.new()
	_decor.world = _world
	add_child(_decor)

	_sprites = SpriteLayer.new()
	add_child(_sprites)
	_sprites.set_net(_net)

	_hud = Hud.new()
	add_child(_hud)

	_inv = InventoryUI.new()
	add_child(_inv)
	_inv.setup(_net)

	_minimap = Minimap.new()
	add_child(_minimap)

	_inp = preload("res://scripts/InputCtl.gd").new()
	add_child(_inp)

	_net.floor_received.connect(_on_floor)
	_net.inv_received.connect(func(m): _inv.on_inv(m))
	_net.bag_received.connect(func(m): _inv.on_bag(m))
	_net.welcomed.connect(func(you): print("[DCC] welcome you=", you))
	_net.start(server_url, player_name)

func _on_floor(geometry: Dictionary, info: Dictionary) -> void:
	if geometry.is_empty():
		return
	_world.build(geometry)
	_pred.set_grid(_world.grid)
	_fog.attach(_world)
	_decor.world = _world
	_decor.apply(str(info.get("theme", "fantasy")), geometry.get("decorations", []), geometry.get("stairs", {}))
	_sprites.set_grid(_world.grid)
	_minimap.set_floor(_world.grid, geometry.get("stairs", {}))
	_hud.set_floor(int(info.get("depth", 1)), str(info.get("theme", "")), float(_net.floor_state.get("endsAt", 0.0)))

func _process(dt: float) -> void:
	var mv: Vector2 = _inp.move_vec()
	_pred.update(_net.self_dto, mv, dt)
	var aim: float = _inp.aim_from(_cam, _pred.x, _pred.y)

	# Spectate/waiting state machine drives the camera target while out of play.
	var sp: Dictionary = _spectate.update(_net, mv, Vector2(_pred.x, _pred.y), dt)
	var spectating: bool = sp.get("spectating", false)

	var alive := str(_net.self_dto.get("status", "")) == "alive" and not bool(_net.self_dto.get("reached", false))
	if alive:
		_input_accum += dt
		if _input_accum * 1000.0 >= DccConst.INPUT_MS:
			_input_accum = 0.0
			_seq += 1
			_net.send_input(_seq, mv, aim)
		for idx in _inp.take_casts():
			_seq += 1
			_net.send_cast(_seq, int(idx), aim)

	# Camera + fog centre: predicted player in play, spectate target while waiting/dead.
	var cam_t: Vector2 = sp.get("cam_target", Vector2(_pred.x, _pred.y))
	var cx: float = cam_t.x if spectating else _pred.x
	var cy: float = cam_t.y if spectating else _pred.y
	_cam.position = Vector3(cx, 820, cy + 460)
	_cam.look_at(Vector3(cx, 0, cy), Vector3.UP)
	_fog.set_vision(cx, cy)

	# Render + UI.
	_sprites.sync(_net.ents, _net.you, Vector2(_pred.x, _pred.y))
	_minimap.update_map(_pred.x, _pred.y, _net.ents, _net.you, alive)
	_hud.update(_net)

	# Spectate transitions -> HUD toast + banner.
	if sp.get("just_entered", false):
		_hud.toast(str(sp.get("toast_text", "")), _color_of(str(sp.get("toast_color", "#ffffff"))))
	var remaining := int(_net.floor_state.get("living", 0)) - int(_net.floor_state.get("livingAtStairs", 0))
	_hud.set_waiting(spectating, bool(sp.get("reached", false)), remaining, str(sp.get("mode", "follow")))
	_inv.set_reached(bool(_net.self_dto.get("reached", false)))

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_I:
				_inv.toggle()
			KEY_TAB:
				_spectate.cycle()
			KEY_V:
				_spectate.toggle_mode()

func _color_of(s: String) -> Color:
	if s.begins_with("#"):
		return Color.from_string(s, Color.WHITE)
	return Color.WHITE
