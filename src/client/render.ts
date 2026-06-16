import * as THREE from "three";
import { BOSS_BOLT_SPRITE } from "../shared/constants";
import { DEFAULT_ABILITIES } from "../shared/abilities";
import type { EntityDTO, GameEvent } from "../protocol";
import type { CollisionGrid, FloorDescriptor } from "../procgen/types";
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
const ENEMY_ACTION_NAMES = ["Cast", "Bolt", "Strike"];
const ACTION_DIRECTIONS = ["Up", "Right", "Down"];

type FacingDir = "up" | "down" | "right";
type ActionName = "cast" | "bolt" | "strike" | "punch" | "kick";
const DIR_SWITCH_BIAS = 1.2;
const ENEMY_FRAME_SLOWDOWN = 1.6;
const ACTION_FRAME_SPEED = 1.25;
const MOVEMENT_HOLD_MS = 150;
// Fog of war (client-cosmetic): monsters/boss/projectiles are only drawn within
// this radius AND with clear line-of-sight to the player (walls block). Allies and
// the local player are always drawn. Pairs with the #fog vignette in index.html.
export const VISION_RADIUS = 520;
const VISION_RADIUS_SQ = VISION_RADIUS * VISION_RADIUS;

interface LoadedClip {
  texture: THREE.Texture;
  sheetW: number;
  sheetH: number;
  frames: { x: number; y: number; w: number; h: number }[];
  frameMs: number;
}

