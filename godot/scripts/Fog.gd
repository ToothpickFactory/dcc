class_name Fog
extends Node
## Wall-based fog of war, ported 1:1 from src/client/render.ts (patchFog + computeWallVis).
##
## A ShaderMaterial (shaders/fog.gdshader) drives BOTH the ground plane and the wall
## MultiMesh: every fragment is blended toward the scene background unless it has
## line-of-sight to the vision center. The collision grid rides along as an R8
## texture so the ground shader marches it per-pixel (smooth). Walls reveal as whole
## tiles via a per-cell mask recomputed on the CPU ONLY when the player crosses into a
## new cell — so walls never flicker as you run within a tile.
##
## INTEGRATION (Main wiring):
##   var fog := Fog.new();  add_child(fog)
##   # after World.build(geometry):
##   fog.attach(world)
##   # every frame, with the camera/vision center in WORLD (x,y) coords:
##   fog.set_vision(cam_x, cam_y)
##
## attach() reads World.grid + the ground/wall instances and applies the fog material
## as material_override. Re-call attach() after any World.build() (new floor) to
## rebuild the grid/mask textures and re-apply. set_vision(x,y) is cheap every frame:
## it only updates the uPlayer uniform and the static-LoS-driven wall mask on cell
## change. Themed tiles set via World.set_ground_texture/set_wall_texture are routed
## into this fog material automatically once attached (one material carries both).

const SHADER_PATH := "res://shaders/fog.gdshader"

var _world: World
var _grid: Dictionary = {}
var _ground_mat: ShaderMaterial
var _wall_mat: ShaderMaterial

# R8 grid (255 = wall) marched by the ground shader.
var _grid_img: Image
var _grid_tex: ImageTexture
# Per-cell "is this wall currently visible" mask (255 = lit). Recomputed on cell-move.
var _wall_vis_img: Image
var _wall_vis_tex: ImageTexture
var _wall_vis: PackedByteArray = PackedByteArray()  # working copy of the mask
var _vis_scratch: PackedByteArray = PackedByteArray()  # visible-open-cell scratch
var _last_vis_cell := -1

## Build the fog textures from World.grid and apply the shader to the ground + walls.
## Call after World.build(geometry); safe to call again on a new floor.
func attach(world: World) -> void:
	_world = world
	_grid = world.grid
	if _grid.is_empty():
		return
	_last_vis_cell = -1
	_build_grid_texture()
	_build_wall_vis_texture()
	_ensure_materials()
	_apply_materials()
	world.set_fog(self)

## Vision center for the fog shader, in WORLD (x,y) coords. Call every frame (Main
## passes the camera focus: the player in play, the spectate target while waiting).
func set_vision(x: float, y: float) -> void:
	if _grid.is_empty():
		return
	var p := Vector2(x, y)
	if _ground_mat:
		_ground_mat.set_shader_parameter("u_player", p)
	if _wall_mat:
		_wall_mat.set_shader_parameter("u_player", p)
	# Recompute the wall mask only on cell change — stable (no flicker) within a tile.
	var cell: float = _grid["cell"]
	var w: int = _grid["w"]
	var here := int(floor(y / cell)) * w + int(floor(x / cell))
	if here == _last_vis_cell:
		return
	_last_vis_cell = here
	_compute_wall_vis(x, y)

## Themed floor tile -> fog shader (so tile + fog share one material). null = flat.
## Called by World.set_ground_texture when fog is attached.
func set_ground_texture(tex: Texture2D) -> void:
	if _ground_mat == null:
		return
	if tex == null:
		_ground_mat.set_shader_parameter("u_has_tex", false)
		_ground_mat.set_shader_parameter("u_use_tile_sheet", false)
		return
	_ground_mat.set_shader_parameter("u_tex", tex)
	_ground_mat.set_shader_parameter("u_has_tex", true)
	_set_tile_sheet_params(_ground_mat, tex)

