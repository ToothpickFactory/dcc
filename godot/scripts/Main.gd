extends Node3D
## Phase-0 orchestrator (GODOT_PORT.md §5): connect to the live /ws, build the floor
## from server geometry, predict the local player, follow with the tilted perspective
## camera (matches render.ts: pos (x,820,y+460) looking at (x,0,y)). Entities are
## placeholder boxes for now — sprite/animation is Phase 1.

@export var server_url := DccConst.DEFAULT_WS_URL
@export var player_name := "GodotHero"

var _net
var _world: World
var _cam: Camera3D
var _pred := Predictor.new()
var _seq := 0
var _input_accum := 0.0
var _self_marker: MeshInstance3D
var _ent_markers := {}

func _ready() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color8(0x0b, 0x0e, 0x14)
	env.environment = e
	add_child(env)

	_cam = Camera3D.new()
	_cam.fov = 55
	_cam.far = 8000
	add_child(_cam)

	_world = World.new()
	add_child(_world)

	_self_marker = _make_marker(Color8(0x5d, 0xd6, 0xff))
	add_child(_self_marker)

	_net = preload("res://scripts/Net.gd").new()
	add_child(_net)
	_net.floor_received.connect(_on_floor)
	_net.welcomed.connect(func(you): print("[DCC] welcome you=", you))
	_net.start(server_url, player_name)

func _on_floor(geometry: Dictionary, _info: Dictionary) -> void:
	if geometry.is_empty():
		return
	_world.build(geometry)
	_pred.set_grid(_world.grid)

func _process(dt: float) -> void:
	var mv := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	_pred.update(_net.self_dto, mv, dt)

	_input_accum += dt
	if _input_accum * 1000.0 >= DccConst.INPUT_MS:
		_input_accum = 0.0
		_seq += 1
		_net.send_input(_seq, mv, 0.0)

	var px := _pred.x
	var py := _pred.y
	_self_marker.position = Vector3(px, 22, py)
	_cam.position = Vector3(px, 820, py + 460)
	_cam.look_at(Vector3(px, 0, py), Vector3.UP)

	_sync_entities()

func _sync_entities() -> void:
	var seen := {}
	for e in _net.ents:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		var id := str(e.get("id", ""))
		if id == _net.you:
			continue
		seen[id] = true
		var m: MeshInstance3D = _ent_markers.get(id)
		if m == null:
			m = _make_marker(_kind_color(str(e.get("kind", ""))))
			add_child(m)
			_ent_markers[id] = m
		m.position = Vector3(float(e.get("x", 0.0)), 22, float(e.get("y", 0.0)))
	for id in _ent_markers.keys():
		if not seen.has(id):
			_ent_markers[id].queue_free()
			_ent_markers.erase(id)

func _kind_color(kind: String) -> Color:
	match kind:
		"monster": return Color8(0xb6, 0x43, 0x3d)
		"boss": return Color8(0x9b, 0x30, 0xff)
		"proj": return Color8(0xff, 0xd3, 0x4d)
		"lootbag": return Color8(0xff, 0x88, 0x33)
		_: return Color8(0x4f, 0x8c, 0xff)

func _make_marker(c: Color) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = Vector3(28, 44, 28)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = c
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bm.material = mat
	var mi := MeshInstance3D.new()
	mi.mesh = bm
	return mi
