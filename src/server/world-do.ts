import { DurableObject } from "cloudflare:workers";
import {
  BOSS_KILL_THRESHOLD,
  BOSS_MAX_HP,
  BOSS_NAME,
  MAX_FLOORS,
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
import { HmacIdentity, type Identity } from "./identity";
import { SqlRunStore, type PlayerRecord, type RunCheckpoint } from "./persistence";
import { SCHEMA } from "./persistence/schema";
import { EmaProfileTracker, type ProfileTracker } from "./loot/profile";

const PERSIST_EVERY = Math.round(1000 / TICK_MS); // ~1 Hz heartbeat (every 20 ticks)
const FIRST_SEED = 0xdcc;

// The single global world. It IS the authoritative server: a fixed-rate tick over
// in-memory state, persisted to the DO's SQLite so the run AND identities survive
// eviction/restart (M0 + M1).
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
  private connected = 0; // open joined sockets; loop runs while > 0

  private identity: Identity;
  private profiles: ProfileTracker = new EmaProfileTracker();
  private sql: SqlStorage;
  private store: SqlRunStore;
  private floor!: FloorDescriptor; // set in the constructor's blockConcurrencyWhile
  private runId = "run-dev";
  private phase: RunPhase = "running";
  private floorEndsAt = 0; // wall-clock deadline of the current floor (mirrors the DO alarm)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.identity = new HmacIdentity(env.TOKEN_SIGNING_KEY);
    this.sql = ctx.storage.sql;
    for (const stmt of SCHEMA) this.sql.exec(stmt); // idempotent CREATE TABLE IF NOT EXISTS
    this.store = new SqlRunStore(this.sql);

    ctx.blockConcurrencyWhile(async () => {
      try {
        const run = await this.store.loadRun();
        if (run) this.resumeRun(run);
        else this.bootstrapRun();
      } catch {
        this.bootstrapRun();
      }
      // Floor timer = a durable alarm (survives eviction). Adopt the scheduled
      // deadline only if it's still in the FUTURE; a past-due rehydrated alarm
      // (the DO was down past the deadline) gets a fresh timer instead of firing
      // a spurious timeout/extinction on the first player to reconnect.
      if (this.phase === "running") {
        const due = await ctx.storage.getAlarm();
        if (due != null && due > Date.now()) {
          this.floorEndsAt = due;
        } else {
          this.floorEndsAt = Date.now() + this.floor.durationMs;
          await ctx.storage.setAlarm(this.floorEndsAt);
        }
      }
    });
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
    this.phase = isRunPhase(run.phase) ? run.phase : "running";
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
  async newRun(): Promise<{ runId: string; seed: number }> {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const runId = `run-${Date.now().toString(36)}`;
    const ids = [...this.players.keys()];

    // Persist FIRST — disk is the source of truth; if it throws, the live world
    // is untouched and the Worker returns 500 (no half-switched run).
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

    this.runId = runId;
    this.phase = "running";
    this.floor = generateFloor(seed, 1);
    this.spawnMonsters();
    this.projectiles = [];
    this.boss = null;
    this.killsSinceBoss = 0;
    this.floorEndsAt = Date.now() + this.floor.durationMs;
    void this.ctx.storage.setAlarm(this.floorEndsAt);
    for (const p of this.players.values()) {
      // Leave p.linkdead as-is: a disconnected character stays frozen/targetable
      // in the new run and clears linkdead only when it reconnects.
      p.status = "alive";
      p.hp = PLAYER_MAX_HP;
      p.cds = {};
      p.mvx = 0;
      p.mvy = 0;
      p.abilities = DEFAULT_ABILITIES.map((a) => ({ ...a }));
      p.x = this.floor.entrance.x + (Math.random() - 0.5) * 200;
      p.y = this.floor.entrance.y + (Math.random() - 0.5) * 200;
      if (!p.linkdead) {
        this.send(p.ws, this.floorMsg());
        this.send(p.ws, this.runMsg());
      }
    }
    return { runId, seed };
  }

  // ---- Floor lifecycle (M4) ----
  // The DO alarm fires at the floor deadline — even if the DO was idle/evicted.
  async alarm(): Promise<void> {
    // at-least-once: ignore a stale retry if a new floor was already scheduled.
    if (Date.now() < this.floorEndsAt - 500) {
      await this.ctx.storage.setAlarm(this.floorEndsAt);
      return;
    }
    if (this.phase !== "running") return;
    // Nobody connected: PAUSE rather than extinct an abandoned/just-woken run.
    // The floor resumes counting once a player reconnects.
    if (this.connected === 0) {
      this.floorEndsAt = Date.now() + this.floor.durationMs;
      await this.ctx.storage.setAlarm(this.floorEndsAt);
      return;
    }
    this.timeoutExpire();
  }

  private atStairs(p: PlayerState): boolean {
    const s = this.floor.stairs;
    return Math.hypot(p.x - s.x, p.y - s.y) <= s.r;
  }

  // Timer expired: living players who didn't reach the stairs die (lethal timer,
  // decision #2), then the floor advances.
  private timeoutExpire(): void {
    for (const p of this.players.values()) {
      if (p.status === "alive" && !this.atStairs(p)) {
        p.status = "spectator";
        p.mvx = 0;
        p.mvy = 0;
        this.events.push({ e: "death", x: p.x, y: p.y, id: p.id });
        this.persistPlayer(p);
      }
    }
    this.advanceFloor();
  }

  // Advance when the timer expires OR all living players reach the stairs.
  // Survivors descend; if none remain the run ends.
  private advanceFloor(): void {
    const survivors = [...this.players.values()].filter((p) => p.status === "alive");
    if (survivors.length === 0 || this.floor.depth + 1 > MAX_FLOORS) {
      this.endRun();
      return;
    }
    this.floor = generateFloor(this.floor.seed, this.floor.depth + 1); // same run seed, deeper
    this.spawnMonsters();
    this.projectiles = [];
    this.boss = null;
    this.killsSinceBoss = 0;
    for (const p of survivors) {
      p.x = this.floor.entrance.x + (Math.random() - 0.5) * 200;
      p.y = this.floor.entrance.y + (Math.random() - 0.5) * 200;
      p.mvx = 0;
      p.mvy = 0;
    }
    this.floorEndsAt = Date.now() + this.floor.durationMs;
    void this.ctx.storage.setAlarm(this.floorEndsAt);
    this.checkpoint();
    this.broadcastFloorRun();
  }

  private endRun(): void {
    this.phase = "ended";
    this.floorEndsAt = 0;
    void this.ctx.storage.deleteAlarm();
    this.checkpoint();
    this.broadcastFloorRun();
  }

  private checkpoint(): void {
    try {
      this.ctx.storage.transactionSync(() =>
        this.store.checkpointSync({
          runId: this.runId,
          currentFloor: this.floor.depth,
          seed: this.floor.seed,
          phase: this.phase,
          savedAt: Date.now(),
        }),
      );
    } catch {
      /* never break on a storage hiccup */
    }
  }

  private broadcastFloorRun(): void {
    const floor = this.floorMsg();
    const run = this.runMsg();
    for (const p of this.players.values()) {
      if (p.linkdead) continue;
      this.send(p.ws, floor);
      this.send(p.ws, run);
    }
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
    let joining = false;
    let closed = false;
    server.addEventListener("message", async (ev) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(ev.data as string) as ClientMsg;
      } catch {
        return;
      }
      if (msg.t === "join") {
        if (player || joining) return; // exactly one join per socket
        joining = true;
        try {
          const ident = await this.resolveIdentity(msg.name, msg.token); // async: crypto + load
          if (closed) return; // socket dropped during the async resolve — don't register a phantom
          player = this.register(server, msg.name, ident); // synchronous => atomic alive/spectator decision
        } finally {
          joining = false;
        }
        return;
      }
      if (player) this.handleInput(player, server, msg);
    });
    // Runs at most once — an abnormal disconnect fires BOTH error and close.
    const drop = () => {
      if (closed) return;
      closed = true;
      if (player) {
        this.connected = Math.max(0, this.connected - 1);
        if (player.ws === server) {
          if (player.status === "alive") {
            // Linkdead: a LIVING character stays in the world, frozen and
            // targetable — it can die while you're gone (decision #8).
            player.linkdead = true;
            player.mvx = 0;
            player.mvy = 0;
            this.persistPlayer(player);
          } else {
            this.players.delete(player.id);
          }
          this.projectiles = this.projectiles.filter((p) => p.ownerId !== player!.id);
        }
      }
      if (this.connected === 0) this.stopLoop();
    };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Async part of join: verify the token (or mint) and load the record. No state
  // mutation here, so it's safe to run with the input gate open across awaits.
  private async resolveIdentity(
    name: string,
    providedToken?: string,
  ): Promise<{ playerId: string; token: string; rec: PlayerRecord | null }> {
    const verified = providedToken ? await this.identity.verify(providedToken) : null;
    if (verified) {
      return { playerId: verified.playerId, token: providedToken!, rec: await this.store.loadPlayer(verified.playerId) };
    }
    const minted = await this.identity.mint(name);
    return { playerId: minted.playerId, token: minted.token, rec: null };
  }

  // Synchronous so the alive/spectator decision is atomic w.r.t. the tick — there
  // is NO await between reading this.players and committing the player. Do not add
  // one, or a death landing mid-join could open a revive window.
  private register(ws: WebSocket, name: string, ident: { playerId: string; token: string; rec: PlayerRecord | null }): PlayerState {
    const { playerId, token, rec } = ident;
    const finalName = (name || rec?.name || "Hero").slice(0, 16);

    // Rebind a character already live in this run (reconnect / second tab).
    const existing = this.players.get(playerId);
    if (existing) {
      const oldWs = existing.ws;
      existing.ws = ws;
      existing.linkdead = false;
      if (name) existing.name = finalName;
      this.connected++;
      if (oldWs !== ws) {
        try {
          oldWs.close(); // displace a stale/second socket; its drop() will decrement
        } catch {
          /* already closed */
        }
      }
      this.welcomeFlow(ws, playerId, token);
      this.startLoop();
      return existing;
    }

    // Dead in this run -> spectator only. This is what makes permadeath stick
    // across a reload: a valid token for a dead character cannot play.
    if (rec && !rec.alive) {
      const spec = this.makePlayer(playerId, finalName, ws, "spectator", rec);
      this.players.set(playerId, spec);
      this.connected++;
      this.welcomeFlow(ws, playerId, token);
      this.startLoop();
      return spec;
    }

    // New player, or an alive player returning after the DO was evicted. Joining
    // a run that has already ENDED yields a spectator (no acting until a new run).
    const status = this.phase === "running" ? "alive" : "spectator";
    const p = this.makePlayer(playerId, finalName, ws, status, rec);
    this.players.set(playerId, p);
    this.connected++;
    this.persistPlayer(p);
    this.welcomeFlow(ws, playerId, token);
    this.startLoop();
    return p;
  }

  private makePlayer(id: string, name: string, ws: WebSocket, status: "alive" | "spectator", rec: PlayerRecord | null): PlayerState {
    return {
      id,
      name,
      x: this.floor.entrance.x + (Math.random() - 0.5) * 200,
      y: this.floor.entrance.y + (Math.random() - 0.5) * 200,
      aim: 0,
      mvx: 0,
      mvy: 0,
      hp: PLAYER_MAX_HP,
      status,
      cds: {},
      lastSeq: 0,
      abilities: (rec?.abilities?.length ? rec.abilities : DEFAULT_ABILITIES).map((a) => ({ ...a })),
      ws,
      linkdead: false,
    };
  }

  private welcomeFlow(ws: WebSocket, playerId: string, token: string) {
    this.send(ws, { t: "welcome", you: playerId, token, world: WORLD, protocol: PROTOCOL_VERSION });
    this.send(ws, this.floorMsg());
    this.send(ws, this.runMsg());
  }

  private handleInput(player: PlayerState, ws: WebSocket, msg: ClientMsg) {
    if (msg.t === "ping") {
      this.send(ws, { t: "pong", ts: msg.ts });
      return;
    }
    if (player.status !== "alive") return; // spectators send no game input
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

    // Permadeath must be durable the instant it happens, not on the next
    // heartbeat — persist any player who died this tick.
    for (const e of this.events) {
      if (e.e === "death") {
        const dp = this.players.get(e.id);
        if (dp && dp.status === "spectator") this.persistPlayer(dp);
      }
    }

    // All living players reached the stairs -> descend early (the other advance
    // trigger is the alarm timeout). advanceFloor resets positions, so this
    // can't re-fire on the next tick.
    if (this.phase === "running") {
      let living = 0;
      let allAtStairs = true;
      for (const p of this.players.values()) {
        // Only CONNECTED living players consent to descend — a linkdead teammate
        // (frozen wherever they dropped) must not block the others.
        if (p.status !== "alive" || p.linkdead) continue;
        living++;
        if (!this.atStairs(p)) allAtStairs = false;
      }
      if (living > 0 && allAtStairs) this.advanceFloor();
    }

    this.broadcast();
    this.events = [];
    if (++this.ticksSincePersist >= PERSIST_EVERY) {
      this.ticksSincePersist = 0;
      this.persistHeartbeat();
    }
  }

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

  private persistPlayer(p: PlayerState) {
    try {
      this.ctx.storage.transactionSync(() => this.store.playerSync(this.recordOf(p)));
    } catch {
      /* never break the loop on a storage hiccup */
    }
  }

  private recordOf(p: PlayerState): PlayerRecord {
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
      if (p.status !== "alive") continue; // linkdead alive players ARE entities (targetable)
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
      if (p.linkdead) continue; // no live socket to send to
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
      state: {
        index: this.floor.index,
        phase: this.phase === "ended" ? "complete" : "active",
        endsAt: this.floorEndsAt, // wall-clock; client counts down via Date.now()
        livingAtStairs: this.atStairsCount(),
        living: this.aliveCount(),
      },
    };
  }
  private atStairsCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.status === "alive" && this.atStairs(p)) n++;
    return n;
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
