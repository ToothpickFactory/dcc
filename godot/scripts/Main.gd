extends Node3D
## Integrated client (GODOT_PORT.md Phases 1–3): connects to the live /ws, builds the
## floor from server geometry, and drives the ported systems — sprites/animation, the
## line-of-sight fog shader, themed tiles/props, HUD, inventory, minimap, and the
## spectate/waiting camera. The server is unchanged (it just sends floor.geometry).
##
## Verified here: parse-clean import + GdUnit4 logic tests. Visual/interactive behaviour
## (shader look, animation, UI feel) needs a display — run `godot --path godot res://scenes/Main.tscn`.

@export var server_url := DccConst.DEFAULT_WS_URL
@export var player_name := "GodotHero"

const DEFAULT_CAMERA_HEIGHT := 700.0
const DEFAULT_CAMERA_BACK_OFFSET := 560.0
const KEY_LIGHT_HEIGHT := 900.0
const KEY_LIGHT_RIGHT_OFFSET := 520.0
const KEY_LIGHT_BACK_OFFSET := 620.0
const KEY_LIGHT_ENERGY := 1.45
const AMBIENT_LIGHT_ENERGY := 0.72
const WALL_MODEL_SCREEN_MARGIN := 180.0

# Camera framing (Champions-of-Norrath-style: closer + lower over the player). Tunable
# live in the editor. height = how far above; back = how far behind (lower back = more
# top-down). Distance ≈ hypot(height, back); was 820/460 (~940 away, steep top-down).
@export var cam_height := DEFAULT_CAMERA_HEIGHT
@export var cam_back := DEFAULT_CAMERA_BACK_OFFSET
@export var cam_fov := 60.0
@export var cam_zoom_min := 0.62
@export var cam_zoom_max := 1.45
@export var cam_zoom_step := 0.10
@export var cam_zoom_smooth := 12.0
@export var cam_yaw_deg := 0.0
@export var cam_tilt_deg := 0.0
@export var cam_tilt_min_deg := 34.0
@export var cam_tilt_max_deg := 72.0
@export var cam_drag_sensitivity := 0.18
@export var cam_stick_rot_speed := 90.0   # degrees/sec for right-stick yaw
@export var cam_stick_zoom_speed := 0.5   # zoom units/sec for right-stick Y

var _net                       # Net (Node)
var _world: World
var _fog: Fog
var _decor: WorldDecor
var _sprites: SpriteLayer
var _fx: FxLayer
var _cam: Camera3D
var _inp                       # InputCtl (Node)
var _hud: Hud
var _inv: InventoryUI
var _skills: SkillsUI
var _minimap: Minimap
var _spectate := Spectate.new()
var _pred := Predictor.new()
var _seq := 0
var _input_accum := 0.0
var _dbg_accum := 0.0
var _nearest_bag_id := ""
var _loot_prompt: Label
var _mhud: Node  # MobileHud — null on PC
var _gate_hint: Label
var _stairs := Vector2.ZERO   # stairs world pos (for the boss-gate hint)
var _floor_stairs: Dictionary = {}  # raw stairs dict from geometry (saved even when hidden)
var _floor_key := ""               # "seed_depth" — unique per floor even if same depth across runs
var _runover_panel: PanelContainer
var _runover_stats: Label
var _skill_hint: Label
var _skill_nudge_was := ""
var _sfx: Sfx
var _music: Music
var _char_level := -1          # last seen character level (for level-up celebration)
var _char_xp := -1             # last seen charXp (for "+N XP" floaters on kills)
var _shake := 0.0              # screenshake intensity (0..1), decays each frame
var _cam_xy := Vector2.ZERO    # smoothed camera focus (lerped toward target)
var _cam_init := false
var _vignette: DangerVignette
var _hb_accum := 999.0         # heartbeat timer (fires promptly when danger begins)
var _hitstop_until := 0.0      # wall-clock ms; Engine.time_scale dips until then
var _last_hitstop := 0.0       # throttle hit-stop so swarms don't strobe
var _boss_present_was := false # tracks boss presence for the combat-music layer
var _trail_frame := 0          # throttles projectile trail dots
var _key_light: DirectionalLight3D
var _dash_ready_at := 0.0      # client-side dodge cooldown gate (ms)
var _decor_vis_cell := -1
var _decor_live_props_key := ""
var _decor_live_props_tick := -1
var _decor_cached_live_props_key := ""
var _cam_zoom := 1.0
var _cam_zoom_target := 1.0
var _cam_dragging := false
var _lt_pressed := false  # tracks LT axis state for skills-menu toggle
var _pad_cursor_pos := Vector2.ZERO
var _pad_cursor_node: Control = null
const WEAPON_DAMAGE_TYPES := ["fire", "frost", "poison", "bleed", "stun", "holy", "dark"]
var _weapon_damage_types: Dictionary = {}
var _menu_was_open := false
var _connect_banner: Label

