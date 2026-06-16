class_name Hud
extends CanvasLayer
## 2D overlay HUD, ported 1:1 from src/client/hud.ts + the toast / waiting-room
## banner in src/client/main.ts + the overlay structure in public/index.html.
## Built ENTIRELY in code (no .tscn) per the Godot port rules.
##
## Pieces (all CanvasLayer children, pointer-transparent except slots):
##   - top-left status line (RichTextLabel): ALIVE/SPECTATING/RUN OVER, HP, class,
##     floor + theme, countdown timer, player count.
##   - bottom-center ability bar (HBoxContainer of slots): icon + key (1-4) + name +
##     cooldown overlay (fills bottom-up) + ammo + AUTO badge on slot 1.
##   - top-center boss bar (shown only when a boss entity is present).
##   - center toast Label with a fade Tween.
##   - waiting-room / spectating banner.
##
## EMOJI NOTE: status/abilities/toast use emoji (⚔ 💀 🏁 🚪 ⚠ ⬇ etc.). Emoji glyphs
## render because Main._install_emoji_font() appends a color-emoji fallback (the OS
## emoji font, or a bundled godot/fonts/NotoColorEmoji.ttf if present) to the engine's
## default font globally. The per-label _apply_font below is a legacy no-op kept only
## for the optional bundled-font path; the global fallback is what actually does it.
##
## Public API (Main calls these):
##   update(net)                                  -> call every frame
##   toast(text: String, color: Color)            -> center fade toast (~3.5s)
##   set_waiting(active, reached, remaining, mode) -> spectate banner
##   set_floor(depth: int, theme: String, ends_at_ms: float) -> from floor msg
##   set_run(phase: String, players: int)         -> from run msg / phase changes
##   set_bar_visible(v: bool)                      -> hide the ability bar while spectating

# ---- colors (mirrored from public/index.html) ----
const COL_TEXT := Color8(0xe6, 0xe9, 0xef)
const COL_MUTED := Color8(0x97, 0xa3, 0xbb)
const COL_SLOT_BG := Color8(0x14, 0x1b, 0x2b)
const COL_SLOT_BORDER := Color8(0x2c, 0x3a, 0x59)
const COL_KEY := Color8(0x9f, 0xb0, 0xd0)
const COL_NAME := Color8(0xcd, 0xd6, 0xe8)
const COL_AUTO := Color8(0xff, 0xd3, 0x4d)
const COL_AMMO_OK := Color8(0xcd, 0xd6, 0xe8)
const COL_AMMO_LOW := Color8(0xff, 0xd3, 0x4d)
const COL_AMMO_EMPTY := Color8(0xff, 0x6a, 0x6a)
const COL_BOSS_NAME := Color8(0xe7, 0xb3, 0xff)
const COL_BOSS_FILL := Color8(0xc0, 0x4c, 0xd0)
const COL_BOSS_BG := Color8(0x1a, 0x10, 0x20)
const COL_TIMER_WARN := Color8(0xff, 0x3b, 0x3b)
const COL_TIMER_LOW := Color8(0xff, 0xd3, 0x4d)
const COL_WAIT_BG := Color8(0x0e, 0x16, 0x26, 0.85)
const COL_WAIT_BORDER := Color8(0x2c, 0x5a, 0x3e)
const COL_WAIT_TEXT := Color8(0xcf, 0xe9, 0xd8)
const COL_WAIT_SUB := Color8(0x8f, 0xb3, 0x9c)

const SLOT_SIZE := 64
const SLOT_GAP := 10

# ---- nodes ----
var _status: RichTextLabel
var _bar_wrap: CenterContainer
var _bar: HBoxContainer
var _boss_wrap: VBoxContainer
var _boss_name: Label
var _boss_fill: ColorRect
var _boss_fill_bg: ColorRect
var _toast: Label
var _toast_tween: Tween
var _floortitle: Label
var _ft_tween: Tween
var _waiting: PanelContainer
var _waiting_label: RichTextLabel

