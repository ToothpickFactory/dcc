import { MONSTER_RESPAWN_MS, PLAYER_MAX_HP } from "../../shared/constants";
import type { BossState, MonsterState, PlayerState, WorldCtx } from "../state";

function isPlayer(t: PlayerState | MonsterState | BossState): t is PlayerState {
  return (t as PlayerState).status !== undefined;
}
function isBoss(t: PlayerState | MonsterState | BossState): t is BossState {
  return (t as BossState).tag === "boss";
}

// The single damage funnel. Friendly fire is just a player damaging a player —
// nothing special-cases it, because the server never trusts the client. This is
// the anti-cheat bedrock; keep ALL damage flowing through here.
export function applyDamage(
  ctx: WorldCtx,
  target: PlayerState | MonsterState | BossState,
  dmg: number,
  sourceId: string,
  sourceIsPlayer: boolean,
  // slowMs is plumbed through for Stream B's slow effect; Phase 0 ignores it.
  _slowMs = 0,
): void {
  if (isPlayer(target)) {
    if (target.status !== "alive") return;
    target.hp -= dmg;
    if (dmg >= 0) {
      ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: dmg });
      if (sourceIsPlayer && sourceId !== target.id) {
        ctx.pushPlay({ e: "friendlyFire", by: sourceId, amount: dmg });
      }
    } else {
      target.hp = Math.min(PLAYER_MAX_HP, target.hp);
      ctx.pushFx({ e: "heal", x: target.x, y: target.y, amount: -dmg });
      ctx.pushPlay({ e: "heal", by: sourceId, amount: -dmg, ally: sourceId !== target.id });
    }
    if (target.hp <= 0) {
      // PERMADEATH (Phase 0): no respawn — the player becomes a spectator.
      // Stream A / M1 ties this to the durable `alive` flag.
      target.status = "spectator";
      target.mvx = 0;
      target.mvy = 0;
      ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
      if (sourceIsPlayer && sourceId !== target.id) {
        ctx.pushPlay({ e: "kill", by: sourceId, targetKind: "player" });
      }
    }
    return;
  }

  if (isBoss(target)) {
    if (target.dead) return;
    if (sourceIsPlayer) target.threat.set(sourceId, (target.threat.get(sourceId) ?? 0) + dmg);
    target.hp -= dmg;
    ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: dmg });
    if (target.hp <= 0) {
      target.dead = true;
      ctx.pushFx({ e: "boss", x: target.x, y: target.y, state: "dead" });
      ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
    }
    return;
  }

  // Monster target.
  if (target.dead) return;
  if (sourceIsPlayer) {
    // Threat-based aggro (combat note): damage from a player draws aggro.
    target.threat.set(sourceId, (target.threat.get(sourceId) ?? 0) + dmg);
  }
  target.hp -= dmg;
  ctx.pushFx({ e: "dmg", x: target.x, y: target.y, amount: dmg });
  if (target.hp <= 0) {
    target.dead = true;
    target.respawnAt = ctx.now + MONSTER_RESPAWN_MS;
    ctx.pushFx({ e: "death", x: target.x, y: target.y, id: target.id });
    if (sourceIsPlayer) ctx.pushPlay({ e: "kill", by: sourceId, targetKind: "monster" });
  }
}
