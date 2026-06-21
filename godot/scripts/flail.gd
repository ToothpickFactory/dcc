class_name Flail
extends Node3D

@export var hand_bone: BoneAttachment3D
@export var chain_length: int = 9
@export var swing_force: float = 10.0

const HANDLE_MODEL := "res://assets/Weapons/Flail/Rare/Handle.glb"
const CHAIN_MODEL := "res://assets/Weapons/Flail/Rare/Chain.glb"
const BALL_MODEL := "res://assets/Weapons/Flail/Rare/Ball.glb"
const HANDLE_SCALE := 0.12
const LINK_SCALE := 0.14
const BALL_SCALE := 0.18
const LINK_SPACING := 0.18
const BALL_SPACING := 0.24

var _anchor: Node3D
var _handle: StaticBody3D
var _ball: RigidBody3D
var _links: Array[RigidBody3D] = []
var _skeleton: Skeleton3D
var _bone_name := ""
var _built := false
var _swing_power := 0.0
var _swing_phase := 0.0

func _ready() -> void:
	if not _built:
		_build_flail()

func attach_to_skeleton(skeleton: Skeleton3D, bone_name: String) -> void:
	_skeleton = skeleton
	_bone_name = bone_name
	if get_parent() is BoneAttachment3D:
		hand_bone = get_parent() as BoneAttachment3D
		hand_bone.bone_name = bone_name
	elif hand_bone == null:
		hand_bone = BoneAttachment3D.new()
		hand_bone.name = "HandAttachment"
	if hand_bone.get_parent() != skeleton:
		if hand_bone.get_parent() != null:
			hand_bone.get_parent().remove_child(hand_bone)
		skeleton.add_child(hand_bone)
	hand_bone.bone_name = bone_name
	if get_parent() != hand_bone:
		if get_parent() != null:
			get_parent().remove_child(self)
		hand_bone.add_child(self)
	position = Vector3.ZERO
	rotation = Vector3.ZERO

func swing() -> void:
	if _ball == null:
		return
	_swing_power = minf(1.0, _swing_power + 0.85)
	_swing_phase = 0.0
	var direction := (global_transform.basis.x * 0.55 - global_transform.basis.z + Vector3.UP * 0.18).normalized()
	_ball.apply_impulse(direction * swing_force * 0.35)

func _physics_process(delta: float) -> void:
	_swing_phase += delta * (8.0 + _swing_power * 5.0)
	_swing_power = move_toward(_swing_power, 0.0, delta * 1.8)
	_pose_chain()

func _build_flail() -> void:
	_built = true
	_anchor = Node3D.new()
	_anchor.name = "FlailParts"
	add_child(_anchor)

	_handle = _make_static_part("Handle", HANDLE_MODEL, HANDLE_SCALE, Vector3.ZERO, Vector3(0.025, 0.08, 0.025))
	_anchor.add_child(_handle)

	var previous: PhysicsBody3D = _handle
	for i in chain_length:
		var y := -LINK_SPACING * float(i + 1)
		var link := _make_rigid_part("ChainLink_%d" % (i + 1), CHAIN_MODEL, LINK_SCALE, Vector3(0.0, y, 0.0), Vector3(0.02, 0.045, 0.02), 0.08)
		_anchor.add_child(link)
		_links.append(link)
		_add_hinge("Hinge_%s_to_%s" % [previous.name, link.name], previous, link, Vector3(0.0, y + LINK_SPACING * 0.5, 0.0))
		previous = link

	var ball_y := -LINK_SPACING * float(chain_length) - BALL_SPACING
	_ball = _make_rigid_part("Ball", BALL_MODEL, BALL_SCALE, Vector3(0.0, ball_y, 0.0), Vector3(0.05, 0.05, 0.05), 0.55)
	_anchor.add_child(_ball)
	_add_hinge("Hinge_%s_to_Ball" % previous.name, previous, _ball, Vector3(0.0, ball_y + BALL_SPACING * 0.5, 0.0))

