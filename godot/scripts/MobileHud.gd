extends CanvasLayer
class_name MobileHud
## On-screen touch controls — virtual joystick (left), ability buttons (right),
## menu buttons (top). Entirely skipped on PC; OS.has_feature("mobile") gates all
## construction. Layout uses direct position/size assignment (no anchors on the
## actual UI elements) for reliable rendering on the GL Compatibility renderer.

var _inp          # InputCtl
var _inv          # InventoryUI
var _skills_ui    # SkillsUI

# ── Layout constants ──────────────────────────────────────────────────────────
const JOY_BASE_R  := 100.0
const JOY_KNOB_R  :=  42.0
const JOY_DEAD    :=  14.0
const JOY_PAD     :=  28.0

const SLOT_COUNT  := 6
const BTN_SIZE    := 100.0
const BTN_GAP     :=  10.0
const BTN_COLS    := 3

const MENU_W      := 160.0
const MENU_H      :=  60.0
const MENU_PAD    :=  14.0

# ── State ─────────────────────────────────────────────────────────────────────
var _root         : Control
var _joy_base     : Panel
var _joy_knob     : Panel
var _ability_btns : Array[Button] = []
var _menu_btns    : Array[Button] = []
var _loot_btn     : Button
var _loot_bag_id  := ""
var _joy_touch_id := -1
var _ability_key  := ""

# ── Lifecycle ─────────────────────────────────────────────────────────────────

func setup(inp, inv, skills_ui) -> void:
	_inp       = inp
	_inv       = inv
	_skills_ui = skills_ui

func _ready() -> void:
	layer = 11
	if not OS.has_feature("mobile"):
		return
	_build()
	call_deferred("_do_layout")
	get_viewport().size_changed.connect(_do_layout)

# ── Construction (create nodes, no sizing yet) ────────────────────────────────

func _build() -> void:
	_root = Control.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	_build_joystick()
	_build_ability_buttons()
	_build_menu_buttons()

func _build_joystick() -> void:
	_joy_base = _circle_panel(JOY_BASE_R,
		Color(0.13, 0.16, 0.26, 0.50),
		Color(0.47, 0.60, 0.95, 0.55), 3.0)
	_root.add_child(_joy_base)
	_joy_knob = _circle_panel(JOY_KNOB_R, Color(0.53, 0.67, 0.97, 0.78))
	_joy_base.add_child(_joy_knob)

func _build_ability_buttons() -> void:
	for i in SLOT_COUNT:
		var btn := _slot_button(i)
		_root.add_child(btn)
		_ability_btns.append(btn)

func _build_menu_buttons() -> void:
	var inv_btn := _menu_button("  Inventory")
	_root.add_child(inv_btn)
	inv_btn.pressed.connect(_on_inv_pressed)
	_menu_btns.append(inv_btn)

	var skills_btn := _menu_button("  Character")
	_root.add_child(skills_btn)
	skills_btn.pressed.connect(_on_skills_pressed)
	_menu_btns.append(skills_btn)

	_loot_btn = _loot_button()
	_loot_btn.visible = false
	_root.add_child(_loot_btn)
	_loot_btn.pressed.connect(_on_loot_pressed)

# ── Layout (position + size from viewport, called after ready + on resize) ────

func _do_layout() -> void:
	if _root == null:
		return
	var vp := get_viewport().get_visible_rect().size
	_layout_joystick(vp)
	_layout_ability_buttons(vp)
	_layout_menu_buttons(vp)

func _layout_joystick(vp: Vector2) -> void:
	_joy_base.position = Vector2(JOY_PAD, vp.y - JOY_PAD - JOY_BASE_R * 2.0)
	_joy_base.size     = Vector2(JOY_BASE_R * 2.0, JOY_BASE_R * 2.0)
	_update_joy_visual(Vector2.ZERO)

func _layout_ability_buttons(vp: Vector2) -> void:
	var btn_rows := SLOT_COUNT / BTN_COLS
	var total_w  := BTN_COLS * BTN_SIZE + (BTN_COLS - 1) * BTN_GAP
	var total_h  := btn_rows * BTN_SIZE + (btn_rows - 1) * BTN_GAP
	var start_x  := vp.x - total_w - JOY_PAD
	var start_y  := vp.y - total_h - JOY_PAD
	for i in SLOT_COUNT:
		var col := i % BTN_COLS
		var row := i / BTN_COLS
		_ability_btns[i].position = Vector2(
			start_x + col * (BTN_SIZE + BTN_GAP),
			start_y + row * (BTN_SIZE + BTN_GAP))
		_ability_btns[i].size = Vector2(BTN_SIZE, BTN_SIZE)

