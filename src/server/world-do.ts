import { DurableObject } from "cloudflare:workers";
import {
  BOSS_KILL_THRESHOLD,
  BOSS_MAX_HP,
  BOSS_NAME,
  MONSTER_MAX_HP,
  PLAYER_MAX_HP,
  TICK_MS,
  WORLD,
} from "../shared/constants";
import { DEFAULT_ABILITIES } from "../shared/abilities";
import { PROTOCOL_VERSION } from "../protocol";
import type { ClientMsg, EntityDTO, GameEvent, SelfDTO, ServerMsg } from "../protocol";
import { generateFloor } from "../procgen";
import type { FloorDescriptor } from "../procgen/types";
import type { BossState, MonsterState, PlayerState, ProjectileState, WorldCtx } from "./state";
import type { PlaystyleEvent } from "./events";
import { stepPlayer } from "./sim/movement";
import { updateMonsters } from "./sim/monsters";
import { updateBoss } from "./sim/boss";
import { castAbility, stepProjectiles } from "./sim/projectiles";
import { DevIdentity, type Identity } from "./identity";
import { InMemoryRunStore, type RunStore } from "./persistence";
import { StubProfileTracker, type ProfileTracker } from "./loot/profile";

// The single global world (Phase 0). It IS the authoritative server: in-memory
// state, a fixed-rate tick, and a snapshot broadcast. Subsystems hang off the
// stubs below and get replaced stream-by-stream (see WORKSTREAMS.md).
export class MyDurableObject extends DurableObject<Env> implements WorldCtx {
  now = 0;
  players = new Map<string, PlayerState>();
  monsters: MonsterState[] = [];
  projectiles: ProjectileState[] = [];
  boss: BossState | null = null;

  private events: GameEvent[] = [];
  private loop: ReturnType<typeof setInterval> | null = null;
  private killsSinceBoss = 0;
  private bossSeq = 0;

