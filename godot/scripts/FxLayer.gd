class_name FxLayer
extends Node3D
## Floating combat feedback from server GameEvents — the visual half of
## render.ts handleEvents() that SpriteLayer (cast/melee/bolt action clips) doesn't
## cover: damage/heal numbers and a death poof. Billboarded Label3D that floats up
## and fades, then frees itself.

func handle_events(events: Array, you_id: String = "") -> void:
	for ev in events:
		if typeof(ev) != TYPE_DICTIONARY:
			continue
		var e: Dictionary = ev
		match str(e.get("e", "")):
			"dmg":
				if e.has("by") and you_id != "" and str(e.get("by", "")) != you_id:
					continue
				_float("-" + str(roundi(float(e.get("amount", 0.0)))), Color(1.0, 0.36, 0.30), e)
			"heal":
				_float("+" + str(roundi(float(e.get("amount", 0.0)))), Color(0.42, 1.0, 0.55), e)
			"hit":
				_impact(e)
			"death":
				_poof(e)

func _new_label(text: String, color: Color, size: int, x: float, y: float, h: float) -> Label3D:
	var lbl := Label3D.new()
	lbl.text = text
	lbl.modulate = color
	lbl.font_size = size
	lbl.pixel_size = 1.0
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

# "+N XP" gain popup (gold), driven by Main off the self charXp delta on kills. Floats
# higher/slower than damage numbers and offset up so it reads as a reward, not a hit.
func xp_popup(x: float, y: float, amount: int) -> void:
	if amount <= 0:
		return
	var lbl := _new_label("+%d XP" % amount, Color(1.0, 0.86, 0.35), 34, x, y, 80.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "position:y", 200.0, 1.0)
	tw.tween_property(lbl, "modulate:a", 0.0, 1.0).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# Projectile/melee impact: a quick bright burst that scales up and fades (the "hit"
# event is emitted by the server but was previously rendered by neither client).
func _impact(e: Dictionary) -> void:
	var x := float(e.get("x", 0.0))
	var y := float(e.get("y", 0.0))
	var lbl := _new_label("✷", Color(1.0, 0.95, 0.6), 30, x, y, 26.0)
	lbl.scale = Vector3(0.4, 0.4, 0.4)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "scale", Vector3(1.7, 1.7, 1.7), 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.22).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# Enemy death: a bright core burst plus a few sparks flying outward, so kills land.
func _poof(e: Dictionary) -> void:
	var x := float(e.get("x", 0.0))
	var y := float(e.get("y", 0.0))
	var core := _new_label("✦", Color(1.0, 0.9, 0.55), 44, x, y, 40.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(core, "scale", Vector3(3.0, 3.0, 3.0), 0.45).set_ease(Tween.EASE_OUT)
	tw.tween_property(core, "modulate:a", 0.0, 0.45)
	tw.set_parallel(false)
	tw.tween_callback(core.queue_free)
	# Diverging sparks.
	for i in 5:
		var ang := TAU * float(i) / 5.0 + randf() * 0.6
		var dist := randf_range(55.0, 95.0)
		var spark := _new_label("•", Color(1.0, 0.8, 0.4), 26, x, y, 42.0)
		var st := create_tween().set_parallel(true)
		st.tween_property(spark, "position", Vector3(x + cos(ang) * dist, 18.0, y + sin(ang) * dist), 0.4).set_ease(Tween.EASE_OUT)
		st.tween_property(spark, "modulate:a", 0.0, 0.4).set_ease(Tween.EASE_IN)
		st.set_parallel(false)
		st.tween_callback(spark.queue_free)