func _layout_menu_buttons(vp: Vector2) -> void:
	var cx := vp.x * 0.5
	_menu_btns[0].position = Vector2(cx - MENU_W - MENU_PAD * 0.5, MENU_PAD)
	_menu_btns[0].size     = Vector2(MENU_W, MENU_H)
	_menu_btns[1].position = Vector2(cx + MENU_PAD * 0.5, MENU_PAD)
	_menu_btns[1].size     = Vector2(MENU_W, MENU_H)
	# Loot button: center-bottom, level with top ability row — shown only when near a bag
	var total_h := (SLOT_COUNT / BTN_COLS) * BTN_SIZE + (SLOT_COUNT / BTN_COLS - 1) * BTN_GAP
	_loot_btn.position = Vector2(cx - MENU_W * 0.5, vp.y - total_h - JOY_PAD)
	_loot_btn.size     = Vector2(MENU_W, MENU_H)

# ── Menu callbacks ────────────────────────────────────────────────────────────

func _on_inv_pressed() -> void:
	if _skills_ui != null and _skills_ui.is_open():
		_skills_ui.close()
	if _inv != null:
		_inv.toggle()

func _on_skills_pressed() -> void:
	if _inv != null and _inv.is_open():
		_inv.close()
	if _skills_ui != null:
		_skills_ui.toggle()

func _on_loot_pressed() -> void:
	if _loot_bag_id != "" and _inv != null:
		_inv.request_loot(_loot_bag_id)

## Called by Main when abilities change. Updates button icon + name labels.
func update_abilities(abilities: Array) -> void:
	var key := str(abilities.size()) + ":"
	for i in mini(abilities.size(), SLOT_COUNT):
		var a: Dictionary = abilities[i]
		key += str(a.get("name", "")) + ","
	if key == _ability_key:
		return
	_ability_key = key
	for i in SLOT_COUNT:
		var btn: Button = _ability_btns[i]
		if i >= abilities.size():
			btn.text = str(i + 1)
			btn.add_theme_font_size_override("font_size", 28)
			continue
		var a: Dictionary = abilities[i]
		var icon := str(a.get("icon", ""))
		var nm   := str(a.get("name", ""))
		if icon == "" and nm == "":
			btn.text = str(i + 1)
			btn.add_theme_font_size_override("font_size", 28)
		elif nm == "":
			btn.text = icon
			btn.add_theme_font_size_override("font_size", 32)
		else:
			btn.text = icon + "\n" + nm.left(9)
			btn.add_theme_font_size_override("font_size", 18)

## Called by Main every tick with the nearest reachable bag id (or "" when none).
func set_loot_bag(bag_id: String) -> void:
	_loot_bag_id = bag_id
	if _loot_btn != null:
		_loot_btn.visible = bag_id != ""

# ── Touch input ───────────────────────────────────────────────────────────────

func _input(event: InputEvent) -> void:
	if _joy_base == null:
		return
	var vp := get_viewport().get_visible_rect().size

	if event is InputEventScreenTouch:
		if event.pressed:
			if _joy_touch_id == -1 \
					and event.position.x < vp.x * 0.45 \
					and event.position.y > vp.y * 0.45:
				_joy_touch_id = event.index
				_apply_joy(event.position, vp)
				get_viewport().set_input_as_handled()
		else:
			if event.index == _joy_touch_id:
				_joy_touch_id = -1
				_update_joy_visual(Vector2.ZERO)
				if _inp != null:
					_inp.set_virtual_stick(Vector2.ZERO)
				get_viewport().set_input_as_handled()

	elif event is InputEventScreenDrag:
		if event.index == _joy_touch_id:
			_apply_joy(event.position, vp)
			get_viewport().set_input_as_handled()

func _apply_joy(pos: Vector2, vp: Vector2) -> void:
	var center := Vector2(JOY_PAD + JOY_BASE_R, vp.y - JOY_PAD - JOY_BASE_R)
	var offset  := pos - center
	_update_joy_visual(offset)
	if _inp == null:
		return
	if offset.length() <= JOY_DEAD:
		_inp.set_virtual_stick(Vector2.ZERO)
	else:
		var beyond   := offset.length() - JOY_DEAD
		var max_dist := JOY_BASE_R - JOY_DEAD
		_inp.set_virtual_stick(offset.normalized() * minf(beyond / max_dist, 1.0))

