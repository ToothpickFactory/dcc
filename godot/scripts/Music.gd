class_name Music
extends Node
## Procedural ambient music — a slow, breathing chord pad synthesized at runtime (no
## asset files, export-safe), looped seamlessly and routed through a reverb bus for depth.
## Each floor theme gets its own mood (root pitch, brightness, detune, reverb). 1:1 with
## the SFX approach in Sfx.gd but longer + looping.
##
## Public API: set_theme(theme)  — crossfade to that theme's bed (lazy-baked + cached).
##             stop() / set_enabled(b).
##
## On Android (MTE/Godot bug): AudioStreamWAV crashes. Uses AudioStreamGenerator instead
## (push individual float frames per _process) — completely different C++ code path.

const RATE := 22050
const LOOP_S := 16.0
const SEG_S := 4.0
const BUS := "Music"

const MOODS := {
	"fantasy":   {"mult": 1.00, "shimmer": 0.18, "detune": 0.004, "wet": 0.34},
	"forest":    {"mult": 1.12, "shimmer": 0.26, "detune": 0.003, "wet": 0.30},
	"cyberpunk": {"mult": 0.50, "shimmer": 0.12, "detune": 0.010, "wet": 0.40},
	"pirate":    {"mult": 0.94, "shimmer": 0.16, "detune": 0.005, "wet": 0.32},
	"clockwork": {"mult": 1.00, "shimmer": 0.20, "detune": 0.006, "wet": 0.28},
	"nightmare": {"mult": 0.47, "shimmer": 0.10, "detune": 0.016, "wet": 0.46},
}
const PROG  := [1.0, 0.794, 1.189, 0.891]
const BASE_HZ := 220.0
const CHORD := [1.0, 1.2, 1.5, 2.0]

# ── Shared state ──────────────────────────────────────────────────────────────
var _player: AudioStreamPlayer
var _combat: AudioStreamPlayer
var _combat_on := false
var _cur := ""
var _enabled := true

# ── WAV path (PC) ─────────────────────────────────────────────────────────────
var _bank: Dictionary = {}
var _bank_bytes: Dictionary = {}
var _combat_bytes: PackedByteArray
var _fade: Tween
var _combat_fade: Tween

# ── Generator path (Android) ──────────────────────────────────────────────────
var _use_gen := false
var _gen_loops: Dictionary = {}         # theme -> PackedFloat32Array
var _gen_combat: PackedFloat32Array
var _gen_pos := 0
var _gen_combat_pos := 0
var _gen_pb: AudioStreamGeneratorPlayback
var _gen_combat_pb: AudioStreamGeneratorPlayback
var _gen_vol := -80.0
var _gen_vol_target := -80.0
var _gen_combat_vol := -80.0
var _gen_combat_vol_target := -80.0


func _ready() -> void:
	_use_gen = OS.has_feature("mobile")
	_ensure_bus()
	if _use_gen:
		_ready_gen()
	else:
		_ready_wav()


func _ready_wav() -> void:
	_player = AudioStreamPlayer.new()
	_player.bus = BUS
	_player.volume_db = 0.0
	add_child(_player)
	_combat = AudioStreamPlayer.new()
	_combat.bus = BUS
	_combat.volume_db = -40.0
	_combat.stream = _bake_combat()
	add_child(_combat)


func _ready_gen() -> void:
	var gen := AudioStreamGenerator.new()
	gen.mix_rate = float(RATE)
	gen.buffer_length = 0.5
	_player = AudioStreamPlayer.new()
	_player.stream = gen
	_player.bus = BUS
	_player.volume_db = -80.0
	add_child(_player)
	_player.play()
	_gen_pb = _player.get_stream_playback() as AudioStreamGeneratorPlayback

	var cgen := AudioStreamGenerator.new()
	cgen.mix_rate = float(RATE)
	cgen.buffer_length = 0.5
	_combat = AudioStreamPlayer.new()
	_combat.stream = cgen
	_combat.bus = BUS
	_combat.volume_db = -80.0
	add_child(_combat)
	_combat.play()
	_gen_combat_pb = _combat.get_stream_playback() as AudioStreamGeneratorPlayback
	_gen_combat = _bake_combat_float()