func _make_static_part(part_name: String, model_path: String, model_scale: float, local_pos: Vector3, collision_size: Vector3) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = part_name
	body.position = local_pos
	body.add_child(_make_model(model_path, model_scale))
	body.add_child(_make_box_collision(collision_size))
	return body

func _make_rigid_part(part_name: String, model_path: String, model_scale: float, local_pos: Vector3, collision_size: Vector3, mass_value: float) -> RigidBody3D:
	var body := RigidBody3D.new()
	body.name = part_name
	body.position = local_pos
	body.mass = mass_value
	body.freeze = true
	body.gravity_scale = 0.0
	body.linear_damp = 3.0
	body.angular_damp = 6.0
	body.can_sleep = false
	body.add_child(_make_model(model_path, model_scale))
	body.add_child(_make_box_collision(collision_size))
	return body

func _make_model(model_path: String, model_scale: float) -> Node3D:
	var model_root := Node3D.new()
	model_root.name = "Model"
	model_root.scale = Vector3.ONE * model_scale
	if model_path == CHAIN_MODEL:
		model_root.rotation_degrees = Vector3(90.0, 0.0, 90.0)
	elif model_path == BALL_MODEL:
		model_root.rotation_degrees = Vector3.ZERO
	else:
		model_root.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	var packed: Resource = load(model_path)
	if packed is PackedScene:
		model_root.add_child((packed as PackedScene).instantiate())
	else:
		push_warning("Flail model missing or not importable: %s" % model_path)
	return model_root

func _make_box_collision(size: Vector3) -> CollisionShape3D:
	var shape := BoxShape3D.new()
	shape.size = size
	var collision := CollisionShape3D.new()
	collision.name = "CollisionShape3D"
	collision.shape = shape
	return collision

func _add_hinge(joint_name: String, node_a: Node, node_b: Node, local_pos: Vector3) -> void:
	var joint := HingeJoint3D.new()
	joint.name = joint_name
	joint.position = local_pos
	joint.rotation_degrees.z = 90.0
	joint.set_param(HingeJoint3D.PARAM_LIMIT_UPPER, deg_to_rad(45.0))
	joint.set_param(HingeJoint3D.PARAM_LIMIT_LOWER, deg_to_rad(-45.0))
	joint.set_param(HingeJoint3D.PARAM_LIMIT_BIAS, 0.35)
	joint.set_param(HingeJoint3D.PARAM_LIMIT_SOFTNESS, 0.75)
	joint.set_param(HingeJoint3D.PARAM_LIMIT_RELAXATION, 0.8)
	joint.set_flag(HingeJoint3D.FLAG_USE_LIMIT, true)
	_anchor.add_child(joint)
	joint.node_a = joint.get_path_to(node_a)
	joint.node_b = joint.get_path_to(node_b)

func _pose_chain() -> void:
	if _anchor == null:
		return
	var base := _handle.global_position if _handle != null else global_position
	var right := global_transform.basis.x.normalized()
	var back := global_transform.basis.z.normalized()
	var down := Vector3.DOWN
	var sway := sin(_swing_phase) * (0.015 + _swing_power * 0.16)
	var lag := 0.0
	for i in _links.size():
		var link := _links[i]
		lag = float(i + 1) / float(maxi(1, _links.size()))
		var hang := LINK_SPACING * float(i + 1)
		var curve: Vector3 = right * sway * lag + back * abs(sway) * 0.35 * lag
		link.global_position = base + down * hang + curve
		link.global_rotation_degrees = Vector3(90.0, 0.0, 90.0 + sway * 150.0 * lag)
	if _ball != null:
		var ball_lag := 1.18
		var ball_hang := LINK_SPACING * float(chain_length) + BALL_SPACING
		var ball_curve: Vector3 = right * sway * ball_lag + back * abs(sway) * 0.45
		_ball.global_position = base + down * ball_hang + ball_curve
		_ball.global_rotation_degrees = Vector3(0.0, 0.0, sway * 180.0)
