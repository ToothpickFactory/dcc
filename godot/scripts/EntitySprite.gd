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
const MODEL_HIT_MS := 360.0
const MODEL_DEATH_MS := 1400.0
const STATUS_EFFECT_MS := 2000.0
const STATUS_EFFECT_FRAMES := 16
const STATUS_EFFECT_COLS := 4
const STATUS_EFFECT_SIZE := 112.0
const STATUS_EFFECT_PATHS := {
	"fire": "res://assets/StatusEffects/Fire/Fire-spritesheet.png",
	"frost": "res://assets/StatusEffects/Frost/Frost-spritesheet.png",
	"poison": "res://assets/StatusEffects/Poison/Poison-spritesheet.png",
}
const STATUS_EFFECT_MODEL_PATHS := {
	"bleed": "res://assets/StatusEffects/Bleed/Bleed.glb",
	"dark": "res://assets/StatusEffects/Dark/Dark.glb",
	"fire": "res://assets/StatusEffects/Fire/Fire.glb",
	"frost": "res://assets/StatusEffects/Frost/Frost.glb",
	"holy": "res://assets/StatusEffects/Holy/Holy.glb",
	"poison": "res://assets/StatusEffects/Poison/Poison.glb",
	"stun": "res://assets/StatusEffects/Stun/Stun.glb",
}
const STATUS_EFFECT_NORMAL_HEIGHT := 260.0
const STATUS_EFFECT_BOSS_HEIGHT := 520.0

const HERO_ROOT := "res://assets/Heroes/Kevin"
const HERO_MODEL_PATH := "res://assets/Heroes/Kevin/Kevin-3d-animated.glb"
const HERO_MODEL_SCALE := 84.0
const HERO_LIGHT_ENERGY := 1.35
const BARBARIAN_MODEL_PATH := "res://assets/Heroes/Barbarian/Barbarian-3d-animated.glb"
const CLERIC_MODEL_PATH := "res://assets/Heroes/Cleric/Cleric-3d-animated.glb"
const PALADIN_MODEL_PATH := "res://assets/Heroes/Paladin/Paladin-3d-animated.glb"
const RANGER_MODEL_PATH := "res://assets/Heroes/Ranger/Ranger-3d-animated.glb"
const ROGUE_MODEL_PATH := "res://assets/Heroes/Rogue/Rogue - Assassin-3d-animated.glb"
const WIZARD_MODEL_PATH := "res://assets/Heroes/Wizard/Wizard-3d-animated.glb"
const HERO_CLASS_IDS := ["warrior", "mage", "priest", "hunter", "rogue"]
const BOSS_ROOT := "res://assets/Bosses/Slime"
const JAILOR_NAME := "Iron Jailor"
const JAILOR_MODEL_PATH := "res://assets/Bosses/Jailor/Iron Jailor-3d-animated.glb"
const JAILOR_MODEL_SCALE := 504.0
const JAILOR_LIGHT_ENERGY := 2.2
const BRIAR_REVENANT_NAME := "Briar Revenant"
const BRIAR_REVENANT_MODEL_PATH := "res://assets/Bosses/BriarRevenant/Briar Revenant-3d-animated.glb"
const PRIMAL_CONFLUX_NAME := "Primal Conflux"
const PRIMAL_CONFLUX_MODEL_PATH := "res://assets/Bosses/PrimalConflux/Primal Conflux-3d-animated.glb"
const JUGGERNAUT_NAME := "Juggernaut"
const JUGGERNAUT_MODEL_PATH := "res://assets/Bosses/Juggernaut/Juggernaut-3d-animated.glb"
const TERRORBOT_NAME := "TerrorBot"
const TERRORBOT_MODEL_PATH := "res://assets/Bosses/TerrorBot/TerrorBot.glb"
const TERRORBOT_MODEL_SCALE := 297.0
const ICE_GOLEM_NAME := "Ice Golem"
const ICE_GOLEM_MODEL_PATH := "res://assets/Bosses/IceGolem/IceGolem.glb"
const ICE_GOLEM_MODEL_SCALE := 180.0
const TERRORBOT_ANIM_ALIASES := {
	"idle": ["Walking"],
	"run": ["Running", "Run_and_Shoot", "Walking"],
	"slash_a": ["Axe_Spin_Attack", "Charged_Upward_Slash"],
	"slash_b": ["Charged_Upward_Slash", "Axe_Spin_Attack"],
	"slash_c": ["Axe_Spin_Attack", "Charged_Upward_Slash"],
	"strike": ["Axe_Spin_Attack", "Charged_Upward_Slash"],
	"punch": ["Axe_Spin_Attack", "Charged_Upward_Slash"],
	"kick": ["Axe_Spin_Attack", "Charged_Upward_Slash"],
	"cast": ["Draw_and_Shoot_Left", "Run_and_Shoot"],
	"bolt": ["Draw_and_Shoot_Left", "Run_and_Shoot"],
	"hit": ["Hit_Reaction_1"],
	"hurt": ["Hit_Reaction_1"],
	"death": ["Dead"],
}
const ENT_MODEL_PATH := "res://assets/Enemies/Ent/Ent.glb"
const ENT_MODEL_SCALE := 84.0
const ENT_LIGHT_ENERGY := 1.7
const ENT_ANIM_ALIASES := {
	"idle": ["Walking"],
	"run": ["Running", "Walking"],
	"slash_a": ["Attack", "Angry_Ground_Stomp_2"],
	"slash_b": ["Angry_Ground_Stomp_2", "Attack"],
	"slash_c": ["Attack", "Angry_Ground_Stomp_2"],
	"strike": ["Attack", "Angry_Ground_Stomp_2"],
	"punch": ["Angry_Ground_Stomp_2", "Attack"],
	"kick": ["Angry_Ground_Stomp_2", "Attack"],
	"cast": ["Angry_Ground_Stomp_2", "Attack"],
	"bolt": ["Angry_Ground_Stomp_2", "Attack"],
	"hit": ["Hit_Reaction_1"],
	"hurt": ["Hit_Reaction_1"],
	"death": ["Dead"],
}
const ALIEN_SQUID_MODEL_PATH := "res://assets/Enemies/AlienSquid/AlienSquid.glb"
const ALIEN_SQUID_MODEL_SCALE := 86.0
const ALIEN_SQUID_LIGHT_ENERGY := 1.85
const FIRE_ELEMENTAL_MODEL_PATH := "res://assets/Enemies/FireElemental/FireElemental.glb"
const FIRE_ELEMENTAL_MODEL_SCALE := 118.0
const FIRE_ELEMENTAL_LIGHT_ENERGY := 1.9
const FIRE_ELEMENTAL_MOVEMENT_ANIMS := ["walk", "walking", "move"]
const GHOUL_MODEL_PATH := "res://assets/Enemies/Ghoul/Ghoul-3d-animated.glb"
const GHOUL_MODEL_SCALE := 116.0
const GHOUL_LIGHT_ENERGY := 1.5
const ICE_GIANT_MODEL_PATH := "res://assets/Enemies/IceGiant/IceGiant.glb"
const ICE_GIANT_MODEL_SCALE := 132.0
const ICE_GIANT_LIGHT_ENERGY := 1.75
const ICE_GIANT_MOVEMENT_ANIMS := ["walk", "walking", "move"]
const INFERNAX_MODEL_PATH := "res://assets/Enemies/Infernax/Warlock - Infernax (Transformation)-3d-animated.glb"
const INFERNAX_MODEL_SCALE := 122.0
const INFERNAX_LIGHT_ENERGY := 1.65
const ORC_MODEL_PATH := "res://assets/Enemies/Orc/Orc-3d-animated.glb"
const ORC_MODEL_SCALE := 124.0
const ORC_LIGHT_ENERGY := 1.55
const PIRATE_MODEL_PATH := "res://assets/Enemies/Pirate/Pirate Zombie-3d-animated.glb"
const PIRATE_MODEL_SCALE := 120.0
const PIRATE_LIGHT_ENERGY := 1.55
const SHARKMAN_MODEL_PATH := "res://assets/Enemies/SharkMan/SharkMan-3d-animated.glb"
const SHARKMAN_MODEL_SCALE := 124.0
const SHARKMAN_LIGHT_ENERGY := 1.6
const SKELETON_MODEL_PATH := "res://assets/Enemies/Skeleton/Skeleton-3d-animated.glb"
const SKELETON_MODEL_SCALE := 112.0
const SKELETON_LIGHT_ENERGY := 1.45
const TROLL_MODEL_PATH := "res://assets/Enemies/Troll/Troll-3d-animated.glb"
const TROLL_MODEL_SCALE := 132.0
const TROLL_LIGHT_ENERGY := 1.6
const WRAITH_MODEL_PATH := "res://assets/Enemies/Wraith/Wraith-3d-animated.glb"
const WRAITH_MODEL_SCALE := 118.0
const WRAITH_LIGHT_ENERGY := 1.7
const ZOMBIE_MODEL_PATH := "res://assets/Enemies/Zombie/Zombie-3d-animated.glb"
const ZOMBIE_MODEL_SCALE := 118.0
const ZOMBIE_LIGHT_ENERGY := 1.5
const ENEMY_ROOTS := ["Goblin", "Ghoul", "Infernax", "Orc", "Pirate", "SharkMan", "Skeleton", "Troll", "Wraith", "Zombie", "Ent", "FireElemental", "IceGiant"]
const POISON_PROJECTILE_SPRITE := 95 # src/shared/constants.ts POISON_PROJECTILE_SPRITE
const ICE_PROJECTILE_SPRITE := 96 # src/shared/constants.ts ICE_PROJECTILE_SPRITE
const FIREBALL_PROJECTILE_SPRITE := 97 # src/shared/constants.ts FIREBALL_PROJECTILE_SPRITE
const FIRE_BOLT_MODEL_PATH := "res://assets/Bolt/Fire.glb"
const FROST_BOLT_MODEL_PATH := "res://assets/Bolt/Frost.glb"
const POISON_BOLT_MODEL_PATH := "res://assets/Bolt/Poison.glb"
const ELECTRIC_BOLT_MODEL_PATH := "res://assets/Bolt/Electric.glb"
const SHADOW_BOLT_MODEL_PATH := "res://assets/Bolt/Shadow.glb"
const BLEED_BOLT_MODEL_PATH := "res://assets/Bolt/Shadow.glb"
const ARROW_MODEL_PATH := "res://assets/Weapons/Arrow/Common.glb"
const ARROW_MODEL_SCALE := 34.0
const DAGGER_MODEL_PATH := "res://assets/Weapons/ThrowingDaggeer/Throwing dagger.glb"
const DAGGER_MODEL_SCALE := 68.0
const BOLT_MODEL_SCALE := 34.0
const BOSS_BOLT_SPRITE := 99   # src/shared/constants.ts BOSS_BOLT_SPRITE
const MONSTER_BOLT_SPRITE := 98 # MONSTER_BOLT_SPRITE
const LOOT_MODEL_PATH := "res://assets/Props/loot.glb"
const LOOT_MODEL_SCALE := 42.0
const LOOT_LIGHT_ENERGY := 1.8
const HERO_FLAIL_SCENE_PATH := "res://scenes/weapons/flail.tscn"
const HERO_MAIN_HAND_BONES := ["RightHand", "mixamorig:RightHand", "right_hand", "hand.R"]
const HERO_OFF_HAND_BONES := ["LeftHand", "mixamorig:LeftHand", "left_hand", "hand.L"]
const HERO_WEAPON_OFFSET := Vector3.ZERO
const HERO_OFFHAND_OFFSET := Vector3(0.0, 0.10, 0.0)
const HERO_WEAPON_ROTATION_DEGREES := Vector3(0.0, 0.0, 0.0)
const HERO_OFFHAND_ROTATION_DEGREES := Vector3(0.0, 180.0, 0.0)
const WEAPON_ASSET_RARITY := {
	"common": "Common",
	"standard": "Standard",
	"uncommon": "Standard",
	"rare": "Rare",
	"epic": "Epic",
	"legendary": "Epic",
}