# ---- per-slot widgets, rebuilt when the bar contents change ----
var _slots: Array = []        # the slot Control roots
var _cd_overlays: Array = []  # ColorRect cooldown overlays (fill bottom-up)
var _ammo_labels: Array = []  # Label or null per slot
var _bar_key := ""

# ---- floor / run state (fed by Main; not on the frozen Net) ----
var _floor_depth := -1
var _floor_theme := ""
var _floor_ends_at_ms := 0.0
var _has_floor := false
var _run_phase := ""
var _run_players := 0

var _emoji_font: FontFile = null


func _ready() -> void:
	layer = 10
	_load_emoji_fallback()
	_build_status()
	_build_boss()
	_build_bar()
	_build_toast()
	_build_waiting()
	_build_floortitle()


# ===========================================================================
# Build (once)
# ===========================================================================

func _load_emoji_fallback() -> void:
	# Optional Noto Color Emoji fallback so emoji glyphs render (see header note).
	for p in ["res://fonts/NotoColorEmoji.ttf", "res://fonts/NotoColorEmoji-Regular.ttf"]:
		if ResourceLoader.exists(p):
			var f := load(p)
			if f is FontFile:
				_emoji_font = f
				return


func _apply_font(lbl: Control) -> void:
	# Attach the emoji font as a fallback on the label's default font so normal text
	# stays in the engine font and only emoji fall through to Noto.
	if _emoji_font == null:
		return
	var base := ThemeDB.fallback_font
	var fb := FontVariation.new()
	fb.base_font = base
	var fallbacks := fb.fallbacks if fb.fallbacks != null else []
	fallbacks.append(_emoji_font)
	fb.fallbacks = fallbacks
	lbl.add_theme_font_override("font", fb)
	if lbl is RichTextLabel:
		lbl.add_theme_font_override("normal_font", fb)
		lbl.add_theme_font_override("bold_font", fb)


func _build_status() -> void:
	_status = RichTextLabel.new()
	_status.bbcode_enabled = true
	_status.fit_content = true
	_status.scroll_active = false
	_status.autowrap_mode = TextServer.AUTOWRAP_OFF
	_status.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_status.add_theme_font_size_override("normal_font_size", 13)
	_status.add_theme_font_size_override("bold_font_size", 13)
	_status.add_theme_color_override("default_color", COL_MUTED)
	_status.offset_left = 12
	_status.offset_top = 12
	_status.offset_right = 900
	_status.offset_bottom = 40
	_apply_font(_status)
	add_child(_status)


func _build_boss() -> void:
	# Top-center column: name label over a thin HP bar. Hidden until a boss appears.
	_boss_wrap = VBoxContainer.new()
	_boss_wrap.visible = false
	_boss_wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_boss_wrap.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_boss_wrap.offset_top = 16
	_boss_wrap.custom_minimum_size = Vector2(560, 0)
	_boss_wrap.offset_left = -280
	_boss_wrap.offset_right = 280
	_boss_wrap.add_theme_constant_override("separation", 5)

	_boss_name = Label.new()
	_boss_name.text = "Boss"
	_boss_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_boss_name.add_theme_color_override("font_color", COL_BOSS_NAME)
	_boss_name.add_theme_font_size_override("font_size", 14)
	_boss_name.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_apply_font(_boss_name)
	_boss_wrap.add_child(_boss_name)

	# HP track: background ColorRect with a fill ColorRect sized by ratio.
	_boss_fill_bg = ColorRect.new()
	_boss_fill_bg.color = COL_BOSS_BG
	_boss_fill_bg.custom_minimum_size = Vector2(0, 14)
	_boss_fill_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_boss_fill = ColorRect.new()
	_boss_fill.color = COL_BOSS_FILL
	_boss_fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_boss_fill.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	_boss_fill.offset_left = 0
	_boss_fill.offset_top = 0
	_boss_fill.offset_bottom = 0
	_boss_fill_bg.add_child(_boss_fill)
	_boss_wrap.add_child(_boss_fill_bg)
	add_child(_boss_wrap)


