## ShopPanel.gd
## Controller-navigable shop overlay. Opens when the player is near the floor shop
## prop so gamepad players can buy and sell without requiring touch/tap input.
## All interactive elements are Godot Button nodes — D-pad navigates, A/Enter buys
## or sells the focused item, B/Escape closes.
extends CanvasLayer

const GOLD         := Color(1.0, 0.85, 0.0)
const GREEN        := Color(0.4, 1.0, 0.5)
const SELL_COLOR   := Color(1.0, 0.65, 0.3)
const DIM          := Color(0.65, 0.65, 0.65)
const SELL_PRICE   := {"common": 3, "uncommon": 8, "rare": 20, "epic": 50, "legendary": 120}
const RARITY_COLOR := {
	"common":    Color8(0x88, 0x99, 0xbb),
	"uncommon":  Color8(0x3f, 0xae, 0x5a),
	"rare":      Color8(0x44, 0x88, 0xff),
	"epic":      Color8(0xaa, 0x44, 0xff),
	"legendary": Color8(0xff, 0xaa, 0x22),
}

var _net: Node
var _shop_items: Array = []
var _carried: Array = []
var _gold := 0

var _root: Control
var _gold_label: Label
var _buy_col: VBoxContainer
var _sell_col: VBoxContainer
var _close_btn: Button

func setup(net: Node) -> void:
	_net = net

func open() -> void:
	visible = true
	if _root != null:
		_root.visible = true
	_refresh()
	# Auto-focus the first interactive button when opened via controller.
	await get_tree().process_frame
	_focus_first()

func close() -> void:
	visible = false

func is_open() -> bool:
	return visible

func on_shop(msg: Dictionary) -> void:
	_shop_items = msg.get("items", [])
	if is_open():
		_refresh()

func on_inv(msg: Dictionary) -> void:
	var inv: Variant = msg.get("inv", {})
	if inv is Dictionary:
		_carried = inv.get("carried", []) as Array
	_gold = int(msg.get("gold", 0))
	if is_open():
		_refresh()

func _ready() -> void:
	layer = 30
	visible = false

	# CanvasLayer children must be Control nodes; use a full-rect root to fill the viewport.
	var container := Control.new()
	container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(container)

	# Dim backdrop.
	var backdrop := ColorRect.new()
	backdrop.color = Color(0, 0, 0, 0.72)
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	backdrop.mouse_filter = Control.MOUSE_FILTER_STOP
	container.add_child(backdrop)

	# Centered card.
	_root = PanelContainer.new()
	_root.set_anchors_and_offsets_preset(Control.PRESET_CENTER, Control.PRESET_MODE_KEEP_SIZE, 0)
	_root.custom_minimum_size = Vector2(460, 600)
	container.add_child(_root)

	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 10)
	_root.add_child(outer)

	_root.add_theme_stylebox_override("panel", _make_bg())

	# ── Header ──────────────────────────────────────────────────────────────
	var header := HBoxContainer.new()
	var title := Label.new()
	title.text = "🛒 Floor Shop"
	title.add_theme_font_size_override("font_size", 20)
	title.add_theme_color_override("font_color", Color.WHITE)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_gold_label = Label.new()
	_gold_label.add_theme_font_size_override("font_size", 16)
	_gold_label.add_theme_color_override("font_color", GOLD)
	header.add_child(title)
	header.add_child(_gold_label)
	outer.add_child(header)

	outer.add_child(HSeparator.new())

	# ── Buy section ─────────────────────────────────────────────────────────
	var buy_lbl := Label.new()
	buy_lbl.text = "For Sale"
	buy_lbl.add_theme_font_size_override("font_size", 14)
	buy_lbl.add_theme_color_override("font_color", GREEN)
	outer.add_child(buy_lbl)

	var buy_scroll := ScrollContainer.new()
	buy_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	buy_scroll.custom_minimum_size = Vector2(0, 180)
	_buy_col = VBoxContainer.new()
	_buy_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_buy_col.add_theme_constant_override("separation", 4)
	buy_scroll.add_child(_buy_col)
	outer.add_child(buy_scroll)

	outer.add_child(HSeparator.new())

	# ── Sell section ─────────────────────────────────────────────────────────
	var sell_lbl := Label.new()
	sell_lbl.text = "Your Items  (sell)"
	sell_lbl.add_theme_font_size_override("font_size", 14)
	sell_lbl.add_theme_color_override("font_color", SELL_COLOR)
	outer.add_child(sell_lbl)

	var sell_scroll := ScrollContainer.new()
	sell_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sell_scroll.custom_minimum_size = Vector2(0, 180)
	_sell_col = VBoxContainer.new()
	_sell_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_sell_col.add_theme_constant_override("separation", 4)
	sell_scroll.add_child(_sell_col)
	outer.add_child(sell_scroll)

	outer.add_child(HSeparator.new())

	# ── Close button ─────────────────────────────────────────────────────────
	_close_btn = Button.new()
	_close_btn.text = "Close  (B)"
	_close_btn.focus_mode = Control.FOCUS_ALL
	_close_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_close_btn.pressed.connect(close)
	outer.add_child(_close_btn)