# Fallback fill colors (render.ts `C` + per-kind). Used when no clip is loaded yet, and as
# the modulate tint for non-animated kinds (proj / lootbag).
const COL_PLAYER := Color8(0x4f, 0x8c, 0xff)
const COL_SELF := Color8(0x5d, 0xd6, 0xff)
const COL_MONSTER := Color8(0xb6, 0x43, 0x3d)
const COL_BOSS := Color8(0x9b, 0x30, 0xff)
const COL_BOSSBOLT := Color8(0xc8, 0x50, 0xff)
const COL_PROJ := Color8(0xff, 0xd3, 0x4d)
const COL_LOOT := Color8(0xff, 0xcc, 0x44)
# Loot-bag glow by best-item rarity (overbright for the high tiers so they beam).
const LOOT_RARITY_COL := {
	"common": Color(0.82, 0.78, 0.58),
	"uncommon": Color(0.42, 1.35, 0.6),
	"rare": Color(0.45, 0.78, 1.6),
	"epic": Color(1.25, 0.6, 1.7),
	"legendary": Color(1.9, 1.35, 0.45),
}
var _loot_rarity := "common"
func set_loot_rarity(r: String) -> void:
	_loot_rarity = r

# Loot etiquette: a bag owned by another player during the priority window reads as locked.
var _loot_locked := false
var _lock_label: Label3D
func set_loot_owner(locked: bool) -> void:
	_loot_locked = locked

func _loot_display_color(now_ms: float) -> Color:
	var col: Color = LOOT_RARITY_COL.get(_loot_rarity, COL_LOOT)
	if _loot_rarity != "common":
		col = col * (0.85 + 0.25 * (0.5 + 0.5 * sin(now_ms * 0.006)))
	if _loot_locked:
		col = col * 0.45
	return col

func _update_loot_model_effects(now_ms: float) -> void:
	if kind != "lootbag":
		return
	var col := _loot_display_color(now_ms)
	if _model_light != null:
		_model_light.light_color = col
		_model_light.light_energy = LOOT_LIGHT_ENERGY * (0.65 if _loot_locked else 1.0)

# ---- ally nameplate + HP bar (other players only; self uses the top HUD) ----
const ALLY_BAR_W := 90.0
var _ally_hp := 0.0
var _ally_hp_max := 0.0
var _ally_klass := ""
var _nameplate: Label3D
var _hp_bg: Sprite3D
var _hp_fill: Sprite3D
static var _bar_tex: Texture2D  # shared 1x1 white texture for the HP bar quads
func set_ally_status(hp: float, max_hp: float, klass: String) -> void:
	_ally_hp = hp
	_ally_hp_max = max_hp
	_ally_klass = klass

# Shared 1x1 white texture for the HP-bar quads (created once).
static func _white_texture() -> Texture2D:
	if _bar_tex == null:
		var img := Image.create(1, 1, false, Image.FORMAT_RGBA8)
		img.set_pixel(0, 0, Color.WHITE)
		_bar_tex = ImageTexture.create_from_image(img)
	return _bar_tex

func _make_bar(w: float, h: float, y: float, prio: int) -> Sprite3D:
	var s := Sprite3D.new()
	s.texture = _white_texture()
	s.centered = false  # anchor at the left edge so the fill shrinks from the right
	s.pixel_size = 1.0
	s.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	s.shaded = false
	s.no_depth_test = true  # ally bars read through walls (co-op visibility)
	s.scale = Vector3(w, h, 1.0)
	s.position = Vector3(-w * 0.5, y, 0.0)
	s.render_priority = prio
	add_child(s)
	return s

func _ensure_nameplate() -> void:
	if _nameplate != null:
		return
	var y := 150.0
	_hp_bg = _make_bar(ALLY_BAR_W, 11.0, y, 5)
	_hp_bg.modulate = Color(0.06, 0.07, 0.10, 0.85)
	_hp_fill = _make_bar(ALLY_BAR_W, 11.0, y, 6)
	_nameplate = Label3D.new()
	_nameplate.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_nameplate.no_depth_test = true
	_nameplate.font_size = 28
	_nameplate.outline_size = 8
	_nameplate.outline_modulate = Color(0, 0, 0, 0.8)
	_nameplate.pixel_size = 1.0
	_nameplate.position = Vector3(0.0, y + 28.0, 0.0)
	_nameplate.render_priority = 6
	add_child(_nameplate)

# Float a name (with class icon) + an HP bar above an ally each frame. No-op for non-allies.
func _update_ally_overlay() -> void:
	if _ally_hp_max <= 0.0 or _is_dead_body:
		if _nameplate != null:
			_nameplate.visible = false
			_hp_bg.visible = false
			_hp_fill.visible = false
		return
	_ensure_nameplate()
	_nameplate.visible = true
	_hp_bg.visible = true
	_hp_fill.visible = true
	var icon := ""
	if _ally_klass != "" and Talents.CLASS_INFO.has(_ally_klass):
		icon = str((Talents.CLASS_INFO[_ally_klass] as Dictionary).get("icon", ""))
	_nameplate.text = (icon + " " + _entity_name).strip_edges() if icon != "" else _entity_name
	var ratio := clampf(_ally_hp / _ally_hp_max, 0.0, 1.0)
	_hp_fill.scale.x = maxf(0.0, ALLY_BAR_W * ratio)
	_hp_fill.modulate = Color(0.35, 0.85, 0.4) if ratio > 0.5 else (Color(0.95, 0.75, 0.25) if ratio > 0.25 else Color(0.9, 0.3, 0.3))

