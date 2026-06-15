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
import type { ClientMsg, EntityDTO, GameEvent, RunPhase, SelfDTO, ServerMsg } from "../protocol";
import { generateFloor } from "../procgen";
import type { FloorDescriptor } from "../procgen/types";
import type { BossState, MonsterState, PlayerState, ProjectileState, WorldCtx } from "./state";
import type { PlaystyleEvent } from "./events";
import { stepPlayer } from "./sim/movement";
import { updateMonsters } from "./sim/monsters";
import { updateBoss } from "./sim/boss";
import { castAbility, stepProjectiles } from "./sim/projectiles";
import { DevIdentity, type Identity } from "./identity";
import { SqlRunStore, type RunCheckpoint } from "./persistence";
import { SCHEMA } from "./persistence/schema";
import { StubProfileTracker, type ProfileTracker } from "./loot/profile";

const PERSIST_EVERY = Math.round(1000 / TICK_MS); // ~1 Hz heartbeat (every 20 ticks)
const FIRST_SEED = 0xdcc;

// The single global world. It IS the authoritative server: a fixed-rate tick over
// in-memory state, persisted to the DO's SQLite so the run survives eviction (M0).
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
  private ticksSincePersist = 0;

  private identity: Identity = new DevIdentity();
  private profiles: ProfileTracker = new StubProfileTracker();
  private sql: SqlStorage;
  private store: SqlRunStore;
  // Set during the constructor's blockConcurrencyWhile before any request runs.
  private floor!: FloorDescriptor;
  private runId = "run-dev";
  private phase: RunPhase = "running";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const stmt of SCHEMA) this.sql.exec(stmt); // idempotent CREATE TABLE IF NOT EXISTS
    this.store = new SqlRunStore(this.sql);

    // Reload-on-construct: resume the persisted run, or bootstrap a fresh one.
    // A throw here would reset the object (crash-loop), so fall back to bootstrap.
    ctx.blockConcurrencyWhile(async () => {
      try {
        const run = await this.store.loadRun();
        if (run) this.resumeRun(run);
        else this.bootstrapRun();
      } catch {
        this.bootstrapRun();
      }
    });
    // The sim loop starts lazily on first join, so an idle DO can be evicted and
    // resume from SQLite on the next connection.
  }

  private bootstrapRun() {
    this.runId = `run-${Date.now().toString(36)}`;
    this.phase = "running";
    this.floor = generateFloor(FIRST_SEED, 1);
    this.spawnMonsters();
    this.store.checkpointSync({ runId: this.runId, currentFloor: 1, seed: FIRST_SEED, phase: this.phase, savedAt: Date.now() });
  }

  private resumeRun(run: RunCheckpoint) {
    this.runId = run.runId;
    // Don't trust a stored TEXT column as a typed enum — validate, else default.
    this.phase = isRunPhase(run.phase) ? run.phase : "running";
    // Floors are deterministic from (seed, depth) — no geometry is persisted.
    this.floor = generateFloor(run.seed, run.currentFloor);
    this.spawnMonsters();
  }

  // ---- WorldCtx hooks the sim modules call ----
  pushFx(e: GameEvent) {
    this.events.push(e);
  }
  pushPlay(e: PlaystyleEvent) {
    this.profiles.record(e);
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
    if (this.boss && !this.boss.dead) return;
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
      castReadyAt: this.now + 1500,
      meleeReadyAt: 0,
      threat: new Map(),
    };
    this.events.push({ e: "boss", x, y, state: "spawn" });
  }

  // RPC: wipe to a fresh vanilla run (admin /admin/new-run; auth in the Worker).
  // Matches decision #7 — manual run-start during dev; scheduled later.
  async newRun(): Promise<{ runId: string; seed: number }> {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const runId = `run-${Date.now().toString(36)}`;
    const ids = [...this.players.keys()];

    // Persist FIRST — disk is the source of truth. If the write throws, the live
    // world is left untouched and the Worker returns 500 (no half-switched run).
    this.ctx.storage.transactionSync(() => {
      this.store.resetSync(runId, seed, Date.now());
      for (const id of ids) {
        const p = this.players.get(id)!;
        this.store.playerSync({
          playerId: id,
          name: p.name,
          alive: true,
          cls: this.profiles.classOf(id),
          profile: this.profiles.get(id),
          abilities: DEFAULT_ABILITIES,
          lastSeen: Date.now(),
        });
      }
    });

    // Committed — now switch the in-memory world and tell connected clients.
    this.runId = runId;
    this.phase = "running";
    this.floor = generateFloor(seed, 1);
    this.spawnMonsters();
    this.projectiles = [];
    this.boss = null;
    this.killsSinceBoss = 0;
    for (const p of this.players.values()) {
      p.status = "alive";
      p.hp = PLAYER_MAX_HP;
      p.cds = {};
      p.mvx = 0;
      p.mvy = 0;
      p.abilities = DEFAULT_ABILITIES.map((a) => ({ ...a }));
      p.x = this.floor.entrance.x + (Math.random() - 0.5) * 200;
      p.y = this.floor.entrance.y + (Math.random() - 0.5) * 200;
      this.send(p.ws, this.floorMsg());
      this.send(p.ws, this.runMsg());
    }
    return { runId, seed };
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
        return;
      }
      player = this.onMessage(server, player, msg);
    });
    const drop = () => {
      if (player) {
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
      void this.store.savePlayer(this.recordOf(p));
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
    if (player.status !== "alive") return player;

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
    if (++this.ticksSincePersist >= PERSIST_EVERY) {
      this.ticksSincePersist = 0;
      this.persistHeartbeat();
    }
  }

  // ~1 Hz durable checkpoint. Batched in one transaction; nothing in the tick
  // depends on it, so a storage hiccup can't stall the sim.
  private persistHeartbeat() {
    try {
      this.ctx.storage.transactionSync(() => {
        this.store.checkpointSync({
          runId: this.runId,
          currentFloor: this.floor.depth,
          seed: this.floor.seed,
          phase: this.phase,
          savedAt: Date.now(),
        });
        for (const p of this.players.values()) this.store.playerSync(this.recordOf(p));
      });
    } catch {
      /* a failed checkpoint must never break the sim loop */
    }
  }

  private recordOf(p: PlayerState) {
    return {
      playerId: p.id,
      name: p.name,
      alive: p.status === "alive",
      cls: this.profiles.classOf(p.id),
      profile: this.profiles.get(p.id),
      abilities: p.abilities,
      lastSeen: Date.now(),
    };
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
      state: { index: this.floor.index, phase: "active", endsAt: this.now + this.floor.durationMs, livingAtStairs: 0, living: this.aliveCount() },
    };
  }
  private runMsg(): ServerMsg {
    return {
      t: "run",
      state: {
        runId: this.runId,
        currentFloor: this.floor.depth,
        phase: this.phase,
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

const RUN_PHASES: readonly RunPhase[] = ["lobby", "running", "ended", "cooldown"];
function isRunPhase(s: string): s is RunPhase {
  return (RUN_PHASES as readonly string[]).includes(s);
}