func _ready() -> void:
	randomize()
	# Dev overrides: DCC_WS points at a server (e.g. ws://127.0.0.1:8787/ws for local
	# wrangler dev); DCC_SMOKE runs a bounded headless integration smoke then quits.
	var ws_override := OS.get_environment("DCC_WS")
	if ws_override != "":
		server_url = ws_override
	if OS.get_environment("DCC_SMOKE") != "":
		get_tree().create_timer(7.0).timeout.connect(func(): get_tree().quit())
	if OS.get_environment("DCC_SHOT") != "":
		# ignore_time_scale=true so a hit-stop (Engine.time_scale dip) can't dilate the capture timer.
		get_tree().create_timer(4.5, true, false, true).timeout.connect(_grab_shot)
	if OS.get_environment("DCC_RESET") != "":
		get_tree().create_timer(2.5).timeout.connect(_reset_run)
	var open_ui := OS.get_environment("DCC_OPENUI")  # "inv" | "skills" — dev screenshot hook
	if open_ui != "":
		get_tree().create_timer(3.8).timeout.connect(func():
			if open_ui == "skills": _skills.open()
			else: _inv.open())
	var cam_env := OS.get_environment("DCC_CAM")  # "height,back,fov" — quick camera tuning
	if cam_env != "":
		var p := cam_env.split(",")
		if p.size() >= 1 and p[0] != "": cam_height = float(p[0])
		if p.size() >= 2 and p[1] != "": cam_back = float(p[1])
		if p.size() >= 3 and p[2] != "": cam_fov = float(p[2])
	cam_zoom_min = maxf(0.1, cam_zoom_min)
	cam_zoom_max = maxf(cam_zoom_min, cam_zoom_max)
	_cam_zoom = clampf(_cam_zoom, cam_zoom_min, cam_zoom_max)
	_cam_zoom_target = _cam_zoom
	if cam_tilt_deg <= 0.0:
		cam_tilt_deg = rad_to_deg(atan2(cam_height, cam_back))
	cam_tilt_deg = clampf(cam_tilt_deg, cam_tilt_min_deg, cam_tilt_max_deg)

	# Scale all 2D/UI relative to the actual window pixel size so the HUD/minimap
	# aren't tiny on a big hi-DPI window, while the 3D scene keeps native resolution.
	# Deferred so the window has its final size first.
	_apply_ui_scale.call_deferred()
	get_window().size_changed.connect(_apply_ui_scale)

	# Emoji glyphs (item/ability/status icons) need a color-emoji font; the engine
	# default has none, so they'd render as tofu. Install one global fallback so ALL
	# UI (HUD, inventory, skills) renders emoji — see _install_emoji_font.
	_install_emoji_font()

	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color8(0x0b, 0x0e, 0x14)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color.WHITE
	e.ambient_light_energy = AMBIENT_LIGHT_ENERGY
	env.environment = e
	add_child(env)

	_cam = Camera3D.new()
	_cam.fov = cam_fov
	# Tight near/far for depth precision: the camera never gets within ~500px of geometry, and
	# nothing relevant is past ~4000px (vision is ~1000). The old 0.05..8000 range wasted almost
	# all the depth buffer up close, which amplified wall z-fighting/tearing.
	_cam.near = 40.0
	_cam.far = 4000
	add_child(_cam)
	_setup_scene_lighting()

	# Net first — modules bind to it.
	_net = preload("res://scripts/Net.gd").new()
	add_child(_net)

	_world = World.new()
	add_child(_world)

	_fog = Fog.new()
	add_child(_fog)

	_decor = WorldDecor.new()
	_decor.world = _world
	add_child(_decor)

	_sprites = SpriteLayer.new()
	add_child(_sprites)
	_sprites.set_net(_net)

	_hud = Hud.new()
	add_child(_hud)
	_hud.auto_attack_toggled.connect(_on_auto_attack_toggled)

	_inv = InventoryUI.new()
	add_child(_inv)
	_inv.setup(_net)

	_skills = SkillsUI.new()
	add_child(_skills)
	_skills.setup(_net)

	_minimap = Minimap.new()
	add_child(_minimap)

	# "Loot (E)" prompt — shown when a loot bag is within reach.
	var loot_layer := CanvasLayer.new()
	loot_layer.layer = 20
	add_child(loot_layer)
	_loot_prompt = Label.new()
	_loot_prompt.text = "Loot (E)"
	_loot_prompt.add_theme_font_size_override("font_size", 20)
	_loot_prompt.add_theme_color_override("font_color", Color(1.0, 0.85, 0.45))
	_loot_prompt.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_loot_prompt.position.y -= 170
	_loot_prompt.visible = false
	loot_layer.add_child(_loot_prompt)

	# Boss-gate hint — the stairs stay shut until the floor's guardian is dead.
	_gate_hint = Label.new()
	_gate_hint.text = "⚔ Defeat the boss to descend"
	_gate_hint.add_theme_font_size_override("font_size", 20)
	_gate_hint.add_theme_color_override("font_color", Color(1.0, 0.55, 0.5))
	_gate_hint.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_gate_hint.position.y -= 140
	_gate_hint.visible = false
	loot_layer.add_child(_gate_hint)

	# Gamepad virtual cursor — shown when a menu is open, driven by the left stick.
	var cursor_layer := CanvasLayer.new()
	cursor_layer.layer = 30  # above all UI layers (inv=25, skills=26)
	add_child(cursor_layer)
	_pad_cursor_node = Label.new()
	_pad_cursor_node.text = "✛"
	_pad_cursor_node.add_theme_font_size_override("font_size", 24)
	_pad_cursor_node.add_theme_color_override("font_color", Color(1.0, 0.9, 0.3, 0.9))
	_pad_cursor_node.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_pad_cursor_node.visible = false
	cursor_layer.add_child(_pad_cursor_node)
	_pad_cursor_pos = get_viewport().get_visible_rect().size * Vector2(0.5, 0.4)

	# Run-over death summary: a centered card with your run stats + how to restart.
	_runover_panel = PanelContainer.new()
	_runover_panel.visible = false
	_runover_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	_runover_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_runover_panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	var ro_sb := StyleBoxFlat.new()
	ro_sb.bg_color = Color8(0x12, 0x10, 0x16, 0xee)
	ro_sb.border_color = Color8(0xd0, 0x8a, 0x2a)
	ro_sb.set_border_width_all(2)
	ro_sb.set_corner_radius_all(16)
	ro_sb.set_content_margin_all(28)
	_runover_panel.add_theme_stylebox_override("panel", ro_sb)
	var ro_col := VBoxContainer.new()
	ro_col.alignment = BoxContainer.ALIGNMENT_CENTER
	ro_col.add_theme_constant_override("separation", 12)
	var ro_title := Label.new()
	ro_title.text = "🏁 RUN OVER"
	ro_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ro_title.add_theme_font_size_override("font_size", 40)
	ro_title.add_theme_color_override("font_color", Color(1.0, 0.83, 0.30))
	_runover_stats = Label.new()
	_runover_stats.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_runover_stats.add_theme_font_size_override("font_size", 18)
	_runover_stats.add_theme_color_override("font_color", Color(0.84, 0.88, 0.95))
	var ro_hint := Label.new()
	ro_hint.text = "Press F2 to start a new run"
	ro_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ro_hint.add_theme_font_size_override("font_size", 16)
	ro_hint.add_theme_color_override("font_color", Color(0.55, 0.62, 0.74))
	ro_col.add_child(ro_title)
	ro_col.add_child(_runover_stats)
	ro_col.add_child(ro_hint)
	_runover_panel.add_child(ro_col)
	loot_layer.add_child(_runover_panel)

	# Skill-ready glow: nudge the player to open the Skills screen when an ability matures.
	_skill_hint = Label.new()
	_skill_hint.text = "✨ A skill is ready to evolve — press K"
	_skill_hint.add_theme_font_size_override("font_size", 18)
	_skill_hint.add_theme_color_override("font_color", Color(1.0, 0.83, 0.30))
	_skill_hint.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_skill_hint.position.y -= 210
	_skill_hint.visible = false
	loot_layer.add_child(_skill_hint)

	_inp = preload("res://scripts/InputCtl.gd").new()
	add_child(_inp)

	var mhud := preload("res://scripts/MobileHud.gd").new()
	mhud.setup(_inp, _inv, _skills)
	add_child(mhud)
	if OS.has_feature("mobile"):
		_mhud = mhud

	_fx = FxLayer.new()
	add_child(_fx)

	_sfx = Sfx.new()
	add_child(_sfx)
	_inv.set_sfx(_sfx)
	_skills.set_sfx(_sfx)

	_music = Music.new()
	add_child(_music)

	_vignette = DangerVignette.new()
	add_child(_vignette)

	_net.protocol_mismatch.connect(_on_protocol_mismatch)
	_net.floor_received.connect(_on_floor)
	_net.inv_received.connect(func(m):
		_inv.on_inv(m)
		var inv_data: Variant = (m as Dictionary).get("inv", {})
		if inv_data is Dictionary:
			var all_items: Array = []
			var carried: Variant = (inv_data as Dictionary).get("carried", [])
			if carried is Array:
				all_items.append_array(carried as Array)
			var eq: Variant = (inv_data as Dictionary).get("equipped", {})
			if eq is Dictionary:
				for v in (eq as Dictionary).values():
					if v is Dictionary:
						all_items.append(v)
			_assign_weapon_damage_types(all_items)
	)
	_net.bag_received.connect(func(m):
		_inv.on_bag(m)
		var bag_items: Variant = (m as Dictionary).get("items", [])
		if bag_items is Array:
			_assign_weapon_damage_types(bag_items as Array)
	)
	_net.shop_received.connect(func(m): _inv.on_shop(m))
	_net.events_received.connect(_on_events)
	_net.loot_received.connect(_on_loot)
	_net.closed.connect(_on_net_closed)
	_net.welcomed.connect(func(you):
		print("[DCC] welcome you=", you)
		_hide_connect_banner()
		_net.send_msg({"t": "setAutoAttack", "enabled": false}))

	# Name screen before connecting (skipped headless / in diagnostic modes).
	if _skip_login():
		_show_connect_banner("Connecting to %s ..." % server_url)
		_net.start(server_url, player_name)
		_start_connect_watchdog()
	else:
		var login := Login.new()
		add_child(login)
		login.submitted.connect(func(n):
			player_name = n
			_show_connect_banner("Connecting to %s ..." % server_url)
			_net.start(server_url, n)
			_start_connect_watchdog())

