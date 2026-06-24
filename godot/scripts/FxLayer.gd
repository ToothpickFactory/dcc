class_name FxLayer
extends Node3D
## Floating combat feedback from server GameEvents — the visual half of
## render.ts handleEvents() that SpriteLayer (cast/melee/bolt action clips) doesn't
## cover: damage/heal numbers and a death poof. Billboarded Label3D that floats up
## and fades, then frees itself.

func handle_events(events: Array, you_id: String = "") -> void:
	for ev in events:
		if typeof(ev) != TYPE_DICTIONARY:
			continue
		var e: Dictionary = ev
		match str(e.get("e", "")):
			"dmg":
				if e.has("by") and you_id != "" and str(e.get("by", "")) != you_id:
					continue
				_dmg_number(roundi(float(e.get("amount", 0.0))), e)
			"heal":
				_float("+" + str(roundi(float(e.get("amount", 0.0)))), Color(0.42, 1.0, 0.55), e, 44)
			"hit":
				_impact(e)
			"death":
				_poof(e)

func _new_label(text: String, color: Color, size: int, x: float, y: float, h: float) -> Label3D:
	var lbl := Label3D.new()
	lbl.text = text
	lbl.modulate = color
	lbl.font_size = size
	lbl.pixel_size = 1.0
	lbl.outline_size = 10
	lbl.outline_modulate = Color(0, 0, 0, 0.7)
	lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lbl.no_depth_test = true
	lbl.position = Vector3(x, h, y)
	add_child(lbl)
	return lbl

func _float(text: String, color: Color, e: Dictionary, size: int = 44) -> void:
	var lbl := _new_label(text, color, size, float(e.get("x", 0.0)), float(e.get("y", 0.0)), 60.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "position:y", 150.0, 0.85)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.85).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# Damage number scaled by hit size: small chip vs a meaty crit-style hit (bigger, hotter,
# with a pop). Reads the blow's weight at a glance instead of uniform numbers.
func _dmg_number(amount: int, e: Dictionary) -> void:
	var size := clampi(34 + amount, 34, 92)
	var big := amount >= 40
	var color := Color(1.0, 0.78, 0.2) if big else Color(1.0, 0.36, 0.30)
	var txt := ("-%d!" % amount) if big else ("-%d" % amount)
	var lbl := _new_label(txt, color, size, float(e.get("x", 0.0)), float(e.get("y", 0.0)), 62.0)
	if big:
		lbl.scale = Vector3(0.5, 0.5, 0.5)
	var tw := create_tween().set_parallel(true)
	if big:
		tw.tween_property(lbl, "scale", Vector3(1.25, 1.25, 1.25), 0.16).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(lbl, "position:y", 165.0, 0.9)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.9).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# A short-lived fading trail dot behind a projectile (Main calls this for in-vision
# projectiles, throttled). Boss bolts get a violet trail; player/monster shots get gold.
func proj_trail(x: float, y: float, boss: bool) -> void:
	var col := Color(0.78, 0.32, 1.0, 0.7) if boss else Color(1.0, 0.83, 0.4, 0.7)
	var dot := _new_label("•", col, 18, x, y, 12.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(dot, "scale", Vector3(0.3, 0.3, 0.3), 0.24)
	tw.tween_property(dot, "modulate:a", 0.0, 0.24)
	tw.set_parallel(false)
	tw.tween_callback(dot.queue_free)

# "+N XP" gain popup (gold), driven by Main off the self charXp delta on kills. Floats
# higher/slower than damage numbers and offset up so it reads as a reward, not a hit.
func xp_popup(x: float, y: float, amount: int) -> void:
	if amount <= 0:
		return
	var lbl := _new_label("+%d XP" % amount, Color(1.0, 0.86, 0.35), 34, x, y, 80.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "position:y", 200.0, 1.0)
	tw.tween_property(lbl, "modulate:a", 0.0, 1.0).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# Attack telegraph: a warning marker over a winding-up enemy for the tell duration, so
# you can read the incoming hit and dodge/step out (paired with the enemy's charge tint).
func windup_marker(x: float, y: float, ms: float) -> void:
	var dur: float = clampf(ms / 1000.0, 0.15, 1.2)
	var lbl := _new_label("❗", Color(1.0, 0.62, 0.12), 30, x, y, 110.0)
	lbl.scale = Vector3(0.6, 0.6, 0.6)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "scale", Vector3(1.3, 1.3, 1.3), dur * 0.6).set_trans(Tween.TRANS_SINE)
	tw.tween_property(lbl, "modulate:a", 0.0, dur).set_ease(Tween.EASE_IN)
	tw.chain().tween_callback(lbl.queue_free)

