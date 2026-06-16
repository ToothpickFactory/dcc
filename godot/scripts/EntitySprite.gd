class_name EntitySprite
extends Sprite3D
## One billboard sprite for a single entity (player / monster / boss / proj / lootbag).
## 1:1 port of the per-sprite logic in src/client/render.ts: directional facing with
## hysteresis (DIR_SWITCH_BIAS), idle-faces-by-aim, action one-shots that latch facing,
## per-frame region stepping with the enemy 1.6x slowdown, and the 98/99 bolt sentinels.
##
## Each EntitySprite owns its OWN AtlasTexture (region into a shared, cached spritesheet),
## so stepping its region never disturbs other sprites that share the same clip — this is
## render.ts's per-sprite `texture = clip.texture.clone()` made explicit.
##
## World (x,y) -> Vector3(x, h, y). Horizontal mirroring uses flip_h (render.ts negated the
## texture repeat.x); vertical is NOT flipped because AtlasTexture regions are top-left
## origin (render.ts had to invert Y for THREE's bottom-left UV origin — Godot does not).

# ---- tuning constants, mirrored from render.ts ----
const DIR_SWITCH_BIAS := 1.2
const ENEMY_FRAME_SLOWDOWN := 1.6
const ACTION_FRAME_SPEED := 1.25
const MOVEMENT_HOLD_MS := 150

const HERO_ROOT := "res://assets/Heroes/Kevin"
const BOSS_ROOT := "res://assets/Bosses/Slime"
const ENEMY_ROOTS := ["Goblin", "Ghoul", "Orc", "Skeleton", "Zombie", "Troll"]
const BOSS_BOLT_SPRITE := 99   # src/shared/constants.ts BOSS_BOLT_SPRITE
const MONSTER_BOLT_SPRITE := 98 # MONSTER_BOLT_SPRITE

# Fallback fill colors (render.ts `C` + per-kind). Used when no clip is loaded yet, and as
# the modulate tint for non-animated kinds (proj / lootbag).
const COL_PLAYER := Color8(0x4f, 0x8c, 0xff)
const COL_SELF := Color8(0x5d, 0xd6, 0xff)
const COL_MONSTER := Color8(0xb6, 0x43, 0x3d)
const COL_BOSS := Color8(0x9b, 0x30, 0xff)
const COL_BOSSBOLT := Color8(0xc8, 0x50, 0xff)
const COL_PROJ := Color8(0xff, 0xd3, 0x4d)
const COL_LOOT := Color8(0xff, 0xcc, 0x44)

# ---- identity ----
var ent_id := ""
var kind := ""
var is_self := false

# ---- hit flash (juice): brief overbright/red tint on taking damage ----
const FLASH_MS := 110.0
var _flash_until := 0.0
var _flash_color := Color(2.4, 2.4, 2.4)   # overbright white; red for the local player

# Flash this sprite (called by SpriteLayer on a dmg/death event near/at this entity).
func flash_hit(now_ms: float, hurt: bool = false) -> void:
	_flash_until = now_ms + FLASH_MS
	_flash_color = Color(2.6, 0.7, 0.7) if hurt else Color(2.4, 2.4, 2.4)

# ---- spawn pop (juice): a quick over-shooting scale-in when first seen ----
const SPAWN_MS := 200.0
var _spawn_until := 0.0
var _spawn_mul := 1.0

func spawn(now_ms: float) -> void:
	_spawn_until = now_ms + SPAWN_MS

# ---- facing / movement state (render.ts SpriteState) ----
var _facing_dir := "down"          # "up" | "down" | "right"
var _flip := false                 # mirror horizontally (left-facing)
var _moving_until := 0.0           # ms wall-clock; movement "held" briefly after stop

# ---- current clip / frame stepping ----
var _clip_key := ""                # base_path of the clip currently displayed
var _frame := -1                   # current frame index within the active clip window
var _next_frame_at := 0.0          # ms wall-clock when we advance

# ---- action one-shot (cast/bolt/strike/punch/kick) ----
var _action := ""                  # "" = none; else one of the action names
var _action_facing_dir := "down"   # latched at queue time
var _action_flip := false          # latched at queue time
var _action_frame_start := 0       # first frame to play
var _action_frame_count := 0       # 0 = whole clip
var _action_frame_speed := 1.0
var _action_until := 0.0           # ms wall-clock; action ends (then resume movement clip)

# Each sprite's private region-into-shared-sheet texture.
var _atlas_tex: AtlasTexture
var _atlas_source: Texture2D       # which shared sheet _atlas_tex currently points at

