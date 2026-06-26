class_name Minimap
extends Control
## Discovery minimap, ported 1:1 from src/client/minimap.ts. Cells the local player
## has had line-of-sight to (per floor) are revealed and drawn to a small top-right
## panel, with the "you" dot, the exit (once its cell is seen), and living teammates.
## Purely client-side; reuses Geo.line_of_sight so it agrees with the fog shader.
##
## Public API (called by Main):
##   set_floor(grid: Dictionary, stairs: Dictionary)  -- fresh floor = fresh discovery
##   update_map(px, py, ents, you_id, in_play)         -- call each frame (px/py = predictor pos)

const SIZE := 210.0      # panel px (square); also multiplied by Main's UI content scale
const REDRAW_MS := 80    # ~12 fps is plenty for a minimap
const STAIRS_HIGHLIGHT_MS := 15000.0

var _grid: Dictionary = {}
var _stairs: Dictionary = {}
var _discovered: Dictionary = {}   # used as a Set: {cell_index: true}
var _scale := 1.0                  # world px -> minimap px
var _last_cell := -1               # recompute discovery only when the player's cell changes
var _next_draw := 0.0
var _stairs_highlight_until := 0.0

# Latest draw state (update_map stashes these; _draw consumes them).
var _px := 0.0
var _py := 0.0
var _ents: Array = []
var _you_id := ""

func _ready() -> void:
	custom_minimum_size = Vector2(SIZE, SIZE)
	size = Vector2(SIZE, SIZE)
	# Pin to the top-right corner with an 8px margin.
	set_anchors_preset(Control.PRESET_TOP_RIGHT)
	offset_left = -SIZE - 8.0
	offset_top = 8.0
	offset_right = -8.0
	offset_bottom = SIZE + 8.0
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false

func set_floor(grid: Dictionary, stairs: Dictionary) -> void:
	_grid = grid
	_stairs = stairs
	_discovered.clear()
	_last_cell = -1
	_stairs_highlight_until = 0.0
	var w: int = grid["w"]
	var cell: float = grid["cell"]
	_scale = SIZE / (float(w) * cell)
	visible = true
	queue_redraw()

## Update just the stairs position (e.g. when boss dies and exit opens mid-floor)
## without clearing discovery or rebuilding the grid.
func update_stairs(stairs: Dictionary) -> void:
	_stairs = stairs

func highlight_stairs() -> void:
	if _grid.is_empty() or _stairs.is_empty():
		return
	var cell: float = _grid["cell"]
	var w: int = _grid["w"]
	var sx := int(floor(float(_stairs.get("x", 0.0)) / cell))
	var sy := int(floor(float(_stairs.get("y", 0.0)) / cell))
	_discovered[sy * w + sx] = true
	_stairs_highlight_until = float(Time.get_ticks_msec()) + STAIRS_HIGHLIGHT_MS
	_next_draw = 0.0
	queue_redraw()

## px/py = local player world pos (for the "you" dot + LoS reveal). in_play=false
## (waiting room / dead) freezes discovery but still redraws allies.
func update_map(px: float, py: float, ents: Array, you_id: String, in_play: bool) -> void:
	if _grid.is_empty():
		return
	_px = px
	_py = py
	_ents = ents
	_you_id = you_id
	if in_play:
		_reveal(px, py)
	var now := float(Time.get_ticks_msec())
	if now < _next_draw:
		return
	_next_draw = now + REDRAW_MS
	queue_redraw()

func _reveal(px: float, py: float) -> void:
	var cell: float = _grid["cell"]
	var w: int = _grid["w"]
	var h: int = _grid["h"]
	var cx := int(floor(px / cell))
	var cy := int(floor(py / cell))
	var here := cy * w + cx
	if here == _last_cell:
		return
	_last_cell = here
	var r := int(ceil(DccConst.VISION_RADIUS / cell))
	var vis_sq := DccConst.VISION_RADIUS * DccConst.VISION_RADIUS
	var y0 := maxi(0, cy - r)
	var y1 := mini(h - 1, cy + r)
	var x0 := maxi(0, cx - r)
	var x1 := mini(w - 1, cx + r)
	for y in range(y0, y1 + 1):
		for x in range(x0, x1 + 1):
			var wx := (x + 0.5) * cell
			var wy := (y + 0.5) * cell
			var dx := wx - px
			var dy := wy - py
			if dx * dx + dy * dy > vis_sq:
				continue
			if Geo.line_of_sight(_grid, px, py, wx, wy):
				_discovered[y * w + x] = true

func _draw() -> void:
	if _grid.is_empty():
		return
	var w: int = _grid["w"]
	var cell: float = _grid["cell"]
	var solid: PackedByteArray = _grid["solid"]
	var s := _scale
	var cs := ceilf(cell * s)
	var cell_size := Vector2(cs, cs)

	# Panel backdrop so undiscovered area reads as solid, not transparent.
	draw_rect(Rect2(Vector2.ZERO, Vector2(SIZE, SIZE)), Color8(0x0b, 0x0e, 0x14, 0xcc), true)

	var wall_col := Color8(0x39, 0x44, 0x5e)
	var floor_col := Color8(0x16, 0x21, 0x3a)
	for idx_v in _discovered.keys():
		var idx := int(idx_v)
		var x := idx % w
		var y := idx / w
		var col := wall_col if solid[idx] == 1 else floor_col
		var p := Vector2(floor(x * cell * s), floor(y * cell * s))
		draw_rect(Rect2(p, cell_size), col, true)

	# Stairs — only once their cell has been discovered.
	if not _stairs.is_empty():
		var stx := float(_stairs.get("x", 0.0))
		var sty := float(_stairs.get("y", 0.0))
		var sx := int(floor(stx / cell))
		var sy := int(floor(sty / cell))
		if _discovered.has(sy * w + sx):
			draw_circle(Vector2(stx * s, sty * s), 3.0, Color8(0x5d, 0xff, 0x9b))
			if float(Time.get_ticks_msec()) < _stairs_highlight_until:
				var pulse := 0.5 + 0.5 * sin(float(Time.get_ticks_msec()) * 0.012)
				draw_arc(Vector2(stx * s, sty * s), 7.0 + pulse * 4.0, 0.0, TAU, 28, Color8(0xff, 0xd3, 0x4d), 2.0)

	# Living teammates (always shown for co-op awareness).
	var ally_col := Color8(0x4f, 0x8c, 0xff)
	for e in _ents:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		if str(e.get("kind", "")) != "player" or str(e.get("id", "")) == _you_id:
			continue
		draw_circle(Vector2(float(e.get("x", 0.0)) * s, float(e.get("y", 0.0)) * s), 2.5, ally_col)

	# You.
	draw_circle(Vector2(_px * s, _py * s), 3.0, Color8(0x5d, 0xd6, 0xff))
