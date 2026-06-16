class_name DangerVignette
extends CanvasLayer
## A red screen-edge vignette that intensifies as the local player nears death — the
## visceral "you're in danger" signal for a permadeath game. Driven by Main from the
## HP ratio (set_danger), pulsing faster the lower you are. Pointer-transparent; sits
## below the menu layers so panels still read clearly.

var _rect: ColorRect
var _mat: ShaderMaterial


func _ready() -> void:
	layer = 15  # over the 3D view + HUD(10), under inventory(25)/skills(26)
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://shaders/vignette.gdshader")
	_mat.set_shader_parameter("intensity", 0.0)
	_rect = ColorRect.new()
	_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_rect.material = _mat
	add_child(_rect)


func set_danger(v: float) -> void:
	_mat.set_shader_parameter("intensity", clampf(v, 0.0, 1.0))
