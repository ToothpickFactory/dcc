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

const VISION_RADIUS := 1000.0   # DccConst.VISION_RADIUS; render.ts VISION_RADIUS (kept in sync)
const VISION_RADIUS_SQ := VISION_RADIUS * VISION_RADIUS
# Anything this close is ALWAYS shown, even if a wall corner clips the sight-line — so an
# enemy hugging a long wall while it attacks you can never be invisible. Distant foes still
# need line-of-sight (corners stay a mystery). ~5 melee-ranges of reveal.
const NEAR_REVEAL := 340.0
const NEAR_REVEAL_SQ := NEAR_REVEAL * NEAR_REVEAL
const SPRITE_PX_NORMAL := 84.0 # players / monsters
const SPRITE_PX_BOSS := 76.0
const SPRITE_PX_PROJ := 16.0
const SPRITE_PX_POISON := 28.0
const SPRITE_PX_ICE := 28.0
const SPRITE_PX_FIREBALL := 28.0
const SPRITE_PX_BOSSBOLT := 24.0
const SPRITE_PX_LOOT := 34.0
const SNAPSHOT_MS := 100.0     # ~2 ticks (TICK_MS=50); interpolation window for remotes
const POISON_PROJECTILE_SPRITE := 95
const ICE_PROJECTILE_SPRITE := 96
const FIREBALL_PROJECTILE_SPRITE := 97
const BOSS_BOLT_SPRITE := 99
const HERO_ROOT := "res://assets/Heroes/Kevin"
const ENEMY_ROOTS := ["Goblin", "Ghoul", "Infernax", "Orc", "Skeleton", "Troll", "Wraith", "Zombie", "Pirate", "SharkMan"]

var _sprites: Dictionary = {}   # id -> EntitySprite
var _last_pos: Dictionary = {}  # id -> Vector2 (previous displayed world pos, for facing delta)
var _net                        # Net node (prev/cur snapshots); set via set_net
var _grid: Dictionary = {}      # collision grid for canSee()
var _you_class := ""            # local player's chosen Klass; drives hero model selection

func set_net(net) -> void:
	_net = net

func set_grid(grid: Dictionary) -> void:
	_grid = grid

func set_you_class(klass: String) -> void:
	klass = _normalize_class(klass)
	if _you_class == klass:
		return
	_you_class = klass
	for id in _sprites:
		var spr: EntitySprite = _sprites[id]
		if spr.is_self:
			spr.set_chosen_class(klass)
			break

func _normalize_class(klass: String) -> String:
	var k := klass.strip_edges().to_lower()
	return "" if k == "null" or k == "<null>" or k == "nil" else k

# ---- hit flash dispatch (juice) -------------------------------------------
# Flash a specific entity's sprite (death event carries an id).
func flash_id(id: String, hurt: bool = false, reaction: String = "hit") -> void:
	var spr: EntitySprite = _sprites.get(id)
	if spr != null:
		spr.flash_hit(float(Time.get_ticks_msec()), hurt, reaction)

# Telegraph: an enemy (by id) is winding up an attack — pulse its charge tint.
func windup_id(id: String, ms: float) -> void:
	var spr: EntitySprite = _sprites.get(id)
	if spr != null:
		spr.windup(float(Time.get_ticks_msec()), ms)

# Flash the sprite nearest a world point (dmg/heal events carry only x,y).
func flash_at(x: float, y: float, radius: float = 70.0, hurt: bool = false, reaction: String = "hit") -> void:
	var best_id := _nearest_sprite_id_at(x, y, radius)
	if best_id != "":
		flash_id(best_id, hurt, reaction)

func status_at(x: float, y: float, status: String, radius: float = 90.0) -> void:
	var best_id := _nearest_sprite_id_at(x, y, radius)
	if best_id == "":
		return
	var spr: EntitySprite = _sprites.get(best_id)
	if spr != null:
		spr.play_status_fx(status, float(Time.get_ticks_msec()))

