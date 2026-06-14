import { DurableObject } from "cloudflare:workers";
import { CLIENT_HTML } from "./client";

/**
 * DCC — multiplayer top-down ARPG foundation.
 *
 * Architecture:
 *  - The Worker (default export) serves the client HTML and upgrades the
 *    `/ws` route into a WebSocket connected to the shared game world.
 *  - A single Durable Object instance (named "world") is the authoritative
 *    game server: it owns all player/monster state, runs a fixed-rate
 *    simulation tick, and broadcasts world snapshots to every connected
 *    client. Everyone who visits the same Worker joins the same world.
 *
 * This is intentionally a foundation — one shared world, simple AI, a handful
 * of abilities — meant for shared playtesting, not final game balance.
 */

// ---- Tunable game constants ----
const TICK_MS = 50; // 20 ticks/sec
const WORLD = { w: 2400, h: 2400 };
const PLAYER_SPEED = 230; // px/sec
const MONSTER_SPEED = 95;
const PLAYER_MAX_HP = 100;
const MONSTER_MAX_HP = 60;
const MONSTER_COUNT = 8;
const MONSTER_AGGRO = 360;
const MONSTER_MELEE_RANGE = 56;
const MONSTER_ATTACK_CD = 1200;
const MONSTER_DMG = 6;
const PLAYER_RESPAWN_MS = 4000;
const MONSTER_RESPAWN_MS = 6000;
const PROJECTILE_SPEED = 620;

interface Ability {
  cd: number; // cooldown ms
  range: number; // max cast range (0 = self)
  dmg: number; // damage applied (negative = heal)
  projectile: boolean;
  slowMs?: number;
}

// Index matches the client's ability bar (keys 1-4).
const ABILITIES: Ability[] = [
  { cd: 900, range: 460, dmg: 18, projectile: true }, // 1 Fireball
  { cd: 1600, range: 420, dmg: 12, projectile: true, slowMs: 1500 }, // 2 Frostbolt
  { cd: 5000, range: 0, dmg: -34, projectile: false }, // 3 Heal (self)
  { cd: 600, range: 110, dmg: 11, projectile: false }, // 4 Smite (melee)
];

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  tx: number; // move target
  ty: number;
  hp: number;
  dead: boolean;
  respawnAt: number;
  slowUntil: number;
  kills: number;
  cds: Record<number, number>; // ability index -> ready-at (logical ms)
  ws: WebSocket;
}

interface Monster {
  id: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  hp: number;
  dead: boolean;
  respawnAt: number;
  attackReadyAt: number;
  wanderAt: number;
}

interface Projectile {
  id: string;
  x: number;
  y: number;
  ownerId: string;
  targetId: string;
  ability: number;
  dmg: number;
  slowMs: number;
}

type GameEvent =
  | { type: "dmg"; x: number; y: number; amount: number }
  | { type: "heal"; x: number; y: number; amount: number }
  | { type: "death"; x: number; y: number }
  | { type: "cast"; x: number; y: number; color: string };

