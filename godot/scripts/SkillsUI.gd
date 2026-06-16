class_name SkillsUI
extends CanvasLayer
## The Skills screen (K): per-ability level + XP, the branching evolution choices once
## an ability has matured, and the overall character level. 1:1 port of
## src/client/skills.ts. Built entirely in code (no .tscn), hidden by default.
##
## Reads net.self_dto.abilities (each carries id/name/icon/tier/xp) + net.self_dto.charXp.
## Evolution picks are sent via net.send_msg({t:"evolve", slot, to}); the UI mutates no
## local state — it redraws from the next state snapshot.
##
## Wiring (Main owns this): instantiate, add_child, setup(net); toggle() on the K key;
## call sync_if_open() each frame so XP bars stay live. See public API below.

# ---- colors (mirror inventory.ts / index.html) ----------------------------
const PANEL_BG := Color8(0x12, 0x18, 0x26)
const BACKDROP := Color8(0x04, 0x06, 0x0c, 0xbb)
const CARD_BG := Color8(0x0e, 0x14, 0x22)
const CARD_BORDER := Color8(0x2c, 0x3a, 0x59)
const READY_BORDER := Color8(0xd0, 0x8a, 0x2a)
const TRACK_BG := Color8(0x0a, 0x10, 0x1c)
const XP_FILL := Color8(0x3f, 0xae, 0x5a)
const TEXT_NAME := Color8(0xd3, 0xdc, 0xec)
const TEXT_SUB := Color8(0x86, 0xa0, 0xc2)
const TEXT_SECTION := Color8(0x7e, 0x93, 0xb3)
const TEXT_HINT := Color8(0x6b, 0x77, 0x90)
const GOLD := Color8(0xe7, 0xc1, 0x4d)
const READY_TEXT := Color8(0xff, 0xd3, 0x4d)

# ---- dependencies / state -------------------------------------------------
var _net: Node = null
var _key := ""

# ---- node refs (built in _ready) ------------------------------------------
var _root: Control
var _char_box: VBoxContainer
var _list: VBoxContainer


func _ready() -> void:
	layer = 26  # above the inventory (25)
	_build_panel()
	_root.visible = false


func setup(net: Node) -> void:
	_net = net


# =====================================================================
# Public API (Main calls these)
# =====================================================================

func is_open() -> bool:
	return _root != null and _root.visible

func toggle() -> void:
	if is_open(): close()
	else: open()

func open() -> void:
	_root.visible = true
	_key = ""
	_render()

func close() -> void:
	_root.visible = false

# Any ability ready to evolve? Drives Main's "skill ready" glow + level-up toast.
func any_ready() -> bool:
	for a in _abilities():
		if a is Dictionary and Skills.can_evolve(a):
			return true
	return false

# Re-render while open as XP/level changes arrive (cheap key check).
func sync_if_open() -> void:
	if not is_open():
		return
	if _state_key() != _key:
		_render()


# =====================================================================
# Rendering
# =====================================================================

func _render() -> void:
	if _net == null:
		return
	var self_dto: Variant = _net.get("self_dto")
	if not (self_dto is Dictionary) or self_dto.is_empty():
		return
	_key = _state_key()
	var char_xp := int(self_dto.get("charXp", 0))

	# Character level header.
	_clear(_char_box)
	var lvl := Skills.char_level_of(char_xp)
	var nx := Skills.char_xp_for_next(char_xp)
	var head := Label.new()
	head.text = "Character  ·  Level %d" % lvl
	head.add_theme_font_size_override("font_size", 16)
	head.add_theme_color_override("font_color", TEXT_NAME)
	_char_box.add_child(head)
	_char_box.add_child(_xp_bar(int(nx.get("into", 0)), int(nx.get("need", 1))))

	# Per-ability cards.
	_clear(_list)
	var abilities := _abilities()
	if abilities.is_empty():
		_list.add_child(_hint("No abilities yet."))
		return
	for i in abilities.size():
		var a: Variant = abilities[i]
		if a is Dictionary:
			_list.add_child(_card(a, i))


