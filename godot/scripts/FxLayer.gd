class_name FxLayer
extends Node3D
## Floating combat feedback from server GameEvents — the visual half of
## render.ts handleEvents() that SpriteLayer (cast/melee/bolt action clips) doesn't
## cover: damage/heal numbers and a death poof. Billboarded Label3D that floats up
## and fades, then frees itself.

func handle_events(events: Array) -> void:
	for ev in events:
		if typeof(ev) != TYPE_DICTIONARY:
			continue
		var e: Dictionary = ev
		match str(e.get("e", "")):
			"dmg":
				_float("-" + str(roundi(float(e.get("amount", 0.0)))), Color(1.0, 0.36, 0.30), e)
			"heal":
				_float("+" + str(roundi(float(e.get("amount", 0.0)))), Color(0.42, 1.0, 0.55), e)
			"death":
				_poof(e)

func _new_label(text: String, color: Color, size: int, x: float, y: float, h: float) -> Label3D:
	var lbl := Label3D.new()
	lbl.text = text
	lbl.modulate = color
	lbl.font_size = size
	lbl.outline_size = 10
	lbl.outline_modulate = Color(0, 0, 0, 0.7)
	lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lbl.no_depth_test = true
	lbl.position = Vector3(x, h, y)
	add_child(lbl)
	return lbl

func _float(text: String, color: Color, e: Dictionary) -> void:
	var lbl := _new_label(text, color, 48, float(e.get("x", 0.0)), float(e.get("y", 0.0)), 60.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "position:y", 150.0, 0.85)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.85).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

func _poof(e: Dictionary) -> void:
	var lbl := _new_label("✦", Color(1.0, 0.9, 0.55), 40, float(e.get("x", 0.0)), float(e.get("y", 0.0)), 40.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "scale", Vector3(2.6, 2.6, 2.6), 0.4)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.4)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)
