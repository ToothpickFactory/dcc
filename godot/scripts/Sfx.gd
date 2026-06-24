class_name Sfx
extends Node
## Procedural sound effects — synthesized PCM (no asset files, export-safe). A small
## palette of short retro blips baked once into AudioStreamWAV, played through a pool of
## AudioStreamPlayers with slight random pitch so repeats don't sound mechanical.
##
## On Android (MTE/Godot bug): AudioStreamWAV crashes. Uses AudioStreamGenerator instead
## (push float frames on play) — completely different C++ code path, MTE-safe.
##
## Public API: play(name), with name in {"hit","hurt","cast","death","loot","evolve"}.

const RATE       := 22050
const POOL       := 10
const MIN_GAP_MS := 40.0

var _bank: Dictionary     = {}  # name -> AudioStreamWAV (PC)
var _gen_bank: Dictionary = {}  # name -> PackedFloat32Array (Android)
var _players: Array = []
var _next := 0
var _last_played: Dictionary = {}

var _use_gen := false


func _ready() -> void:
	_use_gen = OS.has_feature("mobile")
	for i in POOL:
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		p.volume_db = -7.0
		if _use_gen:
			var gen := AudioStreamGenerator.new()
			gen.mix_rate = float(RATE)
			gen.buffer_length = 0.7  # longer than the longest sfx (0.55s descent)
			p.stream = gen
		add_child(p)
		_players.append(p)
	if _use_gen:
		_bake_gen()
	else:
		_bake()


func play(name: String, vol_db := 0.0) -> void:
	if _use_gen:
		_play_gen(name, vol_db)
	else:
		_play_wav(name, vol_db)


func _play_wav(name: String, vol_db: float) -> void:
	var wav: Variant = _bank.get(name)
	if wav == null:
		return
	var now := float(Time.get_ticks_msec())
	if now - float(_last_played.get(name, -9999.0)) < MIN_GAP_MS:
		return
	_last_played[name] = now
	var p: AudioStreamPlayer = _players[_next]
	_next = (_next + 1) % POOL
	p.stream = wav
	p.pitch_scale = randf_range(0.93, 1.08)
	p.volume_db = -7.0 + vol_db
	p.play()


func _play_gen(name: String, vol_db: float) -> void:
	var frames: Variant = _gen_bank.get(name)
	if frames == null:
		return
	var now := float(Time.get_ticks_msec())
	if now - float(_last_played.get(name, -9999.0)) < MIN_GAP_MS:
		return
	_last_played[name] = now
	var p: AudioStreamPlayer = _players[_next]
	_next = (_next + 1) % POOL
	p.pitch_scale = randf_range(0.93, 1.08)
	p.volume_db = -7.0 + vol_db
	p.stop()
	p.play()
	var pb: AudioStreamGeneratorPlayback = p.get_stream_playback()
	if pb == null:
		return
	var sf: PackedFloat32Array = frames
	for i in sf.size():
		var s := sf[i]
		pb.push_frame(Vector2(s, s))


# ---------------------------------------------------------------------------
# Synthesis — generator path (float arrays, Android)
# ---------------------------------------------------------------------------