# A 🔒 over a loot bag owned by someone else during the priority window.
func _update_loot_lock() -> void:
	if not _loot_locked:
		if _lock_label != null:
			_lock_label.visible = false
		return
	if _lock_label == null:
		_lock_label = Label3D.new()
		_lock_label.text = "\U01f512"  # 🔒
		_lock_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		_lock_label.no_depth_test = true
		_lock_label.font_size = 30
		_lock_label.pixel_size = 1.0
		_lock_label.position = Vector3(0.0, 70.0, 0.0)
		_lock_label.render_priority = 6
		add_child(_lock_label)
	_lock_label.visible = true

# ---- identity ----
var ent_id := ""
var kind := ""
var is_self := false
var world_sprite_px: float = 84.0
var _entity_name := ""
var _chosen_class := ""  # Klass from self_dto ("warrior"|"mage"|"priest"|"rogue"|"hunter")
var _model_root: Node3D
var _model_inst: Node3D
var _model_light: OmniLight3D
var _model_anim: AnimationPlayer
var _model_anim_name := ""
var _model_profile: Dictionary = {}
var _model_debug_logged := false
var _projectile_render := ""
var _monster_kind := ""
var _model_slash_index := 0
var _weapon_attachments: Array[BoneAttachment3D] = []
var _weapon_inst: Node3D
var _offhand_weapon_inst: Node3D
var _equipped_weapons: Dictionary = {}
var _weapon_signature := ""
var _dead_until := 0.0
var _is_dead_body := false
var _death_freeze_at := 0.0
var _death_frozen := false
var _status_sprite: Sprite3D
var _status_atlas: AtlasTexture
var _status_until := 0.0
var _status_started_at := 0.0
var _status_kind := ""
var _status_effects: StatusEffects
var _status_effect_nodes := {}
var _status_effect_until := {}
var _cc_effect := ""

# ---- hit flash (juice): brief overbright/red tint on taking damage ----
const FLASH_MS := 110.0
var _flash_until := 0.0
var _flash_color := Color(2.4, 2.4, 2.4)   # overbright white; red for the local player

# ---- attack telegraph: pulsing orange "charge" tint while winding up a melee ----
var _windup_until := 0.0
func windup(now_ms: float, ms: float) -> void:
	_windup_until = now_ms + ms

# ---- hard crowd control: persistent status tint while a foe is stun/root/frozen ----
# Set every frame from the entity DTO's `cc` field ("" when free). The visual is what
# makes a stun/freeze/root readable — a frozen foe reads as "safe to ignore for a beat".
var _cc := ""
func set_cc(kind: String) -> void:
	_cc = kind

# Flash this sprite (called by SpriteLayer on a dmg/death event near/at this entity).
func flash_hit(now_ms: float, hurt: bool = false, reaction: String = "hit") -> void:
	_flash_until = now_ms + FLASH_MS
	_flash_color = Color(2.6, 0.7, 0.7) if hurt else Color(2.4, 2.4, 2.4)
	if _model_root == null:
		return
	if reaction == "death":
		_action = "death"
		_action_until = now_ms + _model_anim_duration_ms("death", MODEL_DEATH_MS)
		_dead_until = _action_until
		_death_freeze_at = _action_until
		_death_frozen = false
		_play_model_anim("death")
	elif _action != "death":
		_action = "hit"
		_action_until = now_ms + MODEL_HIT_MS
		_play_model_anim("hit")

func play_status_fx(kind_name: String, now_ms: float) -> void:
	kind_name = _normalize_status_effect(kind_name)
	_show_model_status_effect(kind_name, now_ms)
	var tex: Texture2D = null
	if STATUS_EFFECT_PATHS.has(kind_name):
		tex = load(str(STATUS_EFFECT_PATHS[kind_name]))
	if _status_sprite == null:
		_status_sprite = Sprite3D.new()
		_status_sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		_status_sprite.shaded = false
		_status_sprite.transparent = true
		_status_sprite.no_depth_test = true
		_status_sprite.render_priority = 7
		add_child(_status_sprite)
	if _status_atlas == null:
		_status_atlas = AtlasTexture.new()
		_status_atlas.filter_clip = true
	if tex != null:
		_status_atlas.atlas = tex
		_status_sprite.texture = _status_atlas
		_status_sprite.modulate = Color.WHITE
	else:
		_ensure_status_fallback_texture()
		_status_sprite.texture = _status_fallback_tex
		_status_sprite.modulate = _status_color(kind_name)
	_status_sprite.visible = true
	_status_started_at = now_ms
	_status_until = now_ms + STATUS_EFFECT_MS
	_status_kind = kind_name
	_update_status_fx(now_ms)

func _update_status_fx(now_ms: float) -> void:
	_update_model_status_effects(now_ms)
	if _status_sprite == null:
		return
	if _is_dead_body or now_ms >= _status_until:
		_status_sprite.visible = false
		return
	var t := clampf((now_ms - _status_started_at) / STATUS_EFFECT_MS, 0.0, 0.999)
	var frame := mini(STATUS_EFFECT_FRAMES - 1, int(floor(t * STATUS_EFFECT_FRAMES)))
	var col := frame % STATUS_EFFECT_COLS
	var row := frame / STATUS_EFFECT_COLS
	var frame_px := 128.0
	if _status_sprite.texture == _status_atlas:
		_status_atlas.region = Rect2(float(col) * frame_px, float(row) * frame_px, frame_px, frame_px)
	_status_sprite.position = Vector3(0.0, 88.0 + sin(now_ms * 0.012) * 5.0, 0.0)
	var pulse := 1.0 + 0.18 * sin(now_ms * 0.018)
	var s := (STATUS_EFFECT_SIZE / frame_px) * pulse
	_status_sprite.scale = Vector3(s, s, s)
	_status_sprite.visible = true

static var _status_fallback_tex: Texture2D
func _ensure_status_fallback_texture() -> void:
	if _status_fallback_tex != null:
		return
	var size := 64
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var center := Vector2(size * 0.5, size * 0.5)
	for y in size:
		for x in size:
			var d := Vector2(x, y).distance_to(center) / (size * 0.5)
			var ring := smoothstep(0.98, 0.68, d) * smoothstep(0.35, 0.62, d)
			var core := smoothstep(0.24, 0.0, d) * 0.35
			img.set_pixel(x, y, Color(1, 1, 1, clampf(ring + core, 0.0, 1.0)))
	_status_fallback_tex = ImageTexture.create_from_image(img)

func _status_color(kind_name: String) -> Color:
	match kind_name:
		"bleed": return Color(1.0, 0.05, 0.03, 0.9)
		"dark": return Color(0.55, 0.12, 1.0, 0.9)
		"fire": return Color(1.0, 0.36, 0.05, 0.9)
		"frost": return Color(0.35, 0.85, 1.0, 0.9)
		"holy": return Color(1.0, 0.86, 0.28, 0.9)
		"poison": return Color(0.35, 1.0, 0.12, 0.9)
		"stun": return Color(1.0, 0.95, 0.18, 0.9)
		_: return Color(1.0, 1.0, 1.0, 0.9)

func _show_model_status_effect(kind_name: String, now_ms: float) -> bool:
	kind_name = _normalize_status_effect(kind_name)
	if not STATUS_EFFECT_MODEL_PATHS.has(kind_name):
		return false
	if _is_dead_body:
		return true
	if _ensure_status_effect(kind_name):
		_status_effect_until[kind_name] = now_ms + STATUS_EFFECT_MS
		_status_effects.show_effect(kind_name)
		return true
	return false

func _normalize_status_effect(kind_name: String) -> String:
	var key := kind_name.strip_edges().to_lower()
	match key:
		"ice", "freeze", "frozen":
			return "frost"
		"burn", "burning":
			return "fire"
		"venom", "toxic":
			return "poison"
		"shadow":
			return "dark"
		"electric", "lightning", "shock":
			return "stun"
		_:
			return key

