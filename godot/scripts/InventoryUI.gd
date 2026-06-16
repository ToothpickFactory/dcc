class_name InventoryUI
extends CanvasLayer
## Character / inventory screen + loot-bag panel. 1:1 port of src/client/inventory.ts.
## Built entirely in code (no .tscn), hidden by default. Renders from the net 'inv'
## message {inv, attrs, derived, capacity, gold} and the 'bag' message {id, items}.
##
## Every action is a tap/click on a tile, so it works with mouse OR touch. Actions
## are sent via net.send_msg(obj); the UI does NOT mutate local state except the
## 2-tap action-bar swap SELECTION — it waits for the next 'inv' snapshot to redraw.
##
## Wiring (Main owns this): instantiate, add_child, then route net signals into
## on_inv()/on_bag() and toggle() on the I key. See public API at the bottom.

# ---- Static lookup tables (mirror inventory.ts) ----------------------------
const SLOT_LABEL := {
	"helmet": "Head", "chest": "Chest", "legs": "Legs", "gloves": "Hands",
	"mainHand": "Main", "offHand": "Off", "ring1": "Ring", "ring2": "Ring", "amulet": "Neck",
}
const SLOT_EMOJI := {
	"helmet": "⛑️", "chest": "\U01f6e1️", "legs": "\U01f456",
	"gloves": "\U01f9e4", "mainHand": "⚔️", "offHand": "\U01f5e1️",
	"ring1": "\U01f48d", "ring2": "\U01f48d", "amulet": "\U01f4ff",
}
const ITEM_EMOJI := {
	"helmet": "⛑️", "chest": "\U01f6e1️", "legs": "\U01f456",
	"gloves": "\U01f9e4", "weapon": "⚔️", "ring": "\U01f48d",
	"amulet": "\U01f4ff", "bag": "\U01f392", "consumable": "\U0001f9ea",
}
const ATTR_ABBR := {
	"power": "PWR", "spirit": "SPR", "haste": "HST",
	"vitality": "VIT", "agility": "AGI", "armor": "ARM",
}
# EQUIP_SLOTS order from shared/items.ts (drives the equipped grid layout).
const EQUIP_SLOTS := ["helmet", "chest", "legs", "gloves", "mainHand", "offHand", "ring1", "ring2", "amulet"]
# sellValue() price table from shared/items.ts.
const SELL_PRICE := {"common": 3, "uncommon": 8, "rare": 20, "epic": 50, "legendary": 120}

# Rarity -> tile border color (matches index.html .r-* rules; common is the base border).
const RARITY_BORDER := {
	"common": Color8(0x2c, 0x3a, 0x59),
	"uncommon": Color8(0x3f, 0xae, 0x5a),
	"rare": Color8(0x3a, 0x7b, 0xd5),
	"epic": Color8(0x9b, 0x59, 0xd0),
	"legendary": Color8(0xd0, 0x8a, 0x2a),
}
const TILE_BG := Color8(0x0e, 0x14, 0x22)
const SEL_BORDER := Color8(0xff, 0xd3, 0x4d)
const PANEL_BG := Color8(0x12, 0x18, 0x26)
const BACKDROP := Color8(0x04, 0x06, 0x0c, 0xbb)
const TEXT_NAME := Color8(0xd3, 0xdc, 0xec)
const TEXT_SUB := Color8(0x86, 0xa0, 0xc2)
const TEXT_SECTION := Color8(0x7e, 0x93, 0xb3)
const TEXT_SLOTLBL := Color8(0x5a, 0x6b, 0x88)
const TEXT_HINT := Color8(0x6b, 0x77, 0x90)
const GOLD := Color8(0xe7, 0xc1, 0x4d)
const DROP_COLOR := Color8(0xc8, 0x7b, 0x7b)

const TILE_MIN := Vector2(78, 76)

# ---- Dependencies / state -------------------------------------------------
var _net: Node = null          # provides send_msg(obj) + self_dto (Dictionary)
var _sfx: Node = null          # optional Sfx node (play(name)); set by Main

# Latest snapshots (raw wire payloads). _inv is the {inv,attrs,derived,capacity,gold} dict.
var _inv: Dictionary = {}
var _has_inv := false
var _reached := false

