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

# Mirror of items.ts ATTR_KEYS — the attributes a player can pour level-up points into.
const ATTR_LIST := ["strength", "intellect", "stamina", "agility", "haste", "crit", "armor"]

# ---- dependencies / state -------------------------------------------------
var _net: Node = null
var _sfx: Node = null   # optional Sfx node (play(name)); set by Main
var _key := ""

# ---- node refs (built in _ready) ------------------------------------------
var _root: Control
var _char_box: VBoxContainer
var _stats_box: VBoxContainer
var _attr_box: VBoxContainer
var _talent_box: VBoxContainer
var _list: VBoxContainer
var _scroll: ScrollContainer
var _reached := false        # in the waiting room (gates the Respec button)
var _respec_armed := false   # two-tap confirm for Respec


func _ready() -> void:
	layer = 26  # above the inventory (25)
	_build_panel()
	_root.visible = false


func setup(net: Node) -> void:
	_net = net

func set_sfx(s: Node) -> void:
	_sfx = s

func _sfx_play(name: String) -> void:
	if _sfx != null and _sfx.has_method("play"):
		_sfx.play(name)


# =====================================================================
# Public API (Main calls these)
# =====================================================================

func is_open() -> bool:
	return _root != null and _root.visible

func toggle() -> void:
	if is_open(): close()
	else: open()

func open() -> void:
	if not _root.visible:
		_sfx_play("ui_open")
	_fit_card_to_window()
	_root.visible = true
	_key = ""
	_render()

func close() -> void:
	if _root.visible:
		_sfx_play("ui_close")
	_root.visible = false

# Waiting-room flag (set by Main from self_dto.reached) — gates the free Respec button.
func set_reached(b: bool) -> void:
	if _reached == b:
		return
	_reached = b
	_respec_armed = false
	if is_open():
		_render()

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