func _build_bar() -> void:
	# Bottom-center wrapper so the bar stays centered regardless of slot count.
	_bar_wrap = CenterContainer.new()
	_bar_wrap.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_bar_wrap.offset_top = -92
	_bar_wrap.offset_bottom = -14
	_bar_wrap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bar = HBoxContainer.new()
	_bar.add_theme_constant_override("separation", SLOT_GAP)
	_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bar_wrap.add_child(_bar)
	add_child(_bar_wrap)


func _build_toast() -> void:
	_toast = Label.new()
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_toast.autowrap_mode = TextServer.AUTOWRAP_OFF
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast.add_theme_font_size_override("font_size", 22)
	_toast.add_theme_constant_override("shadow_offset_x", 0)
	_toast.add_theme_constant_override("shadow_offset_y", 2)
	_toast.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_toast.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_toast.offset_top = 120
	_toast.offset_bottom = 170
	_toast.modulate.a = 0.0
	_apply_font(_toast)
	add_child(_toast)


# Big centered "Floor N · Theme" card that fades in/holds/out on each floor change.
func _build_floortitle() -> void:
	_floortitle = Label.new()
	_floortitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_floortitle.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_floortitle.autowrap_mode = TextServer.AUTOWRAP_OFF
	_floortitle.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_floortitle.add_theme_font_size_override("font_size", 46)
	_floortitle.add_theme_color_override("font_color", COL_TEXT)
	_floortitle.add_theme_constant_override("shadow_offset_x", 0)
	_floortitle.add_theme_constant_override("shadow_offset_y", 3)
	_floortitle.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.85))
	_floortitle.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_floortitle.offset_top = 200
	_floortitle.offset_bottom = 270
	_floortitle.modulate.a = 0.0
	_apply_font(_floortitle)
	add_child(_floortitle)


func _build_waiting() -> void:
	_waiting = PanelContainer.new()
	_waiting.visible = false
	_waiting.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = COL_WAIT_BG
	sb.border_color = COL_WAIT_BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 16
	sb.content_margin_right = 16
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	_waiting.add_theme_stylebox_override("panel", sb)
	_waiting.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_waiting.offset_top = 64
	# Centered horizontally: grow from the horizontal center.
	_waiting.grow_horizontal = Control.GROW_DIRECTION_BOTH

	_waiting_label = RichTextLabel.new()
	_waiting_label.bbcode_enabled = true
	_waiting_label.fit_content = true
	_waiting_label.scroll_active = false
	_waiting_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	_waiting_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_waiting_label.add_theme_color_override("default_color", COL_WAIT_TEXT)
	_waiting_label.add_theme_font_size_override("normal_font_size", 14)
	_waiting_label.add_theme_font_size_override("bold_font_size", 14)
	_apply_font(_waiting_label)
	_waiting.add_child(_waiting_label)
	add_child(_waiting)


# ===========================================================================
# Public API
# ===========================================================================

## Called from Main on the `floor` message. ends_at_ms is the wall-clock deadline
## (FloorState.endsAt) — the HUD counts down against its own clock, like the web.
func set_floor(depth: int, theme: String, ends_at_ms: float) -> void:
	_floor_depth = depth
	_floor_theme = theme
	_floor_ends_at_ms = ends_at_ms
	_has_floor = true


## Called from Main on the `run` message / phase changes.
func set_run(phase: String, players: int) -> void:
	_run_phase = phase
	_run_players = players


## Hide/show the ability bar (Main hides it while spectating, like hudEl).
func set_bar_visible(v: bool) -> void:
	_bar_wrap.visible = v


