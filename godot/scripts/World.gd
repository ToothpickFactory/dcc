class_name World
extends Node3D
## Builds the floor from server geometry: a wall MultiMesh (96-tall boxes, one per
## solid cell) + a ground plane. World (x,y) maps to 3D (x, 0, y) and wall centres
## to ((cx+0.5)*cell, 48, (cy+0.5)*cell) — matching src/client/render.ts exactly.
## Phase 0 uses flat materials; the line-of-sight fog shader is Phase 2 (GODOT_PORT.md §4).

var grid: Dictionary = {}
var _walls: MultiMeshInstance3D
var _ground: MeshInstance3D

func build(geometry: Dictionary) -> void:
	grid = Geo.decode(str(geometry["solid"]), int(geometry["gw"]), int(geometry["gh"]), float(geometry["cell"]))
	_build_ground()
	_build_walls()

func _build_ground() -> void:
	if _ground:
		_ground.queue_free()
	var plane := PlaneMesh.new()
	plane.size = DccConst.WORLD
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color8(0x16, 0x1d, 0x2e)
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	plane.material = mat
	_ground = MeshInstance3D.new()
	_ground.mesh = plane
	_ground.position = Vector3(DccConst.WORLD.x * 0.5, 0, DccConst.WORLD.y * 0.5)
	add_child(_ground)

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
	box.size = Vector3(cell, 96, cell)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color8(0x39, 0x44, 0x5e)
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	box.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = box
	mm.instance_count = count
	var i := 0
	for cy in h:
		for cx in w:
			if solid[cy * w + cx] != 1:
				continue
			mm.set_instance_transform(i, Transform3D(Basis(), Vector3((cx + 0.5) * cell, 48, (cy + 0.5) * cell)))
			i += 1
	_walls = MultiMeshInstance3D.new()
	_walls.multimesh = mm
	add_child(_walls)