func get_scroll() -> ScrollContainer:
	return _scroll


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

	# Live stat breakdown (attrs from the last `inv` message, derived from self).
	_clear(_stats_box)
	var inv: Variant = _net.get("last_inv")
	if inv is Dictionary and not (inv as Dictionary).is_empty():
		var a: Dictionary = (inv as Dictionary).get("attrs", {})
		var d: Dictionary = self_dto.get("derived", (inv as Dictionary).get("derived", {}))
		for r in _stat_rows(a, d):
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 5)
			var k := Label.new()
			k.text = r[0]
			k.add_theme_color_override("font_color", TEXT_SUB)
			k.add_theme_font_size_override("font_size", 13)
			var v := Label.new()
			v.text = r[1]
			v.add_theme_color_override("font_color", TEXT_NAME)
			v.add_theme_font_size_override("font_size", 13)
			row.add_child(k)
			row.add_child(v)
			_stats_box.add_child(row)

	# All-time stats (durable across runs; backs the leaderboard) — from the self DTO.
	_stats_box.add_child(_stat_row_node("— All-time —", ""))
	_stats_box.add_child(_stat_row_node("Lifetime XP", str(int(self_dto.get("lifetimeXp", 0)))))
	_stats_box.add_child(_stat_row_node("Best floor", str(int(self_dto.get("bestFloor", 0)))))
	_stats_box.add_child(_stat_row_node("Kills", str(int(self_dto.get("kills", 0)))))

	# Attribute-point spend panel + respec.
	_render_attrs(self_dto)

	# Class picker / talent tree.
	_render_talents(self_dto)

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
			if _sfx != null and _sfx.has_method("play"):
				_sfx.play("evolve")
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

	# Roomy two-column layout so nothing needs scrolling on a normal window. The scroll
	# stays as a safety net for very small windows / huge talent trees.
	_scroll = ScrollContainer.new()
	_scroll.custom_minimum_size = _panel_size(960.0)
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(_scroll)

	var col := VBoxContainer.new()
	col.custom_minimum_size = Vector2(940, 0)
	col.add_theme_constant_override("separation", 10)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.add_child(col)

	# Header: title + close.
	var headrow := HBoxContainer.new()
	headrow.add_theme_constant_override("separation", 8)
	var title := Label.new()
	title.text = "✨ Skills & Evolution"
	title.add_theme_font_size_override("font_size", 20)
	title.add_theme_color_override("font_color", TEXT_NAME)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.custom_minimum_size = Vector2(38, 38)
	close_btn.pressed.connect(close)
	headrow.add_child(title)
	headrow.add_child(close_btn)
	col.add_child(headrow)

	# Character level + XP bar — full width under the header.
	_char_box = VBoxContainer.new()
	_char_box.add_theme_constant_override("separation", 4)
	_char_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(_char_box)

	# Two columns: [stats + attributes] | [talents + abilities].
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 28)
	cols.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_child(cols)

	var left := VBoxContainer.new()
	left.add_theme_constant_override("separation", 8)
	left.custom_minimum_size = Vector2(460, 0)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(left)

	var right := VBoxContainer.new()
	right.add_theme_constant_override("separation", 8)
	right.custom_minimum_size = Vector2(440, 0)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(right)

	# Left column: STATS then ATTRIBUTES (the attr box renders its own header).
	var statsect := Label.new()
	statsect.text = "STATS"
	statsect.add_theme_font_size_override("font_size", 11)
	statsect.add_theme_color_override("font_color", TEXT_SECTION)
	left.add_child(statsect)

	_stats_box = VBoxContainer.new()
	_stats_box.add_theme_constant_override("separation", 3)
	_stats_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_child(_stats_box)

	_attr_box = VBoxContainer.new()
	_attr_box.add_theme_constant_override("separation", 4)
	_attr_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_child(_attr_box)

	# Right column: class picker / talents, then abilities.
	_talent_box = VBoxContainer.new()
	_talent_box.add_theme_constant_override("separation", 5)
	_talent_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(_talent_box)

	var sect := Label.new()
	sect.text = "ABILITIES"
	sect.add_theme_font_size_override("font_size", 11)
	sect.add_theme_color_override("font_color", TEXT_SECTION)
	right.add_child(sect)

	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 8)
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_child(_list)

	col.add_child(_hint("Use an ability to earn its XP. When it's ready, pick a branch to evolve it. Permadeath wipes all of it."))


# =====================================================================
# Helpers
# =====================================================================

func _panel_size(width: float) -> Vector2:
	var viewport_size := get_viewport().get_visible_rect().size
	return Vector2(minf(width, viewport_size.x * 0.94), maxf(240.0, viewport_size.y * 0.7))

func _fit_card_to_window() -> void:
	if _scroll == null:
		return
	_scroll.custom_minimum_size = _panel_size(_scroll.custom_minimum_size.x)
	_scroll.size = _scroll.custom_minimum_size

func _state_key() -> String:
	var abilities := _abilities()
	var parts: PackedStringArray = []
	for a in abilities:
		if a is Dictionary:
			parts.append("%s:%d:%d" % [str(a.get("id", "")), int(a.get("tier", 0)), int(a.get("xp", 0))])
	var cx := 0
	var sig := ""
	if _net != null:
		var sd: Variant = _net.get("self_dto")
		if sd is Dictionary:
			cx = int(sd.get("charXp", 0))
			sig = JSON.stringify(sd.get("derived", {}))
			# attribute/talent pools + class + waiting-room state drive the spend UI.
			sig += "|ap%d|tp%d|%s|%s|r%s" % [int(sd.get("attrPoints", 0)), int(sd.get("talentPoints", 0)), str(sd.get("chosenClass", "")), JSON.stringify(sd.get("talents", {})), str(_reached)]
		var inv: Variant = _net.get("last_inv")
		if inv is Dictionary:
			sig += JSON.stringify((inv as Dictionary).get("attrs", {}))
	return ",".join(parts) + "|" + str(cx) + "|" + sig