func _card(ab: Dictionary, slot: int) -> PanelContainer:
	var tier := int(ab.get("tier", 0))
	var xp := int(ab.get("xp", 0))
	var cost := Skills.evolve_cost(tier)
	var opts: Array = Skills.options_for(str(ab.get("id", "")))
	var ready := Skills.can_evolve(ab)

	var card := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = CARD_BG
	sb.set_corner_radius_all(10)
	sb.set_border_width_all(2 if ready else 1)
	sb.border_color = READY_BORDER if ready else CARD_BORDER
	sb.set_content_margin_all(10)
	card.add_theme_stylebox_override("panel", sb)
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 5)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card.add_child(col)

	# Header: icon · name · Lv N
	var hrow := HBoxContainer.new()
	hrow.add_theme_constant_override("separation", 8)
	var icon := Label.new()
	icon.text = str(ab.get("icon", "?")) if ab.get("icon", null) != null else "?"
	icon.add_theme_font_size_override("font_size", 22)
	var nm := Label.new()
	nm.text = str(ab.get("name", ""))
	nm.add_theme_font_size_override("font_size", 15)
	nm.add_theme_color_override("font_color", TEXT_NAME)
	nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var lv := Label.new()
	lv.text = "Lv %d" % (tier + 1)
	lv.add_theme_font_size_override("font_size", 13)
	lv.add_theme_color_override("font_color", TEXT_SUB)
	hrow.add_child(icon)
	hrow.add_child(nm)
	hrow.add_child(lv)
	col.add_child(hrow)

	if opts.is_empty():
		col.add_child(_sub("Mastered — no further evolutions."))
	else:
		col.add_child(_xp_bar(min(xp, cost), cost))
		if ready:
			col.add_child(_ready_line("✨ Ready to evolve — choose a path:"))
			col.add_child(_evolve_row(opts, slot))
		else:
			col.add_child(_sub("%d / %d XP to evolve · keep using it" % [xp, cost]))
	return card


# A row of tappable evolution choices.
func _evolve_row(opts: Array, slot: int) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for to in opts:
		var node: Variant = Skills.NODES.get(str(to), null)
		if not (node is Dictionary):
			continue
		row.add_child(_evolve_choice(str(to), node, slot))
	return row


func _evolve_choice(to: String, node: Dictionary, slot: int) -> PanelContainer:
	var tile := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color8(0x10, 0x18, 0x12)
	sb.set_corner_radius_all(8)
	sb.set_border_width_all(1)
	sb.border_color = XP_FILL
	sb.set_content_margin_all(8)
	tile.add_theme_stylebox_override("panel", sb)
	tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tile.mouse_filter = Control.MOUSE_FILTER_STOP
	tile.tooltip_text = "Evolve into %s" % str(node.get("name", to))

	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 2)
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	vb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tile.add_child(vb)

	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 6)
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var ico := Label.new()
	ico.text = str(node.get("icon", "?"))
	ico.add_theme_font_size_override("font_size", 20)
	ico.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var nm := Label.new()
	nm.text = str(node.get("name", to))
	nm.add_theme_font_size_override("font_size", 14)
	nm.add_theme_color_override("font_color", TEXT_NAME)
	nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	nm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_child(ico)
	top.add_child(nm)
	vb.add_child(top)

	var flav := Label.new()
	flav.text = str(node.get("flavor", ""))
	flav.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	flav.add_theme_font_size_override("font_size", 11)
	flav.add_theme_color_override("font_color", TEXT_SUB)
	flav.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	flav.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vb.add_child(flav)

	tile.gui_input.connect(func(ev: InputEvent):
		if _is_tap(ev):
			_send({"t": "evolve", "slot": slot, "to": to})
			var vp := get_viewport()
			if vp != null:
				vp.set_input_as_handled())
	return tile