func _nearest_sprite_id_at(x: float, y: float, radius: float) -> String:
	var best_id := ""
	var best_sq := radius * radius
	for id in _last_pos.keys():
		var p: Vector2 = _last_pos[id]
		var dsq := (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)
		if dsq <= best_sq:
			best_sq = dsq
			best_id = id
	return best_id

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
		if k == "prop":
			var stale: EntitySprite = _sprites.get(id)
			if stale != null:
				stale.queue_free()
				_sprites.erase(id)
				_last_pos.erase(id)
			continue
		var is_self := id == you_id
		var player_class := _player_class_from_dto(d, is_self)

		var spr: EntitySprite = _sprites.get(id)
		if spr == null:
			spr = EntitySprite.new()
			if k == "player":
				spr.set_chosen_class(player_class)
			elif k == "monster":
				spr.set_monster_kind(str(d.get("monKind", "")))
			spr.setup(id, k, is_self)
			add_child(spr)
			_sprites[id] = spr
			if k != "proj":  # projectiles are too fleeting to pop; everything else scales in
				spr.spawn(now_ms)
		elif k == "player":
			spr.set_chosen_class(player_class)
		elif k == "monster":
			spr.set_monster_kind(str(d.get("monKind", "")))
		spr.set_entity_name(str(d.get("name", "")))

		# Resolve display world position.
		var wpos: Vector2
		if is_self:
			wpos = self_pos  # predicted local position (render.ts `predicted`)
		else:
			wpos = _interp_pos(id, d, alpha)

		# Sprite id (for 98/99 bolt sentinels).
		spr.set_sprite_id(int(d.get("sprite", 0)))
		spr.set_projectile_render(str(d.get("proj", "")))
		if k == "lootbag":
			spr.set_loot_rarity(str(d.get("rarity", "common")))
			# Loot etiquette: a bag owned by someone else (during the priority window) reads as locked.
			var lb_owner := str(d.get("owner", ""))
			spr.set_loot_owner(lb_owner != "" and lb_owner != you_id)
		elif k == "player" and not is_self:
			# Ally nameplate + HP bar (so a healer can read teammate HP). Self uses the top HUD.
			spr.set_ally_status(float(d.get("hp", 0.0)), float(d.get("maxHp", 0.0)), player_class)
		spr.set_cc(str(d.get("cc", ""))) # hard CC status tint (stun/root/freeze)
		spr.set_dead_body(bool(d.get("dead", false)), now_ms)

		# Facing delta = movement since the last displayed frame (render.ts dx/dy).
		var prev: Variant = _last_pos.get(id)
		var dx := 0.0
		var dy := 0.0
		if prev is Vector2:
			dx = wpos.x - (prev as Vector2).x
			dy = wpos.y - (prev as Vector2).y
		var aim := float(d.get("aim", 0.0))
		var sprite_px := _sprite_px_for(k, int(d.get("sprite", 0)))

		var ground_z := Geo.ground_height(_grid, wpos.x, wpos.y) # heightfield 2.5D: seat on terrain
		spr.update_visual(wpos.x, wpos.y, dx, dy, aim, now_ms, sprite_px, ground_z)
		_last_pos[id] = wpos

		# Fog of war: self + allies always visible; monsters/boss/proj need line-of-sight
		# within VISION_RADIUS — EXCEPT anything within NEAR_REVEAL, which is always shown so
		# a wall-hugging attacker can't hit you while invisible.
		var fogged := k == "monster" or k == "boss" or k == "proj"
		if fogged:
			var ddx := wpos.x - self_pos.x
			var ddy := wpos.y - self_pos.y
			var dsq := ddx * ddx + ddy * ddy
			spr.visible = dsq <= NEAR_REVEAL_SQ or (dsq <= VISION_RADIUS_SQ and _can_see(self_pos.x, self_pos.y, wpos.x, wpos.y))
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
				spr.queue_action(_self_action_for_ability(int(event.get("ability", 0))), now_ms)
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

func _self_action_for_ability(ability_idx: int) -> String:
	if _net == null:
		return "cast"
	var abilities: Variant = _net.self_dto.get("abilities", [])
	if not (abilities is Array):
		return "cast"
	if ability_idx < 0 or ability_idx >= (abilities as Array).size():
		return "cast"
	var ability: Variant = (abilities as Array)[ability_idx]
	if not (ability is Dictionary):
		return "cast"
	var ab := ability as Dictionary
	var is_projectile := bool(ab.get("projectile", false))
	var dmg := float(ab.get("dmg", 0.0))
	var is_melee := not is_projectile and dmg > 0.0 and not bool(ab.get("taunt", false)) and str(ab.get("groupBuff", "")) == ""
	return "strike" if is_melee else "cast"

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

func _player_class_from_dto(d: Dictionary, is_self: bool) -> String:
	if is_self:
		return _you_class if _you_class != "" else _normalize_class(str(d.get("klass", "")))
	return _normalize_class(str(d.get("klass", "")))

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
		"proj": return _projectile_sprite_px(sprite_id)
		"lootbag": return SPRITE_PX_LOOT
		_: return SPRITE_PX_NORMAL

func _projectile_sprite_px(sprite_id: int) -> float:
	match sprite_id:
		BOSS_BOLT_SPRITE: return SPRITE_PX_BOSSBOLT
		FIREBALL_PROJECTILE_SPRITE: return SPRITE_PX_FIREBALL
		ICE_PROJECTILE_SPRITE: return SPRITE_PX_ICE
		POISON_PROJECTILE_SPRITE: return SPRITE_PX_POISON
		_: return SPRITE_PX_PROJ

# Line-of-sight to the collision grid (render.ts canSee -> Geo.line_of_sight 1:1 port).
# No grid yet -> visible (radius-only fallback).
func _can_see(px: float, py: float, ex: float, ey: float) -> bool:
	if _grid.is_empty():
		return true
	return Geo.line_of_sight(_grid, px, py, ex, ey)