func _update_model_status_effects(now_ms: float) -> void:
	if _status_effects == null:
		return
	if _is_dead_body:
		_status_effects.hide_all()
		_status_effect_until.clear()
		_cc_effect = ""
		return
	var current_cc := _effect_for_cc()
	if current_cc != _cc_effect:
		if _cc_effect != "" and not _status_effect_until.has(_cc_effect):
			_status_effects.hide_effect(_cc_effect)
		_cc_effect = current_cc
		if _cc_effect != "" and _ensure_status_effect(_cc_effect):
			_status_effects.show_effect(_cc_effect)
	for effect_name in _status_effect_until.keys().duplicate():
		if now_ms >= float(_status_effect_until[effect_name]):
			_status_effect_until.erase(effect_name)
			if str(effect_name) != _cc_effect:
				_status_effects.hide_effect(str(effect_name))

func _effect_for_cc() -> String:
	match _cc:
		"stun":
			return "stun"
		"freeze":
			return "frost"
		"root":
			return "poison"
		_:
			return ""

func _ensure_status_effect(kind_name: String) -> bool:
	if _status_effects == null:
		_status_effects = StatusEffects.new()
		_status_effects.name = "StatusEffects"
		add_child(_status_effects)
	if _status_effect_nodes.has(kind_name):
		return true
	var model_path := str(STATUS_EFFECT_MODEL_PATHS.get(kind_name, ""))
	var scene := _load_model_scene(model_path, "Status effect %s" % kind_name)
	if scene == null:
		_warn_model_failed_once(model_path, "Status effect model failed to load: %s" % model_path)
		return false
	var inst := scene.instantiate()
	if not (inst is Node3D):
		inst.queue_free()
		push_warning("Status effect model root is not Node3D: %s" % model_path)
		return false
	var model := inst as Node3D
	var effect_root := Node3D.new()
	effect_root.name = "%s_status_effect" % kind_name.capitalize()
	effect_root.add_child(model)
	_fit_status_effect_model(effect_root, model)
	_status_effects.add_child(effect_root)
	var mesh := _first_mesh(effect_root)
	if mesh == null:
		push_warning("Status effect model has no MeshInstance3D: %s" % model_path)
		effect_root.queue_free()
		return false
	_status_effect_nodes[kind_name] = effect_root
	_status_effects.register_effect_root(kind_name, effect_root)
	return true

func _fit_status_effect_model(effect_root: Node3D, model: Node3D) -> void:
	var bounds: Array = [false, Vector3.ZERO, Vector3.ZERO]
	_collect_node_bounds(model, Transform3D.IDENTITY, bounds)
	if not bool(bounds[0]):
		effect_root.scale = Vector3.ONE
		return
	var min_v: Vector3 = bounds[1]
	var max_v: Vector3 = bounds[2]
	var size := max_v - min_v
	var source_height := maxf(size.y, 0.001)
	var desired_world_height := STATUS_EFFECT_BOSS_HEIGHT if kind == "boss" else STATUS_EFFECT_NORMAL_HEIGHT
	effect_root.position = Vector3.ZERO
	effect_root.scale = Vector3.ONE * (desired_world_height / source_height)
	model.position -= Vector3((min_v.x + max_v.x) * 0.5, min_v.y, (min_v.z + max_v.z) * 0.5)
	_configure_status_effect_visuals(model)

func _collect_node_bounds(node: Node, to_root: Transform3D, result: Array) -> void:
	if node is MeshInstance3D:
		var mesh_node := node as MeshInstance3D
		var aabb := mesh_node.get_aabb()
		var p := aabb.position
		var e := aabb.position + aabb.size
		for x in [p.x, e.x]:
			for y in [p.y, e.y]:
				for z in [p.z, e.z]:
					var point: Vector3 = to_root * Vector3(x, y, z)
					if not bool(result[0]):
						result[0] = true
						result[1] = point
						result[2] = point
					else:
						result[1] = (result[1] as Vector3).min(point)
						result[2] = (result[2] as Vector3).max(point)
	for child in node.get_children():
		if child is Node3D:
			var child3d := child as Node3D
			_collect_node_bounds(child3d, to_root * child3d.transform, result)

func _configure_status_effect_visuals(node: Node) -> void:
	if node is MeshInstance3D:
		var mesh_node := node as MeshInstance3D
		mesh_node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mesh_node.transparency = 0.0
		mesh_node.visible = true
	for child in node.get_children():
		_configure_status_effect_visuals(child)

func is_waiting_for_death_anim(now_ms: float) -> bool:
	return _dead_until > now_ms

func set_dead_body(dead: bool, now_ms: float) -> void:
	if _is_dead_body == dead:
		return
	_is_dead_body = dead
	if dead:
		_action = "death"
		_action_until = now_ms + _model_anim_duration_ms("death", MODEL_DEATH_MS)
		_dead_until = _action_until
		if _death_freeze_at <= now_ms:
			_death_freeze_at = now_ms + _model_anim_duration_ms("death", MODEL_DEATH_MS)
		_death_frozen = false
		_moving_until = 0.0
		if _model_root != null:
			_model_root.visible = false
		texture = null
		modulate.a = 0.0
	else:
		_dead_until = 0.0
		_death_freeze_at = 0.0
		_death_frozen = false
		texture = null
		modulate = Color.WHITE
		if _model_root != null:
			_model_root.visible = true
		if _action == "death":
			_action = ""
			_action_until = now_ms

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
	# The LOCAL hero draws ON TOP of walls so it's never hidden by a tall wall between
	# it and the 3/4 camera (the "can't see my character in a horizontal hall" problem).
	# setup() runs before _ready(), so is_self is already known here.
	no_depth_test = is_self

# Called once right after instantiation by SpriteLayer.
func setup(id: String, k: String, self_flag: bool) -> void:
	ent_id = id
	kind = k
	is_self = self_flag
	_ensure_model_for_entity()

func set_entity_name(v: String) -> void:
	if _entity_name == v:
		return
	_entity_name = v
	_ensure_model_for_entity()

func set_chosen_class(klass: String) -> void:
	klass = _normalize_class(klass)
	if _chosen_class == klass:
		return
	_chosen_class = klass
	if kind != "player":
		return
	# Swap to the new class model. Immediately remove and free the old wrapper so it's
	# gone before the new one is added — deferred free would leave both in the tree
	# for one frame and can corrupt the new model's initial transform.
	if _model_light != null:
		_model_light.queue_free()
		_model_light = null
	if _model_root != null:
		remove_child(_model_root)
		_model_root.free()
		_model_root = null
		_model_inst = null
		_model_anim = null
		_model_anim_name = ""
		_model_profile = {}
		_clear_weapons()
		_status_effects = null
		_status_effect_nodes.clear()
		_status_effect_until.clear()
		_cc_effect = ""
		_model_debug_logged = false
	_ensure_model_for_entity()

func set_weapon_loadout(loadout: Dictionary) -> void:
	if kind != "player":
		return
	var sig := JSON.stringify(loadout)
	if _weapon_signature == sig:
		return
	_weapon_signature = sig
	_equipped_weapons = loadout.duplicate(true)
	if _model_inst != null:
		_clear_weapons()
		_attach_weapon_to_model(_model_profile)

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
	match _monster_kind:
		"alien_squid", "aliensquid":
			return "res://assets/Enemies/AlienSquid"
		"fire_elemental", "fireelemental":
			return "res://assets/Enemies/FireElemental"
		"ghoul":
			return "res://assets/Enemies/Ghoul"
		"goblin":
			return "res://assets/Enemies/Goblin"
		"ice_giant", "icegiant":
			return "res://assets/Enemies/IceGiant"
		"infernax":
			return "res://assets/Enemies/Infernax"
		"orc":
			return "res://assets/Enemies/Orc"
		"pirate":
			return "res://assets/Enemies/Pirate"
		"sharkman":
			return "res://assets/Enemies/SharkMan"
		"skeleton":
			return "res://assets/Enemies/Skeleton"
		"troll":
			return "res://assets/Enemies/Troll"
		"wraith":
			return "res://assets/Enemies/Wraith"
		"zombie":
			return "res://assets/Enemies/Zombie"
	var idx := _fnv1a(ent_id) % ENEMY_ROOTS.size()
	return "res://assets/Enemies/" + str(ENEMY_ROOTS[idx])

