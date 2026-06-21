# Flail Setup

The hero flail is built from:

- `res://assets/Weapons/Flail/Rare/Handle.glb`
- `res://assets/Weapons/Flail/Rare/Chain.glb`
- `res://assets/Weapons/Flail/Rare/Ball.glb`

`res://scenes/weapons/flail.tscn` instances `res://scripts/flail.gd`, which creates a handle, six rigid chain links, a weighted ball, collision boxes, and hinge joints at runtime. Import the GLBs normally as scenes; collision is created manually in `flail.gd`, so generated import collisions are not required.

The flail is equipped from `EntitySprite.gd` through the existing right-hand `BoneAttachment3D` path. `Flail.attach_to_skeleton(skeleton, bone_name)` is available for direct scene use, and `Flail.swing()` applies an impulse to the ball. The client calls `swing()` when a hero strike action starts.

Tuning starts in `flail.gd`:

- Link mass: `0.08`
- Ball mass: `0.55`
- Link damping: `linear_damp = 3.0`, `angular_damp = 6.0`
- Hinge limits: `-45` to `45` degrees
- Hinge feel: bias `0.35`, softness `0.75`, relaxation `0.8`

If the flail jitters, raise angular damping or reduce `swing_force`. If it feels too stiff, lower damping or increase the hinge limit.
