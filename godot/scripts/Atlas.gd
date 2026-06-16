class_name Atlas
extends RefCounted
## Loads a single animation clip from `<basePath>/atlas.json` + `<basePath>/spritesheet.png`
## into a list of AtlasTexture-ready frame rects. 1:1 port of src/client/atlas.ts
## (loadAtlasClip) plus the per-clip texture/duration handling from src/client/render.ts
## (ensureClip). Each loaded clip is cached process-wide so the shared sheet Texture2D is
## decoded once; EntitySprite makes its OWN AtlasTexture pointing at that shared atlas (so
## per-sprite region stepping never aliases other sprites).
##
## A loaded clip is a Dictionary:
##   {
##     "sheet": Texture2D,                # the decoded spritesheet (shared, never mutated)
##     "sheet_w": int, "sheet_h": int,    # full sheet pixel size
##     "frames": Array[Rect2],            # per-frame region rects (top-left origin px)
##     "frame_ms": float,                 # ms per frame (>= 45, like render.ts)
##   }
##
## load_clip(base_path) returns the cached clip or null. base_path is a res:// folder, e.g.
## "res://assets/Heroes/Kevin/iso_run_up_right". Negative results (missing/empty) are cached
## as null so we never re-stat a known-missing clip every frame.

# Process-wide caches. Keyed by base_path. _cache holds Dictionary | null (null = known bad).
static var _cache: Dictionary = {}

# Returns the loaded clip Dictionary, or null if the clip is missing/empty/unreadable.
static func load_clip(base_path: String) -> Variant:
	if _cache.has(base_path):
		return _cache[base_path]  # may be null (known-missing) — that's intentional
	var clip: Variant = _load_uncached(base_path)
	_cache[base_path] = clip  # cache the null too, so we don't re-probe missing clips
	return clip

static func _load_uncached(base_path: String) -> Variant:
	var json_path := base_path + "/atlas.json"
	var png_path := base_path + "/spritesheet.png"
	if not FileAccess.file_exists(json_path):
		return null
	var raw_txt := FileAccess.get_file_as_string(json_path)
	if raw_txt.is_empty():
		return null
	var parsed: Variant = JSON.parse_string(raw_txt)
	if not (parsed is Dictionary):
		return null
	var raw: Dictionary = parsed
	var frames_dict: Variant = raw.get("frames", {})
	if not (frames_dict is Dictionary) or (frames_dict as Dictionary).is_empty():
		return null

	# Sort frame keys numerically (atlas.ts: parseInt, finite, ascending) and build rects.
	var keys: Array = []
	for k in (frames_dict as Dictionary).keys():
		var n := int(str(k))
		if str(n) == str(k):  # only keep keys that are clean integers
			keys.append(n)
	keys.sort()
	if keys.is_empty():
		return null

	var frames: Array[Rect2] = []
	var max_x := 0
	var max_y := 0
	for n in keys:
		var f: Variant = (frames_dict as Dictionary)[str(n)]
		if not (f is Dictionary):
			continue
		var fx := int((f as Dictionary).get("x", 0))
		var fy := int((f as Dictionary).get("y", 0))
		var fw := int((f as Dictionary).get("w", 0))
		var fh := int((f as Dictionary).get("h", 0))
		frames.append(Rect2(fx, fy, fw, fh))
		max_x = max(max_x, fx + fw)
		max_y = max(max_y, fy + fh)
	if frames.is_empty():
		return null

	# Sheet size: prefer meta.size, else infer from frame extents (atlas.ts parity).
	var sheet_w := max_x
	var sheet_h := max_y
	var meta: Variant = raw.get("meta", {})
	var duration_s := maxf(0.6, frames.size() * 0.08)
	if meta is Dictionary:
		var size_v: Variant = (meta as Dictionary).get("size", null)
		if size_v is Dictionary:
			sheet_w = int((size_v as Dictionary).get("w", sheet_w))
			sheet_h = int((size_v as Dictionary).get("h", sheet_h))
		if (meta as Dictionary).has("duration_s"):
			duration_s = float((meta as Dictionary)["duration_s"])
	if sheet_w <= 0 or sheet_h <= 0:
		return null

	# Load the imported spritesheet as a Texture2D resource. (Using Image.load() on a
	# res:// path works in the editor but NOT in exported builds — the raw .png isn't in
	# the PCK, only the imported texture. load() returns that imported texture, export-safe.
	# NEAREST pixel-art filtering is applied on the sprite material in EntitySprite.)
	var sheet := load(png_path) as Texture2D
	if sheet == null:
		# render.ts caches null on texture failure too.
		return null

	# frame_ms: render.ts -> max(45, durationS*1000/frameCount). Per-frame `duration` in
	# the atlas is a relative weight (always 1 here), so the clip-level duration drives timing.
	var frame_ms := maxf(45.0, (duration_s * 1000.0) / float(frames.size()))

	return {
		"sheet": sheet,
		"sheet_w": sheet_w,
		"sheet_h": sheet_h,
		"frames": frames,
		"frame_ms": frame_ms,
	}

# Test/hot-reload helper: drop all cached clips (forces a fresh decode next access).
static func clear_cache() -> void:
	_cache.clear()