interface SpriteState {
  sprite: THREE.Sprite;
  texture: THREE.Texture | null;
  textureSource: THREE.Texture | null;
  clipKey: string;
  frame: number;
  nextFrameAt: number;
  facingDir: FacingDir;
  flipX: boolean;
  movingUntil: number;
  action: ActionName | null;
  actionFacingDir: FacingDir;
  actionFlipX: boolean;
  actionFrameStart: number;
  actionFrameCount: number;
  actionFrameSpeed: number;
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
  private stairs: THREE.Sprite | null = null;
  private walls: THREE.InstancedMesh | null = null;
  private collision: CollisionGrid | null = null; // current floor grid, for fog line-of-sight
  // Wall-based fog of war: a shader on the ground + walls darkens any pixel without
  // line-of-sight to the vision center. The collision grid rides along as a texture;
  // both materials share these uniform objects (one update drives both).
  private fogGridTex = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
  private fog = {
    uPlayer: { value: new THREE.Vector2(0, 0) },
    uGrid: { value: this.fogGridTex },
    uGridSize: { value: new THREE.Vector2(1, 1) },
    uCell: { value: 80 },
    uVisionRadius: { value: VISION_RADIUS },
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.scene.background = new THREE.Color(0x0b0e14);
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 8000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    const groundMat = new THREE.MeshBasicMaterial({ color: 0x161d2e, wireframe: true });
    this.patchFog(groundMat);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 24, 24), groundMat);
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
      for (const action of ENEMY_ACTION_NAMES) {
        for (const dir of ACTION_DIRECTIONS) paths.push(`${root}/${action} ${dir}`);
      }
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
      s = {
        sprite,
        texture: null,
        textureSource: null,
        clipKey: "",
        frame: 0,
        nextFrameAt: 0,
        facingDir: "down",
        flipX: false,
        movingUntil: 0,
        action: null,
        actionFacingDir: "down",
        actionFlipX: false,
        actionFrameStart: 0,
        actionFrameCount: 0,
        actionFrameSpeed: 1,
        actionUntil: 0,
      };
      this.sprites.set(id, s);
    }
    return s;
  }

  private setFallback(state: SpriteState, color: number): void {
    const mat = state.sprite.material as THREE.SpriteMaterial;
    mat.map = null;
    mat.color.setHex(color);
    mat.needsUpdate = true;
  }

  private applyFrame(state: SpriteState, clip: LoadedClip, frameIndex: number, flipX: boolean): void {
    const f = clip.frames[frameIndex % clip.frames.length];
    if (!f) return;
    if (state.textureSource !== clip.texture) {
      state.texture?.dispose();
      state.texture = clip.texture.clone();
      state.texture.needsUpdate = true;
      state.textureSource = clip.texture;
    }

    const mat = state.sprite.material as THREE.SpriteMaterial;
    const texture = state.texture!;
    mat.map = texture;
    mat.color.setHex(0xffffff);
    texture.repeat.set((flipX ? -1 : 1) * (f.w / clip.sheetW), f.h / clip.sheetH);
    texture.offset.set((f.x + (flipX ? f.w : 0)) / clip.sheetW, 1 - (f.y + f.h) / clip.sheetH);
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

  private facingWithHysteresis(
    state: SpriteState,
    dx: number,
    dy: number,
    moving: boolean,
    aim: number,
  ): { dir: FacingDir; flipX: boolean } {
    if (!moving) {
      const f = this.facingFromAngle(aim);
      return { dir: f.dir, flipX: Math.cos(aim) < 0 };
    }

    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let dir: FacingDir;
    if (state.facingDir === "right") {
      dir = ay > ax * DIR_SWITCH_BIAS ? (dy < 0 ? "up" : "down") : "right";
    } else {
      dir = ax > ay * DIR_SWITCH_BIAS ? "right" : state.facingDir;
      if (dir !== "right") dir = dy < 0 ? "up" : "down";
    }

    return { dir, flipX: dx < 0 };
  }

  private clipPath(root: string, moving: boolean, dir: FacingDir): string {
    // Left-facing movement reuses these right-facing atlases and mirrors the sprite.
    return `${root}/${moving ? "iso_run" : "iso_idle"}_${dir}_right`;
  }

  private actionClipPath(root: string, action: ActionName, dir: FacingDir): string {
    // Action folders are canonical right-facing art; left actions mirror the sprite.
    const prefix = action === "cast" ? "Cast" : action === "bolt" ? "Bolt" : action === "strike" ? "Strike" : action === "punch" ? "Punch" : "Kick";
    return `${root}/${prefix} ${dir[0].toUpperCase()}${dir.slice(1)}`;
  }

  private clipDurationMs(clip: LoadedClip | null, isEnemy: boolean, frameCount?: number): number {
    const minimum = isEnemy ? 400 : 180;
    if (!clip) return minimum;
    const slowdown = isEnemy ? ENEMY_FRAME_SLOWDOWN : 1;
    return Math.max(minimum, clip.frameMs * (frameCount ?? clip.frames.length) * slowdown);
  }

  private queueAction(
    id: string,
    root: string,
    action: ActionName,
    now: number,
    frameStart = 0,
    frameCount = 0,
    frameSpeed = ACTION_FRAME_SPEED,
  ): void {
    const state = this.sprites.get(id);
    if (!state) return;
    state.actionFacingDir = state.facingDir;
    state.actionFlipX = state.flipX;
    state.actionFrameStart = frameStart;
    state.actionFrameCount = frameCount;
    state.actionFrameSpeed = frameSpeed;
    const targetClip = this.actionClipPath(root, action, state.actionFacingDir);
    const loaded = this.clipCache.get(targetClip);
    if (loaded === undefined) void this.ensureClip(targetClip);
    state.action = action;
    const playCount = loaded ? Math.min(frameCount || loaded.frames.length, loaded.frames.length - frameStart) : frameCount;
    state.actionUntil = loaded
      ? now + this.clipDurationMs(loaded, root !== HERO_ROOT, playCount) / frameSpeed
      : Number.POSITIVE_INFINITY;
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
            const frameStart = this.heroAttackToggle ? 8 : 0;
            this.heroAttackToggle = !this.heroAttackToggle;
            this.queueAction(caster.id, root, "punch", now, frameStart, 8);
          } else {
            this.queueAction(caster.id, root, "cast", now);
          }
          continue;
        }
        this.queueAction(caster.id, root, "bolt", now);
        continue;
      }

      if (event.e === "melee") {
        const attacker = ents.find((entity) => entity.id === event.by && entity.kind === "monster");
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
      } else if (e.kind === "lootbag") {
        color = 0xffcc44; // a glinting sack on the floor
        size = 34;
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
      const h = e.kind === "proj" ? 12 : e.kind === "boss" ? 38 : e.kind === "lootbag" ? 8 : 22;
      const prev = this.lastPos.get(e.id);
      const dx = prev ? wx - prev.x : 0;
      const dy = prev ? wy - prev.y : 0;
      const positionChanged = dx * dx + dy * dy > 0.5;
      if (positionChanged) s.movingUntil = now + MOVEMENT_HOLD_MS;
      const moving = positionChanged || now < s.movingUntil;
      const face = positionChanged
        ? this.facingWithHysteresis(s, dx, dy, true, e.aim ?? 0)
        : moving
          ? { dir: s.facingDir, flipX: s.flipX }
          : this.facingWithHysteresis(s, 0, 0, false, e.aim ?? 0);
      s.facingDir = face.dir;
      s.flipX = face.flipX;
      if (s.action && now >= s.actionUntil) s.action = null;

      if (e.kind === "player" || e.kind === "monster") {
        const root = e.kind === "player" ? HERO_ROOT : this.enemyRoot(e.id);
        const displayFlipX = s.action ? s.actionFlipX : s.flipX;
        let actionClip = s.action ? this.actionClipPath(root, s.action, s.actionFacingDir) : null;
        let loadedAction = actionClip ? this.clipCache.get(actionClip) : undefined;
        if (actionClip && loadedAction === undefined) void this.ensureClip(actionClip);
        if (actionClip && loadedAction === null) {
          s.action = null;
          actionClip = null;
          loadedAction = undefined;
        }

        const readyAction = actionClip && loadedAction ? { path: actionClip, clip: loadedAction } : null;
        const displayDir = actionClip ? s.actionFacingDir : s.facingDir;
        const targetClip = readyAction?.path ?? this.clipPath(root, actionClip ? false : moving, displayDir);
        const loaded = readyAction?.clip ?? this.clipCache.get(targetClip);
        const actionFrameCount =
          readyAction && s.actionFrameCount > 0
            ? Math.min(s.actionFrameCount, readyAction.clip.frames.length - s.actionFrameStart)
            : readyAction?.clip.frames.length;

        if (s.clipKey !== targetClip) {
          s.clipKey = targetClip;
          s.frame = readyAction ? 0 : -1;
          if (readyAction) {
            const frameStepMs =
              (readyAction.clip.frameMs * (e.kind === "monster" ? ENEMY_FRAME_SLOWDOWN : 1)) / s.actionFrameSpeed;
            s.nextFrameAt = now + frameStepMs;
            s.actionUntil =
              now + this.clipDurationMs(readyAction.clip, e.kind === "monster", actionFrameCount) / s.actionFrameSpeed;
          } else {
            s.nextFrameAt = 0;
          }
        }

        if (loaded) {
          const frameStepMs =
            (loaded.frameMs * (e.kind === "monster" ? ENEMY_FRAME_SLOWDOWN : 1)) /
            (readyAction ? s.actionFrameSpeed : 1);
          if (now >= s.nextFrameAt) {
            s.frame = (s.frame + 1) % (actionFrameCount ?? loaded.frames.length);
            s.nextFrameAt = now + frameStepMs;
          }
          const frameIndex = readyAction ? s.actionFrameStart + s.frame : s.frame;
          this.applyFrame(s, loaded, frameIndex, displayFlipX);
        } else {
          void this.ensureClip(targetClip);
          this.setFallback(s, color);
        }
      } else {
        this.setFallback(s, color);
      }

      s.sprite.scale.set(size, size, 1);
      s.sprite.position.set(wx, h, wy);
      this.lastPos.set(e.id, { x: wx, y: wy });

      // Fog of war: the local player + allies are always drawn; monsters, the
      // boss, and projectiles only within VISION_RADIUS and with clear line-of-
      // sight to the player (walls block). predicted = local player world pos.
      const fogged = e.kind === "monster" || e.kind === "boss" || e.kind === "proj";
      if (fogged && predicted) {
        const ddx = wx - predicted.x;
        const ddy = wy - predicted.y;
        s.sprite.visible = ddx * ddx + ddy * ddy <= VISION_RADIUS_SQ && this.canSee(predicted.x, predicted.y, wx, wy);
      } else {
        s.sprite.visible = true;
      }
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        this.scene.remove(s.sprite);
        s.texture?.dispose();
        (s.sprite.material as THREE.SpriteMaterial).dispose();
        this.sprites.delete(id);
        this.lastPos.delete(id);
      }
    }
  }

  // The exit. Client rebuilds its position from the floor seed (shared procgen).
  setStairs(x: number, y: number) {
    if (!this.stairs) {
      this.stairs = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x5dff9b, transparent: true }));
      this.scene.add(this.stairs);
    }
    this.stairs.position.set(x, 30, y);
  }

  setFloor(floor: FloorDescriptor): void {
    if (this.walls) {
      this.scene.remove(this.walls);
      this.walls.geometry.dispose();
      (this.walls.material as THREE.Material).dispose();
    }

    const grid = floor.collision;
    this.collision = grid; // fog line-of-sight reads this each frame
    // Hand the grid to the fog shader (as a texture) so walls occlude vision.
    this.fogGridTex.dispose();
    this.fogGridTex = this.buildGridTexture(grid);
    this.fog.uGrid.value = this.fogGridTex;
    this.fog.uGridSize.value.set(grid.w, grid.h);
    this.fog.uCell.value = grid.cell;
    let wallCount = 0;
    for (const value of grid.solid) wallCount += value;
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x39445e });
    this.patchFog(wallMat);
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(grid.cell, 96, grid.cell), wallMat, wallCount);
    const matrix = new THREE.Matrix4();
    let instance = 0;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (grid.solid[y * grid.w + x] !== 1) continue;
        matrix.makeTranslation((x + 0.5) * grid.cell, 48, (y + 0.5) * grid.cell);
        walls.setMatrixAt(instance++, matrix);
      }
    }
    walls.instanceMatrix.needsUpdate = true;
    this.scene.add(walls);
    this.walls = walls;
    this.setStairs(floor.stairs.x, floor.stairs.y);
  }

  clearStairs() {
    if (this.stairs) {
      this.scene.remove(this.stairs);
      this.stairs = null;
    }
  }

  follow(x: number, y: number) {
    // Raised + tilted more top-down (was 520h / 420 back) so the level extent and
    // boundaries read clearly. Higher = more overhead, smaller back-offset = flatter.
    this.camera.position.set(x, 820, y + 460);
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

  // Vision center for the wall-fog shader (player in play, spectate target while
  // waiting). Called each frame from the main loop.
  setVision(x: number, y: number): void {
    this.fog.uPlayer.value.set(x, y);
  }

  // The collision grid as an R8 texture (255 = wall) for the fog shader to march.
  private buildGridTexture(grid: CollisionGrid): THREE.DataTexture {
    const data = new Uint8Array(grid.w * grid.h);
    for (let i = 0; i < data.length; i++) data[i] = grid.solid[i] ? 255 : 0;
    const tex = new THREE.DataTexture(data, grid.w, grid.h, THREE.RedFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // Patch a MeshBasicMaterial so each fragment is darkened unless it has line-of-
  // sight to uPlayer — the per-pixel GLSL twin of canSee(). Shared fog uniforms
  // are wired in so one update drives both the ground and wall materials.
  private patchFog(mat: THREE.Material): void {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPlayer = this.fog.uPlayer;
      shader.uniforms.uGrid = this.fog.uGrid;
      shader.uniforms.uGridSize = this.fog.uGridSize;
      shader.uniforms.uCell = this.fog.uCell;
      shader.uniforms.uVisionRadius = this.fog.uVisionRadius;
      shader.vertexShader =
        "varying vec2 vWorldXZ;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec4 dccW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #else
            vec4 dccW = modelMatrix * vec4(transformed, 1.0);
          #endif
          vWorldXZ = dccW.xz;`,
        );
      shader.fragmentShader =
        `varying vec2 vWorldXZ;
        uniform vec2 uPlayer; uniform sampler2D uGrid; uniform vec2 uGridSize; uniform float uCell; uniform float uVisionRadius;
        float dccLos(vec2 from, vec2 to) {
          vec2 d = to - from;
          float dist = length(d);
          vec2 tgt = floor(to / uCell);
          int steps = int(min(48.0, dist / (uCell * 0.5)));
          for (int i = 1; i <= 48; i++) {
            if (i > steps) break;
            vec2 cell = floor((from + d * (float(i) / float(steps))) / uCell);
            if (all(equal(cell, tgt))) return 1.0; // reached target cell unobstructed
            if (texture2D(uGrid, (cell + 0.5) / uGridSize).r > 0.5) return 0.0; // wall between
          }
          return 1.0;
        }
        ` +
        shader.fragmentShader.replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          float dccDist = distance(vWorldXZ, uPlayer);
          float dccFall = 1.0 - smoothstep(uVisionRadius * 0.6, uVisionRadius, dccDist);
          float dccLit = dccLos(uPlayer, vWorldXZ) * dccFall;
          // Blend unseen pixels to the scene background (0x0b0e14) so out-of-sight
          // walls/paths vanish entirely — not just dim. Seen pixels keep full color.
          gl_FragColor.rgb = mix(vec3(0.043, 0.055, 0.078), gl_FragColor.rgb, dccLit);`,
        );
    };
    mat.needsUpdate = true;
  }

  // Fog line-of-sight: true if no solid cell lies between the player and the
  // target. Amanatides–Woo grid traversal over the collision grid (cheap: a few
  // cells per call). No grid yet → treat as visible (radius-only fallback).
  private canSee(px: number, py: number, ex: number, ey: number): boolean {
    const grid = this.collision;
    if (!grid) return true;
    const cell = grid.cell;
    let cx = Math.floor(px / cell);
    let cy = Math.floor(py / cell);
    const ecx = Math.floor(ex / cell);
    const ecy = Math.floor(ey / cell);
    const dx = ex - px;
    const dy = ey - py;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const invDx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const invDy = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
    let tMaxX = dx !== 0 ? (stepX > 0 ? (cx + 1) * cell - px : px - cx * cell) * invDx : Infinity;
    let tMaxY = dy !== 0 ? (stepY > 0 ? (cy + 1) * cell - py : py - cy * cell) * invDy : Infinity;
    const tDeltaX = cell * invDx;
    const tDeltaY = cell * invDy;
    for (let guard = grid.w + grid.h + 2; guard > 0; guard--) {
      if (cx === ecx && cy === ecy) return true; // reached the target cell, unobstructed
      if (tMaxX < tMaxY) {
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        cy += stepY;
        tMaxY += tDeltaY;
      }
      if (cx < 0 || cy < 0 || cx >= grid.w || cy >= grid.h) return true; // off-grid: don't over-hide
      if (cx === ecx && cy === ecy) return true; // entity's own cell is open; stop before testing it
      if (grid.solid[cy * grid.w + cx] === 1) return false; // a wall sits between
    }
    return true;
  }

  draw() {
    // Pulse the stairs marker (size + opacity) so the exit reads as a beacon.
    if (this.stairs) {
      const t = performance.now();
      const pulse = 0.5 + 0.5 * Math.sin(t / 280);
      const s = 120 + 35 * pulse;
      this.stairs.scale.set(s, s, 1);
      (this.stairs.material as THREE.SpriteMaterial).opacity = 0.65 + 0.35 * pulse;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