# Loot bag (separate panel).
var _open_bag_id := ""
var _open_bag_items: Array = []

# Action-bar 2-tap swap selection (the ONLY local mutation). -1 = none.
var _selected_slot := -1
var _bar_key := ""

# ---- Node refs (built in _ready) ------------------------------------------
var _inv_root: Control          # inventory backdrop overlay
var _loot_root: Control         # loot backdrop overlay
var _equip_grid: GridContainer
var _bag_grid: GridContainer
var _ability_bar: GridContainer
var _stat_panel: GridContainer
var _carry_grid: GridContainer
var _carry_count: Label
var _gold_label: Label
var _carry_hint: Label
var _loot_grid: GridContainer

func _ready() -> void:
	layer = 25
	_build_inventory_panel()
	_build_loot_panel()
	_inv_root.visible = false
	_loot_root.visible = false

# Called by Main right after .new() (or set externally) to inject the Net node.
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
	return _inv_root != null and _inv_root.visible

func toggle() -> void:
	if is_open(): close()
	else: open()

func open() -> void:
	if not _has_inv:
		return
	_selected_slot = -1
	_inv_root.visible = true
	_render(_inv)
	_render_bar()

func close() -> void:
	_inv_root.visible = false

# Feed the raw net 'inv' message: {inv, attrs, derived, capacity, gold}.
func on_inv(msg: Dictionary) -> void:
	_inv = msg
	_has_inv = true
	if is_open():
		_render(_inv)
		_render_bar()

# Feed the raw net 'bag' message: {id, items}.
func on_bag(msg: Dictionary) -> void:
	_open_bag_id = str(msg.get("id", ""))
	_open_bag_items = msg.get("items", [])
	if _open_bag_items.is_empty():
		close_loot()   # emptied -> auto-close
		return
	_loot_root.visible = true
	_render_loot()

# Toggle the sell affordance (selling is a waiting-room action). Re-renders if open.
func set_reached(b: bool) -> void:
	if _reached == b:
		return
	_reached = b
	if is_open() and _has_inv:
		_render(_inv)

# Keep the action-bar section live while the screen is open (server updates the bar
# via loot/swaps/ammo). Safe to call every frame from Main when is_open().
func sync() -> void:
	if not is_open():
		return
	var abilities: Array = _abilities()
	var ids: Array = []
	for a in abilities:
		if a is Dictionary:
			ids.append(str(a.get("id", "")))
	var key := ",".join(PackedStringArray(ids)) + ":" + str(_selected_slot)
	if key == _bar_key:
		return
	_render_bar()

# ---- Loot bag helpers (Main may call these from world taps) ----------------
func request_loot(bag_id: String) -> void:
	_send({"t": "openLoot", "bag": bag_id})

# Quick-use (Q key): drink the first carried consumable.
func use_first_potion() -> void:
	var inv: Dictionary = _inv.get("inv", {})
	for it in inv.get("carried", []):
		if it is Dictionary and str(it.get("slot", "")) == "consumable":
			_send({"t": "useItem", "item": str(it.get("id", ""))})
			return

func loot_open_bag_id() -> String:
	return _open_bag_id if (_loot_root != null and _loot_root.visible) else ""

func close_loot() -> void:
	_loot_root.visible = false
	_open_bag_id = ""

# =====================================================================
# Rendering — Character screen
# =====================================================================