func _setup_scene_lighting() -> void:
	_key_light = DirectionalLight3D.new()
	_key_light.name = "KeyLight"
	_key_light.light_energy = KEY_LIGHT_ENERGY
	_key_light.light_color = Color(1.0, 0.94, 0.84)
	_key_light.shadow_enabled = false
	add_child(_key_light)

func _update_scene_lighting(cx: float, cy: float) -> void:
	if _key_light == null:
		return
	_key_light.position = Vector3(cx + KEY_LIGHT_RIGHT_OFFSET, KEY_LIGHT_HEIGHT, cy + KEY_LIGHT_BACK_OFFSET)
	_key_light.look_at(Vector3(cx, 35.0, cy), Vector3.UP)

func _apply_ui_scale() -> void:
	# ~1280px logical reference; clamp so it never shrinks below 1x or balloons.
	var w := float(get_window().size.x)
	get_window().content_scale_factor = clampf(w / 1280.0, 1.0, 2.5)

func _skip_login() -> bool:
	if DisplayServer.get_name() == "headless":
		return true
	for v in ["DCC_SMOKE", "DCC_AUTOMOVE", "DCC_NOLOGIN"]:
		if OS.get_environment(v) != "":
			return true
	return false

# Admin reset: start a fresh run for everyone (the server's /admin/new-run, open
# while ADMIN_OPEN=true). Derives the HTTP base from the WS server_url. Bound to F2.
func _admin_base() -> String:
	var u := server_url
	if u.begins_with("wss://"):
		u = "https://" + u.substr(6)
	elif u.begins_with("ws://"):
		u = "http://" + u.substr(5)
	if u.ends_with("/ws"):
		u = u.substr(0, u.length() - 3)
	return u

func _reset_run() -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(_result, code, _headers, _body):
		print("[DCC] reset HTTP code=", code)
		if code == 200:
			_hud.toast("New run started", Color(0.36, 1.0, 0.43))
		else:
			_hud.toast("Reset failed (%d)" % code, Color(1.0, 0.5, 0.5))
		http.queue_free())
	await get_tree().process_frame  # HTTPRequest must be settled in the tree first
	var err := http.request(_admin_base() + "/admin/new-run", PackedStringArray(), HTTPClient.METHOD_POST)
	if err != OK:
		print("[DCC] reset request err=", err)
		_hud.toast("Reset request failed", Color(1.0, 0.5, 0.5))
		http.queue_free()

# Server is on a newer protocol than this build — surface it LOUDLY (a stale build that
# silently joins a newer server renders a confusing blank/half-broken world). Persistent
# banner so it can't be missed; the fix is to rebuild (run launch-dcc).
func _on_protocol_mismatch(server_v, client_v) -> void:
	var banner := Label.new()
	banner.text = "⚠ Outdated build — server v%d, you v%d. Rebuild to update (run launch-dcc)." % [server_v, client_v]
	banner.add_theme_font_size_override("font_size", 18)
	banner.add_theme_color_override("font_color", Color(1.0, 0.45, 0.45))
	banner.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.85))
	banner.add_theme_constant_override("shadow_offset_y", 2)
	banner.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	banner.position.y += 60
	var layer := CanvasLayer.new()
	layer.layer = 40  # above everything
	add_child(layer)
	layer.add_child(banner)

# A playstyle-tailored ability dropped — celebrate it (the server sends t:"loot"; this was
# silently dropped before). Rarity-colored toast + a pop sfx so the reward lands.
func _on_loot(grant) -> void:
	if not (grant is Dictionary):
		return
	var ability: Dictionary = grant.get("ability", {})
	var rarity := str(grant.get("rarity", "common"))
	var icon := str(ability.get("icon", "✦")) if ability.get("icon", null) != null else "✦"
	var nm := str(ability.get("name", "New ability"))
	_hud.toast("%s  %s!  (%s)" % [icon, nm, rarity], _rarity_color(rarity))
	_sfx.play("loot")
	if rarity == "epic" or rarity == "legendary":
		_shake = 0.6  # a little screen pop for the big ones

func _on_auto_attack_toggled(enabled: bool) -> void:
	_net.send_msg({"t": "setAutoAttack", "enabled": enabled})
	_hud.toast("Auto attack on" if enabled else "Auto attack off", Color8(0xff, 0xd3, 0x4d) if enabled else Color8(0x9f, 0xb0, 0xd0))

func _rarity_color(r: String) -> Color:
	match r:
		"uncommon": return Color8(0x3f, 0xae, 0x5a)
		"rare": return Color8(0x3a, 0x7b, 0xd5)
		"epic": return Color8(0x9b, 0x59, 0xd0)
		"legendary": return Color8(0xe7, 0xc1, 0x4d)
		_: return Color8(0xcf, 0xd6, 0xe6)

func _bag_present(id: String) -> bool:
	for e in _net.ents:
		if typeof(e) == TYPE_DICTIONARY and str(e.get("id", "")) == id:
			return true
	return false

func _show_connect_banner(text: String) -> void:
	if _connect_banner == null:
		var layer := CanvasLayer.new()
		layer.layer = 90
		layer.name = "ConnectionStatus"
		add_child(layer)
		_connect_banner = Label.new()
		_connect_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_connect_banner.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		_connect_banner.add_theme_font_size_override("font_size", 18)
		_connect_banner.add_theme_color_override("font_color", Color(1.0, 0.78, 0.38))
		_connect_banner.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
		_connect_banner.position.y = 18
		layer.add_child(_connect_banner)
	_connect_banner.text = text
	_connect_banner.visible = true

func _hide_connect_banner() -> void:
	if _connect_banner != null:
		_connect_banner.visible = false

func _start_connect_watchdog() -> void:
	get_tree().create_timer(4.0).timeout.connect(func():
		if _net != null and str(_net.you) == "":
			_show_connect_banner("Still connecting to %s. Check that npm run dev says Ready and only one dev server is running." % server_url))

func _on_net_closed() -> void:
	if _net != null and str(_net.you) == "":
		_show_connect_banner("Could not connect to %s. Restart npm run dev, wait for Ready, then relaunch." % server_url)

func _current_weapon_loadout() -> Dictionary:
	if _net == null:
		return {}
	var inv_msg: Variant = _net.get("last_inv")
	if not (inv_msg is Dictionary):
		return {}
	var inv: Variant = (inv_msg as Dictionary).get("inv", {})
	if not (inv is Dictionary):
		return {}
	var equipped: Variant = (inv as Dictionary).get("equipped", {})
	if not (equipped is Dictionary):
		return {}
	var out := {}
	for slot in ["mainHand", "offHand"]:
		var item: Variant = (equipped as Dictionary).get(slot, null)
		if item is Dictionary:
			out[slot] = item
	return out

