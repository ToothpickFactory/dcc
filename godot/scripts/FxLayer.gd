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
				_dmg_number(roundi(float(e.get("amount", 0.0))), e)
			"heal":
				_float("+" + str(roundi(float(e.get("amount", 0.0)))), Color(0.42, 1.0, 0.55), e, 44)
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

func _float(text: String, color: Color, e: Dictionary, size: int = 44) -> void:
	var lbl := _new_label(text, color, size, float(e.get("x", 0.0)), float(e.get("y", 0.0)), 60.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "position:y", 150.0, 0.85)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.85).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# Damage number scaled by hit size: small chip vs a meaty crit-style hit (bigger, hotter,
# with a pop). Reads the blow's weight at a glance instead of uniform numbers.
func _dmg_number(amount: int, e: Dictionary) -> void:
	var size := clampi(34 + amount, 34, 92)
	var big := amount >= 40
	var color := Color(1.0, 0.78, 0.2) if big else Color(1.0, 0.36, 0.30)
	var txt := ("-%d!" % amount) if big else ("-%d" % amount)
	var lbl := _new_label(txt, color, size, float(e.get("x", 0.0)), float(e.get("y", 0.0)), 62.0)
	if big:
		lbl.scale = Vector3(0.5, 0.5, 0.5)
	var tw := create_tween().set_parallel(true)
	if big:
		tw.tween_property(lbl, "scale", Vector3(1.25, 1.25, 1.25), 0.16).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(lbl, "position:y", 165.0, 0.9)
	tw.tween_property(lbl, "modulate:a", 0.0, 0.9).set_ease(Tween.EASE_IN)
	tw.set_parallel(false)
	tw.tween_callback(lbl.queue_free)

# A short-lived fading trail dot behind a projectile (Main calls this for in-vision
# projectiles, throttled). Boss bolts get a violet trail; player/monster shots get gold.
func proj_trail(x: float, y: float, boss: bool) -> void:
	var col := Color(0.78, 0.32, 1.0, 0.7) if boss else Color(1.0, 0.83, 0.4, 0.7)
	var dot := _new_label("•", col, 18, x, y, 12.0)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(dot, "scale", Vector3(0.3, 0.3, 0.3), 0.24)
	tw.tween_property(dot, "modulate:a", 0.0, 0.24)
	tw.set_parallel(false)
	tw.tween_callback(dot.queue_free)

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

# Attack telegraph: a warning marker over a winding-up enemy for the tell duration, so
# you can read the incoming hit and dodge/step out (paired with the enemy's charge tint).
func windup_marker(x: float, y: float, ms: float) -> void:
	var dur: float = clampf(ms / 1000.0, 0.15, 1.2)
	var lbl := _new_label("❗", Color(1.0, 0.62, 0.12), 30, x, y, 110.0)
	lbl.scale = Vector3(0.6, 0.6, 0.6)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(lbl, "scale", Vector3(1.3, 1.3, 1.3), dur * 0.6).set_trans(Tween.TRANS_SINE)
	tw.tween_property(lbl, "modulate:a", 0.0, dur).set_ease(Tween.EASE_IN)
	tw.chain().tween_callback(lbl.queue_free)

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
