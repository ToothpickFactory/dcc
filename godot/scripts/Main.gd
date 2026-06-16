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
var _runover_hint: Label
var _skill_hint: Label
var _skill_ready_was := false
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

func _ready() -> void:
	# Dev overrides: DCC_WS points at a server (e.g. ws://127.0.0.1:8787/ws for local
	# wrangler dev); DCC_SMOKE runs a bounded headless integration smoke then quits.
	var ws_override := OS.get_environment("DCC_WS")
	if ws_override != "":
		server_url = ws_override
	if OS.get_environment("DCC_SMOKE") != "":
		get_tree().create_timer(7.0).timeout.connect(func(): get_tree().quit())
	if OS.get_environment("DCC_SHOT") != "":
		get_tree().create_timer(4.5).timeout.connect(_grab_shot)
	if OS.get_environment("DCC_RESET") != "":
		get_tree().create_timer(2.5).timeout.connect(_reset_run)
	var open_ui := OS.get_environment("DCC_OPENUI")  # "inv" | "skills" — dev screenshot hook
	if open_ui != "":
		get_tree().create_timer(3.8).timeout.connect(func():
			if open_ui == "skills": _skills.open()
			else: _inv.open())

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
	env.environment = e
	add_child(env)

	_cam = Camera3D.new()
	_cam.fov = 55
	_cam.far = 8000
	add_child(_cam)

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

	# Run-over prompt: how to start a fresh run (admin reset over HTTP).
	_runover_hint = Label.new()
	_runover_hint.text = "🏁 Run over — press F2 to start a new run"
	_runover_hint.add_theme_font_size_override("font_size", 22)
	_runover_hint.add_theme_color_override("font_color", Color(1.0, 0.83, 0.30))
	_runover_hint.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_runover_hint.position.y += 120
	_runover_hint.visible = false
	loot_layer.add_child(_runover_hint)

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

	_net.floor_received.connect(_on_floor)
	_net.inv_received.connect(func(m): _inv.on_inv(m))
	_net.bag_received.connect(func(m): _inv.on_bag(m))
	_net.events_received.connect(_on_events)
	_net.welcomed.connect(func(you): print("[DCC] welcome you=", you))

	# Name screen before connecting (skipped headless / in diagnostic modes).
	if _skip_login():
		_net.start(server_url, player_name)
	else:
		var login := Login.new()
		add_child(login)
		login.submitted.connect(func(n):
			player_name = n
			_net.start(server_url, n))

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

func _bag_present(id: String) -> bool:
	for e in _net.ents:
		if typeof(e) == TYPE_DICTIONARY and str(e.get("id", "")) == id:
			return true
	return false

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
				_sprites.flash_at(vp.x, vp.y, 70.0, self_hit)
				if self_hit:
					_shake = 1.0
					_sfx.play("hurt")
					Input.start_joy_vibration(0, 0.35, 0.6, 0.18)  # gamepad rumble (no-op if none)
				else:
					_sfx.play("hit")
			"hit":
				_sfx.play("hit", -3.0)
			"death":
				_sprites.flash_id(str(ev.get("id", "")))
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
			"boss":
				if str(ev.get("state", "")) == "spawn":
					_hud.toast("⚠ A BOSS has awoken — dodge its bolts! ⚠", Color8(0xe7, 0xb3, 0xff))
				else:
					_hud.toast("☠ The boss has been slain! ☠", Color8(0xff, 0xd3, 0x4d))

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
	_world.build(geometry)
	_pred.set_grid(_world.grid)
	_fog.attach(_world)
	_decor.world = _world
	_decor.apply(str(info.get("theme", "fantasy")), geometry.get("decorations", []), geometry.get("stairs", {}))
	_sprites.set_grid(_world.grid)
	_minimap.set_floor(_world.grid, geometry.get("stairs", {}))
	_hud.set_floor(int(info.get("depth", 1)), str(info.get("theme", "")), float(_net.floor_state.get("endsAt", 0.0)))
	_music.set_theme(str(info.get("theme", "fantasy")))
	_hud.floor_title(int(info.get("depth", 1)), str(info.get("theme", "")))  # "Floor N · Theme" card
	_sfx.play("descent")
	_char_level = -1  # re-sync level/xp baselines on floor/run change (avoids spurious toasts)
	_char_xp = -1
	if OS.get_environment("DCC_DEBUG") != "":
		var wi := _world.wall_instance()
		var wc: int = wi.multimesh.instance_count if wi != null and wi.multimesh != null else -1
		print("[DBG] floor built grid=", _world.grid.get("w"), "x", _world.grid.get("h"), " cell=", _world.grid.get("cell"), " walls=", wc, " stairs=", geometry.get("stairs", {}))