func _model_profile_for_entity() -> Dictionary:
	if kind == "player":
		var model_path := HERO_MODEL_PATH
		var label := "Kevin"
		var anim_aliases: Dictionary = {}
		var model_scale := HERO_MODEL_SCALE
		var model_rot_deg: Variant = null
		match _chosen_class:
			"warrior":
				model_path = BARBARIAN_MODEL_PATH
				label = "Barbarian"
			"mage":
				model_path = WIZARD_MODEL_PATH
				label = "Wizard"
			"priest":
				model_path = CLERIC_MODEL_PATH
				label = "Cleric"
			"hunter":
				model_path = RANGER_MODEL_PATH
				label = "Ranger"
			"rogue":
				model_path = ROGUE_MODEL_PATH
				label = "Rogue"
		var profile := {
			"label": label,
			"path": model_path,
			"anim_aliases": anim_aliases,
			"scale": model_scale,
			"model_y": 60.0,
			"light_energy": HERO_LIGHT_ENERGY,
			"light_range": 260.0,
			"light_y": 95.0,
			"contrast": 1.2,
			"saturation": 1.2,
		}
		if model_rot_deg != null:
			profile["rotation_degrees"] = model_rot_deg
		return profile
	if kind == "proj" and (_projectile_render == "fire" or _sprite_id == FIREBALL_PROJECTILE_SPRITE or _sprite_id == BOSS_BOLT_SPRITE or _sprite_id == MONSTER_BOLT_SPRITE):
		return {
			"label": "Fire Bolt",
			"path": FIRE_BOLT_MODEL_PATH,
			"scale": BOLT_MODEL_SCALE,
			"y": 18.0,
			"light_energy": 2.0,
			"light_range": 90.0,
			"light_y": 16.0,
			"contrast": 1.25,
			"saturation": 1.35,
		}
	if kind == "proj" and (_projectile_render == "ice" or _sprite_id == ICE_PROJECTILE_SPRITE):
		return {
			"label": "Frost Bolt",
			"path": FROST_BOLT_MODEL_PATH,
			"scale": BOLT_MODEL_SCALE,
			"y": 18.0,
			"light_energy": 1.6,
			"light_range": 90.0,
			"light_y": 16.0,
			"contrast": 1.25,
			"saturation": 1.25,
		}
	if kind == "proj" and (_projectile_render == "poison" or _sprite_id == POISON_PROJECTILE_SPRITE):
		return {
			"label": "Poison Bolt",
			"path": POISON_BOLT_MODEL_PATH,
			"scale": BOLT_MODEL_SCALE,
			"y": 18.0,
			"light_energy": 1.7,
			"light_range": 90.0,
			"light_y": 16.0,
			"contrast": 1.3,
			"saturation": 1.35,
		}
	if kind == "proj" and _projectile_render == "arrow":
		return {
			"label": "Arrow",
			"path": ARROW_MODEL_PATH,
			"scale": ARROW_MODEL_SCALE,
			"y": 18.0,
			"light_energy": 1.4,
			"light_range": 80.0,
			"light_y": 16.0,
			"contrast": 1.2,
			"saturation": 1.1,
		}
	if kind == "proj" and _projectile_render == "dagger":
		return {
			"label": "Dagger",
			"path": DAGGER_MODEL_PATH,
			"scale": DAGGER_MODEL_SCALE,
			"y": 18.0,
			"light_energy": 1.5,
			"light_range": 80.0,
			"light_y": 16.0,
			"contrast": 1.2,
			"saturation": 1.1,
		}
	if kind == "proj" and (_projectile_render == "electric" or _projectile_render == "shadow" or _projectile_render == "bleed" or _projectile_render == "stun"):
		var bolt_path := ELECTRIC_BOLT_MODEL_PATH
		var bolt_label := "Electric Bolt"
		var bolt_light := 2.0
		if _projectile_render == "shadow":
			bolt_path = SHADOW_BOLT_MODEL_PATH
			bolt_label = "Shadow Bolt"
			bolt_light = 1.75
		elif _projectile_render == "bleed":
			bolt_path = BLEED_BOLT_MODEL_PATH
			bolt_label = "Bleed Bolt"
			bolt_light = 1.6
		elif _projectile_render == "stun":
			bolt_label = "Stun Bolt"
			bolt_light = 2.05
		return {
			"label": bolt_label,
			"path": bolt_path,
			"scale": BOLT_MODEL_SCALE,
			"y": 18.0,
			"light_energy": bolt_light,
			"light_range": 95.0,
			"light_y": 16.0,
			"contrast": 1.3,
			"saturation": 1.35,
		}
	if kind == "lootbag":
		return {
			"label": "Loot",
			"path": LOOT_MODEL_PATH,
			"scale": LOOT_MODEL_SCALE,
			"y": 8.0,
			"light_energy": LOOT_LIGHT_ENERGY,
			"light_range": 150.0,
			"light_y": 42.0,
			"contrast": 1.18,
			"saturation": 1.15,
		}
	if kind == "monster":
		var root := _enemy_root()
		if root.ends_with("/AlienSquid"):
			return {
				"label": "Alien Squid",
				"path": ALIEN_SQUID_MODEL_PATH,
				"scale": ALIEN_SQUID_MODEL_SCALE,
				"model_y": 64.0,
				"light_energy": ALIEN_SQUID_LIGHT_ENERGY,
				"light_range": 300.0,
				"light_y": 112.0,
				"contrast": 1.3,
				"saturation": 1.25,
			}
		if root.ends_with("/Ent"):
			return {
				"label": "Ent",
				"path": ENT_MODEL_PATH,
				"anim_aliases": ENT_ANIM_ALIASES,
				"scale": ENT_MODEL_SCALE,
				"model_y": 78.0,
				"light_energy": ENT_LIGHT_ENERGY,
				"light_range": 340.0,
				"light_y": 130.0,
				"contrast": 1.25,
				"saturation": 1.15,
			}
		if root.ends_with("/FireElemental"):
			return {
				"label": "Fire Elemental",
				"path": FIRE_ELEMENTAL_MODEL_PATH,
				"movement_anim_needles": FIRE_ELEMENTAL_MOVEMENT_ANIMS,
				"scale": FIRE_ELEMENTAL_MODEL_SCALE,
				"model_y": 68.0,
				"light_energy": FIRE_ELEMENTAL_LIGHT_ENERGY,
				"light_range": 340.0,
				"light_y": 118.0,
				"contrast": 1.35,
				"saturation": 1.35,
			}
		if root.ends_with("/Ghoul"):
			return {
				"label": "Ghoul",
				"path": GHOUL_MODEL_PATH,
				"scale": GHOUL_MODEL_SCALE,
				"model_y": 64.0,
				"light_energy": GHOUL_LIGHT_ENERGY,
				"light_range": 290.0,
				"light_y": 106.0,
				"contrast": 1.25,
				"saturation": 1.2,
			}
		if root.ends_with("/IceGiant"):
			return {
				"label": "Ice Giant",
				"path": ICE_GIANT_MODEL_PATH,
				"movement_anim_needles": ICE_GIANT_MOVEMENT_ANIMS,
				"scale": ICE_GIANT_MODEL_SCALE,
				"model_y": 73.0,
				"light_energy": ICE_GIANT_LIGHT_ENERGY,
				"light_range": 330.0,
				"light_y": 122.0,
				"contrast": 1.3,
				"saturation": 1.25,
			}
		if root.ends_with("/Infernax"):
			return {
				"label": "Infernax",
				"path": INFERNAX_MODEL_PATH,
				"scale": INFERNAX_MODEL_SCALE,
				"model_y": 67.0,
				"light_energy": INFERNAX_LIGHT_ENERGY,
				"light_range": 310.0,
				"light_y": 112.0,
				"contrast": 1.35,
				"saturation": 1.35,
			}
		if root.ends_with("/Orc"):
			return {
				"label": "Orc",
				"path": ORC_MODEL_PATH,
				"scale": ORC_MODEL_SCALE,
				"model_y": 68.0,
				"light_energy": ORC_LIGHT_ENERGY,
				"light_range": 300.0,
				"light_y": 112.0,
				"contrast": 1.25,
				"saturation": 1.25,
			}
		if root.ends_with("/Pirate"):
			return {
				"label": "Pirate",
				"path": PIRATE_MODEL_PATH,
				"scale": PIRATE_MODEL_SCALE,
				"model_y": 66.0,
				"light_energy": PIRATE_LIGHT_ENERGY,
				"light_range": 300.0,
				"light_y": 110.0,
				"contrast": 1.25,
				"saturation": 1.25,
			}
		if root.ends_with("/SharkMan"):
			return {
				"label": "SharkMan",
				"path": SHARKMAN_MODEL_PATH,
				"scale": SHARKMAN_MODEL_SCALE,
				"model_y": 68.0,
				"light_energy": SHARKMAN_LIGHT_ENERGY,
				"light_range": 310.0,
				"light_y": 114.0,
				"contrast": 1.25,
				"saturation": 1.25,
			}
		if root.ends_with("/Skeleton"):
			return {
				"label": "Skeleton",
				"path": SKELETON_MODEL_PATH,
				"scale": SKELETON_MODEL_SCALE,
				"model_y": 62.0,
				"light_energy": SKELETON_LIGHT_ENERGY,
				"light_range": 280.0,
				"light_y": 104.0,
				"contrast": 1.25,
				"saturation": 1.15,
			}
		if root.ends_with("/Troll"):
			return {
				"label": "Troll",
				"path": TROLL_MODEL_PATH,
				"scale": TROLL_MODEL_SCALE,
				"model_y": 73.0,
				"light_energy": TROLL_LIGHT_ENERGY,
				"light_range": 320.0,
				"light_y": 120.0,
				"contrast": 1.25,
				"saturation": 1.25,
			}
		if root.ends_with("/Wraith"):
			return {
				"label": "Wraith",
				"path": WRAITH_MODEL_PATH,
				"scale": WRAITH_MODEL_SCALE,
				"model_y": 65.0,
				"light_energy": WRAITH_LIGHT_ENERGY,
				"light_range": 310.0,
				"light_y": 116.0,
				"contrast": 1.3,
				"saturation": 1.25,
			}
		if root.ends_with("/Zombie"):
			return {
				"label": "Zombie",
				"path": ZOMBIE_MODEL_PATH,
				"scale": ZOMBIE_MODEL_SCALE,
				"model_y": 65.0,
				"light_energy": ZOMBIE_LIGHT_ENERGY,
				"light_range": 290.0,
				"light_y": 108.0,
				"contrast": 1.25,
				"saturation": 1.2,
			}
	if kind == "boss":
		var boss_model_path := ""
		var boss_model_scale := JAILOR_MODEL_SCALE
		var boss_anim_aliases: Dictionary = {}
		if _entity_name == JAILOR_NAME:
			boss_model_path = JAILOR_MODEL_PATH
		elif _entity_name == BRIAR_REVENANT_NAME:
			boss_model_path = BRIAR_REVENANT_MODEL_PATH
		elif _entity_name == PRIMAL_CONFLUX_NAME:
			boss_model_path = PRIMAL_CONFLUX_MODEL_PATH
		elif _entity_name == JUGGERNAUT_NAME:
			boss_model_path = JUGGERNAUT_MODEL_PATH
		elif _entity_name == TERRORBOT_NAME:
			boss_model_path = TERRORBOT_MODEL_PATH
			boss_model_scale = TERRORBOT_MODEL_SCALE
			boss_anim_aliases = TERRORBOT_ANIM_ALIASES
		elif _entity_name == ICE_GOLEM_NAME:
			boss_model_path = ICE_GOLEM_MODEL_PATH
			boss_model_scale = ICE_GOLEM_MODEL_SCALE
		if boss_model_path != "":
			return {
				"label": _entity_name,
				"path": boss_model_path,
				"anim_aliases": boss_anim_aliases,
				"scale": boss_model_scale,
				"model_y": 200.0,
				"light_energy": JAILOR_LIGHT_ENERGY,
				"light_range": 520.0,
				"light_y": 180.0,
				"contrast": 1.45,
				"saturation": 1.45,
			}
	return {}