# Hard CC landed on a foe: a quick icon pop (💫 stun, ❄️ freeze, 🪢 root) so the control
# reads at the moment it lands (paired with the persistent status tint on the sprite).
func cc_marker(x: float, y: float, kind: String) -> void:
	var icon := "\U01f4ab" # 💫 stun (dizzy)
	var col := Color(1.0, 0.95, 0.5)
	match kind:
		"freeze":
			icon = "❄️"
			col = Color(0.7, 0.92, 1.0)
		"root":
			icon = "\U01faa2" # 🪢 knot
			col = Color(0.65, 1.0, 0.6)
	var lbl := _new_label(icon, col, 32, x, y, 115.0)
	lbl.scale = Vector3(0.4, 0.4, 0.4)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "scale", Vector3(1.35, 1.35, 1.35), 0.2).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(lbl, "position:y", 165.0, 0.7)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.7).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# Projectile/melee impact: a quick bright burst that scales up and fades (the "hit"
# event is emitted by the server but was previously rendered by neither client).
func _impact(e: Dictionary) -> void:
	var x := float(e.get("x", 0.0))
	var y := float(e.get("y", 0.0))
	var lbl := _new_label("✷", Color(1.0, 0.95, 0.6), 30, x, y, 26.0)
	lbl.scale = Vector3(0.4, 0.4, 0.4)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "scale", Vector3(1.7, 1.7, 1.7), 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.22).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# ---- Hit status-effect GLBs: random animated shader overlay at the impact point for 2 s ----
const STATUS_GLB_EFFECTS := {
	"bleed":  "res://assets/StatusEffects/Bleed/Bleed.glb",
	"dark":   "res://assets/StatusEffects/Dark/Dark.glb",
	"fire":   "res://assets/StatusEffects/Fire/Fire.glb",
	"frost":  "res://assets/StatusEffects/Frost/Frost.glb",
	"holy":   "res://assets/StatusEffects/Holy/Holy.glb",
	"poison": "res://assets/StatusEffects/Poison/Poison.glb",
	"stun":   "res://assets/StatusEffects/Stun/Stun.glb",
}
const STATUS_GLB_SHADER_PATHS := {
	"bleed":  "res://shaders/status_effects/bleed.gdshader",
	"dark":   "res://shaders/status_effects/dark.gdshader",
	"fire":   "res://shaders/status_effects/fire.gdshader",
	"frost":  "res://shaders/status_effects/frost.gdshader",
	"holy":   "res://shaders/status_effects/holy.gdshader",
	"poison": "res://shaders/status_effects/poison.gdshader",
	"stun":   "res://shaders/status_effects/stun.gdshader",
}
static var _failed_status_glbs: Dictionary = {}
static var _status_shader_mats: Dictionary = {}
var _active_status_glb: Node3D = null
var _active_status_target: Node3D = null
var _status_glb_index: int = 0

# The GLB scale is set to sprite_px * this factor, so the effect envelops the character.
# Increase to make effects larger relative to the character; 1.35 = 35% taller than the sprite.
const STATUS_GLB_SCALE_FACTOR := 1.35

func _process(_delta: float) -> void:
	if is_instance_valid(_active_status_glb) and is_instance_valid(_active_status_target):
		_active_status_glb.global_position = _active_status_target.global_position

