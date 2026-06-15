import * as THREE from "three";
import { BOSS_BOLT_SPRITE } from "../shared/constants";
import { DEFAULT_ABILITIES } from "../shared/abilities";
import type { EntityDTO } from "../protocol";

// Per-ability projectile colors (so a green heal bolt reads differently from a
// damage bolt — important when spells hit friend or foe).
const ABILITY_COLORS = DEFAULT_ABILITIES.map((a) => new THREE.Color(a.color ?? "#ffd34d").getHex());
const C = {
  player: 0x4f8cff,
  self: 0x5dd6ff,
  monster: 0xb6433d,
  boss: 0x9b30ff,
  bossbolt: 0xc850ff,
  proj: 0xffd34d,
};

// PHASE 0 renderer: a 3D ground plane with billboard sprites (Doom-like) drawn
// as solid colors. Stream C / M2 swaps colors for atlas textures and upgrades to
// three/webgpu. The server protocol does not change.
export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private sprites = new Map<string, THREE.Sprite>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.scene.background = new THREE.Color(0x0b0e14);
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 8000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x161d2e, wireframe: true }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(1200, 0, 1200);
    this.scene.add(ground);

    this.resize();
    addEventListener("resize", () => this.resize());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private spriteFor(id: string, color: number, size: number): THREE.Sprite {
    let s = this.sprites.get(id);
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ color }));
      s.scale.set(size, size, 1);
      this.scene.add(s);
      this.sprites.set(id, s);
    }
    return s;
  }

  // World (x,y) maps to the ground plane (x, z).
  sync(ents: EntityDTO[], selfId: string, predicted: { x: number; y: number } | null) {
    const seen = new Set<string>();
    for (const e of ents) {
      seen.add(e.id);
      let color: number;
      let size: number;
      if (e.kind === "boss") {
        color = C.boss;
        size = 76;
      } else if (e.kind === "proj") {
        color = e.sprite === BOSS_BOLT_SPRITE ? C.bossbolt : (ABILITY_COLORS[e.sprite ?? 0] ?? C.proj);
        size = e.sprite === BOSS_BOLT_SPRITE ? 24 : 16;
      } else if (e.id === selfId) {
        color = C.self;
        size = 40;
      } else if (e.kind === "player") {
        color = C.player;
        size = 40;
      } else {
        color = C.monster;
        size = 44;
      }
      const s = this.spriteFor(e.id, color, size);
      let wx = e.x;
      let wy = e.y;
      if (e.id === selfId && predicted) {
        wx = predicted.x;
        wy = predicted.y;
      }
      const h = e.kind === "proj" ? 12 : e.kind === "boss" ? 38 : 22;
      s.position.set(wx, h, wy);
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        this.scene.remove(s);
        this.sprites.delete(id);
      }
    }
  }

  follow(x: number, y: number) {
    this.camera.position.set(x, 520, y + 420);
    this.camera.lookAt(x, 0, y);
  }

  // Aim angle from the pointer (mouse or touch) projected onto the ground plane.
  aimFromPointer(mx: number, my: number, px: number, py: number): number {
    const ndc = new THREE.Vector2((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.plane, hit)) return Math.atan2(hit.z - py, hit.x - px);
    return 0;
  }

  draw() {
    this.renderer.render(this.scene, this.camera);
  }
}
