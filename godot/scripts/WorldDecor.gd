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
##   apply(theme: String, decorations: Array, stairs: Dictionary, hazards: Array = [], portals: Array = []) -> void
##   clear() -> void
##   decoration_sprites: Array[Sprite3D]   # spawned decoration billboards
##   stairs_sprite: Sprite3D               # the exit marker (null until apply)

const SHEET_COLS := 4
const SHEET_ROWS := 4
const FLOOR_TILE_INDEX := 0       # rows 0..1: floor tiles
const WALL_TILE_INDEX := 8        # row 2: wall side tiles
const WALL_TOP_TILE_INDEX := 12   # row 3: wall top tiles
const FLOOR_TILE_COUNT := 8
const WALL_TILE_COUNT := 4
const WALL_TOP_TILE_COUNT := 4
const DUNGEON_TILE_SHEET := "dungeon-floor-wall-tiles.png"
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
const CAMPFIRE_SCENE := "res://assets/Props/Meshy_AI_Pixel_Campfire_0621211147_texture.glb"
const CAMPFIRE_TARGET_H := 92.0
const CAMPFIRE_GLOW_SIZE := 360.0
const CAMPFIRE_GLOW_Y := 6.0
const CAMPFIRE_LIGHT_Y := 72.0
const CAMPFIRE_FLAME_Y := 58.0
const CAMPFIRE_SMOKE_Y := 105.0
const CAMPFIRE_SPARK_Y := 92.0
const MAX_CAMPFIRES := 4
const CAMPFIRE_MIN_SPACING := 760.0
const ICE_STAIRS_SCENE := "res://assets/Props/IceDungeonStairs.glb"
const ICE_STAIRS_TARGET_FOOTPRINT := 150.0
const ICE_STAIRS_TARGET_H := 125.0
const ICE_STAIRS_SINK := 34.0

# Valid themes (src/shared/types.ts: Theme). Anything else -> flat fallback.
const THEMES := ["fantasy", "cyberpunk", "forest", "pirate", "clockwork", "nightmare", "icedungeon"]

# Per-theme mood palette: `tint` casts the tile albedo, `bg` is the fog/background color the
# unseen edges fade to. Gives each floor a distinct atmosphere instead of uniform grey.
const THEME_PALETTE := {
	"fantasy":   {"tint": Color(1.0, 0.97, 0.90),  "bg": Color(0.05, 0.06, 0.09)},
	"cyberpunk": {"tint": Color(0.80, 0.95, 1.15),  "bg": Color(0.03, 0.05, 0.10)},
	"forest":    {"tint": Color(0.85, 1.07, 0.85),  "bg": Color(0.03, 0.07, 0.045)},
	"pirate":    {"tint": Color(1.12, 1.0, 0.82),   "bg": Color(0.05, 0.06, 0.06)},
	"clockwork": {"tint": Color(1.14, 1.0, 0.76),   "bg": Color(0.07, 0.055, 0.035)},
	"nightmare": {"tint": Color(1.05, 0.78, 1.06),  "bg": Color(0.07, 0.03, 0.08)},
	"icedungeon": {"tint": Color(0.84, 0.95, 1.16), "bg": Color(0.03, 0.06, 0.10)},
}

@export var tiles_dir := "res://assets/Tiles"
@export var props_dir := "res://assets/Props"

## The World whose ground/wall materials we retexture. Set by Main before apply().
var world: World

var decoration_sprites: Array[Sprite3D] = []
var stairs_sprite: Sprite3D
var stairs_node: Node3D
# Atmosphere props (torch glow pools + flame billboards + floor decals). Fog-culled by Main like
# decorations, but NOT destructible props (skipped by set_live_props). Glow pools flicker.
var atmo_sprites: Array[Node3D] = []
var _glow_quads: Array[Node3D] = []  # subset of atmo_sprites that flicker
var _campfire_glows: Array[MeshInstance3D] = []
var _campfire_lights: Array[OmniLight3D] = []
var _campfire_flames: Array[Sprite3D] = []
var _campfire_auras: Array[Sprite3D] = []
var _campfire_smoke: Array[Sprite3D] = []
var _campfire_sparks: Array[Sprite3D] = []
var _hazard_nodes: Array[Node3D] = []
var _portal_nodes: Array[Node3D] = []
var _flicker := 0.0
static var _glow_tex: Texture2D
static var _decal_tex: Texture2D
static var _campfire_glow_tex: Texture2D
static var _campfire_flame_tex: Texture2D
static var _campfire_smoke_tex: Texture2D
static var _campfire_spark_tex: Texture2D
static var _campfire_scene: PackedScene
static var _ice_stairs_hole_tex: Texture2D
static var _ice_stairs_scene: PackedScene

# theme -> { "floor": Texture2D, "wall": Texture2D } where each texture carries
# metadata telling the fog shader which half of the 4x4 sheet to randomize across.
var _tile_cache: Dictionary = {}
# theme -> Array[AtlasTexture] (length PROP_COUNT)
var _prop_cache: Dictionary = {}
# raw sheet path -> Texture2D (parsed once)
var _sheet_cache: Dictionary = {}
var _hazard_wall_tex: Texture2D

