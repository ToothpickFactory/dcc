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
const DECO_Y := 32.0          # raised from 24 so sprite bottom (32-29=3) clears the floor plane at Y=0
const STAIRS_Y := 30.0        # render.ts setStairs: position.set(x, 30, y)
const STAIRS_FALLBACK := Color(0x5d / 255.0, 1.0, 0x9b / 255.0)  # 0x5dff9b
# Atmosphere: warm torch light-pools on the floor + a flame at the wall, and dark grime decals.
# Fake "lighting" via additive glow quads (the fog/wall materials are unshaded, so real point
# lights wouldn't touch them). Placed deterministically from the grid; fog-culled like decorations.
const GLOW_Y := 5.0            # glow pool height above the floor (additive; above decals)
const DECAL_Y := 2.0           # grime decal height above the floor (avoids z-fight with ground)
const TORCH_GLOW_SIZE := 460.0 # warm pool diameter (px) — lights ~a corridor
const TORCH_FLAME_Y := 70.0    # flame billboard height on the wall
const DECAL_SIZE := 160.0      # grime splotch diameter
const MAX_TORCHES := 44        # per-floor caps (sprite/perf budget)
const MAX_DECALS := 48
const TORCH_THRESH := 0.16     # fraction of wall-edges that get a torch
const TORCH_COLOR := Color(1.6, 1.0, 0.5)  # overbright warm pool (additive) so it reads strongly

# Valid themes (src/shared/types.ts: Theme). Anything else -> flat fallback.
const THEMES := ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare"]

# Per-theme mood palette: `tint` casts the tile albedo, `bg` is the fog/background color the
# unseen edges fade to. Gives each floor a distinct atmosphere instead of uniform grey.
const THEME_PALETTE := {
	"fantasy":   {"tint": Color(1.0, 0.97, 0.90),  "bg": Color(0.05, 0.06, 0.09)},
	"cyberpunk": {"tint": Color(0.80, 0.95, 1.15),  "bg": Color(0.03, 0.05, 0.10)},
	"forest":    {"tint": Color(0.85, 1.07, 0.85),  "bg": Color(0.03, 0.07, 0.045)},
	"pirate":    {"tint": Color(1.12, 1.0, 0.82),   "bg": Color(0.05, 0.06, 0.06)},
	"clockwork": {"tint": Color(1.14, 1.0, 0.76),   "bg": Color(0.07, 0.055, 0.035)},
	"nightmare": {"tint": Color(1.05, 0.78, 1.06),  "bg": Color(0.07, 0.03, 0.08)},
}

@export var tiles_dir := "res://assets/Tiles"
@export var props_dir := "res://assets/Props"

## The World whose ground/wall materials we retexture. Set by Main before apply().
var world: World

var decoration_sprites: Array[Sprite3D] = []
var stairs_sprite: Sprite3D
# Atmosphere props (torch glow pools + flame billboards + floor decals). Fog-culled by Main like
# decorations, but NOT destructible props (skipped by set_live_props). Glow pools flicker.
var atmo_sprites: Array[Node3D] = []
var _glow_quads: Array[Node3D] = []  # subset of atmo_sprites that flicker
var _flicker := 0.0
static var _glow_tex: Texture2D
static var _decal_tex: Texture2D

# theme -> { "floor": AtlasTexture, "wall": AtlasTexture }
var _tile_cache: Dictionary = {}
# theme -> Array[AtlasTexture] (length PROP_COUNT)
var _prop_cache: Dictionary = {}
# raw sheet path -> Texture2D (parsed once)
var _sheet_cache: Dictionary = {}

var _stairs_pulse := 0.0
var _stairs_tex_h := 64.0  # cached stairs texture height, for the pulse pixel_size
var _stairs_base := Color.WHITE  # base tint (white for art, green for the fallback)


