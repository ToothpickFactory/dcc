shader_type spatial;
render_mode blend_add, cull_disabled, unshaded, depth_draw_never;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(211.2, 19.7))) * 28531.88);
}

void fragment() {
	vec2 centered = UV - vec2(0.5);
	float a = TIME * 0.45;
	mat2 r = mat2(vec2(cos(a), -sin(a)), vec2(sin(a), cos(a)));
	vec2 uv = r * centered + vec2(0.5);
	float rays = smoothstep(0.62, 0.98, sin(atan(centered.y, centered.x) * 8.0 + TIME * 1.3) * 0.5 + 0.5);
	float sparkle = step(0.975, hash(floor(uv * 38.0 + TIME)));
	float pulse = 0.72 + 0.28 * sin(TIME * 1.6);
	vec3 color = mix(vec3(1.0, 0.72, 0.18), vec3(1.0, 0.98, 0.78), rays + sparkle);
	ALBEDO = color;
	EMISSION = color * (1.35 + rays * 1.8 + sparkle * 2.8) * pulse;
	ALPHA = clamp((0.22 + rays * 0.34 + sparkle * 0.38) * smoothstep(0.0, 0.2, UV.y), 0.0, 0.78);
}