## Punch an ability-bar slot when it's cast (Main calls this on a local cast).
func pulse_slot(i: int) -> void:
	if i < 0 or i >= _slots.size():
		return
	var slot: Control = _slots[i]
	slot.pivot_offset = slot.size / 2.0  # scale about the slot center
	slot.scale = Vector2.ONE
	var tw := create_tween()
	tw.tween_property(slot, "scale", Vector2(1.22, 1.22), 0.07).set_ease(Tween.EASE_OUT)
	tw.tween_property(slot, "scale", Vector2.ONE, 0.13).set_ease(Tween.EASE_IN)


## Center fade toast (~3.5s), mirrors showToast in main.ts.
func toast(text: String, color: Color) -> void:
	_toast.text = text
	_toast.add_theme_color_override("font_color", color)
	if _toast_tween and _toast_tween.is_valid():
		_toast_tween.kill()
	_toast.modulate.a = 1.0
	_toast_tween = create_tween()
	_toast_tween.tween_interval(3.1)
	_toast_tween.tween_property(_toast, "modulate:a", 0.0, 0.4)


## Floor-intro title card: "Floor N · Theme" fades in, holds, fades out. Called by Main
## on each floor change (alongside the descent sound).
func floor_title(depth: int, theme: String) -> void:
	var t := theme.capitalize() if theme != "" else ""
	_floortitle.text = ("Floor %d · %s" % [depth, t]) if t != "" else ("Floor %d" % depth)
	if _ft_tween and _ft_tween.is_valid():
		_ft_tween.kill()
	_floortitle.modulate.a = 0.0
	_ft_tween = create_tween()
	_ft_tween.tween_property(_floortitle, "modulate:a", 1.0, 0.45)
	_ft_tween.tween_interval(1.5)
	_ft_tween.tween_property(_floortitle, "modulate:a", 0.0, 0.6)


## Spectate banner. mode is "follow" or "free"; remaining = players still on the
## floor (waiting room). Mirrors updateSpectateBanner in main.ts.
func set_waiting(active: bool, reached: bool, remaining: int, mode: String) -> void:
	if not active:
		_waiting.visible = false
		return
	_waiting.visible = true
	var ctrl := "Tab: next player · V: free-cam" if mode == "follow" else "WASD: pan · V: follow"
	if reached:
		var noun := "player" if remaining == 1 else "players"
		_waiting_label.text = (
			"🚪 [b]Waiting room[/b] — %d %s still on the floor" % [remaining, noun]
			+ "\n[color=#8fb39c]%s · I: inventory & sell[/color]" % ctrl
		)
	else:
		_waiting_label.text = "💀 [b]Spectating[/b]\n[color=#8fb39c]%s[/color]" % ctrl


## Per-frame refresh. Reads net.self_dto, net.cur (tick/ents), and the floor/run
## state fed via set_floor/set_run. Mirrors Hud.update(net) in hud.ts.
func update(net) -> void:
	var self_dto: Dictionary = net.self_dto
	var cur: Dictionary = net.cur
	if self_dto.is_empty() or cur.is_empty():
		return
	var tick := int(cur.get("tick", 0))
	var abilities: Array = self_dto.get("abilities", [])

	# Rebuild the bar only when its contents change (loot / swaps), like barKey.
	var key := _bar_key_of(abilities)
	if key != _bar_key:
		_bar_key = key
		_rebuild_bar(abilities)

	_update_slots(self_dto, abilities, tick)
	_update_status(self_dto)
	_update_boss(cur)


# ===========================================================================
# Ability bar
# ===========================================================================

func _bar_key_of(abilities: Array) -> String:
	var ids: PackedStringArray = []
	for a in abilities:
		if a is Dictionary:
			ids.append(str(a.get("id", "")))
	return ",".join(ids) + ":" + str(abilities.size())


func _rebuild_bar(abilities: Array) -> void:
	for c in _bar.get_children():
		c.queue_free()
	_slots = []
	_cd_overlays = []
	_ammo_labels = []
	for i in abilities.size():
		var a: Dictionary = abilities[i] if abilities[i] is Dictionary else {}
		_make_slot(i, a)