## Per-theme palette: an albedo tint (color cast) + the fog/background color. Gives each
## theme a distinct mood. Called by World.set_theme_palette when fog is attached.
func set_palette(tint: Color, bg: Color) -> void:
	var t := Vector3(tint.r, tint.g, tint.b)
	var b := Vector3(bg.r, bg.g, bg.b)
	if _ground_mat:
		_ground_mat.set_shader_parameter("u_tint", t)
		_ground_mat.set_shader_parameter("u_bg", b)
	if _wall_mat:
		_wall_mat.set_shader_parameter("u_tint", t)
		_wall_mat.set_shader_parameter("u_bg", b)

## Themed wall tile -> fog shader. null = flat. Called by World.set_wall_texture.
func set_wall_texture(tex: Texture2D) -> void:
	if _wall_mat == null:
		return
	if tex == null:
		_wall_mat.set_shader_parameter("u_has_tex", false)
		_wall_mat.set_shader_parameter("u_use_tile_sheet", false)
		return
	_wall_mat.set_shader_parameter("u_tex", tex)
	_wall_mat.set_shader_parameter("u_has_tex", true)
	_set_tile_sheet_params(_wall_mat, tex)

# --- internals ---------------------------------------------------------------

func _build_grid_texture() -> void:
	var w: int = _grid["w"]
	var h: int = _grid["h"]
	var solid: PackedByteArray = _grid["solid"]
	var data := PackedByteArray()
	data.resize(w * h)
	for i in range(w * h):
		data[i] = 255 if solid[i] == 1 else 0
	_grid_img = Image.create_from_data(w, h, false, Image.FORMAT_R8, data)
	_grid_tex = ImageTexture.create_from_image(_grid_img)

func _build_wall_vis_texture() -> void:
	var w: int = _grid["w"]
	var h: int = _grid["h"]
	_wall_vis = PackedByteArray()
	_wall_vis.resize(w * h)
	_wall_vis.fill(0)
	_vis_scratch = PackedByteArray()
	_vis_scratch.resize(w * h)
	_wall_vis_img = Image.create_from_data(w, h, false, Image.FORMAT_R8, _wall_vis)
	_wall_vis_tex = ImageTexture.create_from_image(_wall_vis_img)

func _ensure_materials() -> void:
	var shader: Shader = load(SHADER_PATH)
	var w: int = _grid["w"]
	var h: int = _grid["h"]
	var cell: float = _grid["cell"]
	var size := Vector2(w, h)

	_ground_mat = ShaderMaterial.new()
	_ground_mat.shader = shader
	_ground_mat.set_shader_parameter("u_grid", _grid_tex)
	_ground_mat.set_shader_parameter("u_wall_vis", _wall_vis_tex)
	_ground_mat.set_shader_parameter("u_grid_size", size)
	_ground_mat.set_shader_parameter("u_cell", cell)
	_ground_mat.set_shader_parameter("u_vision", DccConst.VISION_RADIUS)
	_ground_mat.set_shader_parameter("u_is_wall", false)
	_ground_mat.set_shader_parameter("u_albedo", _world.ground_color())
	_ground_mat.set_shader_parameter("u_has_tex", false)
	_ground_mat.set_shader_parameter("u_uv_scale", Vector2.ONE * _world.ground_uv_repeat())
	_ground_mat.set_shader_parameter("u_use_tile_sheet", false)
	_ground_mat.set_shader_parameter("u_tile_start", 0.0)
	_ground_mat.set_shader_parameter("u_tile_count", 1.0)
	_ground_mat.set_shader_parameter("u_top_tile_start", 0.0)
	_ground_mat.set_shader_parameter("u_top_tile_count", 1.0)
	_ground_mat.set_shader_parameter("u_player", Vector2.ZERO)

	_wall_mat = ShaderMaterial.new()
	_wall_mat.shader = shader
	_wall_mat.set_shader_parameter("u_grid", _grid_tex)
	_wall_mat.set_shader_parameter("u_wall_vis", _wall_vis_tex)
	_wall_mat.set_shader_parameter("u_grid_size", size)
	_wall_mat.set_shader_parameter("u_cell", cell)
	_wall_mat.set_shader_parameter("u_vision", DccConst.VISION_RADIUS)
	_wall_mat.set_shader_parameter("u_is_wall", true)
	_wall_mat.set_shader_parameter("u_albedo", _world.wall_color())
	_wall_mat.set_shader_parameter("u_has_tex", false)
	_wall_mat.set_shader_parameter("u_uv_scale", Vector2.ONE)
	_wall_mat.set_shader_parameter("u_use_tile_sheet", false)
	_wall_mat.set_shader_parameter("u_tile_start", 0.0)
	_wall_mat.set_shader_parameter("u_tile_count", 1.0)
	_wall_mat.set_shader_parameter("u_top_tile_start", 0.0)
	_wall_mat.set_shader_parameter("u_top_tile_count", 1.0)
	_wall_mat.set_shader_parameter("u_player", Vector2.ZERO)