func _process(delta: float) -> void:
	if not _use_gen:
		return
	_push_main()
	_push_combat()
	_gen_vol = lerpf(_gen_vol, _gen_vol_target, minf(delta * 5.0, 1.0))
	_player.volume_db = _gen_vol
	_gen_combat_vol = lerpf(_gen_combat_vol, _gen_combat_vol_target, minf(delta * 2.0, 1.0))
	_combat.volume_db = _gen_combat_vol


func _push_main() -> void:
	if _gen_pb == null:
		return
	var frames: PackedFloat32Array = _gen_loops.get(_cur, PackedFloat32Array())
	if frames.size() == 0:
		return
	var avail := mini(_gen_pb.get_frames_available(), 4096)
	for _i in avail:
		_gen_pb.push_frame(Vector2(frames[_gen_pos], frames[_gen_pos]))
		_gen_pos = (_gen_pos + 1) % frames.size()


func _push_combat() -> void:
	if _gen_combat_pb == null or _gen_combat.size() == 0:
		return
	var avail := mini(_gen_combat_pb.get_frames_available(), 4096)
	for _i in avail:
		_gen_combat_pb.push_frame(Vector2(_gen_combat[_gen_combat_pos], _gen_combat[_gen_combat_pos]))
		_gen_combat_pos = (_gen_combat_pos + 1) % _gen_combat.size()


# ── Public API ────────────────────────────────────────────────────────────────

func set_enabled(b: bool) -> void:
	_enabled = b
	if not b:
		stop()


func stop() -> void:
	_cur = ""
	if _use_gen:
		_gen_vol_target        = -80.0
		_gen_combat_vol_target = -80.0
		_combat_on = false
		return
	if _player != null:
		_player.stop()
	if _combat != null:
		_combat.stop()
	_combat_on = false


func set_combat(on: bool) -> void:
	if not _enabled or on == _combat_on:
		return
	_combat_on = on
	if _use_gen:
		_gen_combat_vol_target = -4.0 if on else -80.0
		return
	if _combat == null:
		return
	if _combat_fade != null and _combat_fade.is_valid():
		_combat_fade.kill()
	if on and not _combat.playing:
		_combat.play()
	_combat_fade = create_tween()
	_combat_fade.tween_property(_combat, "volume_db", -4.0 if on else -40.0, 1.4)
	if not on:
		_combat_fade.tween_callback(_combat.stop)


func set_theme(theme: String) -> void:
	if not _enabled or theme == _cur:
		return
	_cur = theme
	if _use_gen:
		if not _gen_loops.has(theme):
			_gen_loops[theme] = _bake_float(theme)
		_gen_pos = 0
		_gen_vol_target = 0.0
		return
	if _player == null:
		return
	var wav: AudioStreamWAV = _bank.get(theme)
	if wav == null:
		wav = _bake(theme)
		_bank[theme] = wav
	if _fade != null and _fade.is_valid():
		_fade.kill()
	if _player.playing:
		_fade = create_tween()
		_fade.tween_property(_player, "volume_db", -40.0, 0.5)
		_fade.tween_callback(func(): _swap(wav))
		_fade.tween_property(_player, "volume_db", 0.0, 0.8)
	else:
		_swap(wav)
		_player.volume_db = -40.0
		_fade = create_tween()
		_fade.tween_property(_player, "volume_db", 0.0, 1.2)


func _swap(wav: AudioStreamWAV) -> void:
	_player.stream = wav
	_player.play()


# ── Synthesis — generator path (float arrays) ─────────────────────────────────

