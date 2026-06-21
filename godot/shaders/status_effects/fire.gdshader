shader_type spatial;
render_mode blend_add, cull_disabled, unshaded, depth_draw_never;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
		mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}

void fragment() {
	vec2 uv = UV;
	float n = noise(vec2(uv.x * 5.5 + sin(TIME * 3.0) * 0.12, uv.y * 9.0 - TIME * 1.7));
	float tongues = smoothstep(0.18, 0.92, n + (1.0 - uv.y) * 0.42);
	float edge = smoothstep(0.58, 0.18, abs(uv.x - 0.5));
	float flicker = 0.72 + 0.28 * sin(TIME * 18.0 + n * 7.0);
	vec3 color = mix(vec3(1.0, 0.08, 0.015), vec3(1.0, 0.72, 0.16), tongues);
	ALBEDO = color;
	EMISSION = color * (1.8 + tongues * 2.6) * flicker;
	ALPHA = clamp(tongues * edge * 0.82, 0.0, 0.9);
}
