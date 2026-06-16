class_name Sfx
extends Node
## Procedural sound effects — synthesized PCM (no asset files, export-safe). A small
## palette of short retro blips baked once into AudioStreamWAV, played through a pool of
## AudioStreamPlayers with slight random pitch so repeats don't sound mechanical.
##
## There is no audio in the server protocol; Main drives play() off the same GameEvents
## that feed the visual FX (hit/dmg/death/cast). Per-sound cooldowns keep dense combat
## from turning into a buzzsaw.
##
## Public API: play(name), with name in {"hit","hurt","cast","death","loot","evolve"}.

const RATE := 22050
const POOL := 10
const MIN_GAP_MS := 40.0   # per-sound throttle so many simultaneous hits don't stack

var _bank: Dictionary = {}       # name -> AudioStreamWAV
var _players: Array = []         # AudioStreamPlayer pool
var _next := 0
var _last_played: Dictionary = {}  # name -> ms


func _ready() -> void:
	for i in POOL:
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		p.volume_db = -7.0
		add_child(p)
		_players.append(p)
	_bake()


func play(name: String, vol_db := 0.0) -> void:
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


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------

func _bake() -> void:
	# hit: a snappy noise burst + a short mid thump — "a blow landed".
	_bank["hit"] = _synth(0.10, func(t: float) -> float:
		var env := exp(-t * 38.0)
		var noise := randf() * 2.0 - 1.0
		var tone := sin(TAU * 190.0 * t)
		return env * (0.62 * noise + 0.42 * tone))

	# hurt: you took damage — lower, harsher, a touch longer.
	_bank["hurt"] = _synth(0.20, func(t: float) -> float:
		var env := exp(-t * 13.0)
		var growl := sin(TAU * (95.0 + 30.0 * sin(TAU * 7.0 * t)) * t)
		var noise := (randf() * 2.0 - 1.0) * 0.35
		return env * (0.8 * growl + noise))

	# cast: a quick upward chirp — "you fired".
	_bank["cast"] = _synth(0.13, func(t: float) -> float:
		var f := 340.0 + 1100.0 * t / 0.13
		var env := exp(-t * 11.0)
		var sq := signf(sin(TAU * f * t)) * 0.35 + sin(TAU * f * t) * 0.65
		return env * 0.55 * sq)

	# death: a descending splat — noise that decays into a low tone.
	_bank["death"] = _synth(0.28, func(t: float) -> float:
		var env := exp(-t * 9.0)
		var f := 240.0 * exp(-t * 5.0) + 60.0
		var tone := sin(TAU * f * t)
		var noise := (randf() * 2.0 - 1.0) * exp(-t * 22.0)
		return env * (0.6 * tone + 0.55 * noise))

	# loot: a pleasant two-note chime.
	_bank["loot"] = _synth(0.22, func(t: float) -> float:
		var f := 660.0 if t < 0.09 else 990.0
		var env := exp(-fposmod(t, 0.11) * 16.0)
		return env * 0.5 * sin(TAU * f * t))

	# evolve: a bright three-note arpeggio (a power-up sting).
	_bank["evolve"] = _synth(0.34, func(t: float) -> float:
		var step := int(t / 0.11)
		var freqs := [523.0, 659.0, 880.0]
		var f: float = freqs[mini(step, 2)]
		var env := exp(-fposmod(t, 0.11) * 11.0)
		var sig := sin(TAU * f * t) * 0.7 + sin(TAU * f * 2.0 * t) * 0.3
		return env * 0.5 * sig)


# Build a mono 16-bit AudioStreamWAV by sampling `gen(t)` (returns [-1,1]) for `dur` seconds.
func _synth(dur: float, gen: Callable) -> AudioStreamWAV:
	var n := int(dur * RATE)
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	# Short fade-out tail to avoid a click at the end.
	var fade := maxi(1, int(0.004 * RATE))
	for i in n:
		var t := float(i) / float(RATE)
		var s: float = clampf(float(gen.call(t)), -1.0, 1.0)
		if i > n - fade:
			s *= float(n - i) / float(fade)
		bytes.encode_s16(i * 2, int(s * 32767.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = RATE
	wav.stereo = false
	wav.loop_mode = AudioStreamWAV.LOOP_DISABLED
	wav.data = bytes
	return wav