func _ensure_model_for_entity() -> void:
	if _model_root != null:
		return
	var profile := _model_profile_for_entity()
	if profile.is_empty():
		return
	_model_profile = profile
	var model_path := str(profile.get("path", ""))
	var label := str(profile.get("label", "3D model"))
	var scene := _load_model_scene(model_path, label)
	# A missing per-class model (asset not synced yet) must NOT drop the hero to the flat 2D
	# atlas — degrade to the default 3D hero model so the avatar still reads as a 3D character.
	if scene == null and is_self and kind == "player" and model_path != HERO_MODEL_PATH:
		push_warning("%s model missing (%s) — falling back to default hero model" % [label, model_path])
		model_path = HERO_MODEL_PATH
		label = "Hero"
		scene = _load_model_scene(model_path, label)
	if scene == null:
		_warn_model_failed_once(model_path, "%s model failed to load: %s" % [label, model_path])
		return
	var inst := scene.instantiate()
	if not (inst is Node3D):
		inst.queue_free()
		push_warning("%s model root is not Node3D: %s" % [label, model_path])
		return
	# Wrap inst in a plain Node3D so update_visual can set rotation.y (facing) on the
	# wrapper without hitting Euler gimbal lock when the static fix uses ±90° around X.
	var wrapper := Node3D.new()
	wrapper.scale = Vector3.ONE * float(profile.get("scale", 1.0))
	var rot_deg: Variant = profile.get("rotation_degrees", null)
	if rot_deg is Vector3:
		(inst as Node3D).rotation_degrees = rot_deg
	wrapper.position.y = float(profile.get("model_y", 0.0))
	wrapper.add_child(inst)
	_model_root = wrapper
	_model_inst = inst as Node3D
	add_child(_model_root)
	if is_self and kind == "player" and not _model_debug_logged:
		print("[DCC] hero model active label=%s class=%s path=%s" % [label, _chosen_class, model_path])
		_model_debug_logged = true
	_model_anim = _find_animation_player(_model_root)
	_brighten_model(_model_root, float(profile.get("contrast", 1.0)), float(profile.get("saturation", 1.0)))
	_attach_weapon_to_model(profile)
	_add_model_light(profile)
	texture = null
	modulate.a = 0.0
	_play_model_anim("idle")

static var _failed_models := {}  # paths that failed once — don't retry (avoids per-frame load spam)
static var _model_failure_warnings := {}

static func _warn_model_failed_once(model_path: String, message: String) -> void:
	if _model_failure_warnings.has(model_path):
		return
	_model_failure_warnings[model_path] = true
	push_warning(message)

func _load_model_scene(model_path: String, label: String) -> PackedScene:
	if _failed_models.has(model_path):
		return null
	if not ResourceLoader.exists(model_path) and not FileAccess.file_exists(model_path):
		_failed_models[model_path] = true
		return null
	var imported := load(model_path)
	if imported is PackedScene:
		return imported

	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(model_path, state)
	if err != OK:
		push_warning("%s GLB parse failed: %s" % [label, error_string(err)])
		return null
	var root := doc.generate_scene(state)
	if root == null:
		return null
	var packed := PackedScene.new()
	err = packed.pack(root)
	root.queue_free()
	if err != OK:
		push_warning("%s scene pack failed: %s" % [label, error_string(err)])
		return null
	return packed

func _find_animation_player(node: Node) -> AnimationPlayer:
	if node is AnimationPlayer:
		return node
	for child in node.get_children():
		var found := _find_animation_player(child)
		if found != null:
			return found
	return null

func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D:
		return node
	for child in node.get_children():
		var found := _find_skeleton(child)
		if found != null:
			return found
	return null

func _first_mesh(node: Node) -> MeshInstance3D:
	if node is MeshInstance3D:
		return node
	for child in node.get_children():
		var found := _first_mesh(child)
		if found != null:
			return found
	return null

func _attach_weapon_to_model(profile: Dictionary) -> void:
	if kind != "player" or _model_inst == null:
		return
	var skeleton := _find_skeleton(_model_inst)
	if skeleton == null:
		push_warning("Weapon attachment skipped: no Skeleton3D found for %s" % str(profile.get("label", "model")))
		return
	var main_bone := _hand_bone_name(skeleton, false)
	if main_bone == "":
		push_warning("Weapon attachment skipped: no right-hand bone found for %s" % str(profile.get("label", "model")))
		return
	var main_item: Dictionary = _equipped_item("mainHand")
	if not main_item.is_empty():
		var main_spec := _weapon_spec_from_item(main_item, "flail", "rare")
		if str(main_spec.get("type", "")) != "shield":
			_attach_weapon_instance(skeleton, main_bone, main_spec, false)

	var off_item: Dictionary = _equipped_item("offHand")
	if off_item.is_empty():
		return
	var off_spec := _weapon_spec_from_item(off_item, "shield", "common")
	var off_type := str(off_spec.get("type", ""))
	if off_type == "":
		return
	var off_bone := _hand_bone_name(skeleton, true)
	if off_bone == "":
		push_warning("Offhand attachment skipped: no left-hand bone found for %s" % str(profile.get("label", "model")))
		return
	_attach_weapon_instance(skeleton, off_bone, off_spec, true)