func _process(dt: float) -> void:
	# Torch flicker: gently wobble each glow pool's brightness so torches feel alive.
	if not _glow_quads.is_empty():
		_flicker += dt
		for i in _glow_quads.size():
			var q := _glow_quads[i]
			if not is_instance_valid(q) or not q.visible:
				continue
			var phase := float(i) * 1.7
			var f := 0.78 + 0.22 * sin(_flicker * 7.0 + phase) * (0.6 + 0.4 * sin(_flicker * 17.0 + phase))
			(q as GeometryInstance3D).transparency = clampf(1.0 - f, 0.0, 0.6)
	# Pulse + shimmer the stairs marker so the exit reads as a glowing portal.
	if stairs_sprite == null or not stairs_sprite.visible:
		return
	_stairs_pulse += dt
	var pulse := 0.5 + 0.5 * sin(_stairs_pulse * (1000.0 / 280.0))
	var shimmer := 0.5 + 0.5 * sin(_stairs_pulse * 6.3)  # faster sparkle on top of the slow swell
	var s := 130.0 + 55.0 * pulse
	stairs_sprite.pixel_size = s / _stairs_tex_h
	var glow := 1.0 + 0.7 * shimmer  # overbright flicker for a "portal" feel
	stairs_sprite.modulate = Color(_stairs_base.r * glow, _stairs_base.g * glow, _stairs_base.b * glow, 0.6 + 0.4 * pulse)


## Theme the floor: retexture World's ground/wall materials and spawn decoration +
## stairs billboards. Mirrors applyTileTheme + applyPropTheme from render.ts.
func apply(theme: String, decorations: Array, stairs: Dictionary) -> void:
	clear()
	if not THEMES.has(theme):
		# Unknown theme: leave World on its flat fallback colours, no props.
		push_warning("WorldDecor: unknown theme '%s' — using flat fallback" % theme)
		return

	# 1) Ground + wall tiles (render.ts applyTileTheme) + per-theme color/mood palette.
	var tiles := _load_tiles(theme)
	if world != null:
		world.set_ground_texture(tiles.get("floor"))
		world.set_wall_texture(tiles.get("wall"))
		var pal: Dictionary = THEME_PALETTE.get(theme, {"tint": Color.WHITE, "bg": Color(0.043, 0.055, 0.078)})
		world.set_theme_palette(pal["tint"], pal["bg"])

	# 2) Prop sheet (render.ts applyPropTheme / loadPropTextures).
	var props := _load_props(theme)

	# 3) Stairs marker — prop index 0 (render.ts setStairs uses textures[0]).
	if not stairs.is_empty():
		var sx := float(stairs.get("x", 0.0))
		var sy := float(stairs.get("y", 0.0))
		var stairs_tex: Texture2D = props[0] if props.size() > 0 else null
		stairs_sprite = _make_billboard(stairs_tex, sx, STAIRS_Y + _gh(sx, sy), sy, 120.0)
		_stairs_tex_h = float(stairs_tex.get_height()) if (stairs_tex != null and stairs_tex.get_height() > 0) else 64.0
		if stairs_tex == null:
			stairs_sprite.modulate = STAIRS_FALLBACK
			_stairs_base = STAIRS_FALLBACK
		else:
			_stairs_base = Color.WHITE
		add_child(stairs_sprite)

	# 4) Decorations (render.ts setDecorations). variant indexes the prop sheet,
	#    fallback to index 1 (render.ts: textures[variant] ?? textures[1]).
	for i in decorations.size():
		var deco = decorations[i]
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
		var sprite := _make_billboard(tex, dx, DECO_Y + _gh(dx, dy), dy, DECO_SIZE * scale)
		sprite.set_meta("dcc_prop_id", "prop_%s" % _base36(i))
		add_child(sprite)
		decoration_sprites.append(sprite)

	# 5) Atmosphere: torch light-pools along walls + grime decals on the floor.
	_place_atmosphere()

