class_name World
extends Node3D
## Builds the floor from server geometry: a wall MultiMesh (WALL_H-tall boxes, one per
## solid cell) + a ground plane. World (x,y) maps to 3D (x, 0, y) and wall centres
## to ((cx+0.5)*cell, WALL_H/2, (cy+0.5)*cell). Tall walls (Champions-of-Norrath feel:
## the dungeon reads as deep canyons/halls, not low kerbs).
## Phase 0 uses flat materials; the line-of-sight fog shader is Phase 2 (GODOT_PORT.md §4).

const WALL_H := 220.0  # wall box height (px). Tall, cliff-like — paired with the lower 3/4 camera.
const WALL_SKIRT := 300.0  # extra height extending each wall box DOWNWARD, so on sloped/sunken terrain the base never lifts off the floor and shows a gap (heightfield 2.5D).
const MODEL_WALL_TARGET_H := 210.0
const FANTASY_WALL_TARGET_H := MODEL_WALL_TARGET_H
const FOREST_WALL_TARGET_H := 255.0
const ICE_WALL_TARGET_H := 240.0
const MODEL_WALL_FOOTPRINT := 1.12
const EDGE_WALL_THEMES := ["cyberpunk", "fantasy"]
const CLUSTER_WALL_THEMES := ["forest", "icedungeon"]
const WALL_SHADOW_ALPHA := 0.62
const WALL_MODEL_SCENES := {
	"cyberpunk": [
		"res://assets/Tiles/3D/CyberPunk/Walls/WallA.glb",
		"res://assets/Tiles/3D/CyberPunk/Walls/WallB.glb",
		"res://assets/Tiles/3D/CyberPunk/Walls/WallC.glb",
	],
	"fantasy": [
		"res://assets/Tiles/3D/Dungeon/Walls/WallA.glb",
	],
	"icedungeon": [
		"res://assets/Tiles/3D/Ice/Walls/WallA.glb",
	],
	"forest": [
		"res://assets/Tiles/3D/Forest/Walls/Pine.glb",
		"res://assets/Tiles/3D/Forest/Walls/Redwood.glb",
		"res://assets/Tiles/3D/Forest/Walls/Tree.glb",
	],
}

var grid: Dictionary = {}
var _walls: MultiMeshInstance3D
var _wall_models := Node3D.new()
var _wall_model_nodes: Array[Node3D] = []
var _wall_scene_cache: Dictionary = {}
var _wall_shadow_mat: StandardMaterial3D
var _ground: MeshInstance3D
var _ground_mat: StandardMaterial3D
var _wall_mat: StandardMaterial3D
var _fog: Node  # set by Fog.attach(); themed tiles route into the fog shader when present

func _init() -> void:
	_wall_models.name = "WallModels"
	add_child(_wall_models)

func build(geometry: Dictionary) -> void:
	grid = Geo.decode(str(geometry["solid"]), int(geometry["gw"]), int(geometry["gh"]), float(geometry["cell"]), str(geometry.get("ground", "")))
	_build_ground()
	_build_walls()

## --- Fog hooks (Phase 2) -----------------------------------------------------
## Fog.attach(world) calls this so the line-of-sight shader can override the
## ground + wall meshes. After registration, themed tiles route into the fog
## shader (one material carries tile + fog, mirroring render.ts patchFog).

## The ground MeshInstance3D (null until build()). For Fog.material_override.
func ground_instance() -> GeometryInstance3D:
	return _ground

## The wall MultiMeshInstance3D (null until build()). For Fog.material_override.
func wall_instance() -> GeometryInstance3D:
	return _walls

func model_wall_nodes() -> Array[Node3D]:
	return _wall_model_nodes

func set_wall_model_shadowed(node: Node3D, shadowed: bool) -> void:
	if node == null or not is_instance_valid(node):
		return
	_apply_wall_model_shadow(node, shadowed)

## Base albedo of the flat ground (render.ts floor 0x161d2e), for the fog fallback.
func ground_color() -> Color:
	return Color8(0x16, 0x1d, 0x2e)

## Base albedo of the flat wall (render.ts wall 0x39445e), for the fog fallback.
func wall_color() -> Color:
	return Color8(0x39, 0x44, 0x5e)

## Floor tile repeat count = one tile per cell across the actual floor (grid w).
func ground_uv_repeat() -> float:
	return float(grid["w"]) if not grid.is_empty() else 30.0

## Register the fog node; subsequent set_*_texture calls also update its shader.
func set_fog(fog: Node) -> void:
	_fog = fog

