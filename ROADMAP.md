# DCC — Lead Architect Roadmap: The Infinite Descent

*Prepared for the product owner. Synthesizes the netcode/scale, 3D-client, core-loop, procedural-gen, AI-loot, and persistence/identity subsystem designs against two adversarial verdicts. The verdict on scale was honest and partly damning — it is folded in, not buried. Decisions locked 2026-06-14 are recorded at the bottom and already reflected in the milestones.*

---

## Where we are

We have a working, server-authoritative real-time foundation. That is more than most projects this early, and it is the right skeleton. But it is a *single-floor demo*, not the game in the brief.

**What exists today (Cloudflare Worker at repo root, TypeScript):**

- **One global world DO.** `src/index.ts` routes every `/ws` connection through `env.MY_DURABLE_OBJECT.getByName('world')`. Everyone shares one authoritative `MyDurableObject`. This is the correct MVP default — keep it.
- **Authoritative 20 Hz sim.** A `setInterval(this.tick, TICK_MS)` (TICK_MS=50) advances movement, monster AI, and projectiles in-memory (`Map`s of players/monsters/projectiles). The server owns all state — clients send intent only.
- **Friendly fire already works** because `applyDamage` is server-side and never trusts the client. This is the trust mechanic, already live. Do not regress it.
- **Full-snapshot broadcast.** Each tick, `broadcast()` `JSON.stringify`s the *entire* world (every player + monster + projectile + events) and sends it to *every* socket, with per-client cooldowns appended via a string-slice hack. This is O(N²) egress.
- **2D canvas client** (`client.ts`): interpolates the last two snapshots, click-to-move + click-to-target + keys 1–4, four hardcoded homing abilities. Carries the right instinct in a comment: *"Swap the canvas for 3D without changing the server protocol."*
- **SQLite provisioned but unused.** `wrangler.jsonc` declares `new_sqlite_classes: ["MyDurableObject"]` (migration v1), `nodejs_compat`, observability on. Storage is available — every `Map` is still pure RAM.

**The gaps between this and the vision:**

| Vision requirement | Today | Severity |
|---|---|---|
| Permadeath, one life | Respawn timer (`PLAYER_RESPAWN_MS`); reload = alive again, new id | **Core rule violated** |
| Timed floors, stairs, global progression | None — one infinite floor | Missing |
| Procedural generation, themed floors | Fixed 2400×2400, center spawn | Missing |
| 3D in the browser | 2D canvas | Missing (renderer-only) |
| WASD + mouselook + ballistic aim | Click-to-move + homing-to-target | Combat-model change |
| Emergent roles / AI loot | 4 hardcoded abilities | Missing |
| Survives DO eviction | In-memory only | **Run-loss risk** |
| Scales to 100s–1000s | Full-snapshot-to-all | Won't scale |