func set_live_props(ents: Array) -> void:
	if ents.is_empty():
		return  # no state yet — leave sprites in their initial visible state
	var live := {}
	for e in ents:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = e
		if str(d.get("kind", "")) != "prop":
			continue
		live[str(d.get("id", ""))] = true
	for sprite in decoration_sprites:
		if not is_instance_valid(sprite):
			continue
		var prop_id := str(sprite.get_meta("dcc_prop_id", ""))
		sprite.set_meta("dcc_alive", live.has(prop_id))


## Remove every spawned billboard and reset the stairs pulse. World's ground/wall
## textures are left as-is (a fresh apply() overwrites them; clear-on-floor-exit is
## driven by the next apply or by Main reverting World if needed).
func clear() -> void:
	for sprite in decoration_sprites:
		if is_instance_valid(sprite):
			sprite.queue_free()
	decoration_sprites.clear()
	for a in atmo_sprites:
		if is_instance_valid(a):
			a.queue_free()
	atmo_sprites.clear()
	_glow_quads.clear()
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
	sprite.render_priority = 1  # draw above the floor plane to prevent z-fighting
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


# --- atmosphere: torch light-pools + grime decals --------------------------

## Place torches along walls (a warm flat glow pool on the floor + a flame billboard on the wall)
## and grime decals on open floor. Deterministic from the grid (stable per floor) + count-capped.
func _place_atmosphere() -> void:
	if world == null or world.grid.is_empty():
		return
	var grid: Dictionary = world.grid
	var w: int = grid["w"]
	var h: int = grid["h"]
	var cell: float = grid["cell"]
	var solid: PackedByteArray = grid["solid"]
	var torches := 0
	var decals := 0
	# Step by 1 logical block (2 fine cells) so we don't over-sample the 2x grid.
	for cy in range(1, h - 1, 2):
		for cx in range(1, w - 1, 2):
			var i := cy * w + cx
			if solid[i] == 1:
				# Wall: maybe a torch if it borders open floor (pick the open side for the pool).
				if torches >= MAX_TORCHES or _hash01(cx, cy) > TORCH_THRESH:
					continue
				var ox := 0
				var oy := 0
				if cx + 1 < w and solid[i + 1] == 0: ox = 1
				elif cx - 1 >= 0 and solid[i - 1] == 0: ox = -1
				elif cy + 1 < h and solid[i + w] == 0: oy = 1
				elif cy - 1 >= 0 and solid[i - w] == 0: oy = -1
				else: continue
				var fx := (cx + 0.5 + float(ox) * 0.7) * cell
				var fz := (cy + 0.5 + float(oy) * 0.7) * cell
				var fgz := Geo.ground_height(grid, fx, fz)
				var pool := _floor_quad(_glow_texture(), fx, GLOW_Y + fgz, fz, TORCH_GLOW_SIZE, TORCH_COLOR, true, _ground_normal(fx, fz))
				atmo_sprites.append(pool)
				_glow_quads.append(pool)
				var flame := _make_billboard(_glow_texture(), fx, TORCH_FLAME_Y + fgz, fz, 46.0)
				flame.modulate = Color(1.0, 0.74, 0.4)
				add_child(flame)
				atmo_sprites.append(flame)
				torches += 1
			else:
				# Open floor: maybe a grime decal.
				if decals >= MAX_DECALS or _hash01(cx + 911, cy + 53) > 0.05:
					continue
				var dx := (cx + 0.5) * cell
				var dz := (cy + 0.5) * cell
				var decal := _floor_quad(_decal_texture(), dx, DECAL_Y + Geo.ground_height(grid, dx, dz), dz, DECAL_SIZE * (0.8 + _hash01(cx, cy + 7) * 0.8), Color(1, 1, 1, 0.5), false, _ground_normal(dx, dz))
				decal.rotate_y(_hash01(cx + 3, cy) * TAU)
				atmo_sprites.append(decal)
				decals += 1