## Themed tiling: set the ground albedo to a 1-cell tile that repeats across the
## floor (render.ts repeats the floor tile 30x over the 2400px plane). null reverts
## to the flat fallback colour. Called by WorldDecor.apply().
func set_ground_texture(tex: Texture2D) -> void:
	if _fog != null and _fog.has_method("set_ground_texture"):
		_fog.set_ground_texture(tex)
		return
	if _ground_mat == null:
		return
	if tex == null:
		_ground_mat.albedo_texture = null
		_ground_mat.albedo_color = Color8(0x16, 0x1d, 0x2e)
		_ground_mat.uv1_scale = Vector3.ONE
		return
	tex.set_meta("dcc_tile", true)
	_ground_mat.albedo_texture = tex
	_ground_mat.albedo_color = Color.WHITE
	# One tile per cell across the actual floor (grid w x h).
	var reps_x := float(grid["w"])
	var reps_y := float(grid["h"])
	_ground_mat.uv1_scale = Vector3(reps_x, reps_y, 1.0)

## Per-theme palette (albedo tint + fog/background color) -> fog shader. Called by WorldDecor.apply.
func set_theme_palette(tint: Color, bg: Color) -> void:
	if _fog != null and _fog.has_method("set_palette"):
		_fog.set_palette(tint, bg)

## Themed walls: set the wall albedo to the theme's wall tile (render.ts tile 8).
## null reverts to the flat fallback colour. Called by WorldDecor.apply().
func set_wall_texture(tex: Texture2D) -> void:
	if _fog != null and _fog.has_method("set_wall_texture"):
		_fog.set_wall_texture(tex)
		return
	if _wall_mat == null:
		return
	if tex == null:
		_wall_mat.albedo_texture = null
		_wall_mat.albedo_color = Color8(0x39, 0x44, 0x5e)
		return
	_wall_mat.albedo_texture = tex
	_wall_mat.albedo_color = Color.WHITE

func set_wall_model_theme(theme: String) -> void:
	_clear_wall_models()
	if _walls:
		_walls.visible = true
	if not WALL_MODEL_SCENES.has(theme) or grid.is_empty():
		return
	var scenes := _load_wall_scenes(theme)
	if scenes.is_empty():
		return
	if _walls:
		_walls.visible = false
	_build_wall_models(theme, scenes)

func _build_ground() -> void:
	if _ground:
		_ground.queue_free()
	var w: int = grid["w"]
	var h: int = grid["h"]
	var cell: float = grid["cell"]
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color8(0x16, 0x1d, 0x2e)
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	_ground_mat = mat
	# Heightfield 2.5D: a per-cell-corner displaced mesh instead of a flat plane. Built from a
	# subdivided PlaneMesh (known-good winding/UVs facing +Y), with each vertex pushed up/down in
	# Y ONLY by Geo.ground_height — so v_world.xz still equals game (x,y) and the fog shader needs
	# no change. Vertices carry world coords, so the instance sits at the origin.
	var am := _build_ground_mesh(w, h, cell)
	if OS.get_environment("DCC_DEBUG") != "":
		print("[DBG] ground mesh AABB ", am.get_aabb(), " (size.y = terrain height span px)")
	am.surface_set_material(0, mat)
	_ground = MeshInstance3D.new()
	_ground.mesh = am
	_ground.position = Vector3.ZERO
	add_child(_ground)

func _build_ground_mesh(w: int, h: int, cell: float) -> ArrayMesh:
	var ww := float(w) * cell
	var wh := float(h) * cell
	var plane := PlaneMesh.new()
	plane.size = Vector2(ww, wh)
	plane.subdivide_width = w - 1   # -> w+1 vertices across
	plane.subdivide_depth = h - 1   # -> h+1 vertices deep
	var arrays := plane.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var half_w := ww * 0.5
	var half_h := wh * 0.5
	for i in verts.size():
		var v := verts[i]
		var wx := v.x + half_w   # plane is centred at origin; shift to world [0,ww]
		var wz := v.z + half_h
		verts[i] = Vector3(wx, Geo.ground_height(grid, wx, wz), wz)
	arrays[Mesh.ARRAY_VERTEX] = verts
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return am