func _on_events(events: Array) -> void:
	_sprites.handle_events(events, _net.ents, _net.you, Vector2(_pred.x, _pred.y))
	_fx.handle_events(events, _net.you)
	# Juice + audio: drive hit-flash, sfx, screenshake, and boss callouts off the same events.
	var pp := Vector2(_pred.x, _pred.y)
	for ev in events:
		if not (ev is Dictionary):
			continue
		match str(ev.get("e", "")):
			"dmg":
				var vp := Vector2(float(ev.get("x", 0.0)), float(ev.get("y", 0.0)))
				var self_hit := vp.distance_to(pp) < 38.0
				_sprites.flash_at(vp.x, vp.y, 70.0, self_hit, "hit")
				var status := str(ev.get("status", ""))
				if status == "" and not self_hit:
					var w: Variant = _current_weapon_loadout().get("mainHand", null)
					if w is Dictionary:
						status = str(_weapon_damage_types.get(str((w as Dictionary).get("id", "")), ""))
				if status != "":
					_sprites.status_at(vp.x, vp.y, status, 90.0)
				_fx.spawn_status_glb(vp.x, vp.y, _sprites.nearest_sprite_at(vp.x, vp.y, 70.0), status)
				if self_hit:
					_shake = 1.0
					_sfx.play("hurt")
					Input.start_joy_vibration(0, 0.35, 0.6, 0.18)  # gamepad rumble (no-op if none)
				else:
					_sfx.play("hit")
			"hit":
				_sfx.play("hit", -3.0)
			"death":
				_sprites.flash_id(str(ev.get("id", "")), false, "death")
				_sfx.play("death")
				# Hit-stop on a nearby kill (throttled so swarms don't strobe).
				var dp := Vector2(float(ev.get("x", 0.0)), float(ev.get("y", 0.0)))
				var now_ms := float(Time.get_ticks_msec())
				if dp.distance_to(pp) < 460.0 and now_ms - _last_hitstop > 220.0:
					_last_hitstop = now_ms
					_hitstop_until = now_ms + 55.0
			"cast":
				# Only your own casts (origin ~ your position) — avoids audio spam from every caster.
				if Vector2(float(ev.get("x", 0.0)), float(ev.get("y", 0.0))).distance_to(pp) < 40.0:
					_sfx.play("cast")
			"windup":
				# Enemy attack telegraph: charge tint on the attacker + a warning marker.
				_sprites.windup_id(str(ev.get("by", "")), float(ev.get("ms", 300.0)))
				_fx.windup_marker(float(ev.get("x", 0.0)), float(ev.get("y", 0.0)), float(ev.get("ms", 300.0)))
			"cc":
				# Hard CC landed on a foe: a pop icon (stun/root/freeze) + a sfx if it's near you.
				var ccx := float(ev.get("x", 0.0))
				var ccy := float(ev.get("y", 0.0))
				_fx.cc_marker(ccx, ccy, str(ev.get("kind", "stun")))
				if Vector2(ccx, ccy).distance_to(pp) < 520.0:
					_sfx.play("cast", -4.0)
			"boss":
				if str(ev.get("state", "")) == "spawn":
					_hud.toast("⚠ A BOSS has awoken — dodge its bolts! ⚠", Color8(0xe7, 0xb3, 0xff))
				else:
					# Show the exit immediately using the saved stairs position.
					# The floor message (broadcastFloorRun) arrives first in normal
					# ordering, but this covers the fallback case where it arrives
					# after or the decor/minimap weren't updated yet.
					if not _floor_stairs.is_empty():
						_decor.show_stairs(_floor_stairs)
						_minimap.update_stairs(_floor_stairs)
						_stairs = Vector2(float(_floor_stairs.get("x", 0.0)), float(_floor_stairs.get("y", 0.0)))
					_mark_exit_on_minimap()
					_hud.toast("☠ The boss has been slain! ☠", Color8(0xff, 0xd3, 0x4d))

func _assign_weapon_damage_types(items: Array) -> void:
	for item in items:
		if not (item is Dictionary):
			continue
		var item_id := str((item as Dictionary).get("id", ""))
		if item_id == "" or _weapon_damage_types.has(item_id):
			continue
		var wtype := str((item as Dictionary).get("weaponType", (item as Dictionary).get("type", ""))).strip_edges().to_lower()
		var iname := str((item as Dictionary).get("name", "")).to_lower()
		var is_weapon := ["axe", "flail", "shield", "sword"].has(wtype) \
			or iname.contains("axe") or iname.contains("flail") \
			or iname.contains("shield") or iname.contains("sword") or iname.contains("blade")
		if is_weapon:
			_weapon_damage_types[item_id] = WEAPON_DAMAGE_TYPES[randi() % WEAPON_DAMAGE_TYPES.size()]

# Global color-emoji fallback so emoji glyphs (item/ability/status icons) render instead
# of tofu. Prefer a bundled font if someone dropped one in res://fonts/; otherwise use the
# OS emoji font (Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji). Appending it to the
# engine's default font makes every Label/RichTextLabel that uses the default font inherit it.
func _install_emoji_font() -> void:
	var base: Font = ThemeDB.fallback_font
	if base == null:
		return
	var emoji: Font = null
	for p in ["res://fonts/NotoColorEmoji.ttf", "res://fonts/NotoColorEmoji-Regular.ttf"]:
		if ResourceLoader.exists(p):
			var f := load(p)
			if f is Font:
				emoji = f
				break
	if emoji == null:
		var sf := SystemFont.new()
		sf.font_names = PackedStringArray(["Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Noto Emoji", "Twemoji Mozilla", "EmojiOne Color"])
		sf.allow_system_fallback = true
		emoji = sf
	var fbs: Array = base.fallbacks
	fbs.append(emoji)
	base.fallbacks = fbs