func _process(dt: float) -> void:
	# Hit-stop: a brief global slow-mo on a nearby kill makes blows land (see _on_events).
	# Keyed off wall-clock (unaffected by time_scale) so it always restores.
	Engine.time_scale = 0.12 if Time.get_ticks_msec() < _hitstop_until else 1.0

	var mv: Vector2 = _inp.move_vec()
	if OS.get_environment("DCC_AUTOMOVE") != "":
		mv = Vector2(1, 0)  # diagnostic: simulate holding right to test the move pipeline
	_pred.update(_net.self_dto, mv, dt)
	var aim: float = _inp.aim_from(_cam, _pred.x, _pred.y)

	# Spectate/waiting state machine drives the camera target while out of play.
	var sp: Dictionary = _spectate.update(_net, mv, Vector2(_pred.x, _pred.y), dt)
	var spectating: bool = sp.get("spectating", false)

	var alive := str(_net.self_dto.get("status", "")) == "alive" and not bool(_net.self_dto.get("reached", false))
	if alive:
		_input_accum += dt
		if _input_accum * 1000.0 >= DccConst.INPUT_MS:
			_input_accum = 0.0
			_seq += 1
			_net.send_input(_seq, mv, aim)
		for idx in _inp.take_casts():
			_seq += 1
			_net.send_cast(_seq, int(idx), aim)
			_hud.pulse_slot(int(idx))  # bar-slot punch on cast (readability)

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
	_cam.position = Vector3(cx, 820, cy + 460)
	_cam.look_at(Vector3(cx, 0, cy), Vector3.UP)
	_fog.set_vision(_cam_xy.x, _cam_xy.y)  # un-shaken so fog doesn't jitter
	_update_decor_visibility(_cam_xy.x, _cam_xy.y)

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
	_sprites.sync(_net.ents, _net.you, Vector2(_pred.x, _pred.y))
	_minimap.update_map(_pred.x, _pred.y, _net.ents, _net.you, alive)
	_hud.update(_net)

	# Spectate transitions -> HUD toast + banner.
	if sp.get("just_entered", false):
		_hud.toast(str(sp.get("toast_text", "")), _color_of(str(sp.get("toast_color", "#ffffff"))))
	var remaining := int(_net.floor_state.get("living", 0)) - int(_net.floor_state.get("livingAtStairs", 0))
	_hud.set_waiting(spectating, bool(sp.get("reached", false)), remaining, str(sp.get("mode", "follow")))
	_inv.set_reached(bool(_net.self_dto.get("reached", false)))

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
	var open_bag := _inv.loot_open_bag_id()
	if open_bag != "" and not _bag_present(open_bag):
		_inv.close_loot()

	_runover_hint.visible = str(_net.run_state.get("phase", "")) == "ended"

	# Skills: keep XP bars live while open; nudge + glow when an ability matures.
	if _skills.is_open():
		_skills.sync_if_open()
	var skill_ready: bool = alive and _skills.any_ready()
	_skill_hint.visible = skill_ready and not _skills.is_open() and not _inv.is_open()
	if skill_ready and not _skill_ready_was:
		_hud.toast("✨ A skill is ready to evolve! Press K", Color8(0xff, 0xd3, 0x4d))
	_skill_ready_was = skill_ready

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
			print("[DBG] cam.current=", _cam.current, " cam=", _cam.position.round(),
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
	var vision_sq := DccConst.VISION_RADIUS * DccConst.VISION_RADIUS
	_set_static_sprite_visibility(_decor.stairs_sprite, x, y, vision_sq)
	for sprite in _decor.decoration_sprites:
		_set_static_sprite_visibility(sprite, x, y, vision_sq)

func _set_static_sprite_visibility(sprite: Sprite3D, x: float, y: float, vision_sq: float) -> void:
	if sprite == null or not is_instance_valid(sprite):
		return
	var world_pos := Vector2(sprite.global_position.x, sprite.global_position.z)
	if sprite.has_meta("dcc_world"):
		var meta_pos = sprite.get_meta("dcc_world")
		if meta_pos is Vector2:
			world_pos = meta_pos
	var dx := world_pos.x - x
	var dy := world_pos.y - y
	sprite.visible = dx * dx + dy * dy <= vision_sq and Geo.line_of_sight(_world.grid, x, y, world_pos.x, world_pos.y)

func _unhandled_input(e: InputEvent) -> void:
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

func _color_of(s: String) -> Color:
	if s.begins_with("#"):
		return Color.from_string(s, Color.WHITE)
	return Color.WHITE
