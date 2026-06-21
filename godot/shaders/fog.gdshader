shader_type spatial;
render_mode unshaded;

// Wall-based fog of war, ported 1:1 from src/client/render.ts (patchFog GLSL).
// Each fragment is blended toward the scene background unless it has line-of-sight
// to the vision center (u_player). Walls reveal as whole tiles via a per-cell mask
// (u_wall_vis, recomputed on the CPU only when the player crosses a cell). The
// ground uses a smooth per-pixel half-cell LoS marcher (dccLos) over the grid.
//
// World (game) coords: game (x,y) -> 3D (x, 0, y). The vertex stage passes world XZ
// through to the fragment stage; that XZ equals game (x,y) and is compared against
// u_player, which Fog.set_vision(x,y) feeds as game (x,y).

uniform vec2 u_player = vec2(0.0, 0.0);
uniform sampler2D u_grid : filter_nearest, repeat_disable;       // R8: 1.0 = wall
uniform sampler2D u_wall_vis : filter_nearest, repeat_disable;   // R8: 1.0 = wall lit
uniform vec2 u_grid_size = vec2(1.0, 1.0);                        // cells (w, h)
uniform float u_cell = 80.0;                                     // px per cell
uniform float u_vision = 1000.0;                                // VISION_RADIUS (Fog.gd overrides from DccConst)
uniform bool u_is_wall = false;                                  // material switch
uniform vec4 u_albedo : source_color = vec4(0.086, 0.114, 0.180, 1.0); // flat fallback color
uniform sampler2D u_tex : source_color, filter_nearest, repeat_enable; // optional theme tile
uniform bool u_has_tex = false;                                  // sample u_tex when true
uniform vec2 u_uv_scale = vec2(1.0, 1.0);                        // tile repeats across floor
uniform bool u_use_tile_sheet = false;                           // sample a 4x4 tile sheet
uniform float u_tile_start = 0.0;                                // first valid tile index
uniform float u_tile_count = 1.0;                                // number of valid tiles
uniform float u_top_tile_start = 0.0;                            // optional top-face tile range
uniform float u_top_tile_count = 1.0;
uniform float u_fog_soft = 0.7;                                  // shadow-edge penumbra width, in cells (0 = hard edge)
uniform vec3 u_tint = vec3(1.0, 1.0, 1.0);                       // per-theme albedo multiply (mood)
uniform vec3 u_bg = vec3(0.043, 0.055, 0.078);                   // per-theme fog/background color

varying vec3 v_world;
varying vec3 v_world_normal;