func _on_floor(geometry: Dictionary, info: Dictionary) -> void:
	if geometry.is_empty():
		# The server didn't send floor.geometry — it's pre-protocol-v6. Make the
		# failure visible instead of a silent black screen.
		push_warning("Floor message has no `geometry`: the server hasn't shipped protocol v6. " +
			"Deploy it (npm run deploy) or run vs local: DCC_WS=ws://127.0.0.1:8787/ws against npm run dev.")
		_hud.toast("No floor geometry — deploy the server (protocol v6)", _color_of("#ff8a8a"))
		return
	# Always save the raw stairs dict so the boss-death handler can use it even
	# when exitOpen was false on the first receive (stairs are omitted from decor
	# until the boss dies, but we need the coordinates for when it opens).
	_floor_stairs = geometry.get("stairs", {})
	# Use seed+depth as the floor key so a new run that starts at depth 1 is not
	# confused with a same-floor boss-death re-send (index == depth, so it repeats).
	var new_floor_key := "%d_%d" % [int(info.get("seed", 0)), int(info.get("depth", 0))]
	var same_floor := not _floor_key.is_empty() and new_floor_key == _floor_key
	if same_floor:
		# Same floor re-send: the server is telling us exitOpen changed (boss died).
		# Avoid a full world rebuild — just show the exit without resetting fog or
		# replaying the descent title/sound.
		var stairs: Dictionary = _floor_stairs if bool(_net.floor_state.get("exitOpen", true)) else {}
		if not stairs.is_empty():
			_decor.show_stairs(stairs)
			_minimap.update_stairs(stairs)
			_stairs = Vector2(float(stairs.get("x", 0.0)), float(stairs.get("y", 0.0)))
			_mark_exit_on_minimap()
		return
	_floor_key = new_floor_key
	_world.build(geometry)
	_pred.set_grid(_world.grid)
	_fog.attach(_world)
	var theme := str(info.get("theme", "fantasy"))
	var forced_theme := OS.get_environment("DCC_FORCE_THEME")
	if forced_theme != "":
		theme = forced_theme
	var stairs: Dictionary = _floor_stairs if bool(_net.floor_state.get("exitOpen", true)) else {}
	_decor.world = _world
	_decor.apply(theme, geometry.get("decorations", []), stairs, geometry.get("hazards", []), geometry.get("portals", []))
	_sprites.set_grid(_world.grid)
	_minimap.set_floor(_world.grid, stairs)
	if not stairs.is_empty():
		_mark_exit_on_minimap()
	_decor_vis_cell = -1
	_decor_live_props_key = ""
	_decor_live_props_tick = -1
	_decor_cached_live_props_key = ""
	var st: Dictionary = stairs
	_stairs = Vector2(float(st.get("x", 0.0)), float(st.get("y", 0.0)))
	_hud.set_floor(int(info.get("depth", 1)), theme, float(_net.floor_state.get("endsAt", 0.0)))
	_music.set_theme(theme)
	_hud.floor_title(int(info.get("depth", 1)), theme)  # "Floor N · Theme" card
	_sfx.play("descent")
	_char_level = -1  # re-sync level/xp baselines on floor/run change (avoids spurious toasts)
	_char_xp = -1
	if OS.get_environment("DCC_DEBUG") != "":
		var wi := _world.wall_instance()
		var wc: int = wi.multimesh.instance_count if wi != null and wi.multimesh != null else -1
		print("[DBG] floor built grid=", _world.grid.get("w"), "x", _world.grid.get("h"), " cell=", _world.grid.get("cell"), " walls=", wc, " stairs=", _floor_stairs)

func _mark_exit_on_minimap() -> void:
	if _minimap == null:
		return
	_minimap.highlight_stairs()

