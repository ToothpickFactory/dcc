shader_type spatial;
render_mode blend_add, cull_disabled, unshaded, depth_draw_never;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(71.4, 143.8))) * 32411.77);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void fragment() {
	vec2 p = UV - vec2(0.5);
	float angle = atan(p.y, p.x) + TIME * 0.55;
	float radius = length(p);
	float swirl = noise(vec2(angle * 2.2 + TIME * 0.4, radius * 12.0 - TIME * 0.9));
	float inward = smoothstep(0.18, 0.02, abs(fract(radius * 4.0 - TIME * 0.28 + swirl * 0.2) - 0.5));
	float edge = smoothstep(0.32, 0.52, radius) * (0.62 + 0.38 * sin(TIME * 1.9));
	vec3 color = mix(vec3(0.025, 0.0, 0.045), vec3(0.55, 0.08, 0.95), inward + edge);
	ALBEDO = color;
	EMISSION = color * (1.1 + inward * 2.1 + edge * 2.6);
	ALPHA = clamp(inward * 0.42 + edge * 0.48 + swirl * 0.08, 0.0, 0.76);
}
