class_name Music
extends Node
## Procedural ambient music — a slow, breathing chord pad synthesized at runtime (no
## asset files, export-safe), looped seamlessly and routed through a reverb bus for depth.
## Each floor theme gets its own mood (root pitch, brightness, detune, reverb). 1:1 with
## the SFX approach in Sfx.gd but longer + looping.
##
## Public API: set_theme(theme)  — crossfade to that theme's bed (lazy-baked + cached).
##             stop() / set_enabled(b).

const RATE := 22050
const LOOP_S := 16.0           # loop length; 4 chords x 4s swells
const SEG_S := 4.0             # one chord swell
const BUS := "Music"

# theme -> mood: mult (pitch transpose), shimmer (high voice), detune (dissonance), wet (reverb).
const MOODS := {
	"fantasy":   {"mult": 1.00, "shimmer": 0.18, "detune": 0.004, "wet": 0.34},
	"forest":    {"mult": 1.12, "shimmer": 0.26, "detune": 0.003, "wet": 0.30},
	"cyberpunk": {"mult": 0.50, "shimmer": 0.12, "detune": 0.010, "wet": 0.40},
	"pirate":    {"mult": 0.94, "shimmer": 0.16, "detune": 0.005, "wet": 0.32},
	"clockwork": {"mult": 1.00, "shimmer": 0.20, "detune": 0.006, "wet": 0.28},
	"nightmare": {"mult": 0.47, "shimmer": 0.10, "detune": 0.016, "wet": 0.46},
}
# 4-chord minor progression (i - VI - III - VII), root ratios off a base.
const PROG := [1.0, 0.794, 1.189, 0.891]  # A, F, C, G relative to A
const BASE_HZ := 220.0
const CHORD := [1.0, 1.2, 1.5, 2.0]       # root, min3, fifth, octave

var _bank: Dictionary = {}     # theme -> AudioStreamWAV
var _player: AudioStreamPlayer
var _cur := ""
var _fade: Tween
var _enabled := true

# Boss-intensity layer: a driving pulse that fades in over the ambient bed when a boss
# is alive, then resolves on its death.
var _combat: AudioStreamPlayer
var _combat_on := false
var _combat_fade: Tween


func _ready() -> void:
	_ensure_bus()
	_player = AudioStreamPlayer.new()
	_player.bus = BUS
	_player.volume_db = 0.0
	add_child(_player)
	_combat = AudioStreamPlayer.new()
	_combat.bus = BUS
	_combat.volume_db = -40.0
	_combat.stream = _bake_combat()
	add_child(_combat)


# Fade the boss-combat pulse in (boss present) or out (boss dead/gone).
func set_combat(on: bool) -> void:
	if not _enabled or on == _combat_on:
		return
	_combat_on = on
	if _combat_fade != null and _combat_fade.is_valid():
		_combat_fade.kill()
	if on and not _combat.playing:
		_combat.play()
	_combat_fade = create_tween()
	_combat_fade.tween_property(_combat, "volume_db", -4.0 if on else -40.0, 1.4)
	if not on:
		_combat_fade.tween_callback(_combat.stop)


# A tense driving loop: a steady low pulse (kick) + an anxious detuned high shimmer.
func _bake_combat() -> AudioStreamWAV:
	var loop := 4.0
	var beat := 0.5  # 120 bpm pulse
	var n := int(loop * RATE)
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	for i in n:
		var t := float(i) / float(RATE)
		var ph := fposmod(t, beat) / beat
		var kick := exp(-ph * 16.0) * sin(TAU * (120.0 * exp(-ph * 8.0) + 45.0) * t)  # punchy low
		var tension := 0.10 * sin(TAU * 220.0 * t) * sin(TAU * 221.7 * t)             # detuned beat
		var v: float = clampf(0.7 * kick + tension, -1.0, 1.0)
		bytes.encode_s16(i * 2, int(v * 28000.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = RATE
	wav.stereo = false
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end = n
	wav.data = bytes
	return wav


func set_enabled(b: bool) -> void:
	_enabled = b
	if not b:
		stop()


func stop() -> void:
	if _player != null:
		_player.stop()
	if _combat != null:
		_combat.stop()
	_combat_on = false
	_cur = ""


# Crossfade to the bed for `theme` (lazy-bake + cache). No-op if already playing it.
func set_theme(theme: String) -> void:
	if not _enabled or theme == _cur:
		return
	_cur = theme
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


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------

func _bake(theme: String) -> AudioStreamWAV:
	var m: Dictionary = MOODS.get(theme, MOODS["fantasy"])
	var mult := float(m["mult"])
	var shimmer := float(m["shimmer"])
	var detune := float(m["detune"])
	var n := int(LOOP_S * RATE)
	var bytes := PackedByteArray()
	bytes.resize(n * 2)
	for i in n:
		var t := float(i) / float(RATE)
		var seg := int(t / SEG_S) % PROG.size()
		var root: float = BASE_HZ * mult * float(PROG[seg])
		# Per-chord swell envelope: 0 at segment edges, 1 mid — also makes the loop seamless.
		var env: float = sin(PI * fposmod(t, SEG_S) / SEG_S)
		env = env * env
		var s := 0.0
		for ci in CHORD.size():
			var f: float = root * float(CHORD[ci])
			# Two slightly detuned partials per voice for warmth.
			s += sin(TAU * f * t) + sin(TAU * f * (1.0 + detune) * t)
		s *= 0.12  # tame the summed voices
		# Slow high shimmer (an octave-plus above), gently panned in amplitude.
		s += shimmer * sin(TAU * root * 4.0 * t) * (0.5 + 0.5 * sin(TAU * 0.07 * t))
		# Sub-bass pulse for body.
		s += 0.18 * sin(TAU * root * 0.5 * t) * env
		var v: float = clampf(s * env, -1.0, 1.0)
		bytes.encode_s16(i * 2, int(v * 30000.0))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = RATE
	wav.stereo = false
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end = n
	wav.data = bytes
	return wav


# A dedicated Music bus (created once) with reverb so the pad has space.
func _ensure_bus() -> void:
	if AudioServer.get_bus_index(BUS) != -1:
		return
	var idx := AudioServer.bus_count
	AudioServer.add_bus(idx)
	AudioServer.set_bus_name(idx, BUS)
	AudioServer.set_bus_send(idx, "Master")
	var rev := AudioEffectReverb.new()
	rev.room_size = 0.85
	rev.damping = 0.5
	rev.wet = 0.35
	rev.dry = 0.85
	AudioServer.add_bus_effect(idx, rev)
	AudioServer.set_bus_volume_db(idx, -16.0)