func _build_walls() -> void:
	if _walls:
		_walls.queue_free()
	_clear_wall_models()
	var cell: float = grid["cell"]
	var w: int = grid["w"]
	var h: int = grid["h"]
	var solid: PackedByteArray = grid["solid"]
	var count := 0
	for v in solid:
		count += v
	var box := BoxMesh.new()
	# Slightly fatter than a cell so adjacent wall boxes OVERLAP instead of sharing a coplanar
	# face — coplanar faces z-fight and cause the "tearing" seams between wall pieces. The 1px
	# overlap is invisible (interior faces are occluded) but breaks the depth tie.
	box.size = Vector3(cell + 1.0, WALL_H + WALL_SKIRT, cell + 1.0)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color8(0x39, 0x44, 0x5e)
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	box.material = mat
	_wall_mat = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = box
	mm.instance_count = count
	var i := 0
	for cy in h:
		for cx in w:
			if solid[cy * w + cx] != 1:
				continue
			# Seat the wall on the terrain: top at ground+WALL_H, base WALL_SKIRT below ground so a
			# wall above a sunken neighbour reads as a tall cliff face with no gap underneath.
			var gz := Geo.ground_height(grid, (cx + 0.5) * cell, (cy + 0.5) * cell)
			var ey := gz + (WALL_H - WALL_SKIRT) * 0.5
			mm.set_instance_transform(i, Transform3D(Basis(), Vector3((cx + 0.5) * cell, ey, (cy + 0.5) * cell)))
			i += 1
	_walls = MultiMeshInstance3D.new()
	_walls.multimesh = mm
	add_child(_walls)

func _build_wall_models(theme: String, scenes: Array) -> void:
	var cell: float = grid["cell"]
	var w: int = grid["w"]
	var h: int = grid["h"]
	var solid: PackedByteArray = grid["solid"]
	for cy in h:
		for cx in w:
			if solid[cy * w + cx] != 1 or not _wall_borders_floor(cx, cy, w, h, solid):
				continue
			var center := Vector2((cx + 0.5) * cell, (cy + 0.5) * cell)
			var open_dir := _wall_open_dir(cx, cy, w, h, solid)
			var placement := center
			if EDGE_WALL_THEMES.has(theme):
				placement += open_dir * (cell * 0.5)
			var holder := Node3D.new()
			holder.name = "WallModel"
			holder.position = Vector3(placement.x, Geo.ground_height(grid, placement.x, placement.y), placement.y)
			holder.rotation.y = _wall_rotation_from_dir(open_dir)
			holder.set_meta("dcc_world", center)
			_wall_models.add_child(holder)
			_wall_model_nodes.append(holder)
			if CLUSTER_WALL_THEMES.has(theme):
				_populate_wall_cluster(holder, scenes, cx, cy, cell, theme)
			else:
				var scene: PackedScene = scenes[int(_hash01(cx, cy) * float(scenes.size())) % scenes.size()]
				_add_scaled_model(holder, scene, cell, _wall_target_height(theme), true)

func _populate_wall_cluster(holder: Node3D, scenes: Array, cx: int, cy: int, cell: float, theme: String) -> void:
	var count := 2 + int(_hash01(cx + 17, cy + 31) * (2.99 if theme == "forest" else 1.99))
	for i in count:
		var scene: PackedScene = scenes[(cx * 19 + cy * 31 + i * 7) % scenes.size()]
		var piece := Node3D.new()
		var angle := _hash01(cx + i * 11, cy + i * 23) * TAU
		var radius := cell * (0.08 + _hash01(cx + i * 5, cy + i * 13) * (0.25 if theme == "forest" else 0.18))
		piece.position = Vector3(cos(angle) * radius, 0.0, sin(angle) * radius)
		piece.rotation.y = angle
		holder.add_child(piece)
		var base_h := _wall_target_height(theme)
		var height := base_h * (0.82 + _hash01(cx + i * 43, cy + i * 47) * 0.34)
		_add_scaled_model(piece, scene, cell * (0.82 if theme == "forest" else 0.68), height, theme == "icedungeon")

func _add_scaled_model(parent: Node3D, scene: PackedScene, target_footprint: float, target_h: float, scale_by_height: bool = false) -> void:
	var model := scene.instantiate() as Node3D
	if model == null:
		return
	parent.add_child(model)
	_tune_model(model)
	var bounds := _visual_aabb(model)
	var max_footprint := maxf(bounds.size.x, bounds.size.z)
	var model_scale := 1.0
	if scale_by_height and bounds.size.y > 0.001:
		model_scale = target_h / bounds.size.y
	elif max_footprint > 0.001:
		model_scale = target_footprint / max_footprint
	if bounds.size.y > 0.001:
		model_scale = minf(model_scale, target_h / bounds.size.y)
	# Always cap by footprint so the model never exceeds its tile boundary,
	# regardless of whether scale_by_height drove the initial scale.
	if max_footprint > 0.001:
		model_scale = minf(model_scale, target_footprint / max_footprint)
	model_scale = clampf(model_scale, 0.01, 120.0)
	model.scale = Vector3.ONE * model_scale
	model.position = Vector3(
		-(bounds.position.x + bounds.size.x * 0.5) * model_scale,
		-bounds.position.y * model_scale,
		-(bounds.position.z + bounds.size.z * 0.5) * model_scale
	)