func _render(msg: Dictionary) -> void:
	var inv: Dictionary = msg.get("inv", {})
	var equipped: Dictionary = inv.get("equipped", {})
	var bag_equip: Array = inv.get("bagEquip", [])
	var carried: Array = inv.get("carried", [])
	var capacity := int(msg.get("capacity", 0))
	var gold := int(msg.get("gold", 0))

	# Equipped gear grid.
	_clear(_equip_grid)
	for slot in EQUIP_SLOTS:
		var it: Variant = equipped.get(slot, null)
		var tile: Control
		if it is Dictionary:
			tile = _item_tile(it, str(SLOT_LABEL.get(slot, "")))
			var s: String = slot
			tile.gui_input.connect(func(ev: InputEvent): if _is_tap(ev): _send({"t": "unequip", "slot": s}))
		else:
			tile = _empty_tile(str(SLOT_EMOJI.get(slot, "?")), str(SLOT_LABEL.get(slot, "")))
		_equip_grid.add_child(tile)

	# Equipped bag containers.
	_clear(_bag_grid)
	for i in bag_equip.size():
		var b: Variant = bag_equip[i]
		var tile: Control
		if b is Dictionary:
			tile = _item_tile(b, "Bag")
			var idx := i
			tile.gui_input.connect(func(ev: InputEvent): if _is_tap(ev): _send({"t": "unequipBag", "index": idx}))
		else:
			tile = _empty_tile("\U01f392", "Bag")
		_bag_grid.add_child(tile)

	# Stats panel.
	_render_stats(msg)

	# Gold + carry header.
	_gold_label.text = "\U01fa99 %d" % gold
	_carry_count.text = "%d/%d" % [carried.size(), capacity]

	# Carried items grid.
	_clear(_carry_grid)
	_carry_hint.visible = carried.is_empty()
	var can_sell := _reached
	for it in carried:
		if not (it is Dictionary):
			continue
		var item_id := str(it.get("id", ""))
		var is_consumable := str(it.get("slot", "")) == "consumable"
		var tile := _item_tile(it, "")
		var body := _tile_body(tile)
		# Consumables drink (heal self); everything else equips on tap.
		var tap_msg := {"t": "useItem", "item": item_id} if is_consumable else {"t": "equip", "item": item_id}
		tile.gui_input.connect(func(ev: InputEvent): if _is_tap(ev): _send(tap_msg))
		# Drop affordance (top-right).
		var drop := _corner_label("\U01f5d1", DROP_COLOR, false)
		drop.tooltip_text = "Drop on the floor"
		drop.gui_input.connect(func(ev: InputEvent):
			if _is_tap(ev):
				_send({"t": "drop", "item": item_id})
				_consume(ev))
		body.add_child(drop)
		# Sell affordance (bottom-right) — waiting room only.
		if can_sell:
			var sell := _corner_label("\U01fa99%d" % _sell_value(it), GOLD, true)
			sell.tooltip_text = "Sell for gold"
			sell.gui_input.connect(func(ev: InputEvent):
				if _is_tap(ev):
					_send({"t": "sell", "item": item_id})
					_consume(ev))
			body.add_child(sell)
		_carry_grid.add_child(tile)

func _render_stats(msg: Dictionary) -> void:
	_clear(_stat_panel)
	var a: Dictionary = msg.get("attrs", {})
	var d: Dictionary = msg.get("derived", {})
	var rows := [
		["Max HP", str(roundi(float(d.get("maxHp", 0.0))))],
		["Move", str(roundi(float(d.get("moveSpeed", 0.0))))],
		["Power", "%d · %s dmg" % [int(a.get("power", 0)), _pct(float(d.get("spellPower", 1.0)))]],
		["Spirit", "%d · %s heal" % [int(a.get("spirit", 0)), _pct(float(d.get("healPower", 1.0)))]],
		["Haste", "%d · -%d%% cd" % [int(a.get("haste", 0)), roundi((1.0 - float(d.get("cdMult", 1.0))) * 100.0)]],
		["Vitality", str(int(a.get("vitality", 0)))],
		["Agility", str(int(a.get("agility", 0)))],
		["Armor", "%d · %s block" % [int(a.get("armor", 0)), _pct(float(d.get("dr", 0.0)))]],
	]
	for r in rows:
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
		_stat_panel.add_child(row)

# =====================================================================
# Rendering — Action bar (2-tap swap)
# =====================================================================

func _render_bar() -> void:
	var abilities: Array = _abilities()
	var ids: Array = []
	for a in abilities:
		if a is Dictionary:
			ids.append(str(a.get("id", "")))
	_bar_key = ",".join(PackedStringArray(ids)) + ":" + str(_selected_slot)
	_clear(_ability_bar)
	for i in abilities.size():
		var a: Variant = abilities[i]
		if not (a is Dictionary):
			continue
		var tile := _ability_tile(a, i == 0)
		if i == _selected_slot:
			_apply_border(tile, SEL_BORDER, true)
		var idx := i
		tile.gui_input.connect(func(ev: InputEvent): if _is_tap(ev): _on_bar_tap(idx))
		_ability_bar.add_child(tile)

