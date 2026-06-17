class_name World
extends Node3D
## Builds the floor from server geometry: a wall MultiMesh (WALL_H-tall boxes, one per
## solid cell) + a ground plane. World (x,y) maps to 3D (x, 0, y) and wall centres
## to ((cx+0.5)*cell, WALL_H/2, (cy+0.5)*cell). Tall walls (Champions-of-Norrath feel:
## the dungeon reads as deep canyons/halls, not low kerbs).
## Phase 0 uses flat materials; the line-of-sight fog shader is Phase 2 (GODOT_PORT.md §4).

const WALL_H := 220.0  # wall box height (px). Tall, cliff-like — paired with the lower 3/4 camera.
const WALL_SKIRT := 300.0  # extra height extending each wall box DOWNWARD, so on sloped/sunken terrain the base never lifts off the floor and shows a gap (heightfield 2.5D).

var grid: Dictionary = {}
var _walls: MultiMeshInstance3D
var _ground: MeshInstance3D
var _ground_mat: StandardMaterial3D
var _wall_mat: StandardMaterial3D
var _fog: Node  # set by Fog.attach(); themed tiles route into the fog shader when present

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