func _abilities() -> Array:
	if _net == null:
		return []
	var sd: Variant = _net.get("self_dto")
	if sd is Dictionary:
		var ab: Variant = sd.get("abilities", [])
		if ab is Array:
			return ab
	return []


# The stat rows, mirroring InventoryUI._render_stats / inventory.ts renderStatRows.
func _stat_row_node(k_text: String, v_text: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 5)
	var k := Label.new()
	k.text = k_text
	k.add_theme_color_override("font_color", TEXT_SUB)
	k.add_theme_font_size_override("font_size", 13)
	var v := Label.new()
	v.text = v_text
	v.add_theme_color_override("font_color", TEXT_NAME)
	v.add_theme_font_size_override("font_size", 13)
	row.add_child(k)
	row.add_child(v)
	return row


func _stat_rows(a: Dictionary, d: Dictionary) -> Array:
	return [
		["Max HP", str(roundi(float(d.get("maxHp", 0.0))))],
		["Move", str(roundi(float(d.get("moveSpeed", 0.0))))],
		["Strength", "%d · %s dmg" % [int(a.get("strength", 0)), _pct(float(d.get("spellPower", 1.0)))]],
		["Intellect", "%d · %s heal" % [int(a.get("intellect", 0)), _pct(float(d.get("healPower", 1.0)))]],
		["Stamina", str(int(a.get("stamina", 0)))],
		["Agility", str(int(a.get("agility", 0)))],
		["Haste", "%d · -%d%% cd" % [int(a.get("haste", 0)), roundi((1.0 - float(d.get("cdMult", 1.0))) * 100.0)]],
		["Crit", "%d · %s" % [int(a.get("crit", 0)), _pct(float(d.get("critChance", 0.0)))]],
		["Armor", "%d · %s block" % [int(a.get("armor", 0)), _pct(float(d.get("dr", 0.0)))]],
	]


func _pct(x: float) -> String:
	return "%d%%" % roundi(x * 100.0)


func _cap(s: String) -> String:
	if s == "":
		return s
	return s.substr(0, 1).to_upper() + s.substr(1)


# Attribute-point spend panel: pour unspent points into STR/AGI/INT/STA/CRIT/HASTE/ARMOR,
# plus a free Respec (waiting room only). Points feed straight into derived stats server-side.
func _render_attrs(self_dto: Dictionary) -> void:
	_clear(_attr_box)
	var pts := int(self_dto.get("attrPoints", 0))
	_attr_box.add_child(_talent_section("ATTRIBUTES — %d point%s" % [pts, ("" if pts == 1 else "s")]))
	var attrs: Dictionary = {}
	var inv: Variant = _net.get("last_inv")
	if inv is Dictionary:
		attrs = (inv as Dictionary).get("attrs", {})
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 4)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for k in ATTR_LIST:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		row.custom_minimum_size = Vector2(205, 0)
		var lbl := Label.new()
		lbl.text = "%s %d" % [_cap(k), int(attrs.get(k, 0))]
		lbl.add_theme_color_override("font_color", TEXT_NAME)
		lbl.add_theme_font_size_override("font_size", 13)
		lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var plus := Button.new()
		plus.text = "+"
		plus.custom_minimum_size = Vector2(28, 26)
		plus.disabled = pts <= 0
		plus.pressed.connect(func(): _send({"t": "spendAttr", "attr": k}))
		row.add_child(lbl)
		row.add_child(plus)
		grid.add_child(row)
	_attr_box.add_child(grid)
	# Respec — free, but only in the waiting room (between floors). Two-tap to confirm.
	if _reached:
		var respec := Button.new()
		respec.text = "↺ Confirm respec?" if _respec_armed else "↺ Respec (free)"
		respec.pressed.connect(func():
			if not _respec_armed:
				_respec_armed = true
				respec.text = "↺ Confirm respec?"
				return
			_respec_armed = false
			_send({"t": "respec"}))
		_attr_box.add_child(respec)


