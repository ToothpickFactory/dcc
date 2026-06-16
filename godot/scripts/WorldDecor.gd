class_name WorldDecor
extends Node3D
## Themed tile / prop / decoration rendering, ported 1:1 from src/client/render.ts
## (TILE_SHEETS + PROP_SHEETS, applyTileTheme / applyPropTheme / setDecorations /
## setStairs). Tile & prop sheets are 4x4 grids of cells:
##   floor tile = sheet index 0, wall tile = sheet index 8 (render.ts tileFromSheet).
##   prop sheet index = decoration.variant; index 0 is reserved for the stairs marker.
## Decorations are billboard Sprite3Ds at (x, 24, y) sized 58 * scale; stairs at
## (x, 30, y). Sprites are exposed (decoration_sprites + stairs_sprite, each carrying
## a "dcc_world" Vector2 meta) so Main can fog them with Geo.line_of_sight.
##
## Public API:
##   apply(theme: String, decorations: Array, stairs: Dictionary) -> void
##   clear() -> void
##   decoration_sprites: Array[Sprite3D]   # spawned decoration billboards
##   stairs_sprite: Sprite3D               # the exit marker (null until apply)

const SHEET_COLS := 4
const SHEET_ROWS := 4
const FLOOR_TILE_INDEX := 0   # render.ts: loadTileMaterials -> tileFromSheet(sheet, 0)
const WALL_TILE_INDEX := 8    # render.ts: loadTileMaterials -> tileFromSheet(sheet, 8)
const PROP_COUNT := 16        # render.ts: loadPropTextures -> 16 sliced cells
const DECO_SIZE := 58.0       # render.ts setDecorations: 58 * decoration.scale
const DECO_Y := 24.0          # render.ts: sprite.position.set(x, 24, y)
const STAIRS_Y := 30.0        # render.ts setStairs: position.set(x, 30, y)
const STAIRS_FALLBACK := Color(0x5d / 255.0, 1.0, 0x9b / 255.0)  # 0x5dff9b

# Valid themes (src/shared/types.ts: Theme). Anything else -> flat fallback.
const THEMES := ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare"]

@export var tiles_dir := "res://assets/Tiles"
@export var props_dir := "res://assets/Props"

## The World whose ground/wall materials we retexture. Set by Main before apply().
var world: World

var decoration_sprites: Array[Sprite3D] = []
var stairs_sprite: Sprite3D

# theme -> { "floor": AtlasTexture, "wall": AtlasTexture }
var _tile_cache: Dictionary = {}
# theme -> Array[AtlasTexture] (length PROP_COUNT)
var _prop_cache: Dictionary = {}
# raw sheet path -> Texture2D (parsed once)
var _sheet_cache: Dictionary = {}

var _stairs_pulse := 0.0
var _stairs_tex_h := 64.0  # cached stairs texture height, for the pulse pixel_size


func _process(dt: float) -> void:
	# Pulse the stairs marker so the exit reads as a beacon (render.ts draw()).
	if stairs_sprite == null or not stairs_sprite.visible:
		return
	_stairs_pulse += dt
	var pulse := 0.5 + 0.5 * sin(_stairs_pulse * (1000.0 / 280.0))
	var s := 120.0 + 35.0 * pulse
	stairs_sprite.pixel_size = s / _stairs_tex_h
	stairs_sprite.modulate.a = 0.65 + 0.35 * pulse


## Theme the floor: retexture World's ground/wall materials and spawn decoration +
## stairs billboards. Mirrors applyTileTheme + applyPropTheme from render.ts.
func apply(theme: String, decorations: Array, stairs: Dictionary) -> void:
	clear()
	if not THEMES.has(theme):
		# Unknown theme: leave World on its flat fallback colours, no props.
		push_warning("WorldDecor: unknown theme '%s' — using flat fallback" % theme)
		return

	# 1) Ground + wall tiles (render.ts applyTileTheme).
	var tiles := _load_tiles(theme)
	if world != null:
		world.set_ground_texture(tiles.get("floor"))
		world.set_wall_texture(tiles.get("wall"))

	# 2) Prop sheet (render.ts applyPropTheme / loadPropTextures).
	var props := _load_props(theme)

	# 3) Stairs marker — prop index 0 (render.ts setStairs uses textures[0]).
	if not stairs.is_empty():
		var sx := float(stairs.get("x", 0.0))
		var sy := float(stairs.get("y", 0.0))
		var stairs_tex: Texture2D = props[0] if props.size() > 0 else null
		stairs_sprite = _make_billboard(stairs_tex, sx, STAIRS_Y, sy, 120.0)
		_stairs_tex_h = float(stairs_tex.get_height()) if (stairs_tex != null and stairs_tex.get_height() > 0) else 64.0
		if stairs_tex == null:
			stairs_sprite.modulate = STAIRS_FALLBACK
		add_child(stairs_sprite)

	# 4) Decorations (render.ts setDecorations). variant indexes the prop sheet,
	#    fallback to index 1 (render.ts: textures[variant] ?? textures[1]).
	for deco in decorations:
		if typeof(deco) != TYPE_DICTIONARY:
			continue
		var variant := int(deco.get("variant", 1))
		var tex: Texture2D = null
		if variant >= 0 and variant < props.size():
			tex = props[variant]
		if tex == null and props.size() > 1:
			tex = props[1]
		if tex == null:
			continue
		var scale := float(deco.get("scale", 1.0))
		var dx := float(deco.get("x", 0.0))
		var dy := float(deco.get("y", 0.0))
		var sprite := _make_billboard(tex, dx, DECO_Y, dy, DECO_SIZE * scale)
		add_child(sprite)
		decoration_sprites.append(sprite)


