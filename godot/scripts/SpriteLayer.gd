class_name SpriteLayer
extends Node3D
## Manager for all entity billboards. 1:1 port of the snapshot-driven lifecycle in
## src/client/render.ts sync() + handleEvents(): create/update/remove an EntitySprite per
## entity each frame, interpolate REMOTE entities between the previous and current server
## snapshots, draw the LOCAL player at its predicted position, and fog out
## monsters/boss/projectiles that are out of vision range or behind a wall.
##
## Public API (called by Main.gd):
##   set_net(net)                                  # wire prev/cur snapshots for interpolation
##   set_grid(grid)                                # collision grid for line-of-sight fog
##   sync(ents, you_id, self_pos)                  # per-frame; ents = latest server entity list
##   handle_events(events, ents, you_id, self_pos) # cast/melee -> action one-shots
##
## `sync(ents, you_id, self_pos)` matches the frozen contract signature. `ents` is the
## latest snapshot (Net.cur.ents). Remote interpolation reads Net.prev/Net.cur by id;
## the local self uses `self_pos` (the predicted position) directly.

const VISION_RADIUS := 520.0   # DccConst.VISION_RADIUS; render.ts VISION_RADIUS
const VISION_RADIUS_SQ := VISION_RADIUS * VISION_RADIUS
const SPRITE_PX_NORMAL := 84.0 # players / monsters
const SPRITE_PX_BOSS := 76.0
const SPRITE_PX_PROJ := 16.0
const SPRITE_PX_BOSSBOLT := 24.0
const SPRITE_PX_LOOT := 34.0
const SNAPSHOT_MS := 100.0     # ~2 ticks (TICK_MS=50); interpolation window for remotes
const BOSS_BOLT_SPRITE := 99
const HERO_ROOT := "res://assets/Heroes/Kevin"
const ENEMY_ROOTS := ["Goblin", "Ghoul", "Orc", "Skeleton", "Zombie", "Troll"]

var _sprites: Dictionary = {}   # id -> EntitySprite
var _last_pos: Dictionary = {}  # id -> Vector2 (previous displayed world pos, for facing delta)
var _net                        # Net node (prev/cur snapshots); set via set_net
var _grid: Dictionary = {}      # collision grid for canSee()
var _hero_attack_toggle := false # render.ts heroAttackToggle (alternates cleave punch frames)

func set_net(net) -> void:
	_net = net

func set_grid(grid: Dictionary) -> void:
	_grid = grid

# ---- hit flash dispatch (juice) -------------------------------------------
# Flash a specific entity's sprite (death event carries an id).
func flash_id(id: String, hurt: bool = false, reaction: String = "hit") -> void:
	var spr: EntitySprite = _sprites.get(id)
	if spr != null:
		spr.flash_hit(float(Time.get_ticks_msec()), hurt, reaction)

# Flash the sprite nearest a world point (dmg/heal events carry only x,y).
func flash_at(x: float, y: float, radius: float = 70.0, hurt: bool = false, reaction: String = "hit") -> void:
	var best_id := ""
	var best_sq := radius * radius
	for id in _last_pos.keys():
		var p: Vector2 = _last_pos[id]
		var dsq := (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)
		if dsq <= best_sq:
			best_sq = dsq
			best_id = id
	if best_id != "":
		flash_id(best_id, hurt, reaction)

# ---------------------------------------------------------------------------
# Per-frame sync. ents = the latest server snapshot's entity list (Net.cur.ents).
# you_id = local player id; self_pos = predicted local world position.
# ---------------------------------------------------------------------------
func sync(ents: Array, you_id: String, self_pos: Vector2) -> void:
	var now_ms := float(Time.get_ticks_msec())
	var alpha := _interp_alpha(now_ms)
	var seen := {}

	for e in ents:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = e
		var id := str(d.get("id", ""))
		if id == "":
			continue
		seen[id] = true
		var k := str(d.get("kind", ""))
		var is_self := id == you_id

		var spr: EntitySprite = _sprites.get(id)
		if spr == null:
			spr = EntitySprite.new()
			spr.setup(id, k, is_self)
			add_child(spr)
			_sprites[id] = spr
			if k != "proj":  # projectiles are too fleeting to pop; everything else scales in
				spr.spawn(now_ms)
		spr.set_entity_name(str(d.get("name", "")))

		# Resolve display world position.
		var wpos: Vector2
		if is_self:
			wpos = self_pos  # predicted local position (render.ts `predicted`)
		else:
			wpos = _interp_pos(id, d, alpha)

		# Sprite id (for 98/99 bolt sentinels).
		spr.set_sprite_id(int(d.get("sprite", 0)))

		# Facing delta = movement since the last displayed frame (render.ts dx/dy).
		var prev: Variant = _last_pos.get(id)
		var dx := 0.0
		var dy := 0.0
		if prev is Vector2:
			dx = wpos.x - (prev as Vector2).x
			dy = wpos.y - (prev as Vector2).y
		var aim := float(d.get("aim", 0.0))
		var sprite_px := _sprite_px_for(k, int(d.get("sprite", 0)))

		spr.update_visual(wpos.x, wpos.y, dx, dy, aim, now_ms, sprite_px)
		_last_pos[id] = wpos

		# Fog of war (render.ts): self + allies always visible; monsters/boss/proj only
		# within VISION_RADIUS AND with clear line-of-sight to the local player.
		var fogged := k == "monster" or k == "boss" or k == "proj"
		if fogged:
			var ddx := wpos.x - self_pos.x
			var ddy := wpos.y - self_pos.y
			spr.visible = (ddx * ddx + ddy * ddy <= VISION_RADIUS_SQ) and _can_see(self_pos.x, self_pos.y, wpos.x, wpos.y)
		else:
			spr.visible = true

	# Remove sprites for entities no longer in the snapshot.
	for id in _sprites.keys():
		if not seen.has(id):
			var spr: EntitySprite = _sprites[id]
			if spr.is_waiting_for_death_anim(now_ms):
				continue
			spr.queue_free()
			_sprites.erase(id)
			_last_pos.erase(id)