export class MyDurableObject extends DurableObject<Env> {
  private players = new Map<string, Player>();
  private monsters: Monster[] = [];
  private projectiles: Projectile[] = [];
  private events: GameEvent[] = [];
  private now = 0; // logical clock (ms), advances by TICK_MS each tick
  private seq = 0; // id counter
  private loop: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.spawnMonsters();
  }

  private nextId(prefix: string): string {
    return prefix + "_" + (++this.seq).toString(36);
  }

  private spawnMonsters() {
    for (let i = 0; i < MONSTER_COUNT; i++) {
      this.monsters.push({
        id: this.nextId("m"),
        x: 200 + Math.random() * (WORLD.w - 400),
        y: 200 + Math.random() * (WORLD.h - 400),
        tx: 0,
        ty: 0,
        hp: MONSTER_MAX_HP,
        dead: false,
        respawnAt: 0,
        attackReadyAt: 0,
        wanderAt: 0,
      });
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

    const id = this.nextId("p");
    const player: Player = {
      id,
      name: "Hero",
      x: WORLD.w / 2 + (Math.random() - 0.5) * 200,
      y: WORLD.h / 2 + (Math.random() - 0.5) * 200,
      tx: 0,
      ty: 0,
      hp: PLAYER_MAX_HP,
      dead: false,
      respawnAt: 0,
      slowUntil: 0,
      kills: 0,
      cds: {},
      ws: server,
    };
    player.tx = player.x;
    player.ty = player.y;

    server.addEventListener("message", (ev) => {
      try {
        this.onMessage(player, JSON.parse(ev.data as string));
      } catch {
        /* ignore malformed input */
      }
    });
    const drop = () => {
      this.players.delete(id);
      this.projectiles = this.projectiles.filter((p) => p.ownerId !== id);
      if (this.players.size === 0) this.stopLoop();
    };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    this.players.set(id, player);
    this.startLoop();

    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(player: Player, msg: any) {
    if (msg.t === "join") {
      player.name = String(msg.name || "Hero").slice(0, 16);
      this.sendTo(player, { t: "welcome", id: player.id, world: WORLD });
      return;
    }
    if (player.dead) return;
    if (msg.t === "move") {
      player.tx = clamp(Number(msg.x) || 0, 0, WORLD.w);
      player.ty = clamp(Number(msg.y) || 0, 0, WORLD.h);
    } else if (msg.t === "cast") {
      this.castAbility(player, Number(msg.ability), msg.target ? String(msg.target) : null);
    }
  }

  private castAbility(caster: Player, idx: number, targetId: string | null) {
    const ab = ABILITIES[idx];
    if (!ab) return;
    if ((caster.cds[idx] || 0) > this.now) return; // on cooldown

    // Self-target heal — no target needed.
    if (ab.dmg < 0 && ab.range === 0) {
      caster.cds[idx] = this.now + ab.cd;
      caster.hp = Math.min(PLAYER_MAX_HP, caster.hp - ab.dmg);
      this.events.push({ type: "cast", x: caster.x, y: caster.y, color: "#5dff9b" });
      this.events.push({ type: "heal", x: caster.x, y: caster.y, amount: -ab.dmg });
      return;
    }

    // Targeted abilities require a valid, in-range target before committing.
    const target = this.findTarget(targetId);
    if (!target) return;
    const dist = Math.hypot(target.x - caster.x, target.y - caster.y);
    if (dist > ab.range + 40) return; // out of range

    caster.cds[idx] = this.now + ab.cd;
    this.events.push({ type: "cast", x: caster.x, y: caster.y, color: "#8aa0ff" });

    if (ab.projectile) {
      this.projectiles.push({
        id: this.nextId("pr"),
        x: caster.x,
        y: caster.y,
        ownerId: caster.id,
        targetId: target.id,
        ability: idx,
        dmg: ab.dmg,
        slowMs: ab.slowMs || 0,
      });
    } else {
      this.applyDamage(target, ab.dmg, caster, ab.slowMs || 0);
    }
  }

  private findTarget(id: string | null): Player | Monster | null {
    if (!id) return null;
    const p = this.players.get(id);
    if (p && !p.dead) return p;
    const m = this.monsters.find((mo) => mo.id === id);
    if (m && !m.dead) return m;
    return null;
  }

  private applyDamage(target: Player | Monster, dmg: number, source: Player, slowMs: number) {
    if ("kills" in target) {
      // target is a player
      target.hp -= dmg;
      if (slowMs) target.slowUntil = Math.max(target.slowUntil, this.now + slowMs);
      this.events.push({ type: "dmg", x: target.x, y: target.y, amount: dmg });
      if (target.hp <= 0 && !target.dead) this.killPlayer(target, source);
    } else {
      target.hp -= dmg;
      this.events.push({ type: "dmg", x: target.x, y: target.y, amount: dmg });
      if (target.hp <= 0 && !target.dead) {
        target.dead = true;
        target.respawnAt = this.now + MONSTER_RESPAWN_MS;
        this.events.push({ type: "death", x: target.x, y: target.y });
        source.kills += 1;
      }
    }
  }

  private killPlayer(target: Player, source: Player) {
    target.dead = true;
    target.respawnAt = this.now + PLAYER_RESPAWN_MS;
    this.events.push({ type: "death", x: target.x, y: target.y });
    if (source.id !== target.id) source.kills += 1;
  }

  // ---- Simulation loop ----
  private startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), TICK_MS);
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

    // Players: respawn + movement.
    for (const p of this.players.values()) {
      if (p.dead) {
        if (this.now >= p.respawnAt) {
          p.dead = false;
          p.hp = PLAYER_MAX_HP;
          p.x = WORLD.w / 2 + (Math.random() - 0.5) * 200;
          p.y = WORLD.h / 2 + (Math.random() - 0.5) * 200;
          p.tx = p.x;
          p.ty = p.y;
        }
        continue;
      }
      const speed = PLAYER_SPEED * (p.slowUntil > this.now ? 0.5 : 1);
      moveToward(p, p.tx, p.ty, speed * dt);
    }

    // Monsters: respawn, AI, attack.
    for (const m of this.monsters) {
      if (m.dead) {
        if (this.now >= m.respawnAt) {
          m.dead = false;
          m.hp = MONSTER_MAX_HP;
          m.x = 200 + Math.random() * (WORLD.w - 400);
          m.y = 200 + Math.random() * (WORLD.h - 400);
        }
        continue;
      }
      const prey = this.nearestPlayer(m.x, m.y, MONSTER_AGGRO);
      if (prey) {
        const d = Math.hypot(prey.x - m.x, prey.y - m.y);
        if (d <= MONSTER_MELEE_RANGE) {
          if (this.now >= m.attackReadyAt) {
            m.attackReadyAt = this.now + MONSTER_ATTACK_CD;
            prey.hp -= MONSTER_DMG;
            this.events.push({ type: "dmg", x: prey.x, y: prey.y, amount: MONSTER_DMG });
            if (prey.hp <= 0 && !prey.dead) this.killPlayer(prey, prey);
          }
        } else {
          moveToward(m, prey.x, prey.y, MONSTER_SPEED * dt);
        }
      } else {
        // Wander.
        if (this.now >= m.wanderAt) {
          m.wanderAt = this.now + 2000 + Math.random() * 3000;
          m.tx = clamp(m.x + (Math.random() - 0.5) * 600, 0, WORLD.w);
          m.ty = clamp(m.y + (Math.random() - 0.5) * 600, 0, WORLD.h);
        }
        moveToward(m, m.tx, m.ty, MONSTER_SPEED * 0.6 * dt);
      }
    }

    // Projectiles: home toward target's current position; apply on hit.
    const owners = this.players;
    this.projectiles = this.projectiles.filter((pr) => {
      const target = this.findTarget(pr.targetId);
      if (!target) return false; // target gone
      const dx = target.x - pr.x;
      const dy = target.y - pr.y;
      const dist = Math.hypot(dx, dy);
      const step = PROJECTILE_SPEED * dt;
      if (dist <= step + 20) {
        const owner = owners.get(pr.ownerId);
        if (owner) this.applyDamage(target, pr.dmg, owner, pr.slowMs);
        return false;
      }
      pr.x += (dx / dist) * step;
      pr.y += (dy / dist) * step;
      return true;
    });

    this.broadcast();
    this.events = [];
  }

  private nearestPlayer(x: number, y: number, maxDist: number): Player | null {
    let best: Player | null = null;
    let bestD = maxDist * maxDist;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private broadcast() {
    const snapshot = {
      t: "state",
      now: this.now,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        x: Math.round(p.x),
        y: Math.round(p.y),
        hp: Math.max(0, Math.round(p.hp)),
        maxHp: PLAYER_MAX_HP,
        dead: p.dead,
        kills: p.kills,
      })),
      monsters: this.monsters.map((m) => ({
        id: m.id,
        x: Math.round(m.x),
        y: Math.round(m.y),
        hp: Math.max(0, Math.round(m.hp)),
        maxHp: MONSTER_MAX_HP,
        dead: m.dead,
      })),
      projectiles: this.projectiles.map((pr) => ({
        id: pr.id,
        x: Math.round(pr.x),
        y: Math.round(pr.y),
        ability: pr.ability,
      })),
      events: this.events,
    };
    const data = JSON.stringify(snapshot);
    for (const p of this.players.values()) {
      // Per-player cooldown view appended so each client can render its bar.
      try {
        p.ws.send(data.slice(0, -1) + ',"cds":' + JSON.stringify(p.cds) + "}");
      } catch {
        /* socket closing */
      }
    }
  }

  private sendTo(player: Player, msg: unknown) {
    try {
      player.ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function moveToward(e: { x: number; y: number }, tx: number, ty: number, step: number) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d <= step || d === 0) {
    e.x = tx;
    e.y = ty;
  } else {
    e.x += (dx / d) * step;
    e.y += (dy / d) * step;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      // Everyone joins the same shared world.
      const stub = env.MY_DURABLE_OBJECT.getByName("world");
      return stub.fetch(request);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(CLIENT_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