func _attach_weapon_instance(skeleton: Skeleton3D, bone_name: String, spec: Dictionary, offhand: bool) -> void:
	var weapon_type := str(spec.get("type", ""))
	var weapon_path := _weapon_path_for_spec(spec)
	if weapon_path == "":
		return
	var scene := _load_model_scene(weapon_path, "Weapon")
	if scene == null:
		_warn_model_failed_once(weapon_path, "Weapon model failed to load: %s" % weapon_path)
		return
	var inst := scene.instantiate()
	if not (inst is Node3D):
		inst.queue_free()
		push_warning("Weapon model root is not Node3D: %s" % weapon_path)
		return
	var attachment := BoneAttachment3D.new()
	attachment.bone_name = bone_name
	skeleton.add_child(attachment)
	var weapon := inst as Node3D
	weapon.scale = Vector3.ONE * _weapon_scale_for(weapon_type)
	weapon.position = HERO_OFFHAND_OFFSET if offhand else _weapon_offset_for(weapon_type)
	weapon.rotation_degrees = HERO_OFFHAND_ROTATION_DEGREES if offhand else _weapon_rotation_for(weapon_type)
	if weapon_type == "flail" and weapon.has_method("configure_ball_model"):
		weapon.call("configure_ball_model", _flail_ball_path(str(spec.get("asset_rarity", "Rare"))))
	attachment.add_child(weapon)
	_weapon_attachments.append(attachment)
	if offhand:
		_offhand_weapon_inst = weapon
	else:
		_weapon_inst = weapon
	if weapon.has_method("attach_to_skeleton"):
		weapon.call("attach_to_skeleton", skeleton, bone_name)
	_brighten_model(weapon, 1.08, 1.1)

func _equipped_item(slot: String) -> Dictionary:
	var v: Variant = _equipped_weapons.get(slot, {})
	return v if v is Dictionary else {}

func _weapon_spec_from_item(item: Dictionary, fallback_type: String, fallback_rarity: String) -> Dictionary:
	var weapon_type := _weapon_type_from_item(item, fallback_type)
	var asset_rarity := _weapon_asset_rarity(item, fallback_rarity)
	return {"type": weapon_type, "asset_rarity": asset_rarity}

func _weapon_type_from_item(item: Dictionary, fallback_type: String) -> String:
	var raw := str(item.get("weaponType", item.get("type", ""))).strip_edges().to_lower()
	if ["axe", "bow", "flail", "mace", "shield", "sword"].has(raw):
		return raw
	var name := str(item.get("name", "")).to_lower()
	if name.contains("axe"):
		return "axe"
	if name.contains("bow"):
		return "bow"
	if name.contains("flail"):
		return "flail"
	if name.contains("mace") or name.contains("club") or name.contains("hammer"):
		return "mace"
	if name.contains("shield"):
		return "shield"
	if name.contains("sword") or name.contains("blade"):
		return "sword"
	return fallback_type

func _weapon_asset_rarity(item: Dictionary, fallback_rarity: String) -> String:
	var raw := str(item.get("weaponRarity", item.get("rarity", fallback_rarity))).strip_edges().to_lower()
	return str(WEAPON_ASSET_RARITY.get(raw, WEAPON_ASSET_RARITY.get(fallback_rarity, "Rare")))

func _weapon_path_for_spec(spec: Dictionary) -> String:
	var weapon_type := str(spec.get("type", ""))
	var rarity := str(spec.get("asset_rarity", "Rare"))
	match weapon_type:
		"axe":
			return "res://assets/Weapons/Axe/%s.glb" % rarity
		"bow":
			return "res://assets/Weapons/Bow/%s.glb" % rarity
		"flail":
			return HERO_FLAIL_SCENE_PATH
		"mace":
			return "res://assets/Weapons/Mace/%s.glb" % rarity
		"shield":
			return "res://assets/Weapons/Shield/%s.glb" % rarity
		"sword":
			return "res://assets/Weapons/Sword/%s.glb" % rarity
	return ""

func _flail_ball_path(asset_rarity: String) -> String:
	return "res://assets/Weapons/Flail/Ball/%s.glb" % asset_rarity

func _weapon_scale_for(weapon_type: String) -> float:
	match weapon_type:
		"flail":
			return 1.0
		"shield":
			return 0.36
		"axe":
			return 0.65
		"bow":
			return 0.70
		"mace":
			return 0.65
		"sword":
			return 0.555
	return 1.0

func _weapon_offset_for(weapon_type: String) -> Vector3:
	return HERO_WEAPON_OFFSET

func _weapon_rotation_for(weapon_type: String) -> Vector3:
	return HERO_WEAPON_ROTATION_DEGREES

func _clear_weapons() -> void:
	for attachment in _weapon_attachments:
		if attachment != null and is_instance_valid(attachment):
			attachment.queue_free()
	_weapon_attachments.clear()
	_weapon_inst = null
	_offhand_weapon_inst = null

func _hand_bone_name(skeleton: Skeleton3D, offhand: bool) -> String:
	var candidates := HERO_OFF_HAND_BONES if offhand else HERO_MAIN_HAND_BONES
	for candidate in candidates:
		if skeleton.find_bone(str(candidate)) >= 0:
			return str(candidate)
	var count := skeleton.get_bone_count()
	for i in count:
		var bone := skeleton.get_bone_name(i)
		var lower := bone.to_lower()
		if offhand and (lower.contains("lefthand") or lower.contains("left_hand") or lower.ends_with(":lefthand")):
			return bone
		if not offhand and (lower.contains("righthand") or lower.contains("right_hand") or lower.ends_with(":righthand")):
			return bone
	return ""

func _brighten_model(node: Node, contrast: float, saturation: float) -> void:
	if node is MeshInstance3D:
		var mesh_instance := node as MeshInstance3D
		var surface_count := mesh_instance.mesh.get_surface_count() if mesh_instance.mesh != null else 0
		for i in surface_count:
			var mat := mesh_instance.get_surface_override_material(i)
			if mat == null and mesh_instance.mesh != null:
				mat = mesh_instance.mesh.surface_get_material(i)
			if mat is StandardMaterial3D:
				var copy := (mat as StandardMaterial3D).duplicate() as StandardMaterial3D
				copy.albedo_color = _contrast_color(copy.albedo_color, contrast, saturation)
				copy.emission_enabled = false
				mesh_instance.set_surface_override_material(i, copy)
	for child in node.get_children():
		_brighten_model(child, contrast, saturation)

func _contrast_color(color: Color, contrast: float, saturation: float) -> Color:
	var r := clampf((color.r - 0.5) * contrast + 0.5, 0.0, 1.0)
	var g := clampf((color.g - 0.5) * contrast + 0.5, 0.0, 1.0)
	var b := clampf((color.b - 0.5) * contrast + 0.5, 0.0, 1.0)
	var gray := r * 0.299 + g * 0.587 + b * 0.114
	return Color(
		clampf(gray + (r - gray) * saturation, 0.0, 1.0),
		clampf(gray + (g - gray) * saturation, 0.0, 1.0),
		clampf(gray + (b - gray) * saturation, 0.0, 1.0),
		color.a,
	)

func _add_model_light(profile: Dictionary) -> void:
	var light := OmniLight3D.new()
	light.light_energy = float(profile.get("light_energy", 1.0))
	light.omni_range = float(profile.get("light_range", 260.0))
	light.position = Vector3(0.0, float(profile.get("light_y", 100.0)), 0.0)
	add_child(light)
	_model_light = light

func _play_model_anim(intent: String) -> void:
	if _model_anim == null:
		return
	var names := _model_anim.get_animation_list()
	if names.is_empty():
		return
	var needles := _profile_anim_needles(intent, _base_anim_needles(intent))
	var chosen := String(names[0])
	var matched := false
	for anim_name in names:
		for needle in needles:
			if _anim_name_matches(String(anim_name), needle):
				chosen = String(anim_name)
				matched = true
				break
		if matched:
			break
	if not matched and intent.begins_with("slash_"):
		for anim_name in names:
			for needle in _profile_anim_needles("strike", ["slash", "attack", "strike"]):
				if _anim_name_matches(String(anim_name), needle):
					chosen = String(anim_name)
					matched = true
					break
			if matched:
				break
	if chosen == _model_anim_name and _model_anim.is_playing():
		return
	_model_anim_name = chosen
	if intent == "death":
		var anim := _model_anim.get_animation(chosen)
		if anim != null:
			anim.loop_mode = Animation.LOOP_NONE
	_model_anim.play(chosen)

func _model_anim_duration_ms(intent: String, fallback_ms: float) -> float:
	if _model_anim == null:
		return fallback_ms
	var name := _model_anim_name_for_intent(intent)
	if name == "":
		return fallback_ms
	var anim := _model_anim.get_animation(name)
	if anim == null or anim.length <= 0.0:
		return fallback_ms
	return maxf(fallback_ms, anim.length * 1000.0)

func _model_anim_name_for_intent(intent: String) -> String:
	if _model_anim == null:
		return ""
	var names := _model_anim.get_animation_list()
	if names.is_empty():
		return ""
	var needles := _profile_anim_needles(intent, _base_anim_needles(intent))
	for anim_name in names:
		for needle in needles:
			if _anim_name_matches(String(anim_name), needle):
				return String(anim_name)
	return String(names[0])