## A flat quad lying on the floor at (wx,wy,wz), tilted to the ground `normal` so it hugs slopes
## instead of z-fighting/clipping. additive=true for light pools, false (alpha-blended) for decals.
## Carries dcc_world meta so Main fog-culls it.
func _floor_quad(tex: Texture2D, wx: float, wy: float, wz: float, size: float, color: Color, additive: bool, normal: Vector3 = Vector3.UP) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	mi.mesh = q
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex
	m.albedo_color = color
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if additive else BaseMaterial3D.BLEND_MODE_MIX
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	q.material = m
	# QuadMesh faces +Z locally; orient that normal to the ground normal (flat -> faces up, as before).
	var zaxis := normal.normalized()
	var xaxis := Vector3.RIGHT if absf(zaxis.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD
	var yaxis := zaxis.cross(xaxis).normalized()
	xaxis = yaxis.cross(zaxis).normalized()
	mi.transform = Transform3D(Basis(xaxis, yaxis, zaxis), Vector3(wx, wy, wz))
	mi.set_meta("dcc_world", Vector2(wx, wz))
	add_child(mi)
	return mi

## Ground height at (x,y) in px, 0 when there's no terrain (flat). Heightfield 2.5D.
func _gh(x: float, y: float) -> float:
	if world == null or world.grid.is_empty():
		return 0.0
	return Geo.ground_height(world.grid, x, y)

## Approximate ground surface normal at (x,y) via central differences of the height field.
func _ground_normal(x: float, y: float) -> Vector3:
	if world == null or world.grid.is_empty():
		return Vector3.UP
	var grid: Dictionary = world.grid
	var cell: float = grid["cell"]
	var sx := (Geo.ground_height(grid, x + cell, y) - Geo.ground_height(grid, x - cell, y)) / (2.0 * cell)
	var sz := (Geo.ground_height(grid, x, y + cell) - Geo.ground_height(grid, x, y - cell)) / (2.0 * cell)
	return Vector3(-sx, 1.0, -sz).normalized()

## Warm radial glow texture (white; tinted by modulate). Soft falloff to transparent edges.
static func _glow_texture() -> Texture2D:
	if _glow_tex != null:
		return _glow_tex
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var c := (n - 1) * 0.5
	for y in n:
		for x in n:
			var r := Vector2(x - c, y - c).length() / c
			var a := clampf(1.0 - r, 0.0, 1.0)
			a = a * a  # soft quadratic falloff
			img.set_pixel(x, y, Color(1.0, 1.0, 1.0, a))
	_glow_tex = ImageTexture.create_from_image(img)
	return _glow_tex

## Dark grime splotch (soft-edged, irregular) for floor decals.
static func _decal_texture() -> Texture2D:
	if _decal_tex != null:
		return _decal_tex
	var n := 48
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var c := (n - 1) * 0.5
	for y in n:
		for x in n:
			var r := Vector2(x - c, y - c).length() / c
			# irregular edge via a cheap hash wobble on the radius
			var wob := 0.18 * sin(float(x) * 1.7) * cos(float(y) * 1.3)
			var a := clampf(1.0 - (r + wob) * 1.15, 0.0, 1.0)
			a = pow(a, 1.4) * 0.55
			img.set_pixel(x, y, Color(0.0, 0.0, 0.0, a))
	_decal_tex = ImageTexture.create_from_image(img)
	return _decal_tex

## Deterministic 0..1 hash for stable placement.
func _hash01(x: int, y: int) -> float:
	var v := float(int(sin(float(x) * 127.1 + float(y) * 311.7) * 43758.5453) % 10000) / 10000.0
	return absf(v)


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

func _base36(v: int) -> String:
	const DIGITS := "0123456789abcdefghijklmnopqrstuvwxyz"
	if v <= 0:
		return "0"
	var n := v
	var out := ""
	while n > 0:
		out = DIGITS[n % 36] + out
		n = n / 36
	return out
