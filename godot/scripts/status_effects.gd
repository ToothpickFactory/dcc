class_name StatusEffects
extends Node3D

@export var fire_mesh: MeshInstance3D
@export var frost_mesh: MeshInstance3D
@export var poison_mesh: MeshInstance3D
@export var bleed_mesh: MeshInstance3D
@export var stun_mesh: MeshInstance3D
@export var holy_mesh: MeshInstance3D
@export var dark_mesh: MeshInstance3D

const EFFECT_NAMES := ["fire", "frost", "poison", "bleed", "stun", "holy", "dark"]
const FORCE_OPAQUE_DEBUG := true

const EFFECT_SHADERS := {
	"fire": preload("res://shaders/status_effects/fire.gdshader"),
	"frost": preload("res://shaders/status_effects/frost.gdshader"),
	"poison": preload("res://shaders/status_effects/poison.gdshader"),
	"bleed": preload("res://shaders/status_effects/bleed.gdshader"),
	"stun": preload("res://shaders/status_effects/stun.gdshader"),
	"holy": preload("res://shaders/status_effects/holy.gdshader"),
	"dark": preload("res://shaders/status_effects/dark.gdshader"),
}

var _materials := {}
var _effect_roots := {}

func _ready() -> void:
	_ensure_materials()
	hide_all()

func register_effect_mesh(effect_name: String, mesh: MeshInstance3D) -> void:
	effect_name = _normalize_effect_name(effect_name)
	match effect_name:
		"fire": fire_mesh = mesh
		"frost": frost_mesh = mesh
		"poison": poison_mesh = mesh
		"bleed": bleed_mesh = mesh
		"stun": stun_mesh = mesh
		"holy": holy_mesh = mesh
		"dark": dark_mesh = mesh
		_: return
	_apply_effect_material(effect_name, mesh)
	mesh.visible = false

func register_effect_root(effect_name: String, root: Node3D) -> void:
	effect_name = _normalize_effect_name(effect_name)
	if not EFFECT_NAMES.has(effect_name) or root == null:
		return
	_effect_roots[effect_name] = root
	_apply_effect_material_recursive(effect_name, root)
	var mesh := _find_first_mesh(root)
	if mesh != null:
		register_effect_mesh(effect_name, mesh)
	root.visible = false

func show_effect(effect_name: String) -> void:
	effect_name = _normalize_effect_name(effect_name)
	var root: Node3D = _effect_roots.get(effect_name)
	if root != null:
		_apply_effect_material_recursive(effect_name, root)
		root.visible = true
		return
	var mesh := _mesh_for_effect(effect_name)
	if mesh == null:
		return
	_apply_effect_material(effect_name, mesh)
	mesh.visible = true

func hide_effect(effect_name: String) -> void:
	effect_name = _normalize_effect_name(effect_name)
	var root: Node3D = _effect_roots.get(effect_name)
	if root != null:
		root.visible = false
		return
	var mesh := _mesh_for_effect(effect_name)
	if mesh != null:
		mesh.visible = false

func hide_all() -> void:
	for effect_name in EFFECT_NAMES:
		hide_effect(effect_name)

func _normalize_effect_name(effect_name: String) -> String:
	var key := effect_name.strip_edges().to_lower()
	if key == "ice" or key == "freeze" or key == "frozen":
		return "frost"
	if key == "burn" or key == "burning":
		return "fire"
	if key == "venom" or key == "toxic":
		return "poison"
	return key

func _mesh_for_effect(effect_name: String) -> MeshInstance3D:
	match effect_name:
		"fire": return fire_mesh
		"frost": return frost_mesh
		"poison": return poison_mesh
		"bleed": return bleed_mesh
		"stun": return stun_mesh
		"holy": return holy_mesh
		"dark": return dark_mesh
		_: return null

func _ensure_materials() -> void:
	if not _materials.is_empty():
		return
	for effect_name in EFFECT_NAMES:
		var material: Material
		if FORCE_OPAQUE_DEBUG:
			var debug_material := StandardMaterial3D.new()
			debug_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			debug_material.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
			debug_material.albedo_color = _debug_color(effect_name)
			debug_material.emission_enabled = true
			debug_material.emission = _debug_color(effect_name)
			debug_material.emission_energy_multiplier = 1.25
			debug_material.cull_mode = BaseMaterial3D.CULL_DISABLED
			material = debug_material
		else:
			var shader_material := ShaderMaterial.new()
			shader_material.shader = EFFECT_SHADERS[effect_name]
			material = shader_material
		_materials[effect_name] = material

func _debug_color(effect_name: String) -> Color:
	match effect_name:
		"bleed": return Color(1.0, 0.0, 0.0, 1.0)
		"dark": return Color(0.45, 0.0, 1.0, 1.0)
		"fire": return Color(1.0, 0.38, 0.0, 1.0)
		"frost": return Color(0.28, 0.85, 1.0, 1.0)
		"holy": return Color(1.0, 0.88, 0.18, 1.0)
		"poison": return Color(0.2, 1.0, 0.0, 1.0)
		"stun": return Color(1.0, 1.0, 0.0, 1.0)
		_: return Color.WHITE

func _apply_effect_material(effect_name: String, mesh: MeshInstance3D) -> void:
	_ensure_materials()
	var material: Material = _materials.get(effect_name)
	if material == null or mesh.mesh == null:
		return
	var surface_count := mesh.mesh.get_surface_count()
	for i in surface_count:
		mesh.set_surface_override_material(i, material)

func _apply_effect_material_recursive(effect_name: String, node: Node) -> void:
	if node is MeshInstance3D:
		_apply_effect_material(effect_name, node as MeshInstance3D)
	for child in node.get_children():
		_apply_effect_material_recursive(effect_name, child)

func _find_first_mesh(node: Node) -> MeshInstance3D:
	if node is MeshInstance3D:
		return node
	for child in node.get_children():
		var found := _find_first_mesh(child)
		if found != null:
			return found
	return null
