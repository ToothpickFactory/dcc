import * as THREE from "three";
import { BOSS_BOLT_SPRITE } from "../shared/constants";
import { DEFAULT_ABILITIES } from "../shared/abilities";
import type { EntityDTO, GameEvent } from "../protocol";
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
const MOVE_ANIM_NAMES = [
  "iso_idle_up_right",
  "iso_idle_right_right",
  "iso_idle_down_right",
  "iso_run_up_right",
  "iso_run_right_right",
  "iso_run_down_right",
];

type FacingDir = "up" | "down" | "right";
type ActionName = "cast" | "bolt" | "strike" | "punch" | "kick";

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
  facingDir: FacingDir;
  flipX: boolean;
  action: ActionName | null;
  actionUntil: number;
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
  private heroAttackToggle = false;

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
    for (const a of MOVE_ANIM_NAMES) paths.push(`${HERO_ROOT}/${a}`);
    for (const root of ENEMY_ROOTS) {
      for (const a of MOVE_ANIM_NAMES) paths.push(`${root}/${a}`);
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
      s = { sprite, clipKey: "", frame: 0, nextFrameAt: 0, facingDir: "down", flipX: false, action: null, actionUntil: 0 };
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

  private facingFromVector(dx: number, dy: number): { dir: FacingDir; flipX: boolean } {
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { dir: "right", flipX: dx < 0 };
    }
    return { dir: dy < 0 ? "up" : "down", flipX: dx < 0 };
  }

  private facingFromAngle(a: number): { dir: FacingDir; flipX: boolean } {
    return this.facingFromVector(Math.cos(a), Math.sin(a));
  }

  private clipPath(root: string, moving: boolean, dir: FacingDir): string {
    return `${root}/${moving ? "iso_run" : "iso_idle"}_${dir}_right`;
  }

  private actionClipPath(root: string, action: ActionName, dir: FacingDir): string {
    const prefix = action === "cast" ? "Cast" : action === "bolt" ? "Bolt" : action === "strike" ? "Strike" : action === "punch" ? "Punch" : "Kick";
    return `${root}/${prefix} ${dir[0].toUpperCase()}${dir.slice(1)}`;
  }

  private clipDurationMs(clip: LoadedClip | null): number {
    if (!clip) return 220;
    return Math.max(180, clip.frameMs * clip.frames.length);
  }

  private queueAction(id: string, root: string, action: ActionName, now: number): void {
    const state = this.sprites.get(id);
    if (!state) return;
    const targetClip = this.actionClipPath(root, action, state.facingDir);
    const loaded = this.clipCache.get(targetClip) ?? null;
    if (this.clipCache.get(targetClip) === undefined) void this.ensureClip(targetClip);
    state.action = action;
    state.actionUntil = now + this.clipDurationMs(loaded);
    state.clipKey = "";
    state.frame = 0;
    state.nextFrameAt = 0;
  }

  private nearestEntity(
    ents: EntityDTO[],
    x: number,
    y: number,
    kinds: EntityDTO["kind"][],
    maxDistance: number,
  ): EntityDTO | null {
    let best: EntityDTO | null = null;
    let bestDistSq = maxDistance * maxDistance;
    for (const e of ents) {
      if (!kinds.includes(e.kind)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        best = e;
        bestDistSq = distSq;
      }
    }
    return best;
  }

  handleEvents(events: GameEvent[], ents: EntityDTO[], selfId: string): void {
    const now = performance.now();
    for (const event of events) {
      if (event.e === "cast") {
        const caster = this.nearestEntity(ents, event.x, event.y, ["player", "monster"], 90);
        if (!caster) continue;
        const root = caster.kind === "player" ? HERO_ROOT : this.enemyRoot(caster.id);
        if (caster.id === selfId) {
          const ability = DEFAULT_ABILITIES[event.ability];
          if (ability?.id === "mend") this.queueAction(caster.id, root, "cast", now);
          else if (ability?.id === "cleave") {
            this.heroAttackToggle = !this.heroAttackToggle;
            this.queueAction(caster.id, root, this.heroAttackToggle ? "punch" : "kick", now);
          } else {
            this.queueAction(caster.id, root, "cast", now);
          }
          continue;
        }
        this.queueAction(caster.id, root, "bolt", now);
        continue;
      }

      if (event.e === "dmg") {
        const attacker = this.nearestEntity(ents, event.x, event.y, ["monster"], 140);
        if (!attacker) continue;
        this.queueAction(attacker.id, this.enemyRoot(attacker.id), "strike", now);
      }
    }
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
      const face = moving ? this.facingFromVector(dx, dy) : this.facingFromAngle(e.aim ?? 0);
      s.facingDir = face.dir;
      s.flipX = face.flipX;
      if (s.action && now >= s.actionUntil) s.action = null;

      if (e.kind === "player" || e.kind === "monster") {
        const root = e.kind === "player" ? HERO_ROOT : this.enemyRoot(e.id);
        const targetClip = s.action ? this.actionClipPath(root, s.action, s.facingDir) : this.clipPath(root, moving, s.facingDir);

        if (s.clipKey !== targetClip) {
          s.clipKey = targetClip;
          s.frame = s.action ? 0 : -1;
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

      const sx = (e.kind === "player" || e.kind === "monster") && s.flipX ? -size : size;
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