func _bake_gen() -> void:
	_gen_bank["hit"] = _synth_float(0.10, func(t: float) -> float:
		var env := exp(-t * 38.0)
		var noise := randf() * 2.0 - 1.0
		var tone := sin(TAU * 190.0 * t)
		return env * (0.62 * noise + 0.42 * tone))

	_gen_bank["hurt"] = _synth_float(0.20, func(t: float) -> float:
		var env := exp(-t * 13.0)
		var growl := sin(TAU * (95.0 + 30.0 * sin(TAU * 7.0 * t)) * t)
		var noise := (randf() * 2.0 - 1.0) * 0.35
		return env * (0.8 * growl + noise))

	_gen_bank["cast"] = _synth_float(0.13, func(t: float) -> float:
		var f := 340.0 + 1100.0 * t / 0.13
		var env := exp(-t * 11.0)
		var sq := signf(sin(TAU * f * t)) * 0.35 + sin(TAU * f * t) * 0.65
		return env * 0.55 * sq)

	_gen_bank["death"] = _synth_float(0.28, func(t: float) -> float:
		var env := exp(-t * 9.0)
		var f := 240.0 * exp(-t * 5.0) + 60.0
		var tone := sin(TAU * f * t)
		var noise := (randf() * 2.0 - 1.0) * exp(-t * 22.0)
		return env * (0.6 * tone + 0.55 * noise))

	_gen_bank["loot"] = _synth_float(0.22, func(t: float) -> float:
		var f := 660.0 if t < 0.09 else 990.0
		var env := exp(-fposmod(t, 0.11) * 16.0)
		return env * 0.5 * sin(TAU * f * t))

	_gen_bank["evolve"] = _synth_float(0.34, func(t: float) -> float:
		var step := int(t / 0.11)
		var freqs := [523.0, 659.0, 880.0]
		var f: float = freqs[mini(step, 2)]
		var env := exp(-fposmod(t, 0.11) * 11.0)
		var sig := sin(TAU * f * t) * 0.7 + sin(TAU * f * 2.0 * t) * 0.3
		return env * 0.5 * sig)

	_gen_bank["heartbeat"] = _synth_float(0.34, func(t: float) -> float:
		var beat := func(tt: float) -> float: return exp(-tt * 26.0) * sin(TAU * 58.0 * tt)
		var s: float = beat.call(t)
		if t > 0.14:
			s += 0.85 * float(beat.call(t - 0.14))
		return clampf(s, -1.0, 1.0))

	_gen_bank["descent"] = _synth_float(0.55, func(t: float) -> float:
		var f := 520.0 * exp(-t * 4.5) + 70.0
		var env := exp(-t * 3.4)
		var noise := (randf() * 2.0 - 1.0) * exp(-t * 10.0) * 0.3
		return clampf(env * (0.6 * sin(TAU * f * t) + noise), -1.0, 1.0))

	_gen_bank["ui_open"] = _synth_float(0.10, func(t: float) -> float:
		var f := 480.0 + 700.0 * t / 0.10
		return exp(-t * 16.0) * 0.4 * sin(TAU * f * t))

	_gen_bank["ui_close"] = _synth_float(0.10, func(t: float) -> float:
		var f := 760.0 - 480.0 * t / 0.10
		return exp(-t * 16.0) * 0.4 * sin(TAU * f * t))

	_gen_bank["click"] = _synth_float(0.05, func(t: float) -> float:
		return exp(-t * 60.0) * 0.4 * sin(TAU * 900.0 * t))

	_gen_bank["dash"] = _synth_float(0.16, func(t: float) -> float:
		var env := exp(-t * 13.0)
		var noise := randf() * 2.0 - 1.0
		var f := 620.0 - 320.0 * t / 0.16
		return clampf(env * (0.5 * noise + 0.4 * sin(TAU * f * t)), -1.0, 1.0))


func _synth_float(dur: float, gen: Callable) -> PackedFloat32Array:
	var n    := int(dur * RATE)
	var fade := maxi(1, int(0.004 * RATE))
	var arr  := PackedFloat32Array()
	arr.resize(n)
	for i in n:
		var t := float(i) / float(RATE)
		var s := clampf(float(gen.call(t)), -1.0, 1.0)
		if i > n - fade:
			s *= float(n - i) / float(fade)
		arr[i] = s
	return arr


# ---------------------------------------------------------------------------
# Synthesis — WAV path (PC)
# ---------------------------------------------------------------------------