func _process(dt: float) -> void:
	# Hit-stop: a brief global slow-mo on a nearby kill makes blows land (see _on_events).
	# Keyed off wall-clock (unaffected by time_scale) so it always restores.
	Engine.time_scale = 0.12 if Time.get_ticks_msec() < _hitstop_until else 1.0

	var menu_open := _inv.is_open() or _skills.is_open() or _inv.loot_open_bag_id() != ""

	var mv: Vector2 = _inp.move_vec()
	if menu_open:
		mv = Vector2.ZERO  # left stick drives the cursor, not the character
	if OS.get_environment("DCC_AUTOMOVE") != "":
		mv = Vector2(1, 0)  # diagnostic: simulate holding right to test the move pipeline
	# Rotate movement into world space based on camera yaw so "forward" always means
	# "toward the top of the screen" regardless of how the camera is oriented.
	var _cam_yaw_rad := deg_to_rad(cam_yaw_deg)
	mv = mv.rotated(-_cam_yaw_rad)
	# Feed live props and characters to the predictor so it collides like the server.
	var props: Array = []
	for e in _net.ents:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		var eid := str(e.get("id", ""))
		if eid == _net.you or bool(e.get("dead", false)):
			continue
		var er := _entity_collision_radius(e)
		if er > 0.0:
			props.append({"x": float(e.get("x", 0.0)), "y": float(e.get("y", 0.0)), "r": er})
	_pred.set_props(props)
	_pred.update(_net.self_dto, mv, dt)
	# While a menu is open, freeze aim so left-stick cursor movement doesn't spin
	# the character. aim_from() is skipped entirely to avoid updating _last_aim.
	var aim: float = _inp.aim_from(_cam, _pred.x, _pred.y, _cam_yaw_rad) if not menu_open else _inp.last_aim

	# Spectate/waiting state machine drives the camera target while out of play.
	var sp: Dictionary = _spectate.update(_net, mv, Vector2(_pred.x, _pred.y), dt)
	var spectating: bool = sp.get("spectating", false)

	var alive := str(_net.self_dto.get("status", "")) == "alive" and not bool(_net.self_dto.get("reached", false))
	if alive:
		# Always send movement (mv=0 when menu open) so server knows to stop the char.
		_input_accum += dt
		if _input_accum * 1000.0 >= DccConst.INPUT_MS:
			_input_accum = 0.0
			_seq += 1
			_net.send_input(_seq, mv, aim)
		if not menu_open:
			var casts: Array = _inp.take_casts()
			if not casts.is_empty():
				var cast_aim := _assist_aim(aim)  # light snap toward a nearby enemy in the aim cone
				for idx in casts:
					_seq += 1
					_net.send_cast(_seq, int(idx), cast_aim)
					_hud.pulse_slot(int(idx))  # bar-slot punch on cast (readability)
			# Dodge/dash (Space / LB): client-gated cooldown, predicted burst + whoosh.
			if _inp.consume_dash():
				var now_ms := float(Time.get_ticks_msec())
				if now_ms >= _dash_ready_at:
					_dash_ready_at = now_ms + DccConst.DASH_CD
					var ddir: Vector2 = mv if mv.length() > 0.01 else Vector2(cos(aim), sin(aim))
					_seq += 1
					_net.send_dash(_seq, ddir)
					_pred.dash(ddir)
					_sfx.play("dash")
		else:
			_inp.take_casts()    # drain without firing so queue doesn't back up
			_inp.consume_dash()  # drain without dashing

	# Camera + fog centre: predicted player in play, spectate target while waiting/dead.
	# Smoothed follow (lerp toward the target) + decaying screenshake on taking damage.
	var cam_t: Vector2 = sp.get("cam_target", Vector2(_pred.x, _pred.y))
	var target := cam_t if spectating else Vector2(_pred.x, _pred.y)
	if not _cam_init or _cam_xy.distance_to(target) > 700.0:
		_cam_xy = target  # snap on first frame / floor change / spectate jump
		_cam_init = true
	else:
		_cam_xy = _cam_xy.lerp(target, clampf(dt * 14.0, 0.0, 1.0))
	var shake := Vector2.ZERO
	if _shake > 0.0:
		_shake = maxf(0.0, _shake - dt * 3.5)
		var mag := 26.0 * _shake * _shake
		shake = Vector2(randf_range(-mag, mag), randf_range(-mag, mag))
	var cx: float = _cam_xy.x + shake.x
	var cy: float = _cam_xy.y + shake.y
	# Heightfield 2.5D: lift the camera + its look target by the focus point's ground height so the
	# framing stays constant over hills/pits instead of the player rising out of / sinking below frame.
	var fgz: float = Geo.ground_height(_world.grid, _cam_xy.x, _cam_xy.y) if _world != null and not _world.grid.is_empty() else 0.0
	# Right stick: X rotates the camera yaw, Y zooms (push up = zoom in).
	# Uses InputCtl's event-cached axis values — polling is unreliable on Android.
	const _STICK_DEAD := 0.15
	var _rs: Vector2 = _inp.right_stick()
	var _rs_x: float = _rs.x
	var _rs_y: float = _rs.y
	if absf(_rs_x) > _STICK_DEAD:
		cam_yaw_deg = wrapf(cam_yaw_deg + _rs_x * cam_stick_rot_speed * dt, -180.0, 180.0)
	if absf(_rs_y) > _STICK_DEAD:
		_cam_zoom_target = clampf(_cam_zoom_target + _rs_y * cam_stick_zoom_speed * dt, cam_zoom_min, cam_zoom_max)

	_cam_zoom = lerpf(_cam_zoom, _cam_zoom_target, clampf(dt * cam_zoom_smooth, 0.0, 1.0))
	var base_dist := sqrt(cam_height * cam_height + cam_back * cam_back) * _cam_zoom
	var tilt := deg_to_rad(clampf(cam_tilt_deg, cam_tilt_min_deg, cam_tilt_max_deg))
	var yaw := deg_to_rad(cam_yaw_deg)
	var zoom_height := sin(tilt) * base_dist
	var zoom_back := cos(tilt) * base_dist
	var orbit_x := sin(yaw) * zoom_back
	var orbit_z := cos(yaw) * zoom_back
	_cam.position = Vector3(cx + orbit_x, zoom_height + fgz, cy + orbit_z)
	_cam.look_at(Vector3(cx, fgz, cy), Vector3.UP)
	_update_scene_lighting(_cam_xy.x, _cam_xy.y)
	_fog.set_vision(_cam_xy.x, _cam_xy.y)  # un-shaken so fog doesn't jitter
	_update_decor_visibility(_cam_xy.x, _cam_xy.y)

	# Gamepad cursor: move with the left stick when any menu is open.
	if menu_open:
		if not _menu_was_open:
			_pad_cursor_pos = get_viewport().get_visible_rect().size * Vector2(0.5, 0.4)
		const PAD_CURSOR_SPEED := 900.0
		const PAD_CURSOR_DEAD := 0.15
		var ls: Vector2 = _inp.left_stick()
		if ls.length() > PAD_CURSOR_DEAD:
			_pad_cursor_pos += ls * PAD_CURSOR_SPEED * dt
		var vp_size := get_viewport().get_visible_rect().size
		_pad_cursor_pos = _pad_cursor_pos.clamp(Vector2.ZERO, vp_size)
		# Auto-scroll when the cursor is within 12% of the top or bottom edge.
		var sc: ScrollContainer = null
		if _inv.is_open() or _inv.loot_open_bag_id() != "":
			sc = _inv.get_active_scroll()
		elif _skills.is_open():
			sc = _skills.get_scroll()
		if sc != null:
			var zone := vp_size.y * 0.12
			if _pad_cursor_pos.y > vp_size.y - zone:
				sc.scroll_vertical += int(600.0 * dt)
			elif _pad_cursor_pos.y < zone:
				sc.scroll_vertical -= int(600.0 * dt)
		_pad_cursor_node.position = _pad_cursor_pos - Vector2(12, 14)
		_pad_cursor_node.visible = true
	else:
		_pad_cursor_node.visible = false
	_menu_was_open = menu_open

	# Danger feedback: red vignette + quickening heartbeat as HP drops (alive only).
	var danger := 0.0
	if alive:
		var hp := float(_net.self_dto.get("hp", 0.0))
		var mhp := maxf(1.0, float(_net.self_dto.get("maxHp", 1.0)))
		var ratio := hp / mhp
		if ratio < 0.4:
			danger = (0.4 - ratio) / 0.4  # 0 at 40% HP -> 1 at death
	var pulse := 0.6 + 0.4 * sin(Time.get_ticks_msec() / 1000.0 * (4.0 + danger * 5.0) * TAU)
	_vignette.set_danger(danger * 0.7 * pulse)
	if danger > 0.05:
		_hb_accum += dt
		if _hb_accum >= lerpf(0.95, 0.40, danger):  # faster heartbeat the lower you are
			_hb_accum = 0.0
			_sfx.play("heartbeat", -2.0)
	else:
		_hb_accum = 999.0

	# Boss-intensity music: layer the combat pulse in while a boss is alive.
	var boss_present := false
	for e in _net.ents:
		if typeof(e) == TYPE_DICTIONARY and str(e.get("kind", "")) == "boss":
			boss_present = true
			break
	if boss_present != _boss_present_was:
		_boss_present_was = boss_present
		_music.set_combat(boss_present)
	# Boss gates the stairs: hint when you're at the exit but the guardian still lives.
	_gate_hint.visible = alive and boss_present and _stairs != Vector2.ZERO and Vector2(_pred.x, _pred.y).distance_to(_stairs) < 150.0

	# Projectile trails: drop a fading dot behind in-vision projectiles (throttled).
	_trail_frame += 1
	if _trail_frame % 2 == 0:
		var vsq := DccConst.VISION_RADIUS * DccConst.VISION_RADIUS
		for e in _net.ents:
			if typeof(e) != TYPE_DICTIONARY or str(e.get("kind", "")) != "proj":
				continue
			var ex := float(e.get("x", 0.0))
			var ey := float(e.get("y", 0.0))
			if (ex - _pred.x) * (ex - _pred.x) + (ey - _pred.y) * (ey - _pred.y) <= vsq:
				_fx.proj_trail(ex, ey, int(e.get("sprite", 0)) == 99)

	# Render + UI.
	_sprites.set_you_class(str(_net.self_dto.get("chosenClass", "")))
	_sprites.set_you_weapon_loadout(_current_weapon_loadout())
	_sprites.sync(_net.ents, _net.you, Vector2(_pred.x, _pred.y))
	_minimap.update_map(_pred.x, _pred.y, _net.ents, _net.you, alive)
	_hud.update(_net)
	if _mhud != null:
		_mhud.update_abilities(_net.self_dto.get("abilities", []).slice(0, DccConst.HOTBAR_SIZE))

	# Spectate transitions -> HUD toast + banner.
	if sp.get("just_entered", false):
		_hud.toast(str(sp.get("toast_text", "")), _color_of(str(sp.get("toast_color", "#ffffff"))))
	var remaining := int(_net.floor_state.get("living", 0)) - int(_net.floor_state.get("livingAtStairs", 0))
	_hud.set_waiting(spectating, bool(sp.get("reached", false)), remaining, str(sp.get("mode", "follow")))
	_inv.set_reached(bool(_net.self_dto.get("reached", false)))
	_skills.set_reached(bool(_net.self_dto.get("reached", false)))

	# Loot: nearest bag within reach -> "Loot (E)" prompt; auto-close the loot panel
	# when its bag is gone (looted / despawned / walked away). Press E to open it.
	_nearest_bag_id = ""
	if alive:
		var best := DccConst.LOOT_REACH * DccConst.LOOT_REACH
		for e in _net.ents:
			if typeof(e) != TYPE_DICTIONARY or str(e.get("kind", "")) != "lootbag":
				continue
			var bdx := float(e.get("x", 0.0)) - _pred.x
			var bdy := float(e.get("y", 0.0)) - _pred.y
			var bd := bdx * bdx + bdy * bdy
			if bd <= best:
				best = bd
				_nearest_bag_id = str(e.get("id", ""))
	_loot_prompt.visible = _nearest_bag_id != ""
	if _mhud != null:
		_mhud.set_loot_bag(_nearest_bag_id)
	var open_bag := _inv.loot_open_bag_id()
	if open_bag != "" and not _bag_present(open_bag):
		_inv.close_loot()

	# Run-over death summary: show the card + this run's stats when the run has ended.
	var ended := str(_net.run_state.get("phase", "")) == "ended"
	_runover_panel.visible = ended
	if ended:
		var floor_reached := int(_net.run_state.get("currentFloor", _net.floor_info.get("depth", 1)))
		var lvl_now := Skills.char_level_of(int(_net.self_dto.get("charXp", 0)))
		var kills := int(_net.self_dto.get("kills", 0))
		var life := int(_net.self_dto.get("lifetimeXp", 0))
		_runover_stats.text = "Reached Floor %d · Level %d\n%d kills · %d lifetime XP" % [floor_reached, lvl_now, kills, life]

	# Skills/build nudge: surface the highest-priority pending action behind the K screen —
	# pick a class, spend a talent point, or evolve a matured ability (all live in SkillsUI).
	if _skills.is_open():
		_skills.sync_if_open()
	var nudge := ""
	if alive and not _skills.is_open():
		var sd: Dictionary = _net.self_dto
		if str(sd.get("chosenClass", "")) == "" and int(sd.get("talentPoints", 0)) > 0:
			nudge = "✨ Choose your class — press K"
		elif int(sd.get("talentPoints", 0)) > 0:
			nudge = "✦ Talent point ready — press K"
		elif _skills.any_ready():
			nudge = "✨ A skill is ready to evolve — press K"
	_skill_hint.visible = nudge != "" and not _inv.is_open()
	if nudge != "":
		_skill_hint.text = nudge
	if nudge != "" and nudge != _skill_nudge_was:
		_hud.toast(nudge, Color8(0xff, 0xd3, 0x4d))
	_skill_nudge_was = nudge

	# XP feel: float "+N XP" on kills (charXp accrues from kills) + level-up celebration.
	if not _net.self_dto.is_empty():
		var cxp := int(_net.self_dto.get("charXp", 0))
		if _char_xp < 0:
			_char_xp = cxp
		elif cxp > _char_xp:
			_fx.xp_popup(_pred.x, _pred.y, cxp - _char_xp)
			_char_xp = cxp
		var lvl := Skills.char_level_of(cxp)
		if _char_level < 0:
			_char_level = lvl
		elif lvl > _char_level:
			_char_level = lvl
			_hud.toast("✦ Level %d!" % lvl, Color8(0x7d, 0xff, 0xd0))
			_sfx.play("evolve")
			_sprites.flash_id(_net.you)

	if OS.get_environment("DCC_DEBUG") != "":
		_dbg_accum += dt
		if _dbg_accum >= 1.0:
			_dbg_accum = 0.0
			print("[DBG] fps=", Engine.get_frames_per_second(), " cam.current=", _cam.current, " cam=", _cam.position.round(),
				" pred=(", roundi(_pred.x), ",", roundi(_pred.y), ") floor=", not _world.grid.is_empty(),
				" ents=", _net.ents.size(), " status=", _net.self_dto.get("status", "?"),
				" self=(", _net.self_dto.get("x", "?"), ",", _net.self_dto.get("y", "?"), ")")