func _load_wall_scenes(theme: String) -> Array:
	var scenes: Array = []
	for path in WALL_MODEL_SCENES.get(theme, []):
		if _wall_scene_cache.has(path):
			scenes.append(_wall_scene_cache[path])
			continue
		var loaded := load(path)
		if loaded is PackedScene:
			_wall_scene_cache[path] = loaded
			scenes.append(loaded)
		else:
			push_warning("World: wall model failed to load: %s" % path)
	return scenes

func _clear_wall_models() -> void:
	for child in _wall_models.get_children():
		child.queue_free()
	_wall_model_nodes.clear()

func _wall_borders_floor(cx: int, cy: int, w: int, h: int, solid: PackedByteArray) -> bool:
	return (cx > 0 and solid[cy * w + cx - 1] == 0) or (cx < w - 1 and solid[cy * w + cx + 1] == 0) or (cy > 0 and solid[(cy - 1) * w + cx] == 0) or (cy < h - 1 and solid[(cy + 1) * w + cx] == 0)

func _wall_rotation(cx: int, cy: int, w: int, h: int, solid: PackedByteArray) -> float:
	return _wall_rotation_from_dir(_wall_open_dir(cx, cy, w, h, solid))

func _wall_open_dir(cx: int, cy: int, w: int, h: int, solid: PackedByteArray) -> Vector2:
	if cy < h - 1 and solid[(cy + 1) * w + cx] == 0:
		return Vector2(0.0, 1.0)
	if cx < w - 1 and solid[cy * w + cx + 1] == 0:
		return Vector2(1.0, 0.0)
	if cy > 0 and solid[(cy - 1) * w + cx] == 0:
		return Vector2(0.0, -1.0)
	if cx > 0 and solid[cy * w + cx - 1] == 0:
		return Vector2(-1.0, 0.0)
	return Vector2(0.0, 1.0)

func _wall_rotation_from_dir(open_dir: Vector2) -> float:
	if open_dir.y > 0.0:
		return 0.0
	if open_dir.x > 0.0:
		return PI * 0.5
	if open_dir.y < 0.0:
		return PI
	if open_dir.x < 0.0:
		return -PI * 0.5
	return 0.0

func _wall_target_height(theme: String) -> float:
	match theme:
		"fantasy":
			return FANTASY_WALL_TARGET_H
		"forest":
			return FOREST_WALL_TARGET_H
		"icedungeon":
			return ICE_WALL_TARGET_H
	return MODEL_WALL_TARGET_H

func _tune_model(root: Node3D) -> void:
	if root is GeometryInstance3D:
		(root as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for child in root.get_children():
		if child is Node3D:
			_tune_model(child)

func _apply_wall_model_shadow(root: Node3D, shadowed: bool) -> void:
	if root is GeometryInstance3D:
		var gi := root as GeometryInstance3D
		gi.material_overlay = _wall_shadow_material() if shadowed else null
	for child in root.get_children():
		if child is Node3D:
			_apply_wall_model_shadow(child, shadowed)

func _wall_shadow_material() -> StandardMaterial3D:
	if _wall_shadow_mat != null:
		return _wall_shadow_mat
	var mat := StandardMaterial3D.new()
	mat.resource_name = "DCCWallShadowOverlay"
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color = Color(0.0, 0.0, 0.0, WALL_SHADOW_ALPHA)
	_wall_shadow_mat = mat
	return _wall_shadow_mat

func _visual_aabb(root: Node3D) -> AABB:
	var state := {"has": false, "aabb": AABB()}
	_collect_visual_aabb(root, Transform3D.IDENTITY, state)
	return state["aabb"] if bool(state["has"]) else AABB(Vector3.ZERO, Vector3.ONE)

func _collect_visual_aabb(node: Node3D, xf: Transform3D, state: Dictionary) -> void:
	if node is MeshInstance3D:
		var local := (node as MeshInstance3D).get_aabb()
		for xi in 2:
			for yi in 2:
				for zi in 2:
					var corner := local.position + Vector3(local.size.x * float(xi), local.size.y * float(yi), local.size.z * float(zi))
					var p := xf * corner
					if not bool(state["has"]):
						state["aabb"] = AABB(p, Vector3.ZERO)
						state["has"] = true
					else:
						state["aabb"] = (state["aabb"] as AABB).expand(p)
	for child in node.get_children():
		if child is Node3D:
			var c := child as Node3D
			_collect_visual_aabb(c, xf * c.transform, state)

func _hash01(x: int, y: int) -> float:
	var v := float(int(sin(float(x) * 127.1 + float(y) * 311.7) * 43758.5453) % 10000) / 10000.0
	return absf(v)