func _on_bar_tap(i: int) -> void:
	if _selected_slot == -1:
		_selected_slot = i
	elif _selected_slot == i:
		_selected_slot = -1            # tap again = deselect
	else:
		_send({"t": "swapAbility", "a": _selected_slot, "b": i})
		_selected_slot = -1
	_render_bar()                       # reflect selection immediately; server confirms order

# =====================================================================
# Rendering — Loot bag panel
# =====================================================================

func _render_loot() -> void:
	_clear(_loot_grid)
	for it in _open_bag_items:
		if not (it is Dictionary):
			continue
		var item_id := str(it.get("id", ""))
		var tile := _item_tile(it, "")
		tile.gui_input.connect(func(ev: InputEvent):
			if _is_tap(ev) and _open_bag_id != "":
				_send({"t": "takeLoot", "bag": _open_bag_id, "item": item_id})
				_sfx_play("loot"))
		_loot_grid.add_child(tile)

# =====================================================================
# Tile factories
# =====================================================================

func _item_tile(it: Dictionary, slot_label: String) -> PanelContainer:
	var rarity := str(it.get("rarity", "common"))
	var border: Color = RARITY_BORDER.get(rarity, RARITY_BORDER["common"])
	var tile := _tile_shell(border, false)
	var body := _tile_body(tile)

	var vb := _tile_vbox()
	body.add_child(vb)

	if slot_label != "":
		var lbl := _corner_text(slot_label.to_upper(), TEXT_SLOTLBL)
		lbl.set_anchors_preset(Control.PRESET_TOP_LEFT)
		lbl.position = Vector2(5, 2)
		body.add_child(lbl)

	var icon := str(it.get("icon", ""))
	if icon == "":
		icon = str(ITEM_EMOJI.get(str(it.get("slot", "")), "?"))
	vb.add_child(_centered(icon, 22, TEXT_NAME))
	vb.add_child(_centered(str(it.get("name", "")), 11, TEXT_NAME))
	var st := _stat_str(it)
	if st != "":
		vb.add_child(_centered(st, 9, TEXT_SUB))
	return tile

func _ability_tile(a: Dictionary, is_auto: bool) -> PanelContainer:
	var tile := _tile_shell(RARITY_BORDER["common"], false)
	var body := _tile_body(tile)
	var vb := _tile_vbox()
	body.add_child(vb)

	if is_auto:
		var badge := _corner_text("AUTO", GOLD)
		badge.set_anchors_preset(Control.PRESET_TOP_RIGHT)
		badge.position = Vector2(-34, 2)
		body.add_child(badge)

	var icon := str(a.get("icon", ""))
	if icon == "":
		icon = "?"
	vb.add_child(_centered(icon, 22, TEXT_NAME))
	vb.add_child(_centered(str(a.get("name", "")), 11, TEXT_NAME))

	var sub: String
	if a.has("ammo") and a.get("ammo") != null:
		sub = "%d left" % int(a.get("ammo", 0))
	else:
		var dmg := int(a.get("dmg", 0))
		sub = ("%d heal" % absi(dmg)) if dmg < 0 else ("%d dmg" % dmg)
	vb.add_child(_centered(sub, 9, TEXT_SUB))
	return tile

func _empty_tile(emoji: String, label: String) -> PanelContainer:
	var tile := _tile_shell(RARITY_BORDER["common"], true)
	var body := _tile_body(tile)
	var vb := _tile_vbox()
	body.add_child(vb)
	if label != "":
		var lbl := _corner_text(label.to_upper(), TEXT_SLOTLBL)
		lbl.set_anchors_preset(Control.PRESET_TOP_LEFT)
		lbl.position = Vector2(5, 2)
		body.add_child(lbl)
	vb.add_child(_centered(emoji, 22, TEXT_NAME))
	return tile

# A full-rect, vertically-centered VBox for the icon/name/stat lines.
func _tile_vbox() -> VBoxContainer:
	var vb := VBoxContainer.new()
	vb.alignment = BoxContainer.ALIGNMENT_CENTER
	vb.add_theme_constant_override("separation", 2)
	vb.set_anchors_preset(Control.PRESET_FULL_RECT)
	vb.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return vb