The most important framing: **the foundation is sound and should be EVOLVED, not rewritten.** The server protocol is renderer-agnostic (positions + events, not pixels), so 3D is decoupled. The authoritative sim is the anti-cheat bedrock. The single DO is the right starting rung. The one chunk that is genuinely a *change* rather than an *addition* is the combat model: ballistic aiming (decision #4) replaces target-select homing.

---

## Target architecture

The end state preserves *one logical worldwide run* (single timeline, single floor progression, global completion events) while distributing the *physical* realtime sim so no single Durable Object hits its ceiling. The adversarial verdict forced one honest downgrade, now accepted (decision #1): **"one instance worldwide" is a logical guarantee enforced by a Coordinator, not one physical realtime sim for the whole planet.**

```
                            BROWSER 3D CLIENT (Three.js / WebGPU + WebGL2 fallback)
                            - billboard SPRITES from atlases (Doom-like); predicts LOCAL player only
                            - WASD move + mouselook + BALLISTIC aim; ally/enemy color coding
                            - interpolation buffer (remote entities ~100ms in past)
                                          |
                                   WebSocket (binary delta protocol)
                                          |
              ┌───────────────────────────┴───────────────────────────┐
              │            CLOUDFLARE WORKER (edge, every PoP)          │
              │  - serves client + sprite atlas packs                   │
              │  - /ws upgrade; caches player→shard routing             │
              └───────────────┬───────────────────────┬─────────────────┘
                              │ (join: "which shard?")  │ (realtime: routes straight to shard)
                              v                          v
        ┌──────────────────────────────┐     ┌─────────────────────────────────────────┐
        │      COORDINATOR DO          │     │   FLOOR/ZONE SHARD DOs  (regional)        │
        │  (thin, low-frequency, NOT   │     │   floor:<run>:<N>[:region]                │
        │   on the realtime hot path)  │     │   - authoritative 20Hz combat sim         │
        │  - runId, seed, currentFloor │<───>│   - AoI spatial grid → per-client deltas  │
        │  - floor timer (ALARM)       │ low │   - friendly fire, projectiles, monsters  │
        │  - alive/dead roster         │ freq│   - SQLite heartbeat (resume on evict)    │
        │  - floor-complete fan-out    │     │   - playstyle profile updates (O(1))      │
        │  - SQLite: run/floor/records │     │   - in-tick heuristic loot grant          │
        └──────────────┬───────────────┘     └───────────┬───────────────────┬───────────┘
                       │                                  │ ctx.waitUntil     │ acceptWebSocket
                       │ global events                    v (off hot loop)    v (hibernation)
                       v                          ┌───────────────┐   ┌──────────────────┐
              ┌────────────────────┐              │ WORKERS AI /  │   │  SPECTATOR DO(s)  │
              │  SQLite PERSISTENCE │              │ CLAUDE (Haiku)│   │ dead players +    │
              │  per DO: run_state, │              │ loot FLAVOR   │   │ late joiners,     │
              │  floor_state,       │              │ only — never  │   │ hibernatable,     │
              │  player_profile,    │              │ stats, never  │   │ ~0 GB-s idle,     │
              │  floor_record       │              │ in hot loop   │   │ <500–1k each      │
              └────────────────────┘              └───────────────┘   └──────────────────┘
```

**Data flow, one frame:** client sends WASD-move + ballistic-aim/cast *intent* (seq-numbered, never absolute position) → Worker routes to the player's Floor/Zone shard → shard's authoritative tick integrates movement, advances ballistic projectiles and resolves friendly-fire hits by collision, runs monster threat-aggro, updates the player's 7-axis playstyle profile → on a select-kill/chest/floor-end the deterministic heuristic grants a clamped, *playable* ability the same tick, and a `ctx.waitUntil` job asks Workers AI/Claude for name/flavor/twist *off* the loop → shard emits a per-client **AoI-culled binary delta** (only nearby entities, only changed fields) → client reconciles its predicted local player against `lastProcessedSeq`, interpolates everyone else. The Coordinator only ever sees join routing, the floor alarm, and floor-complete fan-out — never a combat tick.

---

## Milestone ladder

Ordering principle, stated bluntly: **prove the scary unknowns early at small scale, defer massive-scale sharding until the loop is fun.** The three things most likely to kill the project are *combat/netcode feel*, *the permadeath+floor loop*, and *whether 3D is achievable for a small team*. Those come first, on the single DO we already have. Sharding for 1000s is real but it is the *last* rung — building it before the game is fun would be the classic mistake.

Every milestone is shippable and playtestable with a handful of real players.

---

### M0 — Eviction-safe foundation *(de-risk: silent run-loss)*
**Goal:** the single global run survives a deploy/eviction/restart.
**Deliverables:**
- SQLite checkpoint helper writing `run_state`, `floor_state`, `player_roster` on a ~1 Hz heartbeat (NOT every 50 ms tick — that wrecks tick budget and write billing).
- `blockConcurrencyWhile()` rehydration in the DO constructor: load run/seed/roster/positions and *resume*; only bootstrap a fresh run if storage is empty. The current unconditional `spawnMonsters()` becomes conditional.
- Keep `setInterval` as the tick (an always-on combat DO is ~$4/mo and correct); the fix is *recovery*, not cost.

**De-risks:** the critical "a restart wipes the worldwide run" gap — the single biggest durability liability.
**Definition of done:** force a deploy mid-session; the run resumes at the same floor/roster/positions, losing at most ~1–2 s of interpolated position.

---

### M1 — Permadeath + durable identity *(de-risk: the core rule is currently fake)*
**Goal:** death is permanent and a dead player cannot reload back to life.
**Deliverables:**
- Delete `PLAYER_RESPAWN_MS` and the respawn branch in `tick()`; `killPlayer()` sets `status='spectator'`, removes the player from collision/aggro/target sets, broadcasts a death event. The WS stays open.
- Replace per-socket `p_<seq>` ids with a **durable, HMAC-signed `playerId`** minted by the Worker (anonymous account, optional passkey upgrade later — decision #3). The `join` handler verifies the signature and looks up the persisted profile; `alive=0` ⇒ admitted as spectator only. Idempotent death writes so recovery/replay can't resurrect.
- **Linkdead living players stay in the world (decision #8).** On WS drop, a *living* character is NOT removed — it remains in the sim, targetable and **vulnerable** (it can be killed while disconnected). Mark the session `linkdead` with `last_seen`; reconnect rebinds to the same character if still alive, else spectator. No invulnerability, no aggro removal — a rage-quit leaves your hero standing there to die.
- `onMessage` rejects move/cast from spectators.

**De-risks:** permadeath integrity — without durable identity, "one life" is cosmetic.
**Definition of done:** a killed player who reloads the page rejoins as a spectator, never as a living character; a player who disconnects mid-floor can be killed by monsters while gone; verified with several real connections.

---

### M2 — 3D renderer swap at parity *(de-risk: is 3D even feasible for us?)*
**Goal:** the existing game, rendered in 3D, *with zero server protocol changes.*
**Deliverables:**
- Replace the 2D canvas draw layer with **Three.js r184 via `three/webgpu` (WebGPU primary, automatic WebGL2 fallback)**. WebGPU is Baseline across browsers as of Jan 2026; the fallback covers the ~5–10% tail.
- Map server `(x,y)` → ground plane `(x,z)`. Entities render as **billboarded sprites drawn from texture atlases** (Doom-like — decision #6): camera-facing quads with atlas-frame animation, optional 8-direction frames for facing. Use flat colored quads as placeholders until atlases exist. Reads the *same* snapshots. Keep the WS layer, `lerpEntities` interpolation, HUD, login, cooldown overlay, camera-follow smoothing.
- Choice rationale: Three.js (~168 kB, MIT, render-only) over Babylon (~1.4 MB, batteries-included physics we explicitly do NOT want — the DO is the only sim). Sprites over 3D meshes: the locked art direction — far cheaper for crowds and **no rigging/animation pipeline**.

**De-risks:** the 3D feasibility question, cheaply; the sprite path also retires the art-pipeline risk (no skinned-mesh budget).
**Definition of done:** parity with the 2D client rendered as a 3D sprite scene; a playtester can't tell the server changed (it didn't).

---

### M3 — Combat model + netcode feel: WASD, ballistic aim, prediction *(de-risk: does it FEEL real-time?)*
**Goal:** WASD movement and manual ballistic aiming that feel instant and fair; you can deliberately hit *or avoid* an ally by where you point. (This milestone owns the homing→ballistic change from decision #4 — the one true protocol change in the plan.)
**Deliverables:**
- **Input model → WASD + mouselook (replaces click-to-move).** Client sends seq-stamped *input intent* — a movement vector (axes) + facing/aim angle — never an absolute position. Server integrates velocity per tick (replaces the `tx/ty` move-target fields). Teleport stays impossible by construction (intent, not position). *Note: the committed tree is still click-to-move; any local WASD work should be committed and reconciled here.*
- **Ballistic projectiles (replaces homing).** `castAbility` fires in the aim direction; projectiles travel straight and the server does projectile-vs-entity collision (swept sphere/capsule) each tick. Friendly fire becomes **positional** — allies in the line of fire take the hit (this is what makes "trust" a skill mechanic, not a menu choice). Melee (Smite) becomes a short forward cone. The projectile struct carries a velocity/direction instead of `targetId`; `{t:'cast', ability, aim}` replaces target ids; `findTarget` is retired for projectiles.
- **Client prediction:** client predicts LOCAL-player movement from its own inputs and reconciles against the server's echoed `lastProcessedSeq`; remote entities stay pure-interpolated. **Hit resolution stays 100% server-authoritative** — the client predicts its own motion, never outcomes, so friendly fire stays fair and uncheatable.
- **Camera:** over-the-shoulder / first-person with pointer-lock mouselook (isometric fallback for big fights). Crosshair + ally/enemy color coding so the trust decision is legible.
- **Monster threat aggro (combat note):** per-monster threat table — taking damage from a player adds threat; the monster chases the highest-threat target; threat decays over time; nearest-player is the no-threat fallback. Replaces today's pure nearest-player targeting.
- **Harden `onMessage`:** per-socket token-bucket rate limit (**~10 Hz input cap** — this is also the scale gate from the reality check, fixed here on purpose); reject input from spectators.

**De-risks:** combat feel and netcode feel together — the make-or-break "is this a real-time game" question — at small scale where iteration is cheap; and the homing→ballistic protocol change, proven before any scaling work.
**Definition of done:** at a real cross-city connection, WASD movement has no perceptible input lag, a player can reliably land or avoid a shot on an ally, and monsters chase whoever hurt them.

---

### M4 — The run loop: floors, timer, stairs, global events *(de-risk: is the loop fun?)*
**Goal:** the actual game in the brief — timed, themed floors with a lethal timer and a global progression.
**Deliverables:**
- **Per-Floor FSM** (GENERATING → ACTIVE → CLOSING → COMPLETE) and **GlobalRun FSM** (LOBBY → RUNNING → ENDED → cooldown → new run), both owned by the DO and checkpointed to SQLite on every transition with a `floorGeneration` guard against double-advance.
- **Floor timer = durable `ctx.storage.setAlarm()`**, never `setInterval` (an interval-based timer silently dies on the last disconnect or a deploy). `setInterval` stays as the cosmetic-rate physics tick + per-tick "all living at stairs" early-advance check. **Each floor sets its own timer duration** (carried in the floor descriptor — decision #9; deeper floors are not inherently longer or shorter, it depends on the floor).
- Stairs entity + radius. Advance the instant all living players reach the stairs OR the alarm fires. **The timer is lethal (decision #2):** at timeout, every living player not at the stairs dies. Extinction or floor cap → run ENDED → cooldown → fresh run resets everyone to vanilla.
- **Run start is manual during development (decision #7):** an admin endpoint bootstraps a fresh run (everyone vanilla); a fixed real-world schedule replaces the manual trigger later. A run still ends automatically on extinction or floor cap.
- **Procedural gen:** seeded deterministic **BSP + cave hybrid**; the server sends a *seed descriptor + theme id + floor timer*, not meshes (this also keeps gen broadcast-friendly at scale). **In-gen BFS reachability + timer-feasibility check with seed re-roll** — an unsolvable or un-completable-in-time floor strands the entire permadeath playerbase, so this is non-negotiable. Floor themes are a client-side **sprite-atlas reskin** over the shared structural gen.
- Late joiners mid-run are spectators; they play at the next run start. Floor completions write `floor_record` rows — the durable global-event log.

**De-risks:** the core question of whether the timed-floor permadeath loop is actually fun, before any scaling work.
**Definition of done:** a handful of players complete several procedurally generated themed floors with per-floor timers; the timer kills stragglers; an admin can end and restart a run that bootstraps everyone to vanilla; the run survives a forced eviction mid-floor.

---

### M5 — Emergent roles + hybrid AI loot *(de-risk: does identity emerge from play?)*
**Goal:** abilities and roles emerge from behavior; the LLM adds flavor and never touches gameplay.
**Deliverables:**
- **7-axis playstyle profile** (stealth, ranged, melee, support, aggression, exploration, teamwork) updated O(1) inside the existing `castAbility`/`applyDamage`/`killPlayer`/`tick` funnels with EMA smoothing + rate normalization. No IO in the hot loop.
- **Deterministic seeded heuristic**: profile vector → ability category + clamped integer power budget, granting a *playable* ability on the existing `Ability` schema **in the same tick**. The LLM is excluded from every number. **Loot drops on select kills** (elites/bosses/chance-based — not every kill), on chests, and at floor-end (decision #10).
- **Off-loop flavor** via `ctx.waitUntil`: Workers AI Llama 3.1 8B (JSON mode, validated, profanity/injection-filtered) writes only name/flavor/twist; **Claude Haiku 4.5 reserved for rare/boss drops**; both behind AI Gateway with a cache and a **deterministic static table fallback** so loot is always instantly playable. Behind a feature flag and a per-floor spend budget that fails open to the table (per-run ceiling TBD — decision #5). Assert in tests that `player.name` never enters a prompt.
- **Derived `classOf`** (Protector/Hunter/Shadow/Negotiator/Berserker/Vanilla) recomputed each grant and **shown to the player in the HUD** (decision #10); restorative grant magnitude scales with the *live* support axis so a violent healer loses healing (closes the "farm support then go DPS" exploit). Profiles persist in SQLite.

**De-risks:** whether emergent identity is compelling, and proves the LLM is genuinely off the critical path.
**Definition of done:** distinct playstyles reliably produce distinct ability grants and visible class labels; with the LLM disabled, loot is still fully playable from the table; flavor never blocks a tick.

---

### M6 — Bandwidth: AoI culling + binary deltas *(de-risk: the first scale wall)*
**Goal:** raise the single-DO player ceiling several-fold by killing O(N²) egress.
**Deliverables:**
- Uniform spatial grid per shard; each client gets only entities within an AoI radius.
- Per-client **binary delta** protocol (`ArrayBuffer`/`DataView`): quantized int16 positions, entity-id deltas, changed-field bitmask, plus a ~1 Hz keyframe to self-correct drift. Replaces `JSON.stringify` + the string-slice cooldown hack. Client decoder updates; the interpolation buffer is unchanged.
- **Instanced billboard sprites** (one draw call per atlas), sprite-resolution LOD, frustum culling — profiled at 100/300/1000 synthetic entities. Sprites sidestep the skinned-mesh cost entirely.
- The ≤10 Hz input policy is already fixed in M3 (the req/s gate depends on it — see Scale reality check).

**De-risks:** the bandwidth ceiling, the first wall a broadcast game hits.
**Definition of done:** per-tick payload drops 80–90% vs JSON; a single DO sustains a load-tested player count (see M7) at smooth frame rate.

---

### M7 — Coordinator + per-floor (regional) sharding *(de-risk: the headcount + geography wall)*
**Goal:** scale beyond one DO's ceiling while preserving one logical run — and address geography honestly.
**Deliverables:**
- **Coordinator DO** (`getByName('coordinator')`): global run state, floor timer alarm, floor-advance, global-event fan-out, join routing. **Off the realtime hot path** — caches player→shard routing at the Worker edge so combat never touches it.
- **Floor/Zone shard DOs** running per-floor 20 Hz sim for their occupants. **Shard key = floor AND region** (`floor:<run>:<N>:<region>`), co-located near player clusters (decision #1). Two players on opposite sides of the planet on the same logical floor may sit in different physical shards; their shared timer/progress reconcile through the Coordinator on a non-realtime channel.
- **Per-shard join cap set from a real load test** at 50/100/200/300 synthetic players (measure tick wall-time AND inbound req/s) — **plan for ~100–150 living per shard, not 300.**
- Dead players + late joiners move to a **separate hibernatable Spectator DO** (`acceptWebSocket`, `serializeAttachment` ≤16,384 B) — hibernation can't coexist with the combat DO's `setInterval`, so they must be separate. Per-connection send budgeting / backpressure: degrade slow clients (coarser AoI, lower rate), never buffer unboundedly.

**De-risks:** the single-DO headcount ceiling and the geographic-latency reality.
**Definition of done:** a load test shows N shards carrying >1 DO's worth of players with one logical run/timeline; floor-complete fans out globally; thousands of idle spectators cost ~0 GB-s.

---

### M8 — Zone-sharding within a hot floor *(deferred; top of ladder)*
**Goal:** support true 1000s on a *single* crowded floor.
**Deliverables:** split a floor into spatial zones, one DO per zone, **atomic WS+state handoff** at borders (freeze input → snapshot → transfer → ack → unfreeze), read-only border-overlap rendering, single-owner hit resolution at all times.
**De-risks:** the very top of the scale ladder — only built when telemetry shows a floor shard near its cap.
**Definition of done:** synthetic players cross zone borders under load with no dropped inputs, duplicated entities, or friendly-fire desync. **Build last — this is the highest bug-density surface in the system.**

---

## Scale reality check

The scale verdict is **holds-with-caveats**, and the caveats are load-bearing. I am not going to soft-pedal them.

**What holds.** Every cited Cloudflare limit is accurate (128 MB single-threaded per DO; ~1,000 req/s soft cap; 32,768 hibernatable-WS hard cap with ~500–1k guidance for broadcast; `setInterval` prevents hibernation; alarms at-least-once with 2 s backoff; pricing 400k GB-s then $12.50/M, 1M req then $0.15/M, WS messages billed 20:1). The count-scaling engineering is correct: full-snapshot-to-all is genuinely O(N²), and AoI + binary deltas + floor-sharding is the right, well-understood fix.

**Three honest corrections, now baked into the ladder:**

1. **The "150–300 per shard" number was asserted, not measured.** We treat it as unknown until M7's load test. **Plan for ~100–150 living players per shard and gate joins there.** The 32,768 WS cap is never the binding constraint for *combatants* — it only matters for hibernated spectators (stay <500–1k there too).

2. **The req/s wall can bite before the CPU wall, and it's governed by INBOUND input rate.** Outbound broadcasts don't count against the 1,000 req/s inbound cap (the 20:1 ratio is billing-only). At a 10 Hz input policy, inputs alone cap a shard near ~100 players (1000/10); at 60 Hz per-frame input it's ~16. **Therefore the client input policy is a hard design gate — fixed at ≤10 Hz in M3, before deltas are built.**

3. **Geography is the wall the ladder does not climb — and this forces a product-level honesty.** A Durable Object has a single home region. `getByName('world')` and `getByName('floor:…')` pin the authoritative realtime sim to *one physical location*. Sharding by floor does **not** distribute geography: players worldwide on a shared global floor all hit one DO region. For a friendly-fire game where aim and trust are mechanics, a player ~200–250 ms RTT away, plus 50 ms tick plus ~100 ms interpolation, is **not a credible real-time experience.** No AoI/delta/floor-shard technique closes a speed-of-light gap.

**The decision this forced (now LOCKED, #1):** **"one global instance worldwide" is a LOGICAL guarantee** — single run, single floor-progression timeline, global completion events, all enforced by the thin Coordinator — **with REGION-LOCAL realtime combat.** M7's shard key is therefore floor *and* region. Two players a continent apart share the same run, floor number, timer, and global events; they do *not* necessarily share the same physical combat arena. (See Decisions (locked) #1.)

**Fallback if genuinely-shared worldwide realtime combat in one arena ever becomes a hard requirement:** Durable Objects are the wrong primitive for *that specific subsystem*; the fallback is a regional dedicated-game-server fleet (UDP/WebRTC) owning live combat with Cloudflare as the coordination/identity/persistence layer. That is a major scope change and is explicitly NOT in the plan, because the product owner accepted region-local combat. It is invisible to players (you can't see another floor, and you rarely care which physical arena a same-floor stranger 8,000 km away is in) and it keeps the whole architecture on Cloudflare.

---

## AI-loot reality check

The AI-loot verdict is **holds-with-caveats**, and the caveats are mild and well-contained.

**What holds, by construction:**
- **Latency:** `castAbility`/`applyDamage`/`killPlayer` are pure in-memory mutations with zero IO. The two-phase split grants a fully playable ability in-tick (tooltips render from the *real* clamped numbers); the LLM fills only three display strings off-loop via `ctx.waitUntil`. The 20 Hz tick never awaits the model.
- **Fairness/nondeterminism — the scariest failure mode — is not even representable.** Stats come from a seeded PRNG feeding a clamped integer budget; abilities are *personal per-player grants*. The LLM is excluded from every number. The only thing that can diverge is cosmetic flavor text.
- **Injection:** prompt inputs are server-controlled enums, not raw chat, behind schema validation, length caps, and a profanity/URL filter, with a deterministic table fallback.
- **Cost:** at quota/budget exhaustion it degrades to the static table. Gameplay never gates on the model.

**Caveats, folded in:**
- **The LLM's marginal value over the static table is naming variety — i.e. deferrable polish.** So we ship the heuristic + static table as the *permanent backbone* in M5 and treat the LLM as optional cosmetic polish behind a feature flag, never on the critical path. Load-test the fallback path explicitly.
- **Cache-hit optimism fights the emergent/hybrid/per-theme goal** (the keyspace is large), but this only affects flavor *economics*. Keep cache keys coarse (category × rarity × theme), accept name repetition, and expand the static table before spending on the LLM. Reserve Haiku 4.5 for rare/boss drops and batch them (flavor is non-urgent; Batch is 50% off).
- **Confirm `player.name` (16-char slice) is never interpolated into a prompt** — assert it in tests.

**The real wall the verdict names is not the LLM — it's the single DO** (1,000 req/s + O(N²) broadcast), which the AI-loot design correctly scopes out. The good news: the loot system **shards cleanly** — small per-player persisted profiles and the pure-function-plus-async-flavor design survive the M7 split unchanged. Cited facts (Workers AI $0.011/1k Neurons beyond 10k/day free; JSON mode best-effort, no streaming; Haiku 4.5 $1/$5 per M, Batch 50% off) all verify.

---

## Risk register

| Risk | Severity | Mitigation | Milestone |
|---|---|---|---|
| DO eviction/restart wipes the entire global permadeath run (in-memory only) | **Critical** | SQLite heartbeat (run/floor/roster/positions ~1 Hz); `blockConcurrencyWhile` reload-and-resume on construct; conditional `spawnMonsters()` | **M0** |
| Permadeath is fake — per-socket `p_<seq>` id + respawn means reload = alive again | **Critical** | Durable HMAC-signed `playerId`; persisted `alive` flag is sole truth; delete respawn; idempotent death writes; dead → spectator | **M1** |
| Floor timer in `setInterval` silently dies on last disconnect / deploy / eviction | **Critical** | Floor timer = durable `ctx.storage.setAlarm()`; `setInterval` is cosmetic physics tick only | **M4** |
| Unsolvable / timer-infeasible procedural floor strands the whole playerbase under permadeath | **Critical** | In-gen BFS reachability + timer-feasibility check; deterministic seed re-roll; fallback; operator override | **M4** |
| Geographic latency: one DO = one region; worldwide players on a shared floor eat 200–250 ms RTT | **High** | Region-local realtime combat (shard by floor AND region); reconcile shared run/timer via Coordinator off the hot path; "one instance" is logical-only (decision #1) | **M7** |
| Single-DO ceiling (req/s + CPU) hit before sharding exists | **High** | Fix input policy ≤10 Hz (M3); AoI+delta cut CPU/egress; Coordinator caps joins at load-tested ~100–150/shard | **M3 → M7** |
| Client drifts into a second simulation (physics/AI), breaking authority & opening cheats | **High** | Three.js (render-only) not Babylon; client predicts LOCAL movement only, never hit outcomes; code-review gate on non-local-player mutation | **M2/M3** |
| Ballistic friendly-fire hit registration feels off under latency | Medium | Region-local combat keeps RTT low; slower projectiles + generous hitboxes; 100% server-authoritative collision; optional lag-comp/rewind only if needed | **M3** |
| WASD client-prediction mis-reconciles (rubber-banding) | Medium | Predict local movement only; reconcile to echoed `lastProcessedSeq`; light smoothing; identical movement constants client/server | **M3** |
| Art pipeline becomes the critical path | Medium | **Sprite sheets + atlases (Doom-like)** — no rigging/animation pipeline; roles & themes as atlas + tint variants; CC0/asset-pack or generated sprites; bespoke art post-MVP | **M2 → M4** |
| Draw-call/fill cost tanks frame rate before the network does | Medium | Instanced billboard sprites (one draw call per atlas); sprite-resolution LOD; frustum culling; sprites sidestep skinned-mesh cost; profile at 100/300/1000 | **M2/M6** |
| Double-advance race: per-tick "all at stairs" vs fired floor alarm | **High** | Monotonic `floorGeneration` counter persisted with floor_state; every transition checks-and-bumps; stale alarms ignored | **M4** |
| Extinction/empty world: all living die but FSM still "running" | **High** | On any death and in CLOSING, `livingCount==0` → run ENDED (extinction) → cooldown → fresh LOBBY; spectators see countdown | **M4** |
| Per-kill LLM calls at scale blow cost/latency/rate limits | **High** | Never gate gameplay on the model; loot only on select kills/chests/floor-end; cache by category×rarity×theme; Haiku for rare/boss only; batch on alarm; per-floor spend budget fails open to the static table | **M5** |
| Identity token forgery/replay revives a dead character | **High** | HMAC-sign with Worker secret + expiry; verify server-side in `join`; persisted `alive` is sole truth → valid token for a dead char grants spectator only | **M1** |
| Client-trust attacks in `onMessage` (flood, spam, fake input) | Medium | Per-socket token bucket (~10 Hz); accept move/aim *intent* only (never a position) so teleport is impossible by construction; server-owned cooldowns make spam inert; close repeat offenders | **M3** |
| Binary/delta desync drifts a client, mis-aims friendly fire | Medium | ~1 Hz keyframes + seq/gap detection → request keyframe; reliable idempotent event channel; authoritative hit resolution means worst case is a brief visual mismatch | **M6** |
| WebGPU driver/browser edge cases (black screens) | Medium | `three/webgpu` auto-falls back to WebGL2; test WebGL2 explicitly; degrade gracefully on adapter failure | **M2** |
| Linkdead living character (decided): stays in world, can die while disconnected | Medium | **Decided (#8):** character remains targetable & vulnerable; `drop` frees only the socket; reconnect rebinds the alive char; no invulnerability, no aggro removal | **M1/M3** |
| Players game the playstyle profile / grief allies for teamwork axis | Medium | Rate-normalize signals; cap per-window contribution; friendly fire strongly negative with longer memory than positives; context-gating | **M5** |
| Unsafe/malformed LLM text reaches players | Medium | Strict schema validation (JSON mode is best-effort), length caps, profanity/URL filter, one retry → deterministic table; blast radius is 3 cosmetic strings | **M5** |
| Coordinator becomes a hot single point of failure if on the realtime path | Medium | Keep Coordinator off the hot path (join routing, alarm, fan-out only); cache routing at the Worker edge | **M7** |
| WS message billing surprise (20:1 ratio at 20 Hz × N clients) | Medium | AoI+delta cut count and size; one outbound msg/client/tick; hibernate spectators out of the count; monitor via observability | **M6/M7** |
| Schema-version mismatch on deploy breaks rehydration mid-run | Medium | `schemaVersion` field; on mismatch end the run cleanly (`maintenance`) and bootstrap fresh rather than crash-loop; use wrangler SQLite migrations | **M0/M4** |
| Zone handoff (M8) drops inputs / duplicates entities / desyncs friendly fire | **High** | Defer until telemetry demands it; atomic freeze→snapshot→transfer→ack→unfreeze; single-owner hit resolution; heavy synthetic-crossing load tests | **M8** |
| SQLite per-DO cap (1 GB beta → 10 GB GA) over a 100-floor run | Low | Keep profile blobs compact; store derived records not raw telemetry; offload history to D1/records-DO at the 1000s rung | **M7** |

---

## Decisions (locked — 2026-06-14)

The product owner resolved the open questions. Recorded here with consequences; the milestones above already reflect them.

1. **"One worldwide instance" = logical only — ACCEPTED.** One run, one floor timeline, one timer, global completion events via the Coordinator; **realtime combat is region-local** (shard by floor AND region in M7). No worldwide single-arena combat. This is the architecture's load-bearing assumption.

2. **Floor timer is LETHAL — YES.** At timeout, every living player not at the stairs dies (matches "closes forever"). The timer is a genuine survival threat, not a convenience. (M4.)

3. **Accounts: anonymous HMAC token now, passkey later — ACCEPTED.** Durable signed `playerId` in M1; optional WebAuthn "claim your legend" upgrade is post-MVP. No claimable named legends on day one.

4. **Input scheme: WASD + mouselook + BALLISTIC aiming — CHOSEN (reverses the roadmap's earlier recommendation).** This is now the combat model, not target-select. Consequences, now in M3: directional movement (server integrates an input vector, not a click target), manual mouselook aim, and projectiles that travel in a **direction** with server-side collision — so friendly fire is positional (you can miss; an ally in your line of fire takes the hit). This is a combat-model + protocol change (homing→ballistic), heavier than a renderer swap. *Note: the committed tree is still click-to-move/homing; any local WASD work should be committed and reconciled against M3.*

5. **Loot-flavor LLM split — default ACCEPTED, spend ceiling TBD.** Workers AI Llama 3.1 8B for commons, Claude Haiku 4.5 for rare/boss, AI Gateway + per-floor budget failing open to the static table. Per-run spend ceiling to be set before M5 ships the LLM path.

6. **Art: SPRITE SHEETS + ATLASES — CHOSEN.** Billboarded sprites in the 3D world (Doom-like / boomer-shooter). This *removes* the 3D rigging/animation pipeline risk, is far cheaper than skinned meshes for crowds, and pairs naturally with instanced/point-sprite rendering for 100s of entities. Roles & themes become atlas + tint variants. Reflected in M2/M6 and the risk register.

7. **Run cadence: fixed schedule (eventually), MANUAL during dev.** For now a new run is started by an admin/dev trigger; a fixed real-world schedule comes later. A run still ENDS automatically on extinction/floor cap. (M4 gets a manual "start new run" endpoint.)

8. **Linkdead policy: character STAYS in the world, targetable & vulnerable.** A living player who drops connection leaves their character standing in the world — monsters and players can still hit and kill it; it can die while disconnected (raising the stakes, fitting permadeath). Reconnect rebinds to the same character if still alive. No invulnerability, no removal-from-aggro. (M1/M3.)

9. **Floor duration is PER-FLOOR, not depth-scaled.** Each generated floor carries its own timer in its descriptor; deeper ≠ longer or shorter — it depends on the floor's size/theme. No global `FLOOR_DURATION_MS` constant and no depth function. (M4/procgen.) `MAX_FLOORS` = 100 per lore (confirm the cap "win" behavior).

10. **Loot cadence + class label.** Loot drops on **some** kills (elites/bosses/chance-based, not every kill) + chests + floor-end. The emergent **class label is SHOWN** to the player (HUD). Inventory bound defaults to **fixed slots** under permadeath (confirm slot count). (M5.)

**Two combat notes added this round:**
- **Monster threat aggro:** monsters target whoever attacks them. Add a per-monster threat table — damage from a player adds threat; the monster prioritizes the highest-threat target; threat decays over time; fall back to nearest-player when no threat exists (replaces today's pure nearest-player aggro). Folded into M3.
- **Ballistic friendly fire** (from #4) makes "trust" a skill mechanic: positional line-of-fire hits, not target selection.

**Still genuinely open (non-blocking):** per-run LLM spend ceiling (#5); inventory slot count (#10); `MAX_FLOORS` win behavior (#9).