var _stairs_pulse := 0.0
var _stairs_tex_h := 64.0  # cached stairs texture height, for the pulse pixel_size
var _stairs_base := Color.WHITE  # base tint (white for art, green for the fallback)
var _theme := ""  # saved by apply() so show_stairs() can use it


func _process(dt: float) -> void:
	_flicker += dt
	# Torch flicker: gently wobble each glow pool's brightness so torches feel alive.
	if not _glow_quads.is_empty():
		for i in _glow_quads.size():
			var q := _glow_quads[i]
			if not is_instance_valid(q) or not q.visible:
				continue
			var phase := float(i) * 1.7
			var f := 0.78 + 0.22 * sin(_flicker * 7.0 + phase) * (0.6 + 0.4 * sin(_flicker * 17.0 + phase))
			(q as GeometryInstance3D).transparency = clampf(1.0 - f, 0.0, 0.6)
	if not _campfire_glows.is_empty():
		for i in _campfire_glows.size():
			var glow := _campfire_glows[i]
			if not is_instance_valid(glow) or not glow.visible:
				continue
			var phase := float(i) * 2.31
			var breath := 1.0 + 0.055 * sin(_flicker * 4.8 + phase) + 0.025 * sin(_flicker * 11.0 + phase)
			glow.scale = Vector3(breath, breath, 1.0)
			glow.rotate_y(dt * (0.12 + 0.05 * float(i)))
			glow.transparency = clampf(0.58 + 0.12 * sin(_flicker * 7.5 + phase), 0.42, 0.78)
		for i in _campfire_lights.size():
			var light := _campfire_lights[i]
			if not is_instance_valid(light):
				continue
			light.light_energy = 0.82 + 0.18 * sin(_flicker * 8.0 + float(i))
	if not _campfire_flames.is_empty():
		_update_campfire_flames()
	if not _campfire_auras.is_empty():
		_update_campfire_auras()
	if not _campfire_smoke.is_empty():
		_update_campfire_smoke()
	if not _campfire_sparks.is_empty():
		_update_campfire_sparks()
	if not _hazard_nodes.is_empty():
		_update_hazards()
	if not _portal_nodes.is_empty():
		_update_portals(dt)
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
func apply(theme: String, decorations: Array, stairs: Dictionary, hazards: Array = [], portals: Array = []) -> void:
	_theme = theme
	clear()
	if not THEMES.has(theme):
		# Unknown theme: leave World on its flat fallback colours, no props.
		push_warning("WorldDecor: unknown theme '%s' — using flat fallback" % theme)
		return

	# 1) Ground + wall tiles (render.ts applyTileTheme) + per-theme color/mood palette.
	var tiles := _load_tiles(theme)
	_hazard_wall_tex = tiles.get("wall")
	if world != null:
		world.set_ground_texture(tiles.get("floor"))
		world.set_wall_texture(tiles.get("wall"))
		world.set_wall_model_theme(theme)
		var pal: Dictionary = THEME_PALETTE.get(theme, {"tint": Color.WHITE, "bg": Color(0.043, 0.055, 0.078)})
		world.set_theme_palette(pal["tint"], pal["bg"])

	# 2) Prop sheet (render.ts applyPropTheme / loadPropTextures).
	var props := _load_props(theme)

	# 3) Stairs marker — prop index 0 (render.ts setStairs uses textures[0]).
	if not stairs.is_empty():
		var sx := float(stairs.get("x", 0.0))
		var sy := float(stairs.get("y", 0.0))
		if theme == "icedungeon":
			_place_ice_stairs(sx, sy)
		else:
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
	_place_hazards(hazards)
	_place_portals(portals)

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
	_campfire_glows.clear()
	_campfire_lights.clear()
	_campfire_flames.clear()
	_campfire_auras.clear()
	_campfire_smoke.clear()
	_campfire_sparks.clear()
	for h in _hazard_nodes:
		if is_instance_valid(h):
			h.queue_free()
	_hazard_nodes.clear()
	for p in _portal_nodes:
		if is_instance_valid(p):
			p.queue_free()
	_portal_nodes.clear()
	if is_instance_valid(stairs_sprite):
		stairs_sprite.queue_free()
	stairs_sprite = null
	if is_instance_valid(stairs_node):
		stairs_node.queue_free()
	stairs_node = null
	_stairs_pulse = 0.0


## Show the exit staircase without clearing decorations. Called when the boss dies
## and exitOpen flips to true after the initial floor was built without stairs.
func show_stairs(stairs: Dictionary) -> void:
	if stairs.is_empty() or not THEMES.has(_theme):
		return
	# Ice dungeon uses a 3D scene; other themes use the billboard sprite.
	if _theme == "icedungeon":
		if _ice_stairs_scene != null or ResourceLoader.exists(ICE_STAIRS_SCENE):
			var sx := float(stairs.get("x", 0.0))
			var sy := float(stairs.get("y", 0.0))
			_place_ice_stairs(sx, sy)
	else:
		if stairs_sprite != null:
			return  # Already placed.
		var props := _load_props(_theme)
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


# --- portals ---------------------------------------------------------------