func _refresh() -> void:
	if _gold_label == null:
		return
	_gold_label.text = "💰 %d" % _gold
	_build_buy()
	_build_sell()

func _build_buy() -> void:
	for c in _buy_col.get_children():
		c.queue_free()
	if _shop_items.is_empty():
		_buy_col.add_child(_empty_label("(loading…)"))
		return
	for entry in _shop_items:
		if not (entry is Dictionary):
			continue
		var it: Dictionary = entry.get("item", {})
		var price := int(entry.get("price", 0))
		var can_afford := _gold >= price
		var btn := _item_button(it, "💰 %d" % price, can_afford)
		if can_afford:
			var item_id := str(it.get("id", ""))
			btn.pressed.connect(func(): _net.send_msg({"t": "buyItem", "id": item_id}))
		_buy_col.add_child(btn)

func _build_sell() -> void:
	for c in _sell_col.get_children():
		c.queue_free()
	if _carried.is_empty():
		_sell_col.add_child(_empty_label("(nothing to sell)"))
		return
	for it in _carried:
		if not (it is Dictionary):
			continue
		var sv := _sell_value(it)
		var btn := _item_button(it, "+💰 %d" % sv, true)
		var item_id := str(it.get("id", ""))
		btn.pressed.connect(func(): _net.send_msg({"t": "sell", "item": item_id}))
		_sell_col.add_child(btn)

func _item_button(it: Dictionary, price_txt: String, enabled: bool) -> Button:
	var rarity := str(it.get("rarity", "common"))
	var name_txt := str(it.get("name", "Unknown item"))
	var slot_txt := str(it.get("slot", ""))

	var btn := Button.new()
	btn.focus_mode = Control.FOCUS_ALL
	btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn.disabled = not enabled
	btn.custom_minimum_size = Vector2(0, 44)

	# Left side: rarity-colored name + slot
	var label_txt := name_txt
	if slot_txt != "":
		label_txt += "  [%s]" % slot_txt
	btn.text = "%-32s  %s" % [label_txt, price_txt]
	btn.add_theme_color_override("font_color", RARITY_COLOR.get(rarity, Color.WHITE))
	if not enabled:
		btn.modulate = Color(0.5, 0.5, 0.5, 0.8)

	return btn

func _empty_label(txt: String) -> Label:
	var l := Label.new()
	l.text = txt
	l.add_theme_color_override("font_color", DIM)
	l.add_theme_font_size_override("font_size", 13)
	return l

func _sell_value(it: Dictionary) -> int:
	return int(SELL_PRICE.get(str(it.get("rarity", "")), 1))

func _focus_first() -> void:
	# Try to focus the first buy button, then sell, then close.
	for child in _buy_col.get_children():
		if child is Button and not child.disabled:
			child.grab_focus()
			return
	for child in _sell_col.get_children():
		if child is Button and not child.disabled:
			child.grab_focus()
			return
	_close_btn.grab_focus()

func _input(event: InputEvent) -> void:
	if not is_open():
		return
	if event is InputEventJoypadButton and event.pressed:
		if event.button_index == JOY_BUTTON_B:
			close()
			get_viewport().set_input_as_handled()
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			close()
			get_viewport().set_input_as_handled()

func _make_bg() -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = Color8(0x12, 0x18, 0x28, 0xf0)
	s.set_corner_radius_all(8)
	s.content_margin_left   = 18
	s.content_margin_right  = 18
	s.content_margin_top    = 14
	s.content_margin_bottom = 14
	return s
