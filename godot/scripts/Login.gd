class_name Login
extends CanvasLayer
## Name-entry screen shown before connecting (port of the #login card in
## public/index.html). Emits `submitted(name)` then frees itself; Main defers
## Net.start until then.

signal submitted(player_name)

var _field: LineEdit

func _ready() -> void:
	layer = 50  # above the HUD
	var bg := ColorRect.new()
	bg.color = Color(0.04, 0.055, 0.08, 0.97)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.add_child(center)

	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(360, 0)
	box.add_theme_constant_override("separation", 14)
	center.add_child(box)

	var title := Label.new()
	title.text = "⚔️  DCC — The Infinite Descent"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)

	var hint := Label.new()
	hint.text = "WASD move · mouse aim · 1–4 / click cast. Friendly fire is ON. One life."
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.modulate = Color(0.6, 0.66, 0.78)
	box.add_child(hint)

	_field = LineEdit.new()
	_field.placeholder_text = "Your hero name"
	_field.max_length = 16
	box.add_child(_field)

	var btn := Button.new()
	btn.text = "Enter the world"
	box.add_child(btn)

	btn.pressed.connect(_submit)
	_field.text_submitted.connect(func(_t): _submit())
	_field.grab_focus()

func _submit() -> void:
	var n := _field.text.strip_edges()
	if n == "":
		n = "Hero%d" % (randi() % 1000)
	submitted.emit(n)
	queue_free()