# ---------------------------------------------------------------------------
# Events -> action one-shots. Port of render.ts handleEvents(). Called by Main when a
# state message carries `events`. self_pos lets us position-match the self caster.
# ---------------------------------------------------------------------------
func handle_events(events: Array, ents: Array, you_id: String, _self_pos: Vector2) -> void:
	var now_ms := float(Time.get_ticks_msec())
	for ev in events:
		if typeof(ev) != TYPE_DICTIONARY:
			continue
		var event: Dictionary = ev
		var kind := str(event.get("e", ""))
		if kind == "cast":
			var caster := _nearest_entity(ents, float(event.get("x", 0.0)), float(event.get("y", 0.0)), ["player", "monster", "boss"], 90.0)
			if caster.is_empty():
				continue
			var cid := str(caster.get("id", ""))
			var spr: EntitySprite = _sprites.get(cid)
			if spr == null:
				continue
			if cid == you_id:
				# render.ts self-cast specialisation: mend -> cast, cleave -> alternating
				# punch (frameStart 0/8, 8 frames), else generic cast. We only have the
				# ability INDEX on the wire; without the live ability list we fall back to
				# a generic cast one-shot (the common case). Index 1 = starter "rocks"
				# (cleave-like throw) -> punch toggle, matching the starter action bar.
				var ability_idx := int(event.get("ability", 0))
				if ability_idx == 1:
					var frame_start := 8 if _hero_attack_toggle else 0
					_hero_attack_toggle = not _hero_attack_toggle
					spr.queue_action("punch", now_ms, frame_start, 8)
				else:
					spr.queue_action("cast", now_ms)
				continue
			# A remote caster plays the "bolt" cast pose.
			spr.queue_action("bolt", now_ms)
		elif kind == "melee":
			var by := str(event.get("by", ""))
			var spr2: EntitySprite = _sprites.get(by)
			if spr2 == null:
				continue
			if spr2.kind != "monster" and spr2.kind != "boss":
				continue
			spr2.queue_action("strike", now_ms)

# ---------------------------------------------------------------------------
# Interpolation: blend a remote entity between its prev-snapshot and cur-snapshot
# positions. alpha in [0,1] across the snapshot window. Falls back to the raw DTO
# position when no prev sample exists (new entity / no history).
# ---------------------------------------------------------------------------
func _interp_alpha(now_ms: float) -> float:
	if _net == null:
		return 1.0
	var cur: Dictionary = _net.cur
	if cur.is_empty():
		return 1.0
	var recv := float(cur.get("recv", now_ms))
	var a := (now_ms - recv) / SNAPSHOT_MS
	return clampf(a, 0.0, 1.0)

func _interp_pos(id: String, cur_dto: Dictionary, alpha: float) -> Vector2:
	var cur_pos := Vector2(float(cur_dto.get("x", 0.0)), float(cur_dto.get("y", 0.0)))
	if _net == null:
		return cur_pos
	var prev: Dictionary = _net.prev
	if prev.is_empty():
		return cur_pos
	var prev_ents: Variant = prev.get("ents", [])
	if not (prev_ents is Array):
		return cur_pos
	for pe in (prev_ents as Array):
		if typeof(pe) != TYPE_DICTIONARY:
			continue
		if str((pe as Dictionary).get("id", "")) == id:
			var prev_pos := Vector2(float((pe as Dictionary).get("x", cur_pos.x)), float((pe as Dictionary).get("y", cur_pos.y)))
			return prev_pos.lerp(cur_pos, alpha)
	return cur_pos

# ---------------------------------------------------------------------------
# render.ts nearestEntity: closest entity of an allowed kind within maxDistance.
# Returns the DTO Dictionary or {} if none.
# ---------------------------------------------------------------------------
func _nearest_entity(ents: Array, x: float, y: float, kinds: Array, max_distance: float) -> Dictionary:
	var best := {}
	var best_dist_sq := max_distance * max_distance
	for e in ents:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		var d: Dictionary = e
		if not kinds.has(str(d.get("kind", ""))):
			continue
		var ddx := float(d.get("x", 0.0)) - x
		var ddy := float(d.get("y", 0.0)) - y
		var dist_sq := ddx * ddx + ddy * ddy
		if dist_sq <= best_dist_sq:
			best = d
			best_dist_sq = dist_sq
	return best

# Sprite world-size by kind (render.ts size table), with boss-bolt vs normal proj split.
func _sprite_px_for(kind: String, sprite_id: int) -> float:
	match kind:
		"boss": return SPRITE_PX_BOSS
		"proj": return SPRITE_PX_BOSSBOLT if sprite_id == BOSS_BOLT_SPRITE else SPRITE_PX_PROJ
		"lootbag": return SPRITE_PX_LOOT
		_: return SPRITE_PX_NORMAL

# Line-of-sight to the collision grid (render.ts canSee -> Geo.line_of_sight 1:1 port).
# No grid yet -> visible (radius-only fallback).
func _can_see(px: float, py: float, ex: float, ey: float) -> bool:
	if _grid.is_empty():
		return true
	return Geo.line_of_sight(_grid, px, py, ex, ey)