func _ready() -> void:
	billboard = BaseMaterial3D.BILLBOARD_ENABLED
	texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	shaded = false
	transparent = true
	# Sprites are large world-space billboards; render.ts sizes them ~84px. pixel_size
	# maps texture px -> world units. We instead size via explicit scale in SpriteLayer
	# (pixel_size kept 1 so a 128px frame is 128 world-units before scaling).
	pixel_size = 1.0
	double_sided = true
	no_depth_test = false

# Called once right after instantiation by SpriteLayer.
func setup(id: String, k: String, self_flag: bool) -> void:
	ent_id = id
	kind = k
	is_self = self_flag

# ---------------------------------------------------------------------------
# FNV-1a (render.ts hash()) -> pick a stable enemy variant root per entity id.
# ---------------------------------------------------------------------------
static func _fnv1a(s: String) -> int:
	var h := 2166136261
	for i in s.length():
		h ^= s.unicode_at(i)
		# Math.imul(h, 16777619) emulated with 32-bit wraparound.
		h = (h * 16777619) & 0xFFFFFFFF
	return h & 0xFFFFFFFF

func _enemy_root() -> String:
	var idx := _fnv1a(ent_id) % ENEMY_ROOTS.size()
	return "res://assets/Enemies/" + str(ENEMY_ROOTS[idx])

# ---------------------------------------------------------------------------
# Facing helpers (render.ts: facingFromVector / facingFromAngle / facingWithHysteresis).
# facingFromVector ties |dx| >= |dy| -> right.
# ---------------------------------------------------------------------------
static func _facing_from_vector(dx: float, dy: float) -> Dictionary:
	if absf(dx) >= absf(dy):
		return {"dir": "right", "flip": dx < 0.0}
	return {"dir": ("up" if dy < 0.0 else "down"), "flip": dx < 0.0}

func _facing_with_hysteresis(dx: float, dy: float, moving: bool, aim: float) -> Dictionary:
	if not moving:
		# Idle: face by aim angle; flip if aim points left.
		var f := _facing_from_vector(cos(aim), sin(aim))
		return {"dir": f["dir"], "flip": cos(aim) < 0.0}
	var ax := absf(dx)
	var ay := absf(dy)
	var dir := ""
	if _facing_dir == "right":
		dir = ("up" if dy < 0.0 else "down") if ay > ax * DIR_SWITCH_BIAS else "right"
	else:
		dir = "right" if ax > ay * DIR_SWITCH_BIAS else _facing_dir
		if dir != "right":
			dir = "up" if dy < 0.0 else "down"
	return {"dir": dir, "flip": dx < 0.0}

# ---------------------------------------------------------------------------
# Clip path builders (render.ts clipPath / actionClipPath). Left-facing reuses the
# right-facing atlas and mirrors the sprite, so we only ever request *_right / *Right art.
# ---------------------------------------------------------------------------
func _root_for_kind() -> String:
	if kind == "player":
		return HERO_ROOT
	if kind == "boss":
		return BOSS_ROOT
	return _enemy_root()

func _move_clip_path(root: String, moving: bool, dir: String) -> String:
	return "%s/%s_%s_right" % [root, ("iso_run" if moving else "iso_idle"), dir]

func _action_clip_path(root: String, action: String, dir: String) -> String:
	var prefix := ""
	match action:
		"cast": prefix = "Cast"
		"bolt": prefix = "Bolt"
		"strike": prefix = "Strike"
		"punch": prefix = "Punch"
		_: prefix = "Kick"
	var cap_dir := dir.substr(0, 1).to_upper() + dir.substr(1)
	return "%s/%s %s" % [root, prefix, cap_dir]

# render.ts clipDurationMs: minimum floor + enemy slowdown over the played frame count.
func _clip_duration_ms(clip: Variant, is_enemy: bool, frame_count: int) -> float:
	var minimum := 400.0 if is_enemy else 180.0
	if clip == null:
		return minimum
	var slowdown := ENEMY_FRAME_SLOWDOWN if is_enemy else 1.0
	var n := frame_count if frame_count > 0 else (clip["frames"] as Array).size()
	return maxf(minimum, float(clip["frame_ms"]) * float(n) * slowdown)