func _grab_shot() -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png("/tmp/dcc_shot.png")
	print("[DBG] saved /tmp/dcc_shot.png ", img.get_width(), "x", img.get_height())
	get_tree().quit()

func _update_decor_visibility(x: float, y: float) -> void:
	if _world == null or _world.grid.is_empty() or _decor == null:
		return
	# Quantize the sight center to the player's CELL CENTER so the LoS result is stable while
	# you move within a tile — otherwise the ray grazes wall corners as the smoothed camera
	# drifts and props strobe on/off every frame. (Walls already recompute only per-cell.)
	var cell: float = _world.grid["cell"]
	var cell_id := int(floor(y / cell)) * int(_world.grid["w"]) + int(floor(x / cell))
	var live_props_key := _cached_live_props_key()
	var qx: float = (floor(x / cell) + 0.5) * cell
	var qy: float = (floor(y / cell) + 0.5) * cell
	var vision_sq := DccConst.VISION_RADIUS * DccConst.VISION_RADIUS
	if cell_id == _decor_vis_cell and live_props_key == _decor_live_props_key:
		for wall_model in _world.model_wall_nodes():
			_set_wall_model_visibility(wall_model, qx, qy, vision_sq)
		return
	_decor_vis_cell = cell_id
	_decor_live_props_key = live_props_key
	_decor.set_live_props(_net.ents)
	_set_static_sprite_visibility(_decor.stairs_sprite, qx, qy, vision_sq)
	for sprite in _decor.decoration_sprites:
		_set_static_sprite_visibility(sprite, qx, qy, vision_sq)
	for a in _decor.atmo_sprites:  # torch glow-pools / flames / decals — fog-culled like decor
		_set_static_sprite_visibility(a, qx, qy, vision_sq)
	for wall_model in _world.model_wall_nodes():
		_set_wall_model_visibility(wall_model, qx, qy, vision_sq)

func _cached_live_props_key() -> String:
	var tick := -1
	if _net != null:
		tick = int(_net.cur.get("tick", -1))
	if tick == _decor_live_props_tick:
		return _decor_cached_live_props_key
	_decor_live_props_tick = tick
	_decor_cached_live_props_key = _live_props_key(_net.ents)
	return _decor_cached_live_props_key

func _live_props_key(ents: Array) -> String:
	var ids: Array[String] = []
	for e in ents:
		if typeof(e) != TYPE_DICTIONARY or str(e.get("kind", "")) != "prop":
			continue
		ids.append(str(e.get("id", "")))
	ids.sort()
	return "|".join(ids)

func _set_static_sprite_visibility(sprite: Node3D, x: float, y: float, vision_sq: float) -> void:
	if sprite == null or not is_instance_valid(sprite):
		return
	if sprite.has_meta("dcc_alive") and not bool(sprite.get_meta("dcc_alive")):
		sprite.visible = false
		return
	var world_pos := Vector2(sprite.global_position.x, sprite.global_position.z)
	if sprite.has_meta("dcc_world"):
		var meta_pos = sprite.get_meta("dcc_world")
		if meta_pos is Vector2:
			world_pos = meta_pos
	var dx := world_pos.x - x
	var dy := world_pos.y - y
	var dsq := dx * dx + dy * dy
	# Always show close objects (you should see a prop you can bump into); LoS-gate the rest.
	const NEAR_SQ := 340.0 * 340.0
	sprite.visible = dsq <= NEAR_SQ or (dsq <= vision_sq and Geo.line_of_sight(_world.grid, x, y, world_pos.x, world_pos.y))

func _set_wall_model_visibility(wall: Node3D, x: float, y: float, vision_sq: float) -> void:
	if wall == null or not is_instance_valid(wall):
		return
	var world_pos := Vector2(wall.global_position.x, wall.global_position.z)
	if wall.has_meta("dcc_world"):
		var meta_pos = wall.get_meta("dcc_world")
		if meta_pos is Vector2:
			world_pos = meta_pos
	var dx := world_pos.x - x
	var dy := world_pos.y - y
	var dsq := dx * dx + dy * dy
	const NEAR_SQ := 340.0 * 340.0
	var lit := dsq <= NEAR_SQ or (dsq <= vision_sq and Geo.line_of_sight(_world.grid, x, y, world_pos.x, world_pos.y))
	if lit:
		wall.visible = true
		_world.set_wall_model_shadowed(wall, false)
		return
	var on_screen := _node_on_screen(wall)
	wall.visible = on_screen
	_world.set_wall_model_shadowed(wall, on_screen)