// Cheap per-cell hash (0..1) — drives per-tile rotation/mirror/brightness so the floor
// reads as varied stone instead of one tile stamped on a grid. No art needed.
float dcc_hash(vec2 c) {
	return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 dcc_tile_sheet_sample(vec2 cell, vec2 local_uv, float tile_start, float tile_count) {
	float pick = floor(dcc_hash(cell + vec2(19.7, 43.1)) * tile_count);
	float tile = tile_start + clamp(pick, 0.0, max(0.0, tile_count - 1.0));
	float col = mod(tile, 4.0);
	float row = floor(tile / 4.0);
	vec2 uv = (vec2(col, row) + fract(local_uv)) * 0.25;
	return texture(u_tex, uv).rgb;
}

// Per-pixel line-of-sight: 1.0 if no wall lies between `from` and `to`. Mirrors the
// CPU Amanatides–Woo canSee() with a cheap fixed-step half-cell marcher (<=48 steps).
float dcc_los(vec2 from, vec2 to) {
	vec2 d = to - from;
	float dist = length(d);
	vec2 tgt = floor(to / u_cell);
	int steps = int(min(48.0, dist / (u_cell * 0.5)));
	for (int i = 1; i <= 48; i++) {
		if (i > steps) {
			break;
		}
		vec2 cell = floor((from + d * (float(i) / float(steps))) / u_cell);
		if (cell.x == tgt.x && cell.y == tgt.y) {
			return 1.0; // reached the target cell unobstructed
		}
		if (texture(u_grid, (cell + 0.5) / u_grid_size).r > 0.5) {
			return 0.0; // a wall sits between
		}
	}
	return 1.0;
}

// Soft line-of-sight: average several LoS samples taken PERPENDICULAR to the view ray,
// straddling the wall-shadow edge. Binary dcc_los gives a hard angular shadow; averaging
// across the edge's width yields a gradual 0..1 penumbra that fades smoothly to black.
float dcc_los_soft(vec2 from, vec2 to) {
	if (u_fog_soft <= 0.001) {
		return dcc_los(from, to);
	}
	vec2 dir = to - from;
	float dlen = length(dir);
	if (dlen < 1.0) {
		return 1.0;
	}
	vec2 perp = vec2(-dir.y, dir.x) / dlen;   // unit, perpendicular to the view ray
	float r = u_cell * u_fog_soft;            // penumbra half-width in px
	// 3 samples (center + both edges) — enough for a soft penumbra at ~half the cost of 5.
	float s = dcc_los(from, to) + dcc_los(from, to + perp * r) + dcc_los(from, to - perp * r);
	return s * (1.0 / 3.0);
}

void vertex() {
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 world_xz = v_world.xz;
	float vis_flag = 0.0;
	float dist;
	vec3 base;
	if (u_is_wall) {
		// Walls: whole-tile visibility from the per-cell mask so a shown wall reveals
		// fully and never flickers as you move within an adjacent tile.
		vec2 dcc_cell = floor(world_xz / u_cell);
		dist = distance((dcc_cell + 0.5) * u_cell, u_player);
		if (dist <= u_vision) {
			vis_flag = texture(u_wall_vis, (dcc_cell + 0.5) / u_grid_size).r;
		}
		bool top_face = v_world_normal.y > 0.5;
		base = u_has_tex ? (u_use_tile_sheet ? dcc_tile_sheet_sample(dcc_cell, UV * u_uv_scale, top_face ? u_top_tile_start : u_tile_start, top_face ? u_top_tile_count : u_tile_count) : texture(u_tex, UV * u_uv_scale).rgb) : u_albedo.rgb;
		float wall_noise = dcc_hash(dcc_cell);
		base *= mix(0.82, 1.10, wall_noise); // per-wall brightness so a run of wall isn't uniform
		if (top_face) {
			base *= 0.72; // top of wall is intentionally a bit darker than the side.
		} else {
			// Vertical wall sides need to read from the angled camera. Add directional side
			// shading and a mild warm lift so they separate from both floor and wall tops.
			float side_light = 0.88 + 0.42 * clamp(dot(normalize(v_world_normal.xz), normalize(vec2(-0.65, 0.76))), 0.0, 1.0);
			base = mix(base * 1.28, vec3(0.50, 0.55, 0.64), 0.18) * side_light;
		}
	} else {
		// Ground: gate the costly per-pixel LoS march to within-vision pixels (far pixels are
		// fully fogged anyway). GDScript shaders forbid `return` in fragment(), hence the guard.
		dist = distance(world_xz, u_player);
		if (dist <= u_vision) {
			vis_flag = dcc_los_soft(u_player, world_xz);
		}
		// De-grid the floor: rotate/mirror/brighten each tile by its cell hash so the same
		// tile texture stops reading as an obvious repeating lattice. Keeps the exact cell+frac
		// sampling basis the working code used (cellc offset wraps away under repeat).
		vec2 coord = world_xz / u_cell;
		vec2 cellc = floor(coord);
		vec2 f = fract(coord) - 0.5;
		int rot = int(dcc_hash(cellc) * 4.0);
		if (rot == 1) { f = vec2(-f.y, f.x); }
		else if (rot == 2) { f = -f; }
		else if (rot == 3) { f = vec2(f.y, -f.x); }
		if (dcc_hash(cellc + vec2(7.3, 1.7)) > 0.5) { f.x = -f.x; } // random mirror
		f += 0.5;
		base = u_has_tex ? (u_use_tile_sheet ? dcc_tile_sheet_sample(cellc, f, u_tile_start, u_tile_count) : texture(u_tex, cellc + f).rgb) : u_albedo.rgb;
		base *= mix(0.82, 1.10, dcc_hash(cellc + vec2(3.1, 9.2))); // per-tile brightness
		// Contact shadow (cheap AO): darken the floor where it meets a wall, so walls read as
		// grounded instead of pasted on. Sample the 4 neighbour cells; shadow ramps in from each
		// wall edge over `edge` of the tile.
		vec2 fc = fract(coord);
		float edge = 0.34;
		float ao = 1.0;
		if (texture(u_grid, (cellc + vec2(-0.5, 0.5)) / u_grid_size).r > 0.5) { ao = min(ao, smoothstep(0.0, edge, fc.x)); }
		if (texture(u_grid, (cellc + vec2(1.5, 0.5)) / u_grid_size).r > 0.5) { ao = min(ao, smoothstep(0.0, edge, 1.0 - fc.x)); }
		if (texture(u_grid, (cellc + vec2(0.5, -0.5)) / u_grid_size).r > 0.5) { ao = min(ao, smoothstep(0.0, edge, fc.y)); }
		if (texture(u_grid, (cellc + vec2(0.5, 1.5)) / u_grid_size).r > 0.5) { ao = min(ao, smoothstep(0.0, edge, 1.0 - fc.y)); }
		base *= mix(0.5, 1.0, ao); // up to 50% darker hard against a wall
	}
	base *= u_tint; // per-theme color cast
	float fall = 1.0 - smoothstep(u_vision * 0.6, u_vision, dist);
	float lit = vis_flag * fall;
	// Blend unseen pixels to the (themed) background; seen pixels keep full albedo.
	ALBEDO = mix(u_bg, base, lit);
}
