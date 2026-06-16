extends Node
## Phase-0 WebSocket transport. Mirrors src/client/net.ts: connect, join on open,
## decode welcome/floor/state into prev/cur snapshots. Raw JSON over WebSocketPeer
## (NOT Godot high-level multiplayer). Added as a child of Main (not an autoload),
## so GdUnit4 test runs don't open sockets.

signal welcomed(you)
signal protocol_mismatch(server_v, client_v)
signal floor_received(geometry, info)
signal inv_received(msg)
signal bag_received(msg)
signal events_received(events)
signal closed

var you := ""
var token := ""
var self_dto: Dictionary = {}
var ents: Array = []
var cur: Dictionary = {}
var prev: Dictionary = {}
var floor_info: Dictionary = {}    # last floor message `info` (depth/theme/seed/...)
var floor_state: Dictionary = {}   # last floor message `state` (endsAt/living/livingAtStairs)
var run_state: Dictionary = {}     # last run message `state` (phase/players/spectators)
var last_inv: Dictionary = {}      # last `inv` message (inv/attrs/derived/capacity/gold) — for the skills stat block

var _ws := WebSocketPeer.new()
var _was_open := false
var _url := DccConst.DEFAULT_WS_URL
var _name := "GodotHero"

func start(url: String, player_name: String) -> void:
	_url = url
	_name = player_name
	# Dev hook: rebind to an existing character by signed token (e.g. to inspect a
	# leveled save). Mirrors the web client's stored identity token.
	var tok := OS.get_environment("DCC_TOKEN")
	if tok != "":
		token = tok
	var err := _ws.connect_to_url(_url)
	if err != OK:
		push_error("WS connect_to_url failed: %s" % error_string(err))

func _process(_delta: float) -> void:
	_ws.poll()
	var st := _ws.get_ready_state()
	if st == WebSocketPeer.STATE_OPEN:
		if not _was_open:
			_was_open = true
			var join := {"t": "join", "name": _name}
			if token != "":
				join["token"] = token
			_send(join)
		while _ws.get_available_packet_count() > 0:
			var txt := _ws.get_packet().get_string_from_utf8()
			var msg: Variant = JSON.parse_string(txt)
			if msg is Dictionary:
				_handle(msg)
	elif st == WebSocketPeer.STATE_CLOSED and _was_open:
		_was_open = false
		closed.emit()

func _handle(m: Dictionary) -> void:
	match str(m.get("t", "")):
		"welcome":
			you = str(m.get("you", ""))
			token = str(m.get("token", ""))
			var sv := int(m.get("protocol", -1))
			if sv != DccConst.PROTOCOL_VERSION:
				push_warning("Protocol mismatch: server=%d client=%d" % [sv, DccConst.PROTOCOL_VERSION])
				protocol_mismatch.emit(sv, DccConst.PROTOCOL_VERSION)
			welcomed.emit(you)
		"floor":
			floor_info = m.get("info", {})
			floor_state = m.get("state", {})
			floor_received.emit(m.get("geometry", {}), floor_info)
		"state":
			self_dto = m.get("self", {})
			prev = cur
			ents = m.get("ents", [])
			cur = {"tick": int(m.get("tick", 0)), "ents": ents, "recv": Time.get_ticks_msec()}
			var evs: Array = m.get("events", [])
			if not evs.is_empty():
				events_received.emit(evs)
		"run":
			run_state = m.get("state", {})
		"inv":
			last_inv = m
			inv_received.emit(m)
		"bag":
			bag_received.emit(m)
		_:
			pass

func send_input(seq: int, mv: Vector2, aim: float) -> void:
	_send({"t": "input", "seq": seq, "mv": [mv.x, mv.y], "aim": aim})

func send_cast(seq: int, ability: int, aim: float) -> void:
	_send({"t": "cast", "seq": seq, "ability": ability, "aim": aim})

## Generic outbound for inventory/sell/swap/loot messages (see src/protocol.ts ClientMsg).
func send_msg(obj: Dictionary) -> void:
	_send(obj)

func _send(obj: Dictionary) -> void:
	if _ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_ws.send_text(JSON.stringify(obj))