func _make_slot(i: int, a: Dictionary) -> void:
	var slot := PanelContainer.new()
	slot.custom_minimum_size = Vector2(SLOT_SIZE, SLOT_SIZE)
	slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new()
	sb.bg_color = COL_SLOT_BG
	sb.border_color = COL_SLOT_BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(12)
	slot.add_theme_stylebox_override("panel", sb)

	# All overlapping children live in one full-rect container.
	var inner := Control.new()
	inner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inner.set_anchors_preset(Control.PRESET_FULL_RECT)
	slot.add_child(inner)

	# Cooldown overlay: dark fill anchored to the BOTTOM, height grows upward as the
	# cooldown is active (web uses scaleY from a bottom origin). Drawn UNDER text.
	var cd := ColorRect.new()
	cd.color = Color(0, 0, 0, 0.62)
	cd.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cd.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	cd.offset_left = 0
	cd.offset_right = 0
	cd.offset_bottom = 0
	cd.offset_top = 0  # 0 height = ready; set negative to grow up
	inner.add_child(cd)

	# Centered icon + name.
	var col := VBoxContainer.new()
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	col.set_anchors_preset(Control.PRESET_FULL_RECT)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	col.add_theme_constant_override("separation", 2)
	var icon := Label.new()
	icon.text = str(a.get("icon", "?")) if a.get("icon", null) != null else "?"
	icon.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	icon.add_theme_font_size_override("font_size", 22)
	icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_apply_font(icon)
	var nm := Label.new()
	nm.text = str(a.get("name", ""))
	nm.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	nm.autowrap_mode = TextServer.AUTOWRAP_OFF
	nm.clip_text = true
	nm.add_theme_font_size_override("font_size", 11)
	nm.add_theme_color_override("font_color", COL_NAME)
	nm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_apply_font(nm)
	col.add_child(icon)
	col.add_child(nm)
	inner.add_child(col)

	# Key number (top-left).
	var keyl := Label.new()
	keyl.text = str(i + 1)
	keyl.add_theme_font_size_override("font_size", 11)
	keyl.add_theme_color_override("font_color", COL_KEY)
	keyl.position = Vector2(6, 2)
	keyl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	inner.add_child(keyl)

	# AUTO badge on slot 1 (top-right).
	if i == 0:
		var auto := Label.new()
		auto.text = "AUTO"
		auto.add_theme_font_size_override("font_size", 8)
		auto.add_theme_color_override("font_color", COL_AUTO)
		auto.set_anchors_preset(Control.PRESET_TOP_RIGHT)
		auto.offset_left = -34
		auto.offset_top = 2
		auto.offset_right = -3
		auto.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		auto.mouse_filter = Control.MOUSE_FILTER_IGNORE
		inner.add_child(auto)

	# Ammo (bottom-right) only when the ability tracks ammo.
	var ammo_label: Variant = null
	if a.has("ammo"):
		var am := Label.new()
		am.add_theme_font_size_override("font_size", 12)
		am.add_theme_color_override("font_color", COL_AMMO_OK)
		am.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
		am.offset_left = -22
		am.offset_top = -18
		am.offset_right = -4
		am.offset_bottom = -2
		am.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		am.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
		am.mouse_filter = Control.MOUSE_FILTER_IGNORE
		inner.add_child(am)
		ammo_label = am

	_bar.add_child(slot)
	_slots.append(slot)
	_cd_overlays.append(cd)
	_ammo_labels.append(ammo_label)


