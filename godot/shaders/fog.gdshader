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
uniform float u_fog_soft = 0.7;                                  // shadow-edge penumbra width, in cells (0 = hard edge)

// Scene background rgb(0x0b,0x0e,0x14) — unseen pixels blend fully to this so
// out-of-sight terrain vanishes rather than merely dimming.
const vec3 BG = vec3(0.043, 0.055, 0.078);

varying vec3 v_world;

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
}

void fragment() {
	// Base color: the theme tile (repeated like render.ts) or the flat fallback.
	if (u_has_tex) {
		ALBEDO = texture(u_tex, UV * u_uv_scale).rgb;
	} else {
		ALBEDO = u_albedo.rgb;
	}
	vec2 world_xz = v_world.xz;
	float vis_flag = 0.0;
	float dist;
	if (u_is_wall) {
		// Walls: whole-tile visibility from the per-cell mask so a shown wall reveals
		// fully and never flickers as you move within an adjacent tile.
		vec2 dcc_cell = floor(world_xz / u_cell);
		dist = distance((dcc_cell + 0.5) * u_cell, u_player);
		if (dist <= u_vision) {
			vis_flag = texture(u_wall_vis, (dcc_cell + 0.5) / u_grid_size).r;
		}
	} else {
		// Ground: soft per-pixel line-of-sight (gradual penumbra at shadow edges). Beyond the
		// vision radius the pixel is fully fogged anyway (vis_flag stays 0 -> BG), so we GATE the
		// costly LoS march behind the radius check — otherwise every far ground pixel marches up
		// to 48 cells just to end up black (the cost that hurt FPS after the vision-radius bump).
		// NOTE: GDScript shaders forbid `return` in fragment(), hence the guard instead of early-out.
		dist = distance(world_xz, u_player);
		if (dist <= u_vision) {
			vis_flag = dcc_los_soft(u_player, world_xz);
		}
	}
	float fall = 1.0 - smoothstep(u_vision * 0.6, u_vision, dist);
	float lit = vis_flag * fall;
	// Blend unseen pixels to the background; seen pixels keep full albedo.
	ALBEDO = mix(BG, ALBEDO, lit);
}
