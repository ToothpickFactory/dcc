import { DurableObject } from "cloudflare:workers";
import {
  BOSS_MAX_HP,
  BOSS_RADIUS,
  bossNameForDepth,
  LOOT_BAG_TTL,
  LOOT_REACH,
  MAX_FLOORS,
  MONSTER_KINDS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  TICK_MS,
} from "../shared/constants";
import type { Ability, MonsterKind, Rarity } from "../shared/types";
import {
  addItem,
  aggregateAttrs,
  carryCapacity,
  deriveStats,
  emptyInventory,
  equip,
  findCarried,
  removeAnywhere,
  sellValue,
  unequip,
  unequipBag,
  zeroAttrs,
  type InvResult,
  type Item,
} from "../shared/items";
import { recomputeMonster, recomputePlayer } from "./sim/stats";
import { generateItem, generatePotion, rollGearRarity } from "./loot/itemgen";
import { HeuristicLootEngine, type LootContext, type LootEngine } from "./loot/heuristic";
import { AiFlavorService, tableFlavor, type WorkersAiBinding } from "./loot/flavor";
import { DEFAULT_ABILITIES, starterAbilities } from "../shared/abilities";
import { ABILITY_NODES, EVOLUTIONS, HIT_XP, MONSTER_XP, PVP_KILL_XP, canEvolve, charLevelOf, evolveCost } from "../shared/skills";
import { PROTOCOL_VERSION } from "../protocol";
import type { ClientMsg, EntityDTO, GameEvent, RunPhase, SelfDTO, ServerMsg } from "../protocol";
import { generateFloor, rng } from "../procgen";
import { canOccupy, randomWalkablePosition } from "../procgen/collision";
import type { FloorDescriptor } from "../procgen/types";
import type { BossState, LootBagState, MonsterState, PlayerState, ProjectileState, WorldCtx } from "./state";
import type { PlaystyleEvent } from "./events";
import { stepPlayer } from "./sim/movement";
import { updateMonsters } from "./sim/monsters";
import { updateBoss } from "./sim/boss";
import { castAbility, stepProjectiles } from "./sim/projectiles";
import { applyHeal } from "./sim/combat";
import { HmacIdentity, type Identity } from "./identity";
import { SqlRunStore, type LeaderboardEntry, type PlayerRecord, type RunCheckpoint } from "./persistence";
import { MIGRATIONS, SCHEMA } from "./persistence/schema";
import { EmaProfileTracker, type ProfileTracker } from "./loot/profile";

const PERSIST_EVERY = Math.round(1000 / TICK_MS); // ~1 Hz heartbeat (every 20 ticks)
const FIRST_SEED = 0xdcc;
const MAX_ABILITY_SLOTS = 6; // base kit (4) + up to 2 granted; bounded under permadeath

// Per-kind chance that a monster drops a (fresh, floor-appropriate) gear item on
// death — trash rarely, elites/brutes often — so the floor isn't buried in loot.
const GEAR_DROP_CHANCE: Record<MonsterKind, number> = {
  swarm: 0.08,
  grunt: 0.12,
  ranged: 0.2,
  healer: 0.25,
  brute: 0.45,
};
const POTION_DROP_CHANCE = 0.35; // separate, frequent roll so healing stays available
const POTION_CD = 6000; // ms between drinks — heals are strong but not spammable
const LOOT_KILL_CHANCE = 0.06; // a normal kill drops loot only sometimes (select kills, decision #10)

// The single global world. It IS the authoritative server: a fixed-rate tick over
// in-memory state, persisted to the DO's SQLite so the run AND identities survive
// eviction/restart (M0 + M1).
export class MyDurableObject extends DurableObject<Env> implements WorldCtx {
  now = 0;
  players = new Map<string, PlayerState>();
  monsters: MonsterState[] = [];
  projectiles: ProjectileState[] = [];
  boss: BossState | null = null;
  lootBags: LootBagState[] = [];

  private events: GameEvent[] = [];
  private loop: ReturnType<typeof setInterval> | null = null;
  private bossSeq = 0;
  private lootBagSeq = 0;
  private itemSeq = 0;
  private gearRng: () => number = () => 0; // seeded per floor for monster/drop gear
  private ticksSincePersist = 0;
  private connected = 0; // open joined sockets; loop runs while > 0