# Class picker (before a class is chosen) or the point-buy talent tree.
func _render_talents(self_dto: Dictionary) -> void:
	_clear(_talent_box)
	var klass := str(self_dto.get("chosenClass", ""))
	var pts := int(self_dto.get("talentPoints", 0))
	var talents: Dictionary = self_dto.get("talents", {})

	if klass == "" or not Talents.CLASS_INFO.has(klass):
		if pts <= 0:
			return
		_talent_box.add_child(_talent_section("⚔️  Choose your class — %d pt" % pts))
		for k in Talents.KLASSES:
			var info: Dictionary = Talents.CLASS_INFO[k]
			var sub := "%s · %s · %s" % [Talents.CLASS_ROLE[k], Talents.CLASS_MAIN_STAT[k], str(info.get("armor", ""))]
			_talent_box.add_child(_choice_button("%s  %s" % [str(info.get("icon", "")), str(info.get("name", k))], str(info.get("blurb", "")), sub, true, func(): _send({"t": "chooseClass", "cls": k})))
		return

	var cinfo: Dictionary = Talents.CLASS_INFO[klass]
	_talent_box.add_child(_talent_section("%s  %s talents — %d point%s" % [str(cinfo.get("icon", "")), str(cinfo.get("name", klass)), pts, ("" if pts == 1 else "s")]))
	for node in Talents.tree(klass):
		var nid := str(node.get("id", ""))
		var rank := int(talents.get(nid, 0))
		var max_rank := int(node.get("maxRank", 1))
		var can := Talents.can_spend(klass, talents, pts, nid)
		var tag := ""
		if rank > 0:
			tag = ("rank %d/%d" % [rank, max_rank]) if max_rank > 1 else "✓ learned"
		elif int(node.get("requires", 0)) > 0:
			tag = "needs %d spent" % int(node.get("requires", 0))
		elif max_rank > 1:
			tag = "0/%d" % max_rank
		_talent_box.add_child(_choice_button("%s  %s" % [str(node.get("icon", "•")), str(node.get("name", nid))], str(node.get("desc", "")), tag, can, func(): _send({"t": "spendTalent", "node": nid}), rank > 0))


func _talent_section(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", READY_TEXT)
	return l


# A tappable card used for both class choices and talent nodes.
func _choice_button(title: String, desc: String, tag: String, enabled: bool, on_tap: Callable, taken := false) -> PanelContainer:
	var tile := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = CARD_BG
	sb.set_corner_radius_all(8)
	sb.set_border_width_all(1)
	sb.border_color = (XP_FILL if taken else CARD_BORDER)
	sb.set_content_margin_all(8)
	tile.add_theme_stylebox_override("panel", sb)
	tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tile.modulate = Color(1, 1, 1, 1.0 if enabled else 0.5)

	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 1)
	vb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tile.add_child(vb)
	var nm := Label.new()
	nm.text = title
	nm.add_theme_font_size_override("font_size", 13)
	nm.add_theme_color_override("font_color", TEXT_NAME)
	nm.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vb.add_child(nm)
	if desc != "":
		var ed := Label.new()
		ed.text = desc
		ed.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		ed.add_theme_font_size_override("font_size", 11)
		ed.add_theme_color_override("font_color", TEXT_SUB)
		ed.mouse_filter = Control.MOUSE_FILTER_IGNORE
		vb.add_child(ed)
	if tag != "":
		var tg := Label.new()
		tg.text = tag
		tg.add_theme_font_size_override("font_size", 10)
		tg.add_theme_color_override("font_color", XP_FILL if taken else TEXT_HINT)
		tg.mouse_filter = Control.MOUSE_FILTER_IGNORE
		vb.add_child(tg)

	if enabled:
		tile.gui_input.connect(func(ev: InputEvent):
			if _is_tap(ev):
				on_tap.call()
				var vp := get_viewport()
				if vp != null:
					vp.set_input_as_handled())
	return tile


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