func _update_joy_visual(offset: Vector2) -> void:
	if _joy_knob == null or not is_instance_valid(_joy_knob):
		return
	var clamped := offset.limit_length(JOY_BASE_R - JOY_KNOB_R)
	_joy_knob.position = Vector2(
		JOY_BASE_R - JOY_KNOB_R + clamped.x,
		JOY_BASE_R - JOY_KNOB_R + clamped.y)
	_joy_knob.size = Vector2(JOY_KNOB_R * 2.0, JOY_KNOB_R * 2.0)

# ── Visual helpers ────────────────────────────────────────────────────────────

func _circle_panel(r: float, bg: Color, border: Color = Color.TRANSPARENT, border_w: float = 0.0) -> Panel:
	var p  := Panel.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(int(r))
	sb.corner_detail = 24
	if border_w > 0.0:
		sb.border_color = border
		sb.set_border_width_all(int(border_w))
	p.add_theme_stylebox_override("panel", sb)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p

func _slot_button(idx: int) -> Button:
	var btn := Button.new()
	btn.text = str(idx + 1)
	btn.add_theme_font_size_override("font_size", 28)
	btn.add_theme_color_override("font_color", Color8(0xc8, 0xd8, 0xff))

	var sb_n := StyleBoxFlat.new()
	sb_n.bg_color     = Color8(0x16, 0x1c, 0x2e, 0xcc)
	sb_n.border_color = Color8(0x3a, 0x50, 0x78, 0xcc)
	sb_n.set_border_width_all(2)
	sb_n.set_corner_radius_all(14)
	sb_n.corner_detail = 12
	btn.add_theme_stylebox_override("normal", sb_n)

	var sb_p := StyleBoxFlat.new()
	sb_p.bg_color     = Color8(0x3a, 0x52, 0x92, 0xdd)
	sb_p.border_color = Color8(0x78, 0x9c, 0xff, 0xff)
	sb_p.set_border_width_all(2)
	sb_p.set_corner_radius_all(14)
	sb_p.corner_detail = 12
	btn.add_theme_stylebox_override("pressed", sb_p)
	btn.add_theme_stylebox_override("hover",   sb_p)
	btn.add_theme_stylebox_override("focus",   StyleBoxEmpty.new())

	btn.pressed.connect(func(): if _inp != null: _inp.queue_cast(idx))
	return btn

func _loot_button() -> Button:
	var btn := Button.new()
	btn.text = "  Loot"
	btn.add_theme_font_size_override("font_size", 22)
	btn.add_theme_color_override("font_color", Color8(0xff, 0xdd, 0x66))

	var sb := StyleBoxFlat.new()
	sb.bg_color     = Color8(0x28, 0x20, 0x08, 0xdd)
	sb.border_color = Color8(0xff, 0xcc, 0x44, 0xee)
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(10)
	sb.corner_detail = 12
	btn.add_theme_stylebox_override("normal", sb)

	var sb_h := sb.duplicate() as StyleBoxFlat
	sb_h.bg_color = Color8(0x50, 0x3c, 0x10, 0xee)
	btn.add_theme_stylebox_override("hover",   sb_h)
	btn.add_theme_stylebox_override("pressed", sb_h)
	btn.add_theme_stylebox_override("focus",   StyleBoxEmpty.new())
	return btn

func _menu_button(label: String) -> Button:
	var btn := Button.new()
	btn.text = label
	btn.add_theme_font_size_override("font_size", 19)
	btn.add_theme_color_override("font_color", Color8(0xcc, 0xda, 0xff))

	var sb := StyleBoxFlat.new()
	sb.bg_color     = Color8(0x12, 0x18, 0x28, 0xcc)
	sb.border_color = Color8(0x50, 0x68, 0xaa, 0xcc)
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(10)
	sb.corner_detail = 12
	btn.add_theme_stylebox_override("normal", sb)

	var sb_h := sb.duplicate() as StyleBoxFlat
	sb_h.bg_color = Color8(0x26, 0x36, 0x58, 0xdd)
	btn.add_theme_stylebox_override("hover",   sb_h)
	btn.add_theme_stylebox_override("pressed", sb_h)
	btn.add_theme_stylebox_override("focus",   StyleBoxEmpty.new())
	return btn