func _place_portals(portals: Array) -> void:
	for p in portals:
		if typeof(p) != TYPE_DICTIONARY:
			continue
		var portal: Dictionary = p
		var x := float(portal.get("x", 0.0))
		var y := float(portal.get("y", 0.0))
		var r := float(portal.get("r", 64.0))
		var color := Color(0.22, 0.74, 0.98, 0.72)
		var core := Color(0.55, 0.91, 1.0, 0.72)
		var node := Node3D.new()
		node.position = Vector3(x, _gh(x, y), y)
		node.set_meta("dcc_portal_hue", float(portal.get("hue", 0.0)))
		add_child(node)
		_portal_nodes.append(node)
		var disk := _cylinder_mesh(r * 0.82, 4.0, Color(core.r, core.g, core.b, 0.24))
		disk.position = Vector3(0.0, 6.0, 0.0)
		node.add_child(disk)
		var ring := _cylinder_mesh(r, 5.0, color)
		ring.position = Vector3(0.0, 9.0, 0.0)
		node.add_child(ring)
		var pillar := _cylinder_mesh(r * 0.28, 110.0, Color(core.r, core.g, core.b, 0.34))
		pillar.position = Vector3(0.0, 55.0, 0.0)
		node.add_child(pillar)

func _update_portals(dt: float) -> void:
	var now := float(Time.get_ticks_msec())
	for node in _portal_nodes:
		if not is_instance_valid(node):
			continue
		node.rotate_y(dt * 1.8)
		var hue := float(node.get_meta("dcc_portal_hue", 0.0))
		var pulse := 0.5 + 0.5 * sin(now / 260.0 + hue * TAU)
		for child in node.get_children():
			if child is GeometryInstance3D:
				(child as GeometryInstance3D).transparency = 0.12 + 0.42 * (1.0 - pulse)


# --- hazards ---------------------------------------------------------------

func _place_hazards(hazards: Array) -> void:
	for h in hazards:
		if typeof(h) != TYPE_DICTIONARY:
			continue
		var hz: Dictionary = h
		var kind := str(hz.get("kind", ""))
		var color := Color(0.85, 0.84, 0.78, 0.9)
		if kind == "lava_pit" or kind == "flame_turret":
			color = Color(1.0, 0.32, 0.08, 0.78)
		elif kind == "acid_pit":
			color = Color(0.45, 1.0, 0.27, 0.78)
		elif kind == "wall_crusher":
			color = Color(0.6, 0.64, 0.68, 0.95)
		var node := Node3D.new()
		node.set_meta("dcc_hazard", hz)
		add_child(node)
		_hazard_nodes.append(node)
		var x := float(hz.get("x", 0.0))
		var y := float(hz.get("y", 0.0))
		var gh := _gh(x, y)
		if kind == "lava_pit" or kind == "acid_pit":
			var disk := _cylinder_mesh(float(hz.get("r", 80.0)), 4.0, color)
			disk.position = Vector3(x, gh + 3.0, y)
			node.add_child(disk)
			var rim := _cylinder_mesh(float(hz.get("r", 80.0)) * 1.04, 3.0, Color(0.03, 0.025, 0.02, 0.45))
			rim.position = Vector3(x, gh + 2.0, y)
			node.add_child(rim)
		elif kind == "floor_spikes":
			var count := 8
			for i in count:
				var a := (float(i) / float(count)) * TAU
				var rr := 0.0 if i == 0 else float(hz.get("r", 80.0)) * 0.42
				var spike := _cone_mesh(13.0, 42.0, color)
				spike.position = Vector3(x + cos(a) * rr, gh + 21.0, y + sin(a) * rr)
				spike.rotate_y(PI * 0.25)
				node.add_child(spike)
		elif kind == "wall_crusher":
			var dir := int(hz.get("dir", 0))
			var length := float(hz.get("length", hz.get("r", 160.0)))
			var width := float(hz.get("width", hz.get("r", 90.0)))
			var warn_size := Vector3(width, 5.0, length) if dir == 0 else Vector3(length, 5.0, width)
			var warning := _box_mesh(warn_size, Color(1.0, 0.82, 0.3, 0.22))
			warning.position = Vector3(x, gh + 5.0, y)
			node.add_child(warning)
			var plate_size := Vector3(28.0, 88.0, length) if dir == 0 else Vector3(length, 88.0, 28.0)
			for side in [-1, 1]:
				var plate := _box_mesh(plate_size, color, _hazard_wall_tex)
				plate.set_meta("dcc_crusher_side", side)
				plate.position = Vector3(x + (float(side) * width * 0.5 if dir == 0 else 0.0), gh + 44.0, y + (float(side) * width * 0.5 if dir == 1 else 0.0))
				node.add_child(plate)
		else:
			var dir := int(hz.get("dir", 0))
			var angle := 0.0
			if dir == 1:
				angle = PI * 0.5
			elif dir == 2:
				angle = PI
			elif dir == 3:
				angle = -PI * 0.5
			var length := float(hz.get("length", hz.get("r", 120.0)))
			var width := float(hz.get("width", hz.get("r", 80.0)))
			var beam := _box_mesh(Vector3(length, 10.0, width), color)
			beam.rotation.y = angle
			beam.position = Vector3(x + cos(angle) * length * 0.5, gh + 8.0, y + sin(angle) * length * 0.5)
			node.add_child(beam)
			var turret := _cylinder_mesh(26.0, 36.0, Color(0.18, 0.16, 0.14, 1.0))
			turret.position = Vector3(x, gh + 24.0, y)
			node.add_child(turret)