func _update_slots(self_dto: Dictionary, abilities: Array, tick: int) -> void:
	# cdMult from derived (gear); 1.0 default.
	var cd_mult := 1.0
	var derived: Variant = self_dto.get("derived", {})
	if derived is Dictionary and derived.has("cdMult"):
		cd_mult = float(derived["cdMult"])
	# cds come keyed by JSON strings -> int(key) is the ability slot index; the value
	# is the ready-at tick. Build an int->int map once.
	var cds: Dictionary = self_dto.get("cds", {})
	var ready_by_slot := {}
	for k in cds.keys():
		ready_by_slot[int(str(k))] = int(cds[k])

	for i in abilities.size():
		if i >= _cd_overlays.size():
			break
		var a: Dictionary = abilities[i] if abilities[i] is Dictionary else {}
		var ready := int(ready_by_slot.get(i, 0))
		var remaining: float = max(0.0, float(ready - tick))
		var dur: float = max(1.0, float(a.get("cd", 0)) * cd_mult)
		var frac: float = clamp(remaining / dur, 0.0, 1.0)
		# Fill bottom-up: overlay top offset goes from 0 (ready) to -slot_h (full).
		var cd: ColorRect = _cd_overlays[i]
		cd.offset_top = -float(SLOT_SIZE) * frac

		var ammo_label: Variant = _ammo_labels[i]
		if ammo_label != null and a.has("ammo"):
			var ammo := int(a.get("ammo", 0))
			ammo_label.text = str(ammo)
			if ammo == 0:
				ammo_label.add_theme_color_override("font_color", COL_AMMO_EMPTY)
			elif ammo <= 5:
				ammo_label.add_theme_color_override("font_color", COL_AMMO_LOW)
			else:
				ammo_label.add_theme_color_override("font_color", COL_AMMO_OK)


# ===========================================================================
# Status line
# ===========================================================================

func _update_status(self_dto: Dictionary) -> void:
	var ended := _run_phase == "ended"
	var status := str(self_dto.get("status", "alive"))
	var hp := int(self_dto.get("hp", 0))
	var max_hp := int(self_dto.get("maxHp", 0))
	var cls := str(self_dto.get("cls", ""))

	# Countdown timer (skipped once the run has ended), mirroring hud.ts.
	var timer := 0
	if not ended and _has_floor:
		var now_ms := Time.get_unix_time_from_system() * 1000.0
		timer = int(max(0.0, round((_floor_ends_at_ms - now_ms) / 1000.0)))
	var low := not ended and status == "alive" and timer <= 10
	var flash := low and int(floor(Time.get_ticks_msec() / 350.0)) % 2 == 0

	var state_txt := "🏁 RUN OVER"
	if not ended:
		state_txt = "💀 SPECTATING" if status == "spectator" else "ALIVE"

	var depth_txt := str(_floor_depth) if _has_floor else "?"
	var theme_txt := _floor_theme if _has_floor else ""

	var s := "[b]%s[/b] · HP %d/%d · Class [b]%s[/b] · " % [state_txt, hp, max_hp, cls]
	s += "Floor %s (%s) · " % [depth_txt, theme_txt]
	if not ended:
		var tcol := "#e6e9ef"
		if low:
			tcol = "#ff3b3b" if flash else "#ffd34d"
		var warn := "⚠ " if low else ""
		var tail := " — reach the stairs!" if low else ""
		s += "Timer [b][color=%s]%s%ds%s[/color][/b] · " % [tcol, warn, timer, tail]
	s += "Players %d" % _run_players
	_status.text = s


# ===========================================================================
# Boss bar
# ===========================================================================

func _update_boss(cur: Dictionary) -> void:
	var ents: Array = cur.get("ents", [])
	var boss: Dictionary = {}
	for e in ents:
		if e is Dictionary and str(e.get("kind", "")) == "boss":
			boss = e
			break
	if not boss.is_empty() and boss.has("maxHp") and float(boss.get("maxHp", 0)) > 0.0:
		_boss_wrap.visible = true
		_boss_name.text = str(boss.get("name", "Boss"))
		var ratio: float = clamp(float(boss.get("hp", 0)) / float(boss["maxHp"]), 0.0, 1.0)
		# Fill from the left: width is a fraction of the track width.
		_boss_fill.anchor_right = ratio
		_boss_fill.offset_right = 0
	else:
		_boss_wrap.visible = false