# A left-anchored XP fill bar with a centered "into / need XP" label.
func _xp_bar(into: int, need: int) -> Control:
	var track := PanelContainer.new()
	track.custom_minimum_size = Vector2(0, 18)
	track.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var sb := StyleBoxFlat.new()
	sb.bg_color = TRACK_BG
	sb.set_corner_radius_all(6)
	track.add_theme_stylebox_override("panel", sb)

	var holder := Control.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	track.add_child(holder)

	var fill := ColorRect.new()
	fill.color = XP_FILL
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fill.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	fill.offset_left = 0
	fill.offset_top = 0
	fill.offset_bottom = 0
	fill.anchor_right = 1.0 if need <= 0 else clampf(float(into) / float(need), 0.0, 1.0)
	fill.offset_right = 0
	holder.add_child(fill)

	var lbl := Label.new()
	lbl.text = "%d / %d XP" % [into, need]
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lbl.set_anchors_preset(Control.PRESET_FULL_RECT)
	lbl.add_theme_font_size_override("font_size", 10)
	lbl.add_theme_color_override("font_color", TEXT_NAME)
	lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	holder.add_child(lbl)
	return track


func _sub(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", TEXT_SUB)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l


func _ready_line(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", READY_TEXT)
	return l


func _hint(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", TEXT_HINT)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l


# =====================================================================
# Panel construction (one-time, in _ready)
# =====================================================================

func _build_panel() -> void:
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	var bg := ColorRect.new()
	bg.color = BACKDROP
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(bg)
	_root.gui_input.connect(func(ev: InputEvent): if _is_tap(ev): close())
	add_child(_root)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(center)

	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL_BG
	sb.set_corner_radius_all(16)
	sb.set_border_width_all(1)
	sb.border_color = CARD_BORDER
	sb.set_content_margin_all(18)
	panel.add_theme_stylebox_override("panel", sb)
	center.add_child(panel)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(564, 640)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)

	var col := VBoxContainer.new()
	col.custom_minimum_size = Vector2(540, 0)
	col.add_theme_constant_override("separation", 8)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(col)

	# Header: title + close.
	var headrow := HBoxContainer.new()
	headrow.add_theme_constant_override("separation", 8)
	var title := Label.new()
	title.text = "✨ Skills & Evolution"
	title.add_theme_font_size_override("font_size", 18)
	title.add_theme_color_override("font_color", TEXT_NAME)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.custom_minimum_size = Vector2(38, 38)
	close_btn.pressed.connect(close)
	headrow.add_child(title)
	headrow.add_child(close_btn)
	col.add_child(headrow)

	_char_box = VBoxContainer.new()
	_char_box.add_theme_constant_override("separation", 4)
	_char_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(_char_box)

	var sect := Label.new()
	sect.text = "ABILITIES"
	sect.add_theme_font_size_override("font_size", 11)
	sect.add_theme_color_override("font_color", TEXT_SECTION)
	col.add_child(sect)

	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 8)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(_list)

	col.add_child(_hint("Use an ability to earn its XP. When it's ready, pick a branch to evolve it. Permadeath wipes all of it."))


# =====================================================================
# Helpers
# =====================================================================

func _state_key() -> String:
	var abilities := _abilities()
	var parts: PackedStringArray = []
	for a in abilities:
		if a is Dictionary:
			parts.append("%s:%d:%d" % [str(a.get("id", "")), int(a.get("tier", 0)), int(a.get("xp", 0))])
	var cx := 0
	if _net != null:
		var sd: Variant = _net.get("self_dto")
		if sd is Dictionary:
			cx = int(sd.get("charXp", 0))
	return ",".join(parts) + "|" + str(cx)


func _abilities() -> Array:
	if _net == null:
		return []
	var sd: Variant = _net.get("self_dto")
	if sd is Dictionary:
		var ab: Variant = sd.get("abilities", [])
		if ab is Array:
			return ab
	return []


func _send(obj: Dictionary) -> void:
	if _net != null and _net.has_method("send_msg"):
		_net.send_msg(obj)


func _clear(node: Node) -> void:
	for c in node.get_children():
		c.queue_free()


func _is_tap(ev: InputEvent) -> bool:
	if ev is InputEventMouseButton:
		return ev.button_index == MOUSE_BUTTON_LEFT and not ev.pressed
	if ev is InputEventScreenTouch:
		return not ev.pressed
	return false