## Remove every spawned billboard and reset the stairs pulse. World's ground/wall
## textures are left as-is (a fresh apply() overwrites them; clear-on-floor-exit is
## driven by the next apply or by Main reverting World if needed).
func clear() -> void:
	for sprite in decoration_sprites:
		if is_instance_valid(sprite):
			sprite.queue_free()
	decoration_sprites.clear()
	if is_instance_valid(stairs_sprite):
		stairs_sprite.queue_free()
	stairs_sprite = null
	_stairs_pulse = 0.0


# --- internal -------------------------------------------------------------

## Billboard Sprite3D at (wx, wy, wz), sized so its world height ≈ `size_px`.
## texture_filter NEAREST + unshaded + transparent (GODOT rules). Carries a
## "dcc_world" Vector2(world x, world y) meta for Main's fog line-of-sight.
func _make_billboard(tex: Texture2D, wx: float, wy: float, wz: float, size_px: float) -> Sprite3D:
	var sprite := Sprite3D.new()
	sprite.texture = tex
	sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	sprite.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	sprite.shaded = false
	sprite.transparent = true
	sprite.no_depth_test = false
	# Sprite3D world height = texture_height_px * pixel_size. Normalise by the actual
	# tile height so the rendered world size == size_px, regardless of source art
	# resolution — matching render.ts where `size` is the sprite's world scale.
	var tex_h := 64.0
	if tex != null and tex.get_height() > 0:
		tex_h = float(tex.get_height())
	sprite.pixel_size = size_px / tex_h
	sprite.position = Vector3(wx, wy, wz)
	sprite.set_meta("dcc_world", Vector2(wx, wz))
	return sprite


## Load (and cache) the floor + wall AtlasTextures for a theme.
func _load_tiles(theme: String) -> Dictionary:
	if _tile_cache.has(theme):
		return _tile_cache[theme]
	var sheet := _load_sheet("%s/%s-tiles.png" % [tiles_dir, theme])
	var result := {"floor": null, "wall": null}
	if sheet != null:
		result["floor"] = _tile_from_sheet(sheet, FLOOR_TILE_INDEX)
		result["wall"] = _tile_from_sheet(sheet, WALL_TILE_INDEX)
	_tile_cache[theme] = result
	return result


## Load (and cache) the 16 prop AtlasTextures for a theme.
func _load_props(theme: String) -> Array:
	if _prop_cache.has(theme):
		return _prop_cache[theme]
	var sheet := _load_sheet("%s/%s-props.png" % [props_dir, theme])
	var textures: Array = []
	if sheet != null:
		for i in PROP_COUNT:
			textures.append(_tile_from_sheet(sheet, i))
	_prop_cache[theme] = textures
	return textures


## One cell of a 4x4 sheet as an AtlasTexture. col = i%4, row = floor(i/4) — exactly
## render.ts tileFromSheet(sheet, tileIndex).
func _tile_from_sheet(sheet: Texture2D, tile_index: int) -> AtlasTexture:
	var tile_w := sheet.get_width() / float(SHEET_COLS)
	var tile_h := sheet.get_height() / float(SHEET_ROWS)
	var col := tile_index % SHEET_COLS
	var row := tile_index / SHEET_COLS
	var atlas := AtlasTexture.new()
	atlas.atlas = sheet
	atlas.region = Rect2(col * tile_w, row * tile_h, tile_w, tile_h)
	atlas.filter_clip = true
	return atlas


## Load a sheet PNG. Prefer the Godot-imported resource (res://...); fall back to
## parsing the raw file (assets may be copied in without .import sidecars).
func _load_sheet(path: String) -> Texture2D:
	if _sheet_cache.has(path):
		return _sheet_cache[path]
	var tex: Texture2D = null
	if ResourceLoader.exists(path):
		tex = load(path) as Texture2D
	if tex == null and FileAccess.file_exists(path):
		var img := Image.new()
		if img.load(path) == OK:
			tex = ImageTexture.create_from_image(img)
	if tex == null:
		push_warning("WorldDecor: sheet failed to load: %s" % path)
	_sheet_cache[path] = tex
	return tex
