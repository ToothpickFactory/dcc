shader_type spatial;
render_mode blend_add, cull_disabled, unshaded, depth_draw_never;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(13.3, 177.7))) * 46321.55);
}

void fragment() {
	vec2 uv = UV;
	float arcs = step(0.82, hash(floor(vec2(uv.x * 18.0 + TIME * 24.0, uv.y * 26.0 - TIME * 9.0))));
	float jag = smoothstep(0.88, 0.99, sin((uv.x + uv.y * 0.65) * 54.0 + TIME * 30.0) * 0.5 + 0.5);
	float top_ring = smoothstep(0.88, 0.93, uv.y) * smoothstep(0.995, 0.94, uv.y) * (0.55 + 0.45 * sin(uv.x * 6.28318 + TIME * 9.0));
	float flicker = step(0.28, fract(sin(TIME * 44.0) * 413.7));
	vec3 color = mix(vec3(1.0, 0.86, 0.16), vec3(1.0, 1.0, 1.0), arcs + jag);
	ALBEDO = color;
	EMISSION = color * (1.5 + (arcs + jag + top_ring) * 3.5) * flicker;
	ALPHA = clamp((arcs * 0.4 + jag * 0.26 + top_ring * 0.7) * flicker, 0.0, 0.92);
}