# Bordered, dark-filled tile container sized like the web .itile.
func _tile_shell(border: Color, dim: bool) -> PanelContainer:
	var tile := PanelContainer.new()
	tile.custom_minimum_size = TILE_MIN
	tile.mouse_filter = Control.MOUSE_FILTER_STOP
	tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tile.clip_contents = true
	_apply_border(tile, border, false)
	if dim:
		tile.modulate = Color(1, 1, 1, 0.38)
		tile.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# Full-rect overlay body: content + corner affordances anchor here (a plain
	# Control does NOT lay out its children, so absolute positioning works). PASS
	# lets a tap fall through to the PanelContainer's gui_input unless an affordance
	# (STOP) on top consumes it first.
	var body := Control.new()
	body.set_anchors_preset(Control.PRESET_FULL_RECT)
	body.mouse_filter = Control.MOUSE_FILTER_PASS if not dim else Control.MOUSE_FILTER_IGNORE
	tile.add_child(body)
	return tile

# The full-rect overlay child added by _tile_shell — parent content/affordances here.
func _tile_body(tile: PanelContainer) -> Control:
	return tile.get_child(0)

func _apply_border(tile: PanelContainer, border: Color, selected: bool) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = TILE_BG
	sb.set_corner_radius_all(10)
	sb.set_border_width_all(2 if selected else 1)
	sb.border_color = border
	sb.set_content_margin_all(6)
	tile.add_theme_stylebox_override("panel", sb)

# A horizontally-centered label inside the VBox (icon / name / stat lines).
func _centered(text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

# Small absolutely-positioned corner text (slot label / AUTO badge).
func _corner_text(text: String, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 8)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

# A tappable corner affordance (drop / sell). bottom=true anchors to bottom-right.
func _corner_label(text: String, color: Color, bottom: bool) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 11 if bottom else 13)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_STOP
	l.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT if bottom else Control.PRESET_TOP_RIGHT)
	l.position = Vector2(-22, -18) if bottom else Vector2(-18, 1)
	return l

# =====================================================================
# Panel construction (one-time, in _ready)
# =====================================================================

func _build_inventory_panel() -> void:
	_inv_root = _backdrop()
	_inv_root.gui_input.connect(func(ev: InputEvent): if _is_backdrop_tap(ev, _inv_root): close())
	add_child(_inv_root)

	var content := _card(_inv_root)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 4)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_child(col)

	# Header: title + gold + close.
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	var title := Label.new()
	title.text = "⚔️ Character"
	title.add_theme_font_size_override("font_size", 18)
	title.add_theme_color_override("font_color", TEXT_NAME)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_gold_label = Label.new()
	_gold_label.text = "\U01fa99 0"
	_gold_label.add_theme_font_size_override("font_size", 14)
	_gold_label.add_theme_color_override("font_color", GOLD)
	var close_btn := _close_button()
	close_btn.pressed.connect(close)
	head.add_child(title)
	head.add_child(_gold_label)
	head.add_child(close_btn)
	col.add_child(head)

	col.add_child(_section("Equipped"))
	_equip_grid = _grid()
	col.add_child(_equip_grid)

	col.add_child(_section("Bags"))
	_bag_grid = _grid()
	col.add_child(_bag_grid)

	col.add_child(_section("Action bar — tap two to swap (slot 1 auto-casts)"))
	_ability_bar = _grid()
	col.add_child(_ability_bar)

	col.add_child(_section("Stats"))
	_stat_panel = GridContainer.new()
	_stat_panel.columns = 2
	_stat_panel.add_theme_constant_override("h_separation", 16)
	_stat_panel.add_theme_constant_override("v_separation", 4)
	col.add_child(_stat_panel)

	var carry_head := HBoxContainer.new()
	var carry_sect := _section("Carried")
	carry_sect.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_carry_count = Label.new()
	_carry_count.text = "0"
	_carry_count.add_theme_font_size_override("font_size", 11)
	_carry_count.add_theme_color_override("font_color", TEXT_SECTION)
	carry_head.add_child(carry_sect)
	carry_head.add_child(_carry_count)
	col.add_child(carry_head)

	_carry_grid = _grid()
	col.add_child(_carry_grid)

	_carry_hint = _hint("Empty — loot bags or unequip gear here.")
	col.add_child(_carry_hint)
	col.add_child(_hint("Tap a carried item to equip · tap an equipped item to remove · \U01f5d1 to drop on the floor."))