func _update_hazards() -> void:
	var now := float(Time.get_ticks_msec())
	for node in _hazard_nodes:
		if not is_instance_valid(node):
			continue
		var hz: Dictionary = node.get_meta("dcc_hazard", {})
		var active := _hazard_active(hz, now)
		var pulse := 0.75 + 0.25 * sin(now / 110.0 + float(hz.get("phaseMs", 0.0)))
		for child in node.get_children():
			if child is GeometryInstance3D:
				var gi := child as GeometryInstance3D
				if str(hz.get("kind", "")) == "wall_crusher" and gi.has_meta("dcc_crusher_side"):
					var width := float(hz.get("width", hz.get("r", 90.0)))
					var d := 16.0 if active else width * 0.5
					var side := float(int(gi.get_meta("dcc_crusher_side", 1)))
					if int(hz.get("dir", 0)) == 0:
						gi.position.x = float(hz.get("x", 0.0)) + side * d
					else:
						gi.position.z = float(hz.get("y", 0.0)) + side * d
				gi.transparency = 0.0 if active else 0.68
				if str(hz.get("kind", "")) == "floor_spikes":
					gi.position.y = (21.0 + _gh(gi.position.x, gi.position.z)) if active else (8.0 + _gh(gi.position.x, gi.position.z))
				else:
					gi.scale = Vector3.ONE * (0.95 + 0.05 * pulse if active else 1.0)

func _hazard_active(hz: Dictionary, now: float) -> bool:
	var period := float(hz.get("periodMs", 0.0))
	var active := float(hz.get("activeMs", 0.0))
	if period <= 0.0 or active <= 0.0:
		return true
	return fmod(now + float(hz.get("phaseMs", 0.0)), period) < active

func _hazard_mat(color: Color, tex: Texture2D = null) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color.WHITE if tex != null else color
	mat.albedo_texture = tex
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD if color.a < 0.85 else BaseMaterial3D.BLEND_MODE_MIX
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	return mat