  private identity: Identity;
  private profiles: ProfileTracker = new EmaProfileTracker();
  private loot: LootEngine = new HeuristicLootEngine();
  private lootStream: () => number = () => 0; // seeded per floor for deterministic grants
  private flavorSvc!: AiFlavorService; // LLM name/flavor (off the loop); falls open to a static table
  private flavorEnabled = false; // feature flag (env FLAVOR_ENABLED); default off
  private sql: SqlStorage;
  private store: SqlRunStore;
  // All-time per-player score, accumulated in memory and flushed to the durable
  // `leaderboard` table on the persist heartbeat (batches the frequent per-hit XP).
  private lb = new Map<string, { name: string; xp: number; floor: number; kills: number }>();
  floor!: FloorDescriptor; // set in the constructor's blockConcurrencyWhile (public: part of WorldCtx)
  private runId = "run-dev";
  private phase: RunPhase = "running";
  private floorEndsAt = 0; // wall-clock deadline of the current floor (mirrors the DO alarm)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.identity = new HmacIdentity(env.TOKEN_SIGNING_KEY);
    this.sql = ctx.storage.sql;
    for (const stmt of SCHEMA) this.sql.exec(stmt); // idempotent CREATE TABLE IF NOT EXISTS
    for (const stmt of MIGRATIONS) {
      try {
        this.sql.exec(stmt); // additive column adds; throws (ignored) if already applied
      } catch {
        /* column already exists */
      }
    }
    this.store = new SqlRunStore(this.sql);