func _build_loot_panel() -> void:
	_loot_root = _backdrop()
	_loot_root.gui_input.connect(func(ev: InputEvent): if _is_backdrop_tap(ev, _loot_root): close_loot())
	add_child(_loot_root)

	var content := _card(_loot_root)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_child(col)

	var head := HBoxContainer.new()
	var title := Label.new()
	title.text = "\U01f4b0 Loot bag"
	title.add_theme_font_size_override("font_size", 18)
	title.add_theme_color_override("font_color", TEXT_NAME)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var close_btn := _close_button()
	close_btn.pressed.connect(close_loot)
	head.add_child(title)
	head.add_child(close_btn)
	col.add_child(head)

	_loot_grid = _grid()
	col.add_child(_loot_grid)

	var take_all := Button.new()
	take_all.text = "Take all"
	take_all.custom_minimum_size = Vector2(0, 44)
	take_all.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	take_all.pressed.connect(func():
		if _open_bag_id != "":
			_send({"t": "takeLoot", "bag": _open_bag_id})
			_sfx_play("loot"))
	col.add_child(take_all)

	col.add_child(_hint("Tap an item to take it. You must be standing near the bag."))

# Full-screen translucent backdrop that centers its child card.
func _backdrop() -> Control:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_STOP
	var bg := ColorRect.new()
	bg.color = BACKDROP
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(bg)
	return root

# The centered scrollable card (matches .panelCard). Adds the visual card under
# `parent` and returns the inner content holder for callers to populate.
func _card(parent: Control) -> Control:
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(center)

	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = PANEL_BG
	sb.set_corner_radius_all(16)
	sb.set_border_width_all(1)
	sb.border_color = Color8(0x2c, 0x3a, 0x59)
	sb.set_content_margin_all(18)
	panel.add_theme_stylebox_override("panel", sb)
	center.add_child(panel)

	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(564, 640)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)

	# ScrollContainer needs a child that expands to its width to host the column.
	var holder := VBoxContainer.new()
	holder.custom_minimum_size = Vector2(540, 0)
	holder.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(holder)
	return holder

# Section header label (uppercase, spaced).
func _section(text: String) -> Label:
	var l := Label.new()
	l.text = text.to_upper()
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", TEXT_SECTION)
	return l

func _hint(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", TEXT_HINT)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l

func _grid() -> GridContainer:
	var g := GridContainer.new()
	g.columns = 6
	g.add_theme_constant_override("h_separation", 8)
	g.add_theme_constant_override("v_separation", 8)
	g.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return g

func _close_button() -> Button:
	var b := Button.new()
	b.text = "✕"
	b.custom_minimum_size = Vector2(38, 38)
	return b

# =====================================================================
# Helpers
# =====================================================================

func _stat_str(it: Dictionary) -> String:
	var parts: Array = []
	var attrs: Dictionary = it.get("attrs", {})
	for k in attrs.keys():
		var v := int(attrs[k])
		if v != 0:
			parts.append("+%d %s" % [v, ATTR_ABBR.get(str(k), str(k))])
	var bag_slots := int(it.get("bagSlots", 0))
	if bag_slots != 0:
		parts.append("+%d slots" % bag_slots)
	return " ".join(PackedStringArray(parts))

func _sell_value(it: Dictionary) -> int:
	return int(SELL_PRICE.get(str(it.get("rarity", "")), 1))

func _pct(x: float) -> String:
	return "%d%%" % roundi(x * 100.0)

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

# True on a left-click release or touch release (a "tap").
func _is_tap(ev: InputEvent) -> bool:
	if ev is InputEventMouseButton:
		return ev.button_index == MOUSE_BUTTON_LEFT and not ev.pressed
	if ev is InputEventScreenTouch:
		return not ev.pressed
	return false

# Backdrop tap = a tap whose target is the backdrop root itself (not the card).
func _is_backdrop_tap(ev: InputEvent, _root: Control) -> bool:
	return _is_tap(ev)

func _consume(_ev: InputEvent) -> void:
	var vp := get_viewport()
	if vp != null:
		vp.set_input_as_handled()