func _bake_float(theme: String) -> PackedFloat32Array:
	var m: Dictionary = MOODS.get(theme, MOODS["fantasy"])
	var mult    := float(m["mult"])
	var shimmer := float(m["shimmer"])
	var detune  := float(m["detune"])
	var n := int(LOOP_S * RATE)
	var arr := PackedFloat32Array()
	arr.resize(n)
	for i in n:
		var t   := float(i) / float(RATE)
		var seg := int(t / SEG_S) % PROG.size()
		var root: float = BASE_HZ * mult * float(PROG[seg])
		var env: float  = sin(PI * fposmod(t, SEG_S) / SEG_S)
		env = env * env
		var s := 0.0
		for ci in CHORD.size():
			var f: float = root * float(CHORD[ci])
			s += sin(TAU * f * t) + sin(TAU * f * (1.0 + detune) * t)
		s *= 0.12
		s += shimmer * sin(TAU * root * 4.0 * t) * (0.5 + 0.5 * sin(TAU * 0.07 * t))
		s += 0.18 * sin(TAU * root * 0.5 * t) * env
		arr[i] = clampf(s * env, -1.0, 1.0)
	return arr


func _bake_combat_float() -> PackedFloat32Array:
	var loop := 4.0
	var beat := 0.5
	var n := int(loop * RATE)
	var arr := PackedFloat32Array()
	arr.resize(n)
	for i in n:
		var t  := float(i) / float(RATE)
		var ph := fposmod(t, beat) / beat
		var kick    := exp(-ph * 16.0) * sin(TAU * (120.0 * exp(-ph * 8.0) + 45.0) * t)
		var tension := 0.10 * sin(TAU * 220.0 * t) * sin(TAU * 221.7 * t)
		arr[i] = clampf(0.7 * kick + tension, -1.0, 1.0)
	return arr


# ── Synthesis — WAV path (PC) ─────────────────────────────────────────────────

func _bake_combat() -> AudioStreamWAV:
	var loop := 4.0
	var beat := 0.5
	var n := int(loop * RATE)
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	for i in n:
		var t  := float(i) / float(RATE)
		var ph := fposmod(t, beat) / beat
		var kick    := exp(-ph * 16.0) * sin(TAU * (120.0 * exp(-ph * 8.0) + 45.0) * t)
		var tension := 0.10 * sin(TAU * 220.0 * t) * sin(TAU * 221.7 * t)
		bytes.encode_s16(i * 2, int(clampf(0.7 * kick + tension, -1.0, 1.0) * 28000.0))
	var wav := AudioStreamWAV.new()
	wav.format    = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate  = RATE
	wav.stereo    = false
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end   = n
	wav.data = bytes
	_combat_bytes = bytes
	return wav


func _bake(theme: String) -> AudioStreamWAV:
	var m: Dictionary = MOODS.get(theme, MOODS["fantasy"])
	var mult    := float(m["mult"])
	var shimmer := float(m["shimmer"])
	var detune  := float(m["detune"])
	var n := int(LOOP_S * RATE)
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	for i in n:
		var t   := float(i) / float(RATE)
		var seg := int(t / SEG_S) % PROG.size()
		var root: float = BASE_HZ * mult * float(PROG[seg])
		var env: float  = sin(PI * fposmod(t, SEG_S) / SEG_S)
		env = env * env
		var s := 0.0
		for ci in CHORD.size():
			var f: float = root * float(CHORD[ci])
			s += sin(TAU * f * t) + sin(TAU * f * (1.0 + detune) * t)
		s *= 0.12
		s += shimmer * sin(TAU * root * 4.0 * t) * (0.5 + 0.5 * sin(TAU * 0.07 * t))
		s += 0.18 * sin(TAU * root * 0.5 * t) * env
		bytes.encode_s16(i * 2, int(clampf(s * env, -1.0, 1.0) * 30000.0))
	var wav := AudioStreamWAV.new()
	wav.format    = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate  = RATE
	wav.stereo    = false
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end   = n
	wav.data = bytes
	_bank_bytes[theme] = bytes
	return wav


func _ensure_bus() -> void:
	if AudioServer.get_bus_index(BUS) != -1:
		return
	var idx := AudioServer.bus_count
	AudioServer.add_bus(idx)
	AudioServer.set_bus_name(idx, BUS)
	AudioServer.set_bus_send(idx, "Master")
	var rev := AudioEffectReverb.new()
	rev.room_size = 0.85
	rev.damping   = 0.5
	rev.wet       = 0.35
	rev.dry       = 0.85
	AudioServer.add_bus_effect(idx, rev)
	AudioServer.set_bus_volume_db(idx, -16.0)