    // Loot flavor (Stream E): Workers AI / Claude behind AI Gateway, flag-gated
    // and always failing open to the static table. Config is read defensively so
    // a missing binding/secret simply means "table only" — never a crash.
    const e = env as unknown as {
      AI?: WorkersAiBinding;
      FLAVOR_ENABLED?: string;
      AI_GATEWAY_ACCOUNT?: string;
      AI_GATEWAY_ID?: string;
      ANTHROPIC_API_KEY?: string;
    };
    this.flavorEnabled = e.FLAVOR_ENABLED === "1" || e.FLAVOR_ENABLED === "true";
    const gateway =
      e.AI_GATEWAY_ACCOUNT && e.AI_GATEWAY_ID && e.ANTHROPIC_API_KEY
        ? { accountId: e.AI_GATEWAY_ACCOUNT, gatewayId: e.AI_GATEWAY_ID, anthropicKey: e.ANTHROPIC_API_KEY }
        : undefined;
    this.flavorSvc = new AiFlavorService({ enabled: this.flavorEnabled, ai: e.AI, gateway, budgetPerFloor: 24 });

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
    this.seedLoot();
    this.spawnMonsters();
    this.spawnBoss();
    this.store.checkpointSync({ runId: this.runId, currentFloor: 1, seed: FIRST_SEED, phase: this.phase, savedAt: Date.now() });
  }

  private resumeRun(run: RunCheckpoint) {
    this.runId = run.runId;
    this.phase = isRunPhase(run.phase) ? run.phase : "running";
    this.floor = generateFloor(run.seed, run.currentFloor);
    this.seedLoot();
    this.spawnMonsters();
    this.spawnBoss();
  }

  // ---- WorldCtx hooks the sim modules call ----
  pushFx(e: GameEvent) {
    this.events.push(e);
  }
  pushPlay(e: PlaystyleEvent) {
    this.profiles.record(e);
    if (e.e === "kill" && e.targetKind === "monster") {
      // Loot drops on SOME kills, not every one (decision #10).
      const killer = this.players.get(e.by);
      if (killer && this.lootStream() < LOOT_KILL_CHANCE) {
        this.grantLoot(killer, "kill", this.lootStream() < 0.25 ? "uncommon" : "common");
      }
    }
  }

  // Spawn a loot bag holding (fresh-id copies of) the given items. Called by the
  // combat funnel whenever an entity dies. No-op for an empty drop.
  dropLoot(x: number, y: number, items: Item[]): void {
    if (items.length === 0) return;
    const copies = items.map((it) => ({ ...it, id: `i_${(++this.itemSeq).toString(36)}` }));
    this.lootBags.push({ id: `bag_${(++this.lootBagSeq).toString(36)}`, x, y, items: copies, expiresAt: Date.now() + LOOT_BAG_TTL });
  }

  // On monster death: chance-gated, floor-appropriate drops. NOT every kill drops
  // gear (per-kind odds — trash rarely, elites often), and when it does it's a
  // FRESH item rolled on the floor's rarity curve (not a copy of the monster's own
  // stat gear). Potions are a separate, frequent roll so healing stays available.
  rollDrops(m: MonsterState): void {
    const drops: Item[] = [];
    if (this.gearRng() < (GEAR_DROP_CHANCE[m.kind] ?? 0.12)) {
      drops.push(generateItem(this.floor.depth, rollGearRarity(this.floor.depth, this.gearRng), this.gearRng));
    }
    if (this.gearRng() < POTION_DROP_CHANCE) {
      drops.push(generatePotion(this.floor.depth, this.gearRng));
    }
    this.dropLoot(m.x, m.y, drops);
  }

  // Award XP to the ability that landed a hit/kill, plus character XP on kills.
  // Ability XP matures an ability toward its next evolution; character XP raises
  // the character level (passive HP). Both persist; permadeath wipes them.
  gainXp(playerId: string, idx: number, killed: boolean, kind?: MonsterKind | "boss"): void {
    const p = this.players.get(playerId);
    if (!p || p.status !== "alive") return;
    const ab = p.abilities[idx];
    if (!ab) return;
    const amount = killed ? (kind ? MONSTER_XP[kind] : PVP_KILL_XP) : HIT_XP;
    ab.xp = (ab.xp ?? 0) + amount;
    this.bumpLb(p, amount, killed); // all-time leaderboard score (every hit + kill)
    if (killed) {
      const before = charLevelOf(p.charXp);
      p.charXp += amount;
      if (charLevelOf(p.charXp) > before) {
        recomputePlayer(p); // new character level -> more max HP
        p.hp = p.derived.maxHp; // top off on level-up
      }
    }
  }

  // ---- Leaderboard accumulation (in memory; flushed on the persist heartbeat) ----

  // Lazily seed a player's running totals from the durable table (so all-time XP
  // continues across reconnects/runs). Called on join.
  private seedLb(playerId: string, name: string): void {
    if (this.lb.has(playerId)) return;
    const row = this.store.loadLeaderboardSync(playerId);
    this.lb.set(playerId, row
      ? { name: row.name, xp: row.lifetimeXp, floor: row.bestFloor, kills: row.kills }
      : { name, xp: 0, floor: 0, kills: 0 });
  }

  private bumpLb(p: PlayerState, dxp: number, killed: boolean): void {
    const r = this.lb.get(p.id) ?? { name: p.name, xp: 0, floor: 0, kills: 0 };
    r.name = p.name;
    r.xp += dxp;
    if (killed) r.kills += 1;
    this.lb.set(p.id, r);
  }

  private bumpLbFloor(p: PlayerState, depth: number): void {
    const r = this.lb.get(p.id) ?? { name: p.name, xp: 0, floor: 0, kills: 0 };
    r.name = p.name;
    if (depth > r.floor) r.floor = depth;
    this.lb.set(p.id, r);
  }

  // Write the in-memory totals to the durable table (idempotent absolute upserts).
  private flushLb(): void {
    const now = Date.now();
    for (const [playerId, r] of this.lb) {
      if (r.xp === 0 && r.floor === 0 && r.kills === 0) continue; // don't clutter the board with non-scorers
      this.store.leaderboardUpsertSync({ playerId, name: r.name, lifetimeXp: r.xp, bestFloor: r.floor, kills: r.kills, updatedAt: now });
    }
  }

  // RPC (GET /leaderboard): flush latest in-memory totals, then return the top N.
  topPlayers(limit = 20): LeaderboardEntry[] {
    try {
      this.ctx.storage.transactionSync(() => this.flushLb());
    } catch {
      /* fall through to whatever is already persisted */
    }
    return this.store.topLeaderboardSync(limit);
  }

  private spawnMonsters() {
    // Stream D's procgen stub spawns all grunts; until it emits varied kinds,
    // distribute archetypes so the per-kind behaviors are exercised. The moment
    // floor.spawns carry real variety (any non-grunt present), honor them as-is.
    const homogeneousGrunt = this.floor.spawns.every((s) => s.kind === "grunt");
    const VARIETY: MonsterKind[] = ["grunt", "brute", "swarm", "ranged", "swarm", "grunt"];
    this.monsters = this.floor.spawns.map((s, i) => {
      const kind = homogeneousGrunt ? VARIETY[i % VARIETY.length] : s.kind;
      const def = MONSTER_KINDS[kind];
      const base = zeroAttrs();
      return {
        id: `m_${i.toString(36)}`,
        kind,
        x: s.x,
        y: s.y,
        aim: 0,
        maxHp: def.hp,
        hp: def.hp,
        dead: false,
        respawnAt: 0,
        attackReadyAt: 0,
        wanderAt: 0,
        slowUntil: 0,
        base,
        inv: emptyInventory(),
        derived: deriveStats(def.hp, def.speed, base),
        threat: new Map(),
      };
    });
    for (const m of this.monsters) this.gearUpMonster(m);
  }

  // Give a monster 1-2 generated items (so kills actually drop loot), then fold
  // the gear into its stats and refill HP. Deterministic via the per-floor gear
  // stream. Brutes carry an extra piece.
  private gearUpMonster(m: MonsterState): void {
    const pieces = 1 + (m.kind === "brute" ? 1 : this.gearRng() < 0.4 ? 1 : 0);
    for (let i = 0; i < pieces; i++) {
      addItem(m.inv, generateItem(this.floor.depth, rollGearRarity(this.floor.depth, this.gearRng), this.gearRng));
    }
    recomputeMonster(m);
    m.hp = m.maxHp; // spawn at full HP including any vitality gear
  }

  private spawnBoss() {
    // The exit guardian starts near the stairs on every floor.
    const { x, y } = this.bossSpawnNearStairs();
    this.boss = {
      tag: "boss",
      id: `boss_${(++this.bossSeq).toString(36)}`,
      name: bossNameForDepth(this.floor.depth),
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

  private bossSpawnNearStairs(): { x: number; y: number } {
    const grid = this.floor.collision;
    const stairs = this.floor.stairs;
    const preferred = stairs.r + BOSS_RADIUS + 36;
    for (const radius of [preferred, preferred + 40, preferred + 80, preferred + 120]) {
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const x = stairs.x + Math.cos(angle) * radius;
        const y = stairs.y + Math.sin(angle) * radius;
        if (canOccupy(grid, x, y, BOSS_RADIUS)) return { x, y };
      }
    }
    return randomWalkablePosition(grid, BOSS_RADIUS, this.gearRng);
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
          abilities: starterAbilities(),
          base: zeroAttrs(), // fresh run = fresh character
          inv: emptyInventory(),
          gold: 0,
          charXp: 0,
          lastSeen: Date.now(),
        });
      }
    });

    this.runId = runId;
    this.phase = "running";
    this.floor = generateFloor(seed, 1);
    this.seedLoot();
    this.spawnMonsters();
    this.spawnBoss();
    this.projectiles = [];
    this.floorEndsAt = Date.now() + this.floor.durationMs;
    void this.ctx.storage.setAlarm(this.floorEndsAt);
    for (const p of this.players.values()) {
      // Leave p.linkdead as-is: a disconnected character stays frozen/targetable
      // in the new run and clears linkdead only when it reconnects.
      p.status = "alive";
      p.reached = false;
      p.gold = 0; // fresh run = fresh character: gold wiped with gear
      p.cds = {};
      p.mvx = 0;
      p.mvy = 0;
      p.slowUntil = 0;
      p.seen.clear();
      p.abilities = starterAbilities(); // fresh run = base sword + rocks, all skill progress wiped
      p.charXp = 0;
      p.base = zeroAttrs(); // fresh run = fresh character: gear wiped
      p.inv = emptyInventory();
      recomputePlayer(p);
      p.hp = p.derived.maxHp;
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

  // A player reached the stairs: pull them into the safe "waiting room" — they
  // leave the floor (excluded from the entity list), become invulnerable and
  // untargeted, and wait for the rest of the party (or the timer).
  private markReached(p: PlayerState): void {
    p.reached = true;
    p.mvx = 0;
    p.mvy = 0;
    for (const m of this.monsters) m.threat.delete(p.id);
    if (this.boss) this.boss.threat.delete(p.id);
  }

  // Timer expired: living players who didn't reach the stairs die (lethal timer,
  // decision #2), then the floor advances. Players already in the waiting room
  // (reached) are safe and survive.
  private timeoutExpire(): void {
    for (const p of this.players.values()) {
      if (p.status === "alive" && !p.reached) {
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
    // M4 floor_record: log the floor the survivors just cleared, before the depth
    // advances below. Survivor count is the party that reached the stairs in time.
    this.persistFloorComplete(this.floor.depth, survivors.length);
    // Floor-end reward — granted on the COMPLETED floor (its depth/theme/seed).
    for (const p of survivors) this.grantLoot(p, "floorEnd", this.floor.depth >= 10 ? "rare" : "uncommon");
    this.floor = generateFloor(this.floor.seed, this.floor.depth + 1); // same run seed, deeper
    this.seedLoot();
    this.spawnMonsters();
    this.spawnBoss();
    this.projectiles = [];
    for (const p of survivors) {
      p.x = this.floor.entrance.x + (Math.random() - 0.5) * 200;
      p.y = this.floor.entrance.y + (Math.random() - 0.5) * 200;
      p.mvx = 0;
      p.mvy = 0;
      p.slowUntil = 0;
      p.reached = false; // fresh floor: everyone back in play
      p.seen.clear(); // fresh floor = fresh exploration
      this.bumpLbFloor(p, this.floor.depth); // record deepest floor reached (all-time)
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

  // M4 floor_record: persist a cleared floor + survivor count. Guarded like
  // checkpoint() so a storage hiccup never breaks the run loop.
  private persistFloorComplete(floor: number, survivors: number): void {
    try {
      this.ctx.storage.transactionSync(() =>
        this.store.recordFloorCompleteSync({ runId: this.runId, floor, completedAt: Date.now(), survivors }),
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
    this.seedLb(playerId, finalName); // resume all-time leaderboard totals

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
      this.welcomeFlow(existing, token);
      this.startLoop();
      return existing;
    }

    // Dead in this run -> spectator only. This is what makes permadeath stick
    // across a reload: a valid token for a dead character cannot play.
    if (rec && !rec.alive) {
      const spec = this.makePlayer(playerId, finalName, ws, "spectator", rec);
      this.players.set(playerId, spec);
      this.connected++;
      this.welcomeFlow(spec, token);
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
    this.welcomeFlow(p, token);
    this.startLoop();
    return p;
  }

  private makePlayer(id: string, name: string, ws: WebSocket, status: "alive" | "spectator", rec: PlayerRecord | null): PlayerState {
    // Reconnects rehydrate their persisted gear; brand-new heroes get a kit below.
    const base = rec ? { ...rec.base } : zeroAttrs();
    const inv = rec ? rec.inv : emptyInventory();
    const p: PlayerState = {
      id,
      name,
      x: this.floor.entrance.x + (Math.random() - 0.5) * 200,
      y: this.floor.entrance.y + (Math.random() - 0.5) * 200,
      aim: 0,
      mvx: 0,
      mvy: 0,
      hp: PLAYER_MAX_HP,
      status,
      reached: false,
      gold: rec?.gold ?? 0, // carry persisted gold across reconnect/eviction
      cds: {},
      lastSeq: 0,
      abilities: (rec?.abilities?.length ? rec.abilities : starterAbilities()).map((a) => ({ ...a })),
      charXp: rec?.charXp ?? 0,
      slowUntil: 0,
      potionReadyAt: 0,
      seen: new Set(),
      base,
      inv,
      derived: deriveStats(PLAYER_MAX_HP, PLAYER_SPEED, base),
      ws,
      linkdead: false,
    };
    if (!rec) this.giveStarterKit(p); // brand-new hero gets a basic kit (INV-5 persists it)
    recomputePlayer(p); // fold in gear; clamps hp to derived maxHp
    if (!rec) p.hp = p.derived.maxHp; // start at full HP including gear
    return p;
  }

  // A fresh hero starts with a common weapon + chest + a small bag equipped, so
  // every character has gear from the start (and something to drop / be looted).
  private giveStarterKit(p: PlayerState): void {
    const kit = [
      generateItem(1, "common", this.gearRng, "weapon"),
      generateItem(1, "common", this.gearRng, "chest"),
      generateItem(1, "common", this.gearRng, "bag"),
    ];
    for (const it of kit) {
      addItem(p.inv, it);
      equip(p.inv, it.id);
    }
  }

  private welcomeFlow(p: PlayerState, token: string) {
    // Floors now vary in size (procgen scales with depth), so report the CURRENT
    // floor's dims rather than the legacy fixed WORLD constant.
    this.send(p.ws, { t: "welcome", you: p.id, token, world: { w: this.floor.w, h: this.floor.h }, protocol: PROTOCOL_VERSION });
    this.send(p.ws, this.floorMsg());
    this.send(p.ws, this.runMsg());
    this.sendInv(p); // initial character-screen state
  }

  private handleInput(player: PlayerState, ws: WebSocket, msg: ClientMsg) {
    if (msg.t === "ping") {
      this.send(ws, { t: "pong", ts: msg.ts });
      return;
    }
    if (player.status !== "alive") return; // spectators send no game input
    if (msg.t === "input") {
      if (player.reached) return; // in the waiting room — no movement
      player.mvx = clampUnit(msg.mv?.[0] ?? 0);
      player.mvy = clampUnit(msg.mv?.[1] ?? 0);
      player.aim = Number(msg.aim) || 0;
      player.lastSeq = msg.seq | 0;
    } else if (msg.t === "cast") {
      if (player.reached) return; // in the waiting room — no casting
      player.aim = Number(msg.aim) || 0;
      player.lastSeq = msg.seq | 0;
      castAbility(this, player, msg.ability | 0, player.aim);
    } else if (msg.t === "sell") {
      this.sellItem(player, String(msg.item));
    } else if (msg.t === "equip") {
      this.applyInv(player, () => equip(player.inv, String(msg.item)));
    } else if (msg.t === "unequip") {
      this.applyInv(player, () => unequip(player.inv, msg.slot));
    } else if (msg.t === "unequipBag") {
      this.applyInv(player, () => unequipBag(player.inv, msg.index | 0));
    } else if (msg.t === "drop") {
      this.dropItem(player, String(msg.item));
    } else if (msg.t === "useItem") {
      this.useItem(player, String(msg.item));
    } else if (msg.t === "openLoot") {
      this.openLoot(player, String(msg.bag));
    } else if (msg.t === "takeLoot") {
      this.takeLoot(player, String(msg.bag), msg.item ? String(msg.item) : undefined);
    } else if (msg.t === "swapAbility") {
      this.swapAbility(player, msg.a | 0, msg.b | 0);
    } else if (msg.t === "evolve") {
      this.evolveAbility(player, msg.slot | 0, String(msg.to));
    }
  }

  // Reorder the action bar (e.g. move a found ability into the auto-cast slot).
  // Cooldowns move with the slot index so a swap can't reset a cooldown.
  private swapAbility(p: PlayerState, a: number, b: number): void {
    const n = p.abilities.length;
    if (a < 0 || b < 0 || a >= n || b >= n || a === b) return;
    [p.abilities[a], p.abilities[b]] = [p.abilities[b], p.abilities[a]];
    const ca = p.cds[a] ?? 0;
    p.cds[a] = p.cds[b] ?? 0;
    p.cds[b] = ca;
    this.persistPlayer(p);
  }

  // Evolve a matured ability into a chosen branch. Server-authoritative: checks
  // the ability is ready and `to` is a real branch of its current node, then
  // swaps in the new node (tier++, xp reset, ammo refilled by the node default).
  private evolveAbility(p: PlayerState, slot: number, to: string): void {
    const ab = p.abilities[slot];
    if (!ab || !canEvolve(ab)) return;
    if (!(EVOLUTIONS[ab.id] ?? []).includes(to)) return;
    const node = ABILITY_NODES[to];
    if (!node) return;
    p.abilities[slot] = { ...node, tier: (ab.tier ?? 0) + 1, xp: 0 };
    this.persistPlayer(p);
  }

  // ---- Inventory actions (server-authoritative; never trust the client) ----
  private sendInv(p: PlayerState): void {
    if (p.linkdead) return;
    this.send(p.ws, { t: "inv", inv: p.inv, attrs: aggregateAttrs(p.base, p.inv), derived: p.derived, capacity: carryCapacity(p.inv), gold: p.gold });
  }

  // Run an inventory mutation; on success, refold stats + persist + push the
  // updated character screen. Failures (full bag, bad slot) are silently ignored.
  private applyInv(p: PlayerState, action: () => InvResult): void {
    if (p.status !== "alive") return;
    if (action().ok) {
      recomputePlayer(p);
      this.persistPlayer(p);
      this.sendInv(p);
    }
  }

  private dropItem(p: PlayerState, itemId: string): void {
    const it = removeAnywhere(p.inv, itemId);
    if (!it) return;
    this.dropLoot(p.x, p.y, [it]);
    recomputePlayer(p);
    this.persistPlayer(p);
    this.sendInv(p);
  }

  // Drink/use a carried consumable (e.g. a potion). Server-authoritative: validates
  // it's a consumable and off cooldown, applies the heal to SELF, removes the item.
  private useItem(p: PlayerState, itemId: string): void {
    if (p.status !== "alive" || p.reached) return; // not while dead or in the waiting room
    if (this.now < p.potionReadyAt) return; // shared consumable cooldown
    const idx = findCarried(p.inv, itemId);
    if (idx < 0) return;
    const it = p.inv.carried[idx]!;
    if (!it.consumable) return; // only consumables are drinkable
    const amount = it.consumable.heal ?? Math.round(p.derived.maxHp * (it.consumable.healPct ?? 0));
    if (amount <= 0) return;
    p.inv.carried.splice(idx, 1); // consume it
    p.potionReadyAt = this.now + POTION_CD;
    applyHeal(this, p, amount, p.id); // clamps to maxHp, pushes the heal fx
    this.persistPlayer(p);
    this.sendInv(p);
  }

  // Sell a CARRIED item for gold — a waiting-room action (you must be "reached").
  // Equipped gear must be unequipped first; selling never touches worn stats.
  private sellItem(p: PlayerState, itemId: string): void {
    if (p.status !== "alive" || !p.reached) return;
    const idx = findCarried(p.inv, itemId);
    if (idx < 0) return;
    const [it] = p.inv.carried.splice(idx, 1);
    p.gold += sellValue(it);
    this.persistPlayer(p);
    this.sendInv(p);
  }

  private bagInReach(p: PlayerState, bagId: string): LootBagState | null {
    const bag = this.lootBags.find((b) => b.id === bagId);
    if (!bag || Math.hypot(bag.x - p.x, bag.y - p.y) > LOOT_REACH) return null;
    return bag;
  }

  private openLoot(p: PlayerState, bagId: string): void {
    const bag = this.bagInReach(p, bagId);
    if (bag && !p.linkdead) this.send(p.ws, { t: "bag", id: bag.id, items: bag.items });
  }

  // Take a specific item (or everything that fits) from a nearby bag.
  private takeLoot(p: PlayerState, bagId: string, itemId?: string): void {
    const bag = this.bagInReach(p, bagId);
    if (!bag) return;
    let changed = false;
    if (itemId) {
      const idx = bag.items.findIndex((i) => i.id === itemId);
      if (idx >= 0 && addItem(p.inv, bag.items[idx])) {
        bag.items.splice(idx, 1);
        changed = true;
      }
    } else {
      while (bag.items.length && addItem(p.inv, bag.items[0])) {
        bag.items.shift();
        changed = true;
      }
    }
    if (changed) {
      recomputePlayer(p);
      this.persistPlayer(p);
      this.sendInv(p);
      if (!p.linkdead) this.send(p.ws, { t: "bag", id: bag.id, items: bag.items }); // refresh (despawns when empty)
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
    for (const p of this.players.values()) stepPlayer(this, p, dt);
    updateMonsters(this, dt);
    updateBoss(this, dt);
    for (const p of this.players.values()) if (p.status === "alive") this.autoCast(p);
    stepProjectiles(this, dt);

    // Despawn expired loot bags so a long floor doesn't litter forever.
    if (this.lootBags.length) {
      const nowMs = Date.now();
      this.lootBags = this.lootBags.filter((b) => b.expiresAt > nowMs && b.items.length > 0);
    }

    // Permadeath must be durable the instant it happens, not on the next
    // heartbeat — persist any player who died this tick.
    for (const e of this.events) {
      if (e.e === "death") {
        const dp = this.players.get(e.id);
        if (dp && dp.status === "spectator") this.persistPlayer(dp);
      } else if (e.e === "boss" && e.state === "dead" && this.boss) {
        // The boss is a guaranteed, big drop for whoever did the most damage.
        const id = this.topThreat(this.boss.threat);
        const winner = id ? this.players.get(id) : null;
        if (winner) this.grantLoot(winner, "kill", this.floor.depth >= 10 ? "legendary" : "epic");
        // ...and a hoard for the whole party — a great-gear bag at its lair, so a
        // group is rewarded together, not just the top-damage hero (PG-4).
        const bossRarity: Rarity = this.floor.depth >= 10 ? "legendary" : "epic";
        const hoard = Array.from({ length: 3 + Math.floor(this.gearRng() * 3) }, () =>
          generateItem(this.floor.depth, this.gearRng() < 0.5 ? bossRarity : "rare", this.gearRng),
        );
        this.dropLoot(this.boss.x, this.boss.y, hoard);
      }
    }

    // All living players reached the stairs -> descend early (the other advance
    // trigger is the alarm timeout). advanceFloor resets positions, so this
    // can't re-fire on the next tick.
    if (this.phase === "running") {
      let living = 0;
      let allReached = true;
      for (const p of this.players.values()) {
        // Only CONNECTED living players consent to descend — a linkdead teammate
        // (frozen wherever they dropped) must not block the others.
        if (p.status !== "alive" || p.linkdead) continue;
        // Latch: the instant you touch the stairs you're "done" — safe in the
        // waiting room. You don't have to stay on the tile.
        if (!p.reached && this.atStairs(p)) this.markReached(p);
        living++;
        if (!p.reached) allReached = false;
      }
      // Advance once EVERY living player has reached (stragglers are killed by the
      // floor timer in timeoutExpire, which then advances).
      if (living > 0 && allReached) this.advanceFloor();
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
        this.flushLb(); // persist all-time leaderboard totals (batched)
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
      base: p.base,
      inv: p.inv,
      gold: p.gold,
      charXp: p.charXp,
      lastSeen: Date.now(),
    };
  }

  // ---- Loot (Stream E / M5) ----
  private seedLoot(): void {
    // Deterministic per-floor stream: a given floor + grant order = the same drops.
    this.lootStream = rng((this.floor.seed * 2654435761 + this.floor.depth * 40503) >>> 0);
    this.gearRng = rng((this.floor.seed * 374761393 + this.floor.depth * 668265263) >>> 0);
    this.flavorSvc.resetFloorBudget(); // per-floor LLM spend cap
  }

  // Heuristic loot for a player: profile -> playable Ability the same tick, then
  // slot it, persist, and push the wire event (the LLM flavor arrives later, off
  // the loop). The class label is recomputed live in broadcast/recordOf.
  private grantLoot(p: PlayerState, trigger: LootContext["trigger"], rarity: Rarity): void {
    if (p.status !== "alive") return;
    const lctx: LootContext = { trigger, depth: this.floor.depth, rarity, theme: this.floor.theme, rng: this.lootStream };
    const ability = this.loot.grant(this.profiles.get(p.id), lctx);
    // Instant static flavor so every drop is named + playable the same tick.
    const tf = tableFlavor(ability.category, rarity, this.floor.theme);
    ability.name = tf.name;
    ability.flavor = tf.flavor;
    ability.twist = tf.twist;
    this.slotLoot(p, ability);
    this.persistPlayer(p);
    if (!p.linkdead) this.send(p.ws, { t: "loot", grant: { id: ability.id, ability, rarity, flavor: tf } });
    // Optional LLM upgrade — OFF the tick, fail-open, sends a follow-up if better.
    if (this.flavorEnabled) this.flavorize(p, ability, rarity);
  }

  // Fire-and-forget: ask the model for a richer name/flavor and, if it returns
  // something different from the table, patch the ability and push a follow-up
  // `loot` event (the client merges by grant id). Never awaited in the loop.
  private flavorize(p: PlayerState, ability: Ability, rarity: Rarity): void {
    const theme = this.floor.theme;
    void this.flavorSvc
      .flavor(ability.category, rarity, theme)
      .then((fl) => {
        if (!fl || fl.name === ability.name) return; // table already applied
        ability.name = fl.name;
        ability.flavor = fl.flavor;
        ability.twist = fl.twist;
        this.persistPlayer(p);
        if (!p.linkdead) this.send(p.ws, { t: "loot", grant: { id: ability.id, ability, rarity, flavor: fl } });
      })
      .catch(() => {
        /* table flavor already shipped; an LLM failure is invisible */
      });
  }

  // Bounded slots under permadeath: the 4-ability starting kit (0-3) is never
  // overwritten; grants fill the two extra slots, then replace the weakest extra
  // (preferring same-category) so power can't grow unbounded.
  private slotLoot(p: PlayerState, ability: Ability): void {
    const BASE = DEFAULT_ABILITIES.length;
    if (p.abilities.length < MAX_ABILITY_SLOTS) {
      p.abilities.push(ability);
      return;
    }
    let target = BASE;
    let worst = Infinity;
    for (let i = BASE; i < p.abilities.length; i++) {
      const a = p.abilities[i];
      const score = Math.abs(a.dmg) + (a.category === ability.category ? -1000 : 0);
      if (score < worst) {
        worst = score;
        target = i;
      }
    }
    p.abilities[target] = ability;
  }

  // Slot-1 AUTO-CAST: the first action ability auto-swings/throws at the nearest
  // foe in its range whenever it's off cooldown (and has ammo). Targets monsters
  // and the boss only — never allies.
  private autoCast(p: PlayerState): void {
    const ab = p.abilities[0];
    if (!ab) return;
    if ((p.cds[0] ?? 0) > this.now) return;
    if (ab.ammo !== undefined && ab.ammo <= 0) return;
    const target = this.nearestEnemy(p.x, p.y, ab.range);
    if (target) castAbility(this, p, 0, Math.atan2(target.y - p.y, target.x - p.x));
  }

  private nearestEnemy(x: number, y: number, range: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = range * range;
    for (const m of this.monsters) {
      if (m.dead) continue;
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (this.boss && !this.boss.dead) {
      const d = (this.boss.x - x) ** 2 + (this.boss.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = this.boss;
      }
    }
    return best;
  }

  private topThreat(threat: Map<string, number>): string | null {
    let best: string | null = null;
    let bestV = 0;
    for (const [id, v] of threat) {
      if (v > bestV) {
        bestV = v;
        best = id;
      }
    }
    return best;
  }

  private broadcast() {
    const ents: EntityDTO[] = [];
    for (const p of this.players.values()) {
      if (p.status !== "alive" || p.reached) continue; // reached players left the floor for the waiting room
      ents.push({
        id: p.id,
        kind: "player",
        x: r(p.x),
        y: r(p.y),
        aim: r2(p.aim),
        hp: Math.max(0, r(p.hp)),
        maxHp: Math.round(p.derived.maxHp),
        name: p.name,
        cls: this.profiles.classOf(p.id),
      });
    }
    for (const m of this.monsters) {
      if (m.dead) continue;
      ents.push({ id: m.id, kind: "monster", x: r(m.x), y: r(m.y), aim: r2(m.aim), hp: Math.max(0, r(m.hp)), maxHp: m.maxHp });
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
    for (const b of this.lootBags) {
      ents.push({ id: b.id, kind: "lootbag", x: r(b.x), y: r(b.y), n: b.items.length });
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
        maxHp: Math.round(p.derived.maxHp),
        ack: p.lastSeq,
        cds: p.cds,
        cls: this.profiles.classOf(p.id),
        profile: this.profiles.get(p.id),
        derived: p.derived,
        abilities: p.abilities,
        charXp: p.charXp,
        status: p.status,
        reached: p.reached,
        lifetimeXp: this.lb.get(p.id)?.xp ?? 0,
        bestFloor: this.lb.get(p.id)?.floor ?? 0,
        kills: this.lb.get(p.id)?.kills ?? 0,
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
      // Static geometry for non-procgen clients (Godot). The browser ignores it.
      geometry: {
        gw: this.floor.collision.w,
        gh: this.floor.collision.h,
        cell: this.floor.collision.cell,
        solid: encodeSolid(this.floor.collision.solid),
        entrance: this.floor.entrance,
        stairs: this.floor.stairs,
        decorations: this.floor.decorations,
      },
    };
  }
  // Count players who've reached the stairs (now in the waiting room). Sent as
  // `livingAtStairs` so the client shows "N reached / waiting for the rest".
  private atStairsCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.status === "alive" && p.reached) n++;
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

// Base64-encode the collision grid (1 byte/cell) for the floor message. `btoa` is
// a Workers global; ~900 bytes -> ~1.2 KB, sent once per floor change. Godot decodes
// with Marshalls.base64_to_raw().
function encodeSolid(solid: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < solid.length; i++) bin += String.fromCharCode(solid[i]);
  return btoa(bin);
}