  private identity: Identity = new DevIdentity();
  private store: RunStore = new InMemoryRunStore();
  private profiles: ProfileTracker = new StubProfileTracker();
  private floor: FloorDescriptor;
  private runId = "run-dev";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // PHASE 0: generate a fresh floor on construct. Stream A / M0 makes this
    // conditional on persisted state (blockConcurrencyWhile reload-and-resume).
    this.floor = generateFloor(0xdcc, 1);
    this.spawnMonsters();
    void this.store.saveCheckpoint({ runId: this.runId, currentFloor: 1, seed: this.floor.seed, phase: "running", savedAt: this.now });
  }

  // ---- WorldCtx hooks the sim modules call ----
  pushFx(e: GameEvent) {
    this.events.push(e);
  }
  pushPlay(e: PlaystyleEvent) {
    this.profiles.record(e);
    // Collective monster kills accrue toward the boss (ported from the monolith).
    if (e.e === "kill" && e.targetKind === "monster") {
      this.killsSinceBoss += 1;
      this.maybeSpawnBoss();
    }
  }

  private spawnMonsters() {
    this.monsters = this.floor.spawns.map((s, i) => ({
      id: `m_${i.toString(36)}`,
      kind: s.kind,
      x: s.x,
      y: s.y,
      aim: 0,
      hp: MONSTER_MAX_HP,
      dead: false,
      respawnAt: 0,
      attackReadyAt: 0,
      wanderAt: 0,
      threat: new Map(),
    }));
  }

  private maybeSpawnBoss() {
    if (this.boss && !this.boss.dead) return; // one boss at a time
    if (this.killsSinceBoss < BOSS_KILL_THRESHOLD) return;
    this.killsSinceBoss = 0;
    const x = 300 + Math.random() * (WORLD.w - 600);
    const y = 300 + Math.random() * (WORLD.h - 600);
    this.boss = {
      tag: "boss",
      id: `boss_${(++this.bossSeq).toString(36)}`,
      name: BOSS_NAME,
      x,
      y,
      aim: 0,
      hp: BOSS_MAX_HP,
      maxHp: BOSS_MAX_HP,
      dead: false,
      castReadyAt: this.now + 1500, // brief telegraph before the first volley
      meleeReadyAt: 0,
      threat: new Map(),
    };
    this.events.push({ e: "boss", x, y, state: "spawn" });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    let player: PlayerState | null = null;
    server.addEventListener("message", (ev) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(ev.data as string) as ClientMsg;
      } catch {
        return; // ignore malformed input
      }
      player = this.onMessage(server, player, msg);
    });
    const drop = () => {
      if (player) {
        // PHASE 0: remove on disconnect. Stream A / M1 keeps a LIVING character
        // in the world (targetable, can die while linkdead) and rebinds on
        // reconnect (decision #8).
        const id = player.id;
        this.players.delete(id);
        this.projectiles = this.projectiles.filter((p) => p.ownerId !== id);
        if (this.boss) this.boss.threat.delete(id);
        for (const m of this.monsters) m.threat.delete(id);
      }
      if (this.players.size === 0) this.stopLoop();
    };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, player: PlayerState | null, msg: ClientMsg): PlayerState | null {
    if (msg.t === "join") {
      const minted = this.identity.mint(msg.name);
      const p: PlayerState = {
        id: minted.playerId,
        name: (msg.name || "Hero").slice(0, 16),
        x: this.floor.entrance.x + (Math.random() - 0.5) * 200,
        y: this.floor.entrance.y + (Math.random() - 0.5) * 200,
        aim: 0,
        mvx: 0,
        mvy: 0,
        hp: PLAYER_MAX_HP,
        status: "alive",
        cds: {},
        lastSeq: 0,
        abilities: DEFAULT_ABILITIES.map((a) => ({ ...a })),
        ws,
      };
      this.players.set(p.id, p);
      void this.store.savePlayer({
        playerId: p.id,
        name: p.name,
        alive: true,
        cls: this.profiles.classOf(p.id),
        profile: this.profiles.get(p.id),
        abilities: p.abilities,
        lastSeen: this.now,
      });
      this.send(ws, { t: "welcome", you: p.id, token: minted.token, world: WORLD, protocol: PROTOCOL_VERSION });
      this.send(ws, this.floorMsg());
      this.send(ws, this.runMsg());
      this.startLoop();
      return p;
    }

    if (!player) return null;
    if (msg.t === "ping") {
      this.send(ws, { t: "pong", ts: msg.ts });
      return player;
    }
    if (player.status !== "alive") return player; // spectators send no game input

    if (msg.t === "input") {
      player.mvx = clampUnit(msg.mv?.[0] ?? 0);
      player.mvy = clampUnit(msg.mv?.[1] ?? 0);
      player.aim = Number(msg.aim) || 0;
      player.lastSeq = msg.seq | 0;
    } else if (msg.t === "cast") {
      player.aim = Number(msg.aim) || 0;
      player.lastSeq = msg.seq | 0;
      castAbility(this, player, msg.ability | 0, player.aim);
    }
    return player;
  }

  // ---- Simulation loop ----
  private startLoop() {
    if (!this.loop) this.loop = setInterval(() => this.tick(), TICK_MS);
  }
  private stopLoop() {
    if (this.loop) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  private tick() {
    this.now += TICK_MS;
    const dt = TICK_MS / 1000;
    for (const p of this.players.values()) stepPlayer(p, dt);
    updateMonsters(this, dt);
    updateBoss(this, dt);
    stepProjectiles(this, dt);
    this.broadcast();
    this.events = [];
  }

  private broadcast() {
    const ents: EntityDTO[] = [];
    for (const p of this.players.values()) {
      if (p.status !== "alive") continue;
      ents.push({
        id: p.id,
        kind: "player",
        x: r(p.x),
        y: r(p.y),
        aim: r2(p.aim),
        hp: Math.max(0, r(p.hp)),
        maxHp: PLAYER_MAX_HP,
        name: p.name,
        cls: this.profiles.classOf(p.id),
      });
    }
    for (const m of this.monsters) {
      if (m.dead) continue;
      ents.push({ id: m.id, kind: "monster", x: r(m.x), y: r(m.y), aim: r2(m.aim), hp: Math.max(0, r(m.hp)), maxHp: MONSTER_MAX_HP });
    }
    if (this.boss && !this.boss.dead) {
      ents.push({
        id: this.boss.id,
        kind: "boss",
        x: r(this.boss.x),
        y: r(this.boss.y),
        aim: r2(this.boss.aim),
        hp: Math.max(0, r(this.boss.hp)),
        maxHp: this.boss.maxHp,
        name: this.boss.name,
      });
    }
    for (const pr of this.projectiles) {
      ents.push({ id: pr.id, kind: "proj", x: r(pr.x), y: r(pr.y), sprite: pr.ability });
    }

    // PHASE 0: every client gets every entity. Stream G / M6 adds AoI culling +
    // binary deltas here (O(N^2) is the known scale wall — see ROADMAP.md).
    for (const p of this.players.values()) {
      const self: SelfDTO = {
        x: r(p.x),
        y: r(p.y),
        hp: Math.max(0, r(p.hp)),
        maxHp: PLAYER_MAX_HP,
        ack: p.lastSeq,
        cds: p.cds,
        cls: this.profiles.classOf(p.id),
        profile: this.profiles.get(p.id),
        status: p.status,
      };
      this.send(p.ws, { t: "state", tick: this.now, ack: p.lastSeq, ents, events: this.events, self });
    }
  }

  private floorMsg(): ServerMsg {
    return {
      t: "floor",
      info: {
        index: this.floor.index,
        seed: this.floor.seed,
        depth: this.floor.depth,
        theme: this.floor.theme,
        w: this.floor.w,
        h: this.floor.h,
        durationMs: this.floor.durationMs,
      },
      // PHASE 0: a static active floor. Stream A / M4 owns the Floor FSM + the
      // durable alarm timer + the stairs-reached advance rule.
      state: { index: this.floor.index, phase: "active", endsAt: this.now + this.floor.durationMs, livingAtStairs: 0, living: this.aliveCount() },
    };
  }
  private runMsg(): ServerMsg {
    return {
      t: "run",
      state: {
        runId: this.runId,
        currentFloor: this.floor.depth,
        phase: "running",
        players: this.aliveCount(),
        spectators: this.players.size - this.aliveCount(),
      },
    };
  }
  private aliveCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.status === "alive") n++;
    return n;
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing */
    }
  }
}

function r(v: number) {
  return Math.round(v);
}
function r2(v: number) {
  return Math.round(v * 100) / 100;
}
function clampUnit(v: number) {
  const n = Number(v) || 0;
  return n < -1 ? -1 : n > 1 ? 1 : n;
}