# ---------------------------------------------------------------------------
# Public: queue an action one-shot (render.ts queueAction). Called by SpriteLayer when an
# event (cast/melee) targets this entity. Latches the CURRENT facing for the duration.
# ---------------------------------------------------------------------------
func queue_action(action: String, now_ms: float, frame_start: int = 0, frame_count: int = 0, frame_speed: float = ACTION_FRAME_SPEED) -> void:
	_action_facing_dir = _facing_dir
	_action_flip = _flip
	_action_frame_start = frame_start
	_action_frame_count = frame_count
	_action_frame_speed = frame_speed
	var root := _root_for_kind()
	var target := _action_clip_path(root, action, _action_facing_dir)
	var loaded: Variant = Atlas.load_clip(target)
	_action = action
	if loaded == null:
		# No such action clip — bail out (render.ts leaves actionUntil but the draw loop
		# clears a null action clip immediately; we just don't enter the action).
		_action = ""
		return
	var avail := (loaded["frames"] as Array).size() - frame_start
	var play_count := mini(frame_count if frame_count > 0 else avail, avail)
	var is_enemy := root != HERO_ROOT
	_action_until = now_ms + _clip_duration_ms(loaded, is_enemy, play_count) / frame_speed
	# Force a clip switch on the next update so the action clip takes over from frame 0.
	_clip_key = ""
	_frame = 0
	_next_frame_at = 0.0

# ---------------------------------------------------------------------------
# Per-frame update. SpriteLayer computes the entity's interpolated world (wx, wy) and the
# raw inter-snapshot delta (dx, dy) for facing, then calls this. `now_ms` is wall-clock ms.
# Mirrors the per-entity body of render.ts sync().
# ---------------------------------------------------------------------------
func update_visual(wx: float, wy: float, dx: float, dy: float, aim: float, now_ms: float, sprite_px: float) -> void:
	# Spawn-pop scale factor (ease-out-back overshoot) applied in _apply_size.
	if now_ms < _spawn_until:
		var p := 1.0 - (_spawn_until - now_ms) / SPAWN_MS
		var tt := p - 1.0
		_spawn_mul = 1.0 + 2.7 * tt * tt * tt + 1.7 * tt * tt
	else:
		_spawn_mul = 1.0

	# Movement detection + hold (render.ts: positionChanged if |delta|^2 > 0.5).
	var position_changed := dx * dx + dy * dy > 0.5
	if position_changed:
		_moving_until = now_ms + MOVEMENT_HOLD_MS
	var moving := position_changed or now_ms < _moving_until

	# Facing: hysteresis while moving; on a true position change recompute, on held-move
	# keep the latched facing, on idle face-by-aim.
	var face: Dictionary
	if position_changed:
		face = _facing_with_hysteresis(dx, dy, true, aim)
	elif moving:
		face = {"dir": _facing_dir, "flip": _flip}
	else:
		face = _facing_with_hysteresis(0.0, 0.0, false, aim)
	_facing_dir = face["dir"]
	_flip = face["flip"]

	# Expire a finished action.
	if _action != "" and now_ms >= _action_until:
		_action = ""

	# Position. Height offset is kind-dependent (render.ts h).
	var h := _height_for_kind()
	position = Vector3(wx, h, wy)

	# Non-animated kinds: flat-colored billboard (proj / lootbag / spectator etc.).
	if kind != "player" and kind != "monster" and kind != "boss":
		_set_fallback()
		_apply_size(sprite_px)
		return

	var root := _root_for_kind()
	var display_flip := _action_flip if _action != "" else _flip

	# Resolve the action clip (if any). render.ts: a null-loaded action is dropped.
	var action_clip := ""
	var loaded_action: Variant = null
	if _action != "":
		action_clip = _action_clip_path(root, _action, _action_facing_dir)
		loaded_action = Atlas.load_clip(action_clip)
		if loaded_action == null:
			_action = ""
			action_clip = ""

	var display_dir := _action_facing_dir if action_clip != "" else _facing_dir
	var target_clip := action_clip
	var loaded: Variant = loaded_action
	if action_clip == "":
		# No action: idle/run clip for the display direction.
		target_clip = _move_clip_path(root, moving, display_dir)
		loaded = Atlas.load_clip(target_clip)

	var is_enemy := kind == "monster" or kind == "boss"

	# Played frame window for an action (frame_start..count, clamped to clip length).
	var action_frame_count := -1
	if action_clip != "" and loaded != null:
		if _action_frame_count > 0:
			action_frame_count = mini(_action_frame_count, (loaded["frames"] as Array).size() - _action_frame_start)
		else:
			action_frame_count = (loaded["frames"] as Array).size()

	# Clip changed -> reset stepping (render.ts: frame = readyAction ? 0 : -1).
	if _clip_key != target_clip:
		_clip_key = target_clip
		_frame = 0 if action_clip != "" else -1
		if action_clip != "" and loaded != null:
			var step_ms := (float(loaded["frame_ms"]) * (ENEMY_FRAME_SLOWDOWN if is_enemy else 1.0)) / _action_frame_speed
			_next_frame_at = now_ms + step_ms
			_action_until = now_ms + _clip_duration_ms(loaded, is_enemy, action_frame_count) / _action_frame_speed
		else:
			_next_frame_at = 0.0

	if loaded != null:
		var speed_div := _action_frame_speed if action_clip != "" else 1.0
		var frame_step_ms := (float(loaded["frame_ms"]) * (ENEMY_FRAME_SLOWDOWN if is_enemy else 1.0)) / speed_div
		var window := action_frame_count if action_frame_count >= 0 else (loaded["frames"] as Array).size()
		if window <= 0:
			window = 1
		if now_ms >= _next_frame_at:
			_frame = (_frame + 1) % window
			_next_frame_at = now_ms + frame_step_ms
		if _frame < 0:
			_frame = 0
		var frame_index := (_action_frame_start + _frame) if action_clip != "" else _frame
		_apply_frame(loaded, frame_index, display_flip)
	else:
		_set_fallback()

	# Hit flash overrides the just-set modulate, decaying over FLASH_MS (juice).
	if now_ms < _flash_until:
		var ft := clampf((_flash_until - now_ms) / FLASH_MS, 0.0, 1.0)
		modulate = modulate.lerp(_flash_color, ft)

	_apply_size(sprite_px)