func _base_anim_needles(intent: String) -> Array[String]:
	match intent:
		"run":
			return _movement_anim_needles()
		"slash_a":
			return ["slash a", "slash_a", "slasha", "slash 1", "slash_1", "attack a", "attack_a", "attack 1"]
		"slash_b":
			return ["slash b", "slash_b", "slashb", "slash 2", "slash_2", "attack b", "attack_b", "attack 2"]
		"slash_c":
			return ["slash c", "slash_c", "slashc", "slash 3", "slash_3", "attack c", "attack_c", "attack 3"]
		"strike", "punch", "kick":
			return ["attack", "strike", "punch", "slash", "hit"]
		"cast", "bolt":
			return ["cast", "spell", "throw", "pitch", "attack", "strike"]
		"whirlwind":
			return ["whirlwind", "spin", "twirl"]
		"hit", "hurt":
			return ["hit", "hurt", "damage", "impact", "react"]
		"death":
			return ["death", "die", "dead"]
	return ["idle"]

func _profile_anim_needles(intent: String, base_needles: Array[String]) -> Array[String]:
	var merged: Array[String] = []
	var aliases: Dictionary = _model_profile.get("anim_aliases", {})
	if aliases.has(intent):
		for alias in aliases[intent]:
			merged.append(str(alias))
	for needle in base_needles:
		merged.append(needle)
	return merged

func _anim_name_matches(anim_name: String, needle: String) -> bool:
	var lower := anim_name.to_lower()
	var lower_needle := needle.to_lower()
	if lower.contains(lower_needle):
		return true
	return _normalize_anim_name(lower).contains(_normalize_anim_name(lower_needle))

func _normalize_anim_name(value: String) -> String:
	var normalized := value
	for ch in ["_", "-", ".", "|", "/", "\\", ":"]:
		normalized = normalized.replace(ch, " ")
	while normalized.contains("  "):
		normalized = normalized.replace("  ", " ")
	return normalized.strip_edges()

func _movement_anim_needles() -> Array[String]:
	if _model_profile.has("movement_anim_needles"):
		var needles: Array[String] = []
		for needle in _model_profile["movement_anim_needles"]:
			needles.append(str(needle))
		return needles
	if kind == "player":
		return ["jog", "job", "run", "walk", "move"]
	return ["run", "walk", "move"]

func _freeze_death_anim_if_ready(now_ms: float) -> void:
	if not _is_dead_body or _death_frozen or now_ms < _death_freeze_at:
		return
	if _model_anim == null or _model_anim_name == "":
		_death_frozen = true
		return
	var anim := _model_anim.get_animation(_model_anim_name)
	if anim != null and anim.length > 0.0:
		_model_anim.seek(maxf(0.0, anim.length - 0.001), true)
	_model_anim.pause()
	_death_frozen = true

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

func _model_yaw_for_facing(dir: String, flip: bool, offset: float = 0.0) -> float:
	var yaw := 0.0
	match dir:
		"up":
			yaw = PI
		"down":
			yaw = 0.0
		_:
			yaw = -PI * 0.5 if flip else PI * 0.5
	return yaw + offset

func _normalize_class(klass: String) -> String:
	var k := klass.strip_edges().to_lower()
	return "" if k == "null" or k == "<null>" or k == "nil" else k

func _has_chosen_class() -> bool:
	return HERO_CLASS_IDS.has(_chosen_class)

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
	if _model_root != null:
		if _action == "death":
			return
		var model_action := action
		if action == "strike":
			var slash_names := ["slash_a", "slash_b", "slash_c"]
			model_action = slash_names[_model_slash_index % slash_names.size()]
			_model_slash_index += 1
		_action = model_action
		_action_until = now_ms + 650.0
		_play_model_anim(model_action)
		if action == "strike" and _weapon_inst != null and _weapon_inst.has_method("swing"):
			_weapon_inst.call("swing")
		return
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
func update_visual(wx: float, wy: float, dx: float, dy: float, aim: float, now_ms: float, sprite_px: float, ground_z: float = 0.0) -> void:
	_update_ally_overlay() # ally nameplate + HP bar (no-op for non-allies)
	_update_status_fx(now_ms)
	if _is_dead_body:
		position = Vector3(wx, _height_for_kind() + ground_z, wy)
		texture = null
		modulate.a = 0.0
		if _model_root != null:
			_model_root.visible = false
		return

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
	if _action != "" and not _is_dead_body and now_ms >= _action_until:
		_action = ""

	if _model_root != null:
		position = Vector3(wx, float(_model_profile.get("y", 0.0)) + ground_z, wy)
		scale = Vector3.ONE
		texture = null
		modulate.a = 0.0
		if kind == "lootbag":
			_update_loot_model_effects(now_ms)
			_update_loot_lock()
			return
		_model_root.rotation.x = 0.0
		_model_root.rotation.z = 0.0
		if kind == "proj":
			# Bolts face their travel direction. PI - aim maps world-space atan2(z,x)
			# to Godot rotation.y convention for this top-down camera setup.
			_model_root.rotation.y = (PI - aim) + float(_model_profile.get("yaw_offset", 0.0))
			if _projectile_render == "dagger":
				# Tumble end-over-end as the dagger flies (~2 rotations/sec).
				_model_root.rotation.x = fmod(float(now_ms) * 0.012, TAU)
		else:
			var model_dir := _action_facing_dir if _action != "" else _facing_dir
			var model_flip := _action_flip if _action != "" else _flip
			_model_root.rotation.y = _model_yaw_for_facing(model_dir, model_flip, float(_model_profile.get("yaw_offset", 0.0)))
			if _action == "":
				_play_model_anim("run" if moving else "idle")
		return

	# Position. Height offset is kind-dependent (render.ts h), plus the terrain ground height.
	var h := _height_for_kind()
	position = Vector3(wx, h + ground_z, wy)

	# Non-animated kinds: flat-colored billboard (proj / lootbag / spectator etc.).
	if kind != "player" and kind != "monster" and kind != "boss":
		_set_fallback()
		# Loot bags glow by rarity (overbright tint) + shimmer for uncommon+, so you can
		# spot a legendary across the room — CoN's loot-shower legibility.
		if kind == "lootbag":
			modulate = _loot_display_color(now_ms)
			_update_loot_lock()
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

	# Hard CC status tint: frozen (steady icy blue), stunned (dazed yellow pulse), rooted
	# (dim green). Applied before the wind-up tint so a rooted-but-winding-up foe still shows
	# the orange "incoming" tell on top.
	if _cc != "":
		match _cc:
			"freeze":
				modulate = modulate.lerp(Color(0.5, 0.85, 2.0), 0.72)
			"stun":
				var cp := 0.5 + 0.5 * sin(now_ms * 0.02)
				modulate = modulate.lerp(Color(2.1, 1.95, 0.6), 0.42 + 0.34 * cp)
			"root":
				modulate = modulate.lerp(Color(0.7, 1.35, 0.7), 0.5)

	# Attack telegraph: pulsing orange "charge" tint while the enemy winds up (the tell).
	if now_ms < _windup_until:
		var wp := 0.5 + 0.5 * sin(now_ms * 0.025)
		modulate = modulate.lerp(Color(2.6, 1.3, 0.25), 0.4 + 0.5 * wp)

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
		if _projectile_render != "":
			return Color(1, 1, 1, 0)
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
	if _sprite_id == v:
		return
	_sprite_id = v
	_ensure_model_for_entity()

func set_projectile_render(v: String) -> void:
	if _projectile_render == v:
		return
	_projectile_render = v
	_ensure_model_for_entity()

func set_monster_kind(v: String) -> void:
	v = v.strip_edges().to_lower()
	if _monster_kind == v:
		return
	_monster_kind = v
	if kind != "monster":
		return
	if _model_light != null:
		_model_light.queue_free()
		_model_light = null
	if _model_root != null:
		remove_child(_model_root)
		_model_root.free()
		_model_root = null
		_model_inst = null
		_model_anim = null
		_model_anim_name = ""
		_model_profile = {}
		_clear_weapons()
		_status_effects = null
		_status_effect_nodes.clear()
		_status_effect_until.clear()
		_cc_effect = ""
		_model_debug_logged = false
	_ensure_model_for_entity()

# Scale a 128px frame (or fallback quad) to roughly `sprite_px` world units tall/wide.
# render.ts sets sprite.scale to the pixel size directly; with pixel_size=1 a 128px frame
# is 128 world-units, so scale = sprite_px / 128. Fallback (no texture) uses a unit quad.
func _apply_size(sprite_px: float) -> void:
	world_sprite_px = sprite_px
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