func _set_tile_sheet_params(mat: ShaderMaterial, tex: Texture2D) -> void:
	var use_sheet := bool(tex.get_meta("dcc_tile_sheet", false))
	mat.set_shader_parameter("u_use_tile_sheet", use_sheet)
	if not use_sheet:
		mat.set_shader_parameter("u_tile_start", 0.0)
		mat.set_shader_parameter("u_tile_count", 1.0)
		mat.set_shader_parameter("u_top_tile_start", 0.0)
		mat.set_shader_parameter("u_top_tile_count", 1.0)
		return
	mat.set_shader_parameter("u_tile_start", float(int(tex.get_meta("dcc_tile_start", 0))))
	mat.set_shader_parameter("u_tile_count", float(int(tex.get_meta("dcc_tile_count", 1))))
	mat.set_shader_parameter("u_top_tile_start", float(int(tex.get_meta("dcc_top_tile_start", tex.get_meta("dcc_tile_start", 0)))))
	mat.set_shader_parameter("u_top_tile_count", float(int(tex.get_meta("dcc_top_tile_count", tex.get_meta("dcc_tile_count", 1)))))

func _apply_materials() -> void:
	var g := _world.ground_instance()
	if g:
		g.material_override = _ground_mat
	var wl := _world.wall_instance()
	if wl:
		wl.material_override = _wall_mat

# A wall is visible if any open floor cell adjacent to it (8-neighbour) has clear
# line-of-sight to the player within vision range. Reveals whole walls bounding the
# area you can see; computed per cell-move, not per frame. (render.ts: computeWallVis)
func _compute_wall_vis(px: float, py: float) -> void:
	var w: int = _grid["w"]
	var h: int = _grid["h"]
	var cell: float = _grid["cell"]
	var solid: PackedByteArray = _grid["solid"]
	var vision: float = DccConst.VISION_RADIUS
	var r := int(ceil(vision / cell)) + 1
	var cx := int(floor(px / cell))
	var cy := int(floor(py / cell))
	_wall_vis.fill(0)
	_vis_scratch.fill(0)
	var x0 := maxi(0, cx - r)
	var x1 := mini(w - 1, cx + r)
	var y0 := maxi(0, cy - r)
	var y1 := mini(h - 1, cy + r)
	var vision_sq := vision * vision
	# Pass 1: which open cells in range are visible.
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			var idx := y * w + x
			if solid[idx] == 1:
				continue
			var wx := (x + 0.5) * cell
			var wy := (y + 0.5) * cell
			var dx := wx - px
			var dy := wy - py
			if dx * dx + dy * dy > vision_sq:
				continue
			if Geo.line_of_sight(_grid, px, py, wx, wy):
				_vis_scratch[idx] = 1
	# Pass 2: a wall lights up if any 8-neighbour open cell is visible.
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			var idx := y * w + x
			if solid[idx] != 1:
				continue
			var lit := false
			var ny0 := maxi(0, y - 1)
			var ny1 := mini(h - 1, y + 1)
			var nx0 := maxi(0, x - 1)
			var nx1 := mini(w - 1, x + 1)
			for ny in range(ny0, ny1 + 1):
				if lit:
					break
				for nx in range(nx0, nx1 + 1):
					if _vis_scratch[ny * w + nx] == 1:
						lit = true
						break
			if lit:
				_wall_vis[idx] = 255
	_wall_vis_img.set_data(w, h, false, Image.FORMAT_R8, _wall_vis)
	_wall_vis_tex.update(_wall_vis_img)