# render.ts h: proj 12, boss 38, lootbag 8, else 22.
func _height_for_kind() -> float:
	match kind:
		"proj": return 12.0
		"boss": return 38.0
		"lootbag": return 8.0
		_: return 22.0

# Point this sprite's private AtlasTexture at frame_index of `clip`, mirroring if needed.
# (render.ts applyFrame: clone the sheet, set repeat/offset; here we set the region rect.)
func _apply_frame(clip: Variant, frame_index: int, flip_x: bool) -> void:
	var frames: Array = clip["frames"]
	if frames.is_empty():
		return
	var f: Rect2 = frames[frame_index % frames.size()]
	if _atlas_tex == null:
		_atlas_tex = AtlasTexture.new()
		_atlas_tex.filter_clip = true
	var sheet: Texture2D = clip["sheet"]
	if _atlas_source != sheet:
		_atlas_tex.atlas = sheet
		_atlas_source = sheet
	_atlas_tex.region = f
	texture = _atlas_tex
	modulate = Color.WHITE
	flip_h = flip_x

# render.ts setFallback: drop the texture, tint to the kind color.
func _set_fallback() -> void:
	texture = null
	modulate = _fallback_color()
	flip_h = false

func _fallback_color() -> Color:
	if kind == "boss":
		return COL_BOSS
	if kind == "proj":
		# 98/99 bolt sentinels are NOT atlas frames — boss bolt gets its own purple.
		return COL_BOSSBOLT if _sprite_id == BOSS_BOLT_SPRITE else COL_PROJ
	if kind == "lootbag":
		return COL_LOOT
	if is_self:
		return COL_SELF
	if kind == "player":
		return COL_PLAYER
	return COL_MONSTER

# Cached sprite id from the DTO (used to distinguish 98/99 bolt sentinels).
var _sprite_id := 0
func set_sprite_id(v: int) -> void:
	_sprite_id = v

# Scale a 128px frame (or fallback quad) to roughly `sprite_px` world units tall/wide.
# render.ts sets sprite.scale to the pixel size directly; with pixel_size=1 a 128px frame
# is 128 world-units, so scale = sprite_px / 128. Fallback (no texture) uses a unit quad.
func _apply_size(sprite_px: float) -> void:
	if texture != null:
		var th := texture.get_height()
		var s := sprite_px / float(th if th > 0 else 128)
		scale = Vector3(s, s, s) * _spawn_mul
	else:
		# No texture: Sprite3D draws nothing without a texture, so give the fallback a
		# 1px white texture sized up. Built lazily and shared per-instance.
		if texture == null:
			_ensure_fallback_texture()
			var s := sprite_px
			scale = Vector3(s, s, s) * _spawn_mul

# A 1x1 white texture so a textureless (fallback-colored) entity is still visible.
static var _white_tex: Texture2D
func _ensure_fallback_texture() -> void:
	if _white_tex == null:
		var img := Image.create(1, 1, false, Image.FORMAT_RGBA8)
		img.set_pixel(0, 0, Color.WHITE)
		_white_tex = ImageTexture.create_from_image(img)
	texture = _white_tex