func spawn_status_glb(x: float, y: float, target: Node3D = null, requested_effect: String = "") -> void:
	if is_instance_valid(_active_status_glb):
		return
	var effect_name := _normalize_status_effect(requested_effect)
	if effect_name == "":
		var keys := STATUS_GLB_EFFECTS.keys()
		effect_name = str(keys[_status_glb_index % keys.size()])
		_status_glb_index += 1
	if not STATUS_GLB_EFFECTS.has(effect_name):
		return
	var glb_path := str(STATUS_GLB_EFFECTS[effect_name])
	var scene := _load_status_glb(glb_path)
	if scene == null:
		return
	var inst := scene.instantiate()
	if not (inst is Node3D):
		inst.queue_free()
		return
	var root := inst as Node3D
	var sprite_px: float = 84.0
	if target != null:
		var v = target.get("world_sprite_px")
		if v != null:
			sprite_px = float(v)
	root.scale = Vector3.ONE * (sprite_px * STATUS_GLB_SCALE_FACTOR)
	root.position = Vector3(x, 22.0, y)
	_apply_status_shader(root, effect_name)
	add_child(root)
	if target != null and is_instance_valid(target):
		root.global_position = target.global_position
	_active_status_glb = root
	_active_status_target = target
	_play_all_anims(root)
	var tw := create_tween()
	tw.tween_interval(2.0)
	tw.tween_callback(func():
		if is_instance_valid(root):
			root.queue_free()
		_active_status_glb = null
		_active_status_target = null
	)

func _normalize_status_effect(effect_name: String) -> String:
	var key := effect_name.strip_edges().to_lower()
	match key:
		"shadow":
			return "dark"
		"electric", "lightning", "shock":
			return "stun"
		"ice", "freeze", "frozen":
			return "frost"
		_:
			return key

func _get_status_mat(effect_name: String) -> ShaderMaterial:
	if _status_shader_mats.has(effect_name):
		return _status_shader_mats[effect_name] as ShaderMaterial
	var shader_path := str(STATUS_GLB_SHADER_PATHS.get(effect_name, ""))
	if shader_path == "" or not ResourceLoader.exists(shader_path):
		_status_shader_mats[effect_name] = null
		return null
	var shader := load(shader_path) as Shader
	if shader == null:
		_status_shader_mats[effect_name] = null
		return null
	var mat := ShaderMaterial.new()
	mat.shader = shader
	_status_shader_mats[effect_name] = mat
	return mat

func _apply_status_shader(node: Node, effect_name: String) -> void:
	var mat := _get_status_mat(effect_name)
	if mat == null:
		return
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		if mi.mesh != null:
			for i in mi.mesh.get_surface_count():
				mi.set_surface_override_material(i, mat)
	for child in node.get_children():
		_apply_status_shader(child, effect_name)

static func _load_status_glb(path: String) -> PackedScene:
	if _failed_status_glbs.has(path):
		return null
	if not ResourceLoader.exists(path) and not FileAccess.file_exists(path):
		_failed_status_glbs[path] = true
		return null
	var res := load(path)
	if res is PackedScene:
		return res as PackedScene
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_file(path, state) != OK:
		_failed_status_glbs[path] = true
		return null
	var node := doc.generate_scene(state)
	if node == null:
		_failed_status_glbs[path] = true
		return null
	var packed := PackedScene.new()
	var err := packed.pack(node)
	node.queue_free()
	if err != OK:
		_failed_status_glbs[path] = true
		return null
	return packed

func _play_all_anims(node: Node) -> void:
	if node is AnimationPlayer:
		var ap := node as AnimationPlayer
		var anims := ap.get_animation_list()
		if anims.size() > 0:
			ap.play(str(anims[0]))
	for child in node.get_children():
		_play_all_anims(child)

# Enemy death: a bright core burst plus a few sparks flying outward, so kills land.
func _poof(e: Dictionary) -> void:
	var x := float(e.get("x", 0.0))
	var y := float(e.get("y", 0.0))
	var core := _new_label("✦", Color(1.0, 0.9, 0.55), 44, x, y, 40.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(core, "scale", Vector3(3.0, 3.0, 3.0), 0.45).set_ease(Tween.EASE_OUT)
	tw.tween_property(core, "modulate:a", 0.0, 0.45)
	tw.set_parallel(false)
	tw.tween_callback(core.queue_free)
	# Diverging sparks.
	for i in 5:
		var ang := TAU * float(i) / 5.0 + randf() * 0.6
		var dist := randf_range(55.0, 95.0)
		var spark := _new_label("•", Color(1.0, 0.8, 0.4), 26, x, y, 42.0)
		var st := create_tween().set_parallel(true)
		st.tween_property(spark, "position", Vector3(x + cos(ang) * dist, 18.0, y + sin(ang) * dist), 0.4).set_ease(Tween.EASE_OUT)
		st.tween_property(spark, "modulate:a", 0.0, 0.4).set_ease(Tween.EASE_IN)
		st.set_parallel(false)
		st.tween_callback(spark.queue_free)
