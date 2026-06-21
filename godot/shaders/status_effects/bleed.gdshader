shader_type spatial;
render_mode blend_add, cull_disabled, unshaded, depth_draw_never;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(171.1, 37.9))) * 34981.23);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void fragment() {
	vec2 uv = UV + vec2(0.0, TIME * 0.16);
	float cracks = smoothstep(0.62, 0.9, noise(vec2(uv.x * 13.0, uv.y * 17.0)));
	float drip = smoothstep(0.35, 0.86, sin(uv.y * 31.0 + noise(uv * 7.0) * 4.0) * 0.5 + 0.5);
	float pulse = 0.6 + 0.4 * sin(TIME * 3.2 + noise(UV * 5.0) * 5.0);
	vec3 color = mix(vec3(0.36, 0.0, 0.015), vec3(1.0, 0.04, 0.055), cracks);
	ALBEDO = color;
	EMISSION = color * (1.0 + cracks * drip * 2.8 * pulse);
	ALPHA = clamp((cracks * 0.52 + drip * 0.15) * smoothstep(0.0, 0.18, UV.y), 0.0, 0.72);
}