func _cylinder_mesh(radius: float, height: float, color: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 32
	mesh.material = _hazard_mat(color)
	mi.mesh = mesh
	return mi

func _cone_mesh(radius: float, height: float, color: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.0
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 4
	mesh.material = _hazard_mat(color)
	mi.mesh = mesh
	return mi

func _box_mesh(size: Vector3, color: Color, tex: Texture2D = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh.material = _hazard_mat(color, tex)
	mi.mesh = mesh
	return mi


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
	_place_campfire()

func _place_campfire() -> void:
	var scene := _load_campfire_scene()
	if scene == null or world == null or world.grid.is_empty():
		return
	for pos in _campfire_spots():
		_spawn_campfire(scene, pos)

func _place_ice_stairs(x: float, y: float) -> void:
	if world == null or world.grid.is_empty():
		return
	var grid: Dictionary = world.grid
	var cell: float = grid["cell"]
	var gh := _gh(x, y)
	var normal := _ground_normal(x, y)
	var pos := Vector2(x, y)

	var hole := _floor_quad(_ice_stairs_hole_texture(), x, gh + 1.5, y, cell * 2.0, Color(0.68, 0.9, 1.0, 1.0), false, normal)
	hole.name = "IceDungeonStairsHole"
	hole.set_meta("dcc_world", pos)
	atmo_sprites.append(hole)

	var scene := _load_ice_stairs_scene()
	if scene == null:
		return
	var holder := Node3D.new()
	holder.name = "IceDungeonStairs"
	holder.position = Vector3(x, gh - ICE_STAIRS_SINK, y)
	holder.set_meta("dcc_world", pos)
	add_child(holder)
	atmo_sprites.append(holder)
	stairs_node = holder

	var model := scene.instantiate() as Node3D
	if model == null:
		holder.queue_free()
		atmo_sprites.erase(holder)
		return
	holder.add_child(model)
	var bounds := _visual_aabb(model)
	var max_footprint := maxf(bounds.size.x, bounds.size.z)
	var model_scale := 1.0
	if max_footprint > 0.001:
		model_scale = ICE_STAIRS_TARGET_FOOTPRINT / max_footprint
	if bounds.size.y > 0.001:
		model_scale = minf(model_scale, ICE_STAIRS_TARGET_H / bounds.size.y)
	model_scale = clampf(model_scale, 0.01, 80.0)
	model.scale = Vector3.ONE * model_scale
	model.position = Vector3(
		-(bounds.position.x + bounds.size.x * 0.5) * model_scale,
		-bounds.position.y * model_scale,
		-(bounds.position.z + bounds.size.z * 0.5) * model_scale
	)

func _spawn_campfire(scene: PackedScene, pos: Vector2) -> void:
	var gh := _gh(pos.x, pos.y)
	var normal := _ground_normal(pos.x, pos.y)
	var holder := Node3D.new()
	holder.name = "Campfire"
	holder.position = Vector3(pos.x, gh, pos.y)
	holder.rotate_y(_hash01(int(pos.x), int(pos.y)) * TAU)
	holder.set_meta("dcc_world", pos)
	add_child(holder)
	atmo_sprites.append(holder)

	var model := scene.instantiate() as Node3D
	if model == null:
		holder.queue_free()
		atmo_sprites.erase(holder)
		return
	holder.add_child(model)
	_tune_campfire_materials(model)
	var bounds := _visual_aabb(model)
	var model_scale := 1.0
	if bounds.size.y > 0.001:
		model_scale = clampf(CAMPFIRE_TARGET_H / bounds.size.y, 0.02, 80.0)
	model.scale = Vector3.ONE * model_scale
	model.position.y = -bounds.position.y * model_scale
	_add_campfire_fx(holder, pos)

	var glow := _floor_quad(_campfire_glow_texture(), pos.x, CAMPFIRE_GLOW_Y + gh, pos.y, CAMPFIRE_GLOW_SIZE, Color(1.0, 0.72, 0.42, 0.34), true, normal)
	glow.set_meta("dcc_world", pos)
	glow.set_meta("dcc_campfire_glow", true)
	atmo_sprites.append(glow)
	_campfire_glows.append(glow)
	var core := _floor_quad(_glow_texture(), pos.x, CAMPFIRE_GLOW_Y + gh + 1.0, pos.y, CAMPFIRE_GLOW_SIZE * 0.5, Color(1.18, 0.9, 0.56, 0.26), true, normal)
	core.set_meta("dcc_world", pos)
	atmo_sprites.append(core)
	_campfire_glows.append(core)

	var light := OmniLight3D.new()
	light.name = "CampfireLight"
	light.light_color = Color(1.0, 0.74, 0.46)
	light.light_energy = 0.82
	light.omni_range = 360.0
	light.shadow_enabled = false
	light.position = Vector3(0.0, CAMPFIRE_LIGHT_Y, 0.0)
	holder.add_child(light)
	_campfire_lights.append(light)

func _add_campfire_fx(holder: Node3D, world_pos: Vector2) -> void:
	for i in 3:
		var aura := _make_local_billboard(_glow_texture(), Vector3(0.0, CAMPFIRE_FLAME_Y - 2.0 + float(i) * 4.0, 0.0), (92.0 - float(i) * 15.0) * 1.5, Color(1.0, 0.22 + float(i) * 0.13, 0.08, 0.27))
		aura.name = "CampfireAura"
		aura.render_priority = 1
		aura.set_meta("dcc_phase", float(i) * 1.91)
		aura.set_meta("dcc_base_size", aura.pixel_size)
		aura.set_meta("dcc_world", world_pos)
		holder.add_child(aura)
		_campfire_auras.append(aura)
	for i in 6:
		var phase := float(i) * 1.37
		var flame := _make_local_billboard(_campfire_flame_texture(), Vector3((float(i) - 2.5) * 5.8, CAMPFIRE_FLAME_Y + float(i % 2) * 5.0, 0.0), (54.0 - float(i) * 3.2) * 1.5, Color(1.0, 0.68 - float(i) * 0.035, 0.26, 0.9))
		flame.name = "CampfireFlame"
		flame.set_meta("dcc_phase", phase)
		flame.set_meta("dcc_base_y", flame.position.y)
		flame.set_meta("dcc_base_size", flame.pixel_size)
		flame.set_meta("dcc_world", world_pos)
		holder.add_child(flame)
		_campfire_flames.append(flame)
	for i in 8:
		var phase := _hash01(i * 17 + int(world_pos.x), i * 43 + int(world_pos.y))
		var smoke := _make_local_billboard(_campfire_smoke_texture(), Vector3(randf_range(-12.0, 12.0), CAMPFIRE_SMOKE_Y + phase * 54.0, randf_range(-10.0, 10.0)), (62.0 + phase * 28.0) * 1.5, Color(0.34, 0.32, 0.29, 0.42))
		smoke.name = "CampfireSmoke"
		smoke.set_meta("dcc_phase", phase)
		smoke.set_meta("dcc_world", world_pos)
		holder.add_child(smoke)
		_campfire_smoke.append(smoke)
	for i in 15:
		var phase := _hash01(i * 31 + int(world_pos.x), i * 59 + int(world_pos.y))
		var spark := _make_local_billboard(_campfire_spark_texture(), Vector3(randf_range(-7.0, 7.0), CAMPFIRE_SPARK_Y + phase * 80.0, randf_range(-7.0, 7.0)), 12.0, Color(1.0, 0.78, 0.36, 0.0))
		spark.name = "CampfireSpark"
		spark.set_meta("dcc_phase", phase)
		spark.set_meta("dcc_world", world_pos)
		holder.add_child(spark)
		_campfire_sparks.append(spark)

func _make_local_billboard(tex: Texture2D, pos: Vector3, size_px: float, color: Color) -> Sprite3D:
	var sprite := Sprite3D.new()
	sprite.texture = tex
	sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	sprite.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	sprite.shaded = false
	sprite.transparent = true
	sprite.no_depth_test = false
	sprite.render_priority = 2
	var tex_h := 64.0
	if tex != null and tex.get_height() > 0:
		tex_h = float(tex.get_height())
	sprite.pixel_size = size_px / tex_h
	sprite.position = pos
	sprite.modulate = color
	return sprite

func _update_campfire_flames() -> void:
	for i in _campfire_flames.size():
		var flame := _campfire_flames[i]
		if not is_instance_valid(flame):
			continue
		var phase := float(flame.get_meta("dcc_phase", 0.0))
		var base_y := float(flame.get_meta("dcc_base_y", flame.position.y))
		var base_size := float(flame.get_meta("dcc_base_size", flame.pixel_size))
		var lick := 0.5 + 0.5 * sin(_flicker * 12.0 + phase)
		var flutter := sin(_flicker * 19.0 + phase * 2.0)
		flame.pixel_size = base_size * (0.82 + 0.28 * lick)
		flame.position.x = sin(_flicker * 5.8 + phase) * (4.0 + float(i))
		flame.position.y = base_y + lick * 13.0
		flame.rotation.z = flutter * 0.09
		flame.modulate.a = 0.68 + 0.28 * lick

func _update_campfire_auras() -> void:
	for i in _campfire_auras.size():
		var aura := _campfire_auras[i]
		if not is_instance_valid(aura):
			continue
		var phase := float(aura.get_meta("dcc_phase", 0.0))
		var base_size := float(aura.get_meta("dcc_base_size", aura.pixel_size))
		var pulse := 0.5 + 0.5 * sin(_flicker * 7.2 + phase)
		aura.pixel_size = base_size * (0.84 + 0.2 * pulse)
		aura.position.x = sin(_flicker * 3.8 + phase) * 3.5
		aura.position.y = CAMPFIRE_FLAME_Y - 2.0 + float(i) * 4.0 + pulse * 4.0
		aura.modulate.a = 0.18 + 0.15 * pulse

func _update_campfire_smoke() -> void:
	for i in _campfire_smoke.size():
		var smoke := _campfire_smoke[i]
		if not is_instance_valid(smoke):
			continue
		var seed := float(smoke.get_meta("dcc_phase", 0.0))
		var t := fmod(_flicker * 0.18 + seed, 1.0)
		var drift := sin(_flicker * 1.4 + seed * TAU)
		smoke.position.x = drift * (12.0 + 34.0 * t)
		smoke.position.z = cos(_flicker * 1.1 + seed * TAU) * (8.0 + 18.0 * t)
		smoke.position.y = CAMPFIRE_SMOKE_Y + t * 150.0
		smoke.pixel_size = ((58.0 + t * 58.0) * 1.5) / 64.0
		smoke.rotation.z += 0.006 + seed * 0.004
		smoke.modulate.a = 0.405 * sin(t * PI)

func _update_campfire_sparks() -> void:
	for i in _campfire_sparks.size():
		var spark := _campfire_sparks[i]
		if not is_instance_valid(spark):
			continue
		var seed := float(spark.get_meta("dcc_phase", 0.0))
		var t := fmod(_flicker * (0.55 + seed * 0.35) + seed, 1.0)
		var angle := seed * TAU + sin(_flicker * 2.0 + seed) * 0.4
		var radius := 8.0 + t * 44.0
		spark.position.x = cos(angle) * radius
		spark.position.z = sin(angle) * radius
		spark.position.y = CAMPFIRE_SPARK_Y + t * 125.0
		spark.pixel_size = lerpf(13.5, 3.75, t) / 64.0
		spark.modulate.a = minf(1.0, 1.08 * sin(t * PI))

func _campfire_spots() -> Array[Vector2]:
	var grid: Dictionary = world.grid
	var w: int = grid["w"]
	var h: int = grid["h"]
	var cell: float = grid["cell"]
	var solid: PackedByteArray = grid["solid"]
	var candidates: Array = []
	for cy in range(2, h - 2):
		for cx in range(2, w - 2):
			var i := cy * w + cx
			if solid[i] != 0:
				continue
			if solid[i - 1] != 0 or solid[i + 1] != 0 or solid[i - w] != 0 or solid[i + w] != 0:
				continue
			var noise := _hash01(cx + 131, cy + 719) * 3.5
			var open_bonus := 0.0
			for oy in range(-2, 3):
				for ox in range(-2, 3):
					if ox == 0 and oy == 0:
						continue
					var ni := (cy + oy) * w + (cx + ox)
					if solid[ni] == 0:
						open_bonus += 0.08
			candidates.append({
				"pos": Vector2((float(cx) + 0.5) * cell, (float(cy) + 0.5) * cell),
				"cell": Vector2(float(cx), float(cy)),
				"score": noise + open_bonus,
			})

	var chosen: Array[Vector2] = []
	var min_spacing_sq := CAMPFIRE_MIN_SPACING * CAMPFIRE_MIN_SPACING
	var anchors := [
		Vector2(float(w) * 0.22, float(h) * 0.22),
		Vector2(float(w) * 0.78, float(h) * 0.22),
		Vector2(float(w) * 0.22, float(h) * 0.78),
		Vector2(float(w) * 0.78, float(h) * 0.78),
	]
	for anchor in anchors:
		var best := {}
		var best_score := -INF
		for c in candidates:
			var pos: Vector2 = c["pos"]
			var too_close := false
			for existing in chosen:
				if pos.distance_squared_to(existing) < min_spacing_sq:
					too_close = true
					break
			if too_close:
				continue
			var cell_pos: Vector2 = c["cell"]
			var spread_score := -cell_pos.distance_to(anchor) + float(c["score"]) * 5.0
			if best.is_empty() or spread_score > best_score:
				best = c
				best_score = spread_score
		if not best.is_empty():
			chosen.append(best["pos"])
		if chosen.size() >= MAX_CAMPFIRES:
			return chosen

	candidates.sort_custom(func(a, b): return float(a["score"]) > float(b["score"]))
	for c in candidates:
		var pos: Vector2 = c["pos"]
		var too_close := false
		for existing in chosen:
			if pos.distance_squared_to(existing) < min_spacing_sq:
				too_close = true
				break
		if too_close:
			continue
		chosen.append(pos)
		if chosen.size() >= MAX_CAMPFIRES:
			break
	return chosen

func _load_campfire_scene() -> PackedScene:
	if _campfire_scene != null:
		return _campfire_scene
	if not ResourceLoader.exists(CAMPFIRE_SCENE):
		push_warning("WorldDecor: campfire scene missing: %s" % CAMPFIRE_SCENE)
		return null
	_campfire_scene = load(CAMPFIRE_SCENE) as PackedScene
	return _campfire_scene

func _load_ice_stairs_scene() -> PackedScene:
	if _ice_stairs_scene != null:
		return _ice_stairs_scene
	var loaded := load(ICE_STAIRS_SCENE)
	if not (loaded is PackedScene):
		push_warning("WorldDecor: ice dungeon stairs scene missing: %s" % ICE_STAIRS_SCENE)
		return null
	_ice_stairs_scene = loaded as PackedScene
	return _ice_stairs_scene

func _tune_campfire_materials(root: Node3D) -> void:
	for child in root.get_children():
		if child is Node3D:
			_tune_campfire_materials(child)
	if not (root is MeshInstance3D):
		return
	var mi := root as MeshInstance3D
	if mi.mesh == null:
		return
	for surface in mi.mesh.get_surface_count():
		var mat := mi.get_surface_override_material(surface)
		if mat == null:
			mat = mi.mesh.surface_get_material(surface)
		var tuned := _campfire_rock_material(mat)
		if tuned != null:
			mi.set_surface_override_material(surface, tuned)

func _campfire_rock_material(mat: Material) -> Material:
	if mat == null or not (mat is BaseMaterial3D):
		return null
	var base := mat as BaseMaterial3D
	var nm := mat.resource_name.to_lower()
	var c := base.albedo_color
	var maxc := maxf(c.r, maxf(c.g, c.b))
	var minc := minf(c.r, minf(c.g, c.b))
	var sat := maxc - minc
	var named_rock := nm.contains("rock") or nm.contains("stone") or nm.contains("pebble")
	var neutral_rock := sat < 0.18 and c.get_luminance() > 0.16
	if not named_rock and not neutral_rock:
		return null
	var copy := base.duplicate(true) as BaseMaterial3D
	copy.albedo_color = Color(c.r * 0.52, c.g * 0.52, c.b * 0.52, c.a)
	return copy

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

static func _ice_stairs_hole_texture() -> Texture2D:
	if _ice_stairs_hole_tex != null:
		return _ice_stairs_hole_tex
	var n := 96
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var c := (n - 1) * 0.5
	for y in n:
		for x in n:
			var uv := Vector2((float(x) - c) / c, (float(y) - c) / c)
			var edge := maxf(absf(uv.x), absf(uv.y))
			var frost := smoothstep(0.68, 1.0, edge)
			var crack := 0.5 + 0.5 * sin(float(x) * 0.41 + float(y) * 0.17)
			var core := Color(0.012, 0.022, 0.04, 1.0)
			var rim := Color(0.40 + 0.12 * crack, 0.70 + 0.10 * crack, 0.95, 1.0)
			img.set_pixel(x, y, core.lerp(rim, frost))
	_ice_stairs_hole_tex = ImageTexture.create_from_image(img)
	return _ice_stairs_hole_tex

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

## Uneven amber pool for the 3D campfire. The alpha edge is intentionally wavy; _process()
## rotates and breathes the quad so the circle feels like firelight licking across the floor.
static func _campfire_glow_texture() -> Texture2D:
	if _campfire_glow_tex != null:
		return _campfire_glow_tex
	var n := 96
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var c := (n - 1) * 0.5
	for y in n:
		for x in n:
			var px := float(x) - c
			var py := float(y) - c
			var r := Vector2(px, py).length() / c
			var a := atan2(py, px)
			var wave := 0.045 * sin(a * 7.0) + 0.026 * sin(a * 13.0 + 0.8) + 0.018 * cos(a * 19.0)
			var edge := 0.88 + wave
			var alpha := clampf((edge - r) / 0.36, 0.0, 1.0)
			alpha = pow(alpha, 1.65)
			var warm := 0.78 + 0.22 * clampf(1.0 - r, 0.0, 1.0)
			img.set_pixel(x, y, Color(1.0, warm, 0.62, alpha))
	_campfire_glow_tex = ImageTexture.create_from_image(img)
	return _campfire_glow_tex

static func _campfire_flame_texture() -> Texture2D:
	if _campfire_flame_tex != null:
		return _campfire_flame_tex
	var w := 48
	var h := 80
	var img := Image.create(w, h, false, Image.FORMAT_RGBA8)
	var cx := float(w - 1) * 0.5
	for y in h:
		for x in w:
			var nx := (float(x) - cx) / cx
			var ny := float(y) / float(h - 1)
			var width := lerpf(0.72, 0.08, ny)
			var lean := 0.16 * sin(ny * PI * 2.2)
			var d := absf(nx - lean) / maxf(width, 0.01)
			var body := clampf(1.0 - d, 0.0, 1.0) * clampf((1.0 - ny) * 1.25, 0.0, 1.0)
			var tip := clampf((ny - 0.18) / 0.82, 0.0, 1.0)
			var alpha := pow(body, 1.7) * (0.35 + 0.65 * tip)
			var heat := clampf(1.0 - d * 0.8, 0.0, 1.0)
			img.set_pixel(x, h - 1 - y, Color(1.0, 0.58 + 0.32 * heat, 0.16 + 0.28 * heat, alpha))
	_campfire_flame_tex = ImageTexture.create_from_image(img)
	return _campfire_flame_tex

static func _campfire_smoke_texture() -> Texture2D:
	if _campfire_smoke_tex != null:
		return _campfire_smoke_tex
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var c := float(n - 1) * 0.5
	for y in n:
		for x in n:
			var p := Vector2(float(x) - c, float(y) - c) / c
			var r := p.length()
			var wob := 0.08 * sin(float(x) * 0.42) + 0.06 * cos(float(y) * 0.37)
			var a := clampf(1.0 - (r + wob) * 1.18, 0.0, 1.0)
			a = pow(a, 1.8) * 0.52
			img.set_pixel(x, y, Color(1.0, 1.0, 1.0, a))
	_campfire_smoke_tex = ImageTexture.create_from_image(img)
	return _campfire_smoke_tex

static func _campfire_spark_texture() -> Texture2D:
	if _campfire_spark_tex != null:
		return _campfire_spark_tex
	var n := 16
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	var c := float(n - 1) * 0.5
	for y in n:
		for x in n:
			var r := Vector2(float(x) - c, float(y) - c).length() / c
			var a := pow(clampf(1.0 - r, 0.0, 1.0), 2.2)
			img.set_pixel(x, y, Color(1.0, 0.88, 0.42, a))
	_campfire_spark_tex = ImageTexture.create_from_image(img)
	return _campfire_spark_tex

## Deterministic 0..1 hash for stable placement.
func _hash01(x: int, y: int) -> float:
	var v := float(int(sin(float(x) * 127.1 + float(y) * 311.7) * 43758.5453) % 10000) / 10000.0
	return absf(v)


## Load (and cache) the floor + wall AtlasTextures for a theme.
func _load_tiles(theme: String) -> Dictionary:
	if _tile_cache.has(theme):
		return _tile_cache[theme]
	var sheet := _load_sheet(_tile_sheet_path(theme))
	var result := {"floor": null, "wall": null}
	if sheet != null:
		result["floor"] = _tile_sheet_texture(sheet, 0, FLOOR_TILE_COUNT)
		result["wall"] = _tile_sheet_texture(sheet, WALL_TILE_INDEX, WALL_TILE_COUNT, WALL_TOP_TILE_INDEX, WALL_TOP_TILE_COUNT)
	_tile_cache[theme] = result
	return result

func _tile_sheet_path(theme: String) -> String:
	return "%s/%s-tiles.png" % [tiles_dir, theme]


## Load (and cache) the 16 prop AtlasTextures for a theme.
func _load_props(theme: String) -> Array:
	if _prop_cache.has(theme):
		return _prop_cache[theme]
	var sheet := _load_sheet("%s/%s-props.png" % [props_dir, theme])
	if sheet == null and theme == "icedungeon":
		sheet = _load_sheet("%s/nightmare-props.png" % [props_dir])
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

func _tile_sheet_texture(sheet: Texture2D, tile_start: int, tile_count: int, top_tile_start: int = -1, top_tile_count: int = -1) -> Texture2D:
	var tex: Texture2D
	var img := sheet.get_image()
	if img != null and not img.is_empty():
		tex = ImageTexture.create_from_image(img)
	else:
		# CompressedTexture2D.get_image() returns null at runtime; duplicate() gives a
		# separate resource instance so floor and wall can carry independent tile-range
		# metadata without overwriting each other.
		tex = sheet.duplicate() as Texture2D
	tex.set_meta("dcc_tile_sheet", true)
	tex.set_meta("dcc_tile_start", tile_start)
	tex.set_meta("dcc_tile_count", tile_count)
	tex.set_meta("dcc_top_tile_start", tile_start if top_tile_start < 0 else top_tile_start)
	tex.set_meta("dcc_top_tile_count", tile_count if top_tile_count < 0 else top_tile_count)
	return tex

## One 4x4 sheet cell baked into its own texture. ShaderMaterial sampling does not honour
## AtlasTexture regions reliably, so floor/wall materials receive cropped textures.
func _tile_texture_from_sheet(sheet: Texture2D, tile_index: int) -> Texture2D:
	var img := sheet.get_image()
	if img == null or img.is_empty():
		return _tile_from_sheet(sheet, tile_index)
	var tile_w := int(img.get_width() / SHEET_COLS)
	var tile_h := int(img.get_height() / SHEET_ROWS)
	var col := tile_index % SHEET_COLS
	var row := tile_index / SHEET_COLS
	var region := img.get_region(Rect2i(col * tile_w, row * tile_h, tile_w, tile_h))
	return ImageTexture.create_from_image(region)


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
