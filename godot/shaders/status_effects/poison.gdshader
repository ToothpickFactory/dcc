shader_type spatial;
render_mode blend_add, cull_disabled, unshaded, depth_draw_never;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(93.9, 67.3))) * 18943.232);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void fragment() {
	vec2 uv = UV + vec2(sin(TIME * 0.7 + UV.y * 8.0) * 0.025, TIME * 0.22);
	float slime = noise(vec2(uv.x * 8.0, uv.y * 10.0));
	float bubbles = smoothstep(0.79, 0.96, noise(vec2(uv.x * 18.0 + TIME * 0.6, uv.y * 18.0 - TIME * 0.4)));
	float drips = smoothstep(0.48, 0.92, slime + sin(uv.y * 24.0 + TIME * 2.1) * 0.16);
	vec3 color = mix(vec3(0.14, 0.78, 0.12), vec3(0.88, 1.0, 0.18), bubbles + drips * 0.35);
	ALBEDO = color;
	EMISSION = color * (1.1 + drips * 1.7 + bubbles * 2.6);
	ALPHA = clamp((drips * 0.54 + bubbles * 0.35) * smoothstep(0.02, 0.22, UV.y), 0.0, 0.78);
}