func _bake() -> void:
	_bank["hit"] = _synth(0.10, func(t: float) -> float:
		var env := exp(-t * 38.0)
		var noise := randf() * 2.0 - 1.0
		var tone := sin(TAU * 190.0 * t)
		return env * (0.62 * noise + 0.42 * tone))

	_bank["hurt"] = _synth(0.20, func(t: float) -> float:
		var env := exp(-t * 13.0)
		var growl := sin(TAU * (95.0 + 30.0 * sin(TAU * 7.0 * t)) * t)
		var noise := (randf() * 2.0 - 1.0) * 0.35
		return env * (0.8 * growl + noise))

	_bank["cast"] = _synth(0.13, func(t: float) -> float:
		var f := 340.0 + 1100.0 * t / 0.13
		var env := exp(-t * 11.0)
		var sq := signf(sin(TAU * f * t)) * 0.35 + sin(TAU * f * t) * 0.65
		return env * 0.55 * sq)

	_bank["death"] = _synth(0.28, func(t: float) -> float:
		var env := exp(-t * 9.0)
		var f := 240.0 * exp(-t * 5.0) + 60.0
		var tone := sin(TAU * f * t)
		var noise := (randf() * 2.0 - 1.0) * exp(-t * 22.0)
		return env * (0.6 * tone + 0.55 * noise))

	_bank["loot"] = _synth(0.22, func(t: float) -> float:
		var f := 660.0 if t < 0.09 else 990.0
		var env := exp(-fposmod(t, 0.11) * 16.0)
		return env * 0.5 * sin(TAU * f * t))

	_bank["evolve"] = _synth(0.34, func(t: float) -> float:
		var step := int(t / 0.11)
		var freqs := [523.0, 659.0, 880.0]
		var f: float = freqs[mini(step, 2)]
		var env := exp(-fposmod(t, 0.11) * 11.0)
		var sig := sin(TAU * f * t) * 0.7 + sin(TAU * f * 2.0 * t) * 0.3
		return env * 0.5 * sig)

	_bank["heartbeat"] = _synth(0.34, func(t: float) -> float:
		var beat := func(tt: float) -> float: return exp(-tt * 26.0) * sin(TAU * 58.0 * tt)
		var s: float = beat.call(t)
		if t > 0.14:
			s += 0.85 * float(beat.call(t - 0.14))
		return clampf(s, -1.0, 1.0))

	_bank["descent"] = _synth(0.55, func(t: float) -> float:
		var f := 520.0 * exp(-t * 4.5) + 70.0
		var env := exp(-t * 3.4)
		var noise := (randf() * 2.0 - 1.0) * exp(-t * 10.0) * 0.3
		return clampf(env * (0.6 * sin(TAU * f * t) + noise), -1.0, 1.0))

	_bank["ui_open"] = _synth(0.10, func(t: float) -> float:
		var f := 480.0 + 700.0 * t / 0.10
		return exp(-t * 16.0) * 0.4 * sin(TAU * f * t))

	_bank["ui_close"] = _synth(0.10, func(t: float) -> float:
		var f := 760.0 - 480.0 * t / 0.10
		return exp(-t * 16.0) * 0.4 * sin(TAU * f * t))

	_bank["click"] = _synth(0.05, func(t: float) -> float:
		return exp(-t * 60.0) * 0.4 * sin(TAU * 900.0 * t))

	_bank["dash"] = _synth(0.16, func(t: float) -> float:
		var env := exp(-t * 13.0)
		var noise := randf() * 2.0 - 1.0
		var f := 620.0 - 320.0 * t / 0.16
		return clampf(env * (0.5 * noise + 0.4 * sin(TAU * f * t)), -1.0, 1.0))


func _synth(dur: float, gen: Callable) -> AudioStreamWAV:
	var n    := int(dur * RATE)
	var fade := maxi(1, int(0.004 * RATE))
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	for i in n:
		var t := float(i) / float(RATE)
		var s: float = clampf(float(gen.call(t)), -1.0, 1.0)
		if i > n - fade:
			s *= float(n - i) / float(fade)
		bytes.encode_s16(i * 2, int(s * 32767.0))
	var wav := AudioStreamWAV.new()
	wav.format    = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate  = RATE
	wav.stereo    = false
	wav.loop_mode = AudioStreamWAV.LOOP_DISABLED
	wav.data      = bytes
	return wav
