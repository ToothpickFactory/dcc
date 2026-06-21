shader_type spatial;
render_mode blend_add, cull_disabled, unshaded, depth_draw_never;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(41.7, 289.3))) * 24634.6345);
}

void fragment() {
	vec2 uv = UV;
	float pulse = 0.62 + 0.38 * sin(TIME * 1.8);
	float sparkle = step(0.965, hash(floor(uv * 42.0 + vec2(TIME * 2.0, -TIME * 1.1))));
	float shimmer = 0.5 + 0.5 * sin((uv.x + uv.y) * 42.0 + TIME * 3.0);
	float vertical = smoothstep(0.0, 0.22, uv.y) * smoothstep(1.0, 0.72, uv.y);
	vec3 color = mix(vec3(0.22, 0.82, 1.0), vec3(0.9, 1.0, 1.0), shimmer * 0.65 + sparkle);
	ALBEDO = color;
	EMISSION = color * (1.35 + pulse * 1.85 + sparkle * 3.0);
	ALPHA = clamp((0.22 + shimmer * 0.34 + sparkle * 0.42) * vertical, 0.0, 0.76);
}
