import * as THREE from "three";
import { BOSS_BOLT_SPRITE } from "../shared/constants";
import { DEFAULT_ABILITIES } from "../shared/abilities";
import type { EntityDTO } from "../protocol";
import { loadAtlasClip } from "./atlas";

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

const HERO_ROOT = "/assets/Heroes/Kevin";
const ENEMY_ROOTS = ["Goblin", "Ghoul", "Orc", "Skeleton", "Zombie", "Troll"].map((n) => `/assets/Enemies/${n}`);
const ANIM_NAMES = [
  "iso_idle_up_right",
  "iso_idle_right_right",
  "iso_idle_down_right",
  "iso_run_up_right",
  "iso_run_right_right",
  "iso_run_down_right",
];

interface LoadedClip {
  texture: THREE.Texture;
  sheetW: number;
  sheetH: number;
  frames: { x: number; y: number; w: number; h: number }[];
  frameMs: number;
}

interface SpriteState {
  sprite: THREE.Sprite;
  clipKey: string;
  frame: number;
  nextFrameAt: number;
}

export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private sprites = new Map<string, SpriteState>();
  private clipCache = new Map<string, LoadedClip | null>();
  private clipPromises = new Map<string, Promise<LoadedClip | null>>();
  private lastPos = new Map<string, { x: number; y: number }>();
  private textureLoader = new THREE.TextureLoader();

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
    void this.primeClipCache();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private async primeClipCache(): Promise<void> {
    const paths: string[] = [];
    for (const a of ANIM_NAMES) paths.push(`${HERO_ROOT}/${a}`);
    for (const root of ENEMY_ROOTS) {
      for (const a of ANIM_NAMES) paths.push(`${root}/${a}`);
    }
    await Promise.all(paths.map((p) => this.ensureClip(p)));
  }

  private async ensureClip(path: string): Promise<LoadedClip | null> {
    const cached = this.clipCache.get(path);
    if (cached !== undefined) return cached;
    const inFlight = this.clipPromises.get(path);
    if (inFlight) return inFlight;

    const p = (async () => {
      const clip = await loadAtlasClip(path);
      if (!clip || clip.sheetWidth <= 0 || clip.sheetHeight <= 0 || clip.frames.length === 0) {
        this.clipCache.set(path, null);
        return null;
      }
      const tex = await this.textureLoader.loadAsync(clip.imageUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      const loaded: LoadedClip = {
        texture: tex,
        sheetW: clip.sheetWidth,
        sheetH: clip.sheetHeight,
        frames: clip.frames,
        frameMs: Math.max(45, (clip.durationS * 1000) / clip.frames.length),
      };
      this.clipCache.set(path, loaded);
      return loaded;
    })()
      .catch(() => {
        this.clipCache.set(path, null);
        return null;
      })
      .finally(() => {
        this.clipPromises.delete(path);
      });

    this.clipPromises.set(path, p);
    return p;
  }

  private spriteFor(id: string, color: number, size: number): SpriteState {
    let s = this.sprites.get(id);
    if (!s) {
      const mat = new THREE.SpriteMaterial({ color, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(size, size, 1);
      this.scene.add(sprite);
      s = { sprite, clipKey: "", frame: 0, nextFrameAt: 0 };
      this.sprites.set(id, s);
    }
    return s;
  }

  private setFallback(mat: THREE.SpriteMaterial, color: number): void {
    mat.map = null;
    mat.color.setHex(color);
    mat.needsUpdate = true;
  }

  private applyFrame(mat: THREE.SpriteMaterial, clip: LoadedClip, frameIndex: number): void {
    const f = clip.frames[frameIndex % clip.frames.length];
    if (!f) return;
    mat.map = clip.texture;
    mat.color.setHex(0xffffff);
    mat.map.repeat.set(f.w / clip.sheetW, f.h / clip.sheetH);
    mat.map.offset.set(f.x / clip.sheetW, 1 - (f.y + f.h) / clip.sheetH);
    mat.needsUpdate = true;
  }

  private hash(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private enemyRoot(id: string): string {
    return ENEMY_ROOTS[this.hash(id) % ENEMY_ROOTS.length] ?? ENEMY_ROOTS[0]!;
  }

  private facingFromAngle(a: number): { dir: "up" | "down" | "right"; flipX: boolean } {
    const angle = Math.atan2(Math.sin(a), Math.cos(a));
    if (angle >= (3 * Math.PI) / 4 || angle <= (-3 * Math.PI) / 4) return { dir: "right", flipX: true };
    if (angle > Math.PI / 4) return { dir: "down", flipX: false };
    if (angle < -Math.PI / 4) return { dir: "up", flipX: false };
    return { dir: "right", flipX: false };
  }

  private clipPath(root: string, moving: boolean, dir: "up" | "down" | "right"): string {
    return `${root}/${moving ? "iso_run" : "iso_idle"}_${dir}_right`;
  }

  // World (x,y) maps to the ground plane (x, z).
  sync(ents: EntityDTO[], selfId: string, predicted: { x: number; y: number } | null) {
    const now = performance.now();
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
        size = 84;
      } else if (e.kind === "player") {
        color = C.player;
        size = 84;
      } else {
        color = C.monster;
        size = 84;
      }
      const s = this.spriteFor(e.id, color, size);
      let wx = e.x;
      let wy = e.y;
      if (e.id === selfId && predicted) {
        wx = predicted.x;
        wy = predicted.y;
      }
      const h = e.kind === "proj" ? 12 : e.kind === "boss" ? 38 : 22;
      const prev = this.lastPos.get(e.id);
      const dx = prev ? wx - prev.x : 0;
      const dy = prev ? wy - prev.y : 0;
      const moving = dx * dx + dy * dy > 0.5;
      const face = this.facingFromAngle(moving ? Math.atan2(dy, dx) : (e.aim ?? 0));

      if (e.kind === "player" || e.kind === "monster") {
        const root = e.kind === "player" ? HERO_ROOT : this.enemyRoot(e.id);
        const targetClip = this.clipPath(root, moving, face.dir);

        if (s.clipKey !== targetClip) {
          s.clipKey = targetClip;
          s.frame = 0;
          s.nextFrameAt = 0;
        }

        const loaded = this.clipCache.get(targetClip);
        if (loaded) {
          if (now >= s.nextFrameAt) {
            s.frame = (s.frame + 1) % loaded.frames.length;
            s.nextFrameAt = now + loaded.frameMs;
          }
          this.applyFrame(s.sprite.material as THREE.SpriteMaterial, loaded, s.frame);
        } else {
          void this.ensureClip(targetClip);
          this.setFallback(s.sprite.material as THREE.SpriteMaterial, color);
        }
      } else {
        this.setFallback(s.sprite.material as THREE.SpriteMaterial, color);
      }

      const sx = (e.kind === "player" || e.kind === "monster") && face.flipX ? -size : size;
      s.sprite.scale.set(sx, size, 1);
      s.sprite.position.set(wx, h, wy);
      this.lastPos.set(e.id, { x: wx, y: wy });
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        this.scene.remove(s.sprite);
        this.sprites.delete(id);
        this.lastPos.delete(id);
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