func _node_on_screen(node: Node3D) -> bool:
	if _cam == null or node == null or not is_instance_valid(node):
		return false
	var pos := node.global_position
	if _cam.is_position_behind(pos):
		return false
	var screen_pos := _cam.unproject_position(pos)
	var rect := get_viewport().get_visible_rect().grow(WALL_MODEL_SCREEN_MARGIN)
	return rect.has_point(screen_pos)

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP:
			_cam_zoom_target = clampf(_cam_zoom_target - cam_zoom_step, cam_zoom_min, cam_zoom_max)
			get_viewport().set_input_as_handled()
			return
		if e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_cam_zoom_target = clampf(_cam_zoom_target + cam_zoom_step, cam_zoom_min, cam_zoom_max)
			get_viewport().set_input_as_handled()
			return
	if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_MIDDLE:
		_cam_dragging = e.pressed
		get_viewport().set_input_as_handled()
		return
	if e is InputEventMouseMotion and _cam_dragging:
		cam_yaw_deg = wrapf(cam_yaw_deg - e.relative.x * cam_drag_sensitivity, -180.0, 180.0)
		cam_tilt_deg = clampf(cam_tilt_deg - e.relative.y * cam_drag_sensitivity, cam_tilt_min_deg, cam_tilt_max_deg)
		get_viewport().set_input_as_handled()
		return
	if e is InputEventKey and e.pressed and not e.echo:
		match e.keycode:
			KEY_I:
				if _skills.is_open():
					_skills.close()
				_inv.toggle()
			KEY_K:
				if _inv.is_open():
					_inv.close()
				_skills.toggle()
			KEY_E:
				if _nearest_bag_id != "":
					_inv.request_loot(_nearest_bag_id)
			KEY_Q:
				_inv.use_first_potion()
			KEY_F2:
				_reset_run()
			KEY_TAB:
				_spectate.cycle()
			KEY_V:
				_spectate.toggle_mode()
	# Gamepad menu/action bindings (abilities and dash are handled in InputCtl):
	#   A/B -> interact/drop while a menu is open (consumed before InputCtl sees them)
	#   LB -> inventory   LT -> character/skills
	#   D-pad Up -> quick potion   D-pad Right -> loot
	if e is InputEventJoypadButton and e.pressed:
		var _any_menu := _inv.is_open() or _skills.is_open() or _inv.loot_open_bag_id() != ""
		if _any_menu:
			match e.button_index:
				JOY_BUTTON_A:
					# Defer so push_input isn't called from inside an active dispatch.
					call_deferred(&"_pad_tap", _pad_cursor_pos)
					get_viewport().set_input_as_handled()
					return
				JOY_BUTTON_B:
					if _inv.is_open():
						_inv.pad_drop_at(_pad_cursor_pos)
						get_viewport().set_input_as_handled()
					return
		match e.button_index:
			JOY_BUTTON_LEFT_SHOULDER:
				if _skills.is_open():
					_skills.close()
				_inv.toggle()
				get_viewport().set_input_as_handled()
			JOY_BUTTON_DPAD_UP:
				_inv.use_first_potion()
				get_viewport().set_input_as_handled()
			JOY_BUTTON_DPAD_RIGHT:
				if _nearest_bag_id != "":
					_inv.request_loot(_nearest_bag_id)
				get_viewport().set_input_as_handled()
	# LT is an axis trigger; toggle the skills menu on each press (threshold crossing).
	if e is InputEventJoypadMotion:
		var joy_e := e as InputEventJoypadMotion
		if joy_e.axis == JOY_AXIS_TRIGGER_LEFT:
			var lt_pressed := joy_e.axis_value > 0.5
			if lt_pressed and not _lt_pressed:
				if _inv.is_open():
					_inv.close()
				_skills.toggle()
			_lt_pressed = lt_pressed
			get_viewport().set_input_as_handled()

func _pad_tap(pos: Vector2) -> void:
	var ev := InputEventScreenTouch.new()
	ev.pressed = false
	ev.index = 0
	ev.position = pos
	# Walk only the active UI layer so HUD controls can't intercept.
	if _skills.is_open():
		_fire_at(_skills, pos, ev)
	elif _inv.is_open() or _inv.loot_open_bag_id() != "":
		_fire_at(_inv, pos, ev)

# Recursive depth-first search for the deepest interactive Control at logical
# screen position pos. Buttons get pressed.emit(); other STOP-filter Controls get
# gui_input.emit() — matching what Godot's GUI router would do, but using logical
# coordinates so content_scale_factor never misroutes the synthesized event.
func _fire_at(node: Node, pos: Vector2, ev: InputEvent) -> bool:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return false
	var children := node.get_children()
	for i in range(children.size() - 1, -1, -1):
		if _fire_at(children[i], pos, ev):
			return true
	if node is Button:
		var btn := node as Button
		if not btn.disabled and btn.get_global_rect().has_point(pos):
			btn.pressed.emit()
			return true
	elif node is Control:
		var ctrl := node as Control
		if ctrl.mouse_filter == Control.MOUSE_FILTER_STOP and ctrl.get_global_rect().has_point(pos):
			ctrl.gui_input.emit(ev)
			return true
	return false

func _color_of(s: String) -> Color:
	if s.begins_with("#"):
		return Color.from_string(s, Color.WHITE)
	return Color.WHITE

func _entity_collision_radius(e: Dictionary) -> float:
	match str(e.get("kind", "")):
		"prop":
			return maxf(12.0, 24.0 * float(e.get("scale", 1.0)))
		"player":
			return DccConst.PLAYER_RADIUS
		"boss":
			return DccConst.BOSS_RADIUS
		"monster":
			match str(e.get("monKind", "grunt")):
				"brute":
					return DccConst.MONSTER_RADIUS_BRUTE
				"swarm":
					return DccConst.MONSTER_RADIUS_SWARM
				"pirate":
					return DccConst.MONSTER_RADIUS_PIRATE
				"sharkman":
					return DccConst.MONSTER_RADIUS_SHARKMAN
				"ranged":
					return DccConst.MONSTER_RADIUS_RANGED
				"healer":
					return DccConst.MONSTER_RADIUS_HEALER
				_:
					return DccConst.MONSTER_RADIUS_GRUNT
	return 0.0

# Light aim-assist: if an enemy sits within a cone of the player's aim (and in range),
# snap the cast toward it — so fast swarms aren't pure precision-mouse. Picks the closest
# enemy within ±~32° and ~560px; otherwise returns the raw aim untouched.
func _assist_aim(aim: float) -> float:
	var pp := Vector2(_pred.x, _pred.y)
	var best_d := -1.0
	var best_ang := aim
	const CONE := 0.56
	const RANGE := 560.0
	for e in _net.ents:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		var k := str(e.get("kind", ""))
		if k != "monster" and k != "boss":
			continue
		var to := Vector2(float(e.get("x", 0.0)), float(e.get("y", 0.0))) - pp
		var d := to.length()
		if d < 1.0 or d > RANGE:
			continue
		if absf(wrapf(atan2(to.y, to.x) - aim, -PI, PI)) > CONE:
			continue
		if best_d < 0.0 or d < best_d:
			best_d = d
			best_ang = atan2(to.y, to.x)
	return best_ang
