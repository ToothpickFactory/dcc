shader_type canvas_item;
// Radial danger vignette: transparent center, colored edges, alpha driven by `intensity`.
// Drawn on a full-rect ColorRect over the 3D view (DangerVignette.gd).

uniform float intensity : hint_range(0.0, 1.0) = 0.0;
uniform vec4 tint : source_color = vec4(0.92, 0.06, 0.06, 1.0);

void fragment() {
	vec2 uv = UV - vec2(0.5);
	float d = length(uv) * 1.41421356; // 0 at center -> ~1 at corners
	float edge = smoothstep(0.40, 0.95, d);
	COLOR = vec4(tint.rgb, edge * intensity);
}
