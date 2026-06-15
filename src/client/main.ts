import { Net } from "./net";
import { Input } from "./input";
import { Predictor } from "./predict";
import { Renderer } from "./render";
import { Hud } from "./hud";
import { InventoryUI } from "./inventory";
import { generateFloor } from "../procgen";
import { LOOT_REACH } from "../shared/constants";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const net = new Net();
const input = new Input();
const predictor = new Predictor();
const renderer = new Renderer(canvas);
const invUI = new InventoryUI(net);
const lootBtn = document.getElementById("lootBtn") as HTMLButtonElement;
const hudEl = document.getElementById("hud") as HTMLElement;
const waitingEl = document.getElementById("waiting") as HTMLElement;
let nearestBagId: string | null = null;
let hud: Hud | null = null;

// Waiting-room spectate camera: once you reach the stairs your character leaves
// the floor, so the camera follows a spectate target instead of the (gone) player.
const spectateTarget = { x: 0, y: 0 };
let spectateMode: "follow" | "free" = "follow";
let followIdx = 0;
let wasReached = false;

input.attach(canvas);

const loginEl = document.getElementById("login") as HTMLElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const loginMsg = document.getElementById("loginMsg") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const resetRunBtn = document.getElementById("resetRun") as HTMLButtonElement;
const isLocalDev = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
// Show the reset control in local dev, or anywhere when `?admin` is in the URL
// (so a deployed instance can be reset without curl — still gated by the token).
const adminUnlocked = isLocalDev || new URLSearchParams(location.search).has("admin");
let connected = false;
let toastHideAt = 0;
let lastFloorKey = "";
let lastRunPhase = "";

if (adminUnlocked) resetRunBtn.style.display = "block";

function showToast(text: string, color: string) {
  toastEl.textContent = text;
  toastEl.style.color = color;
  toastEl.style.opacity = "1";
  toastHideAt = performance.now() + 3500;
}

// Waiting-room banner: how many players are still fighting + spectate controls.
function updateWaitingBanner() {
  const remaining = net.floor ? Math.max(0, net.floor.state.living - net.floor.state.livingAtStairs) : 0;
  const ctrl = spectateMode === "follow" ? "Tab: next player · V: free-cam" : "WASD: pan · V: follow";
  waitingEl.style.display = "block";
  waitingEl.innerHTML =
    `🚪 <b>Waiting room</b> — ${remaining} ${remaining === 1 ? "player" : "players"} still on the floor` +
    `<div class="wsub">${ctrl} · I: inventory & sell</div>`;
}

net.onWelcome = () => {
  connected = true;
  // Persist the signed identity token so a reload rebinds to the same character
  // (and a dead character stays dead — permadeath, M1).
  try {
    if (net.token) localStorage.setItem("dcc.token", net.token);
  } catch {
    /* storage unavailable (private mode) — identity just won't survive reload */
  }
  loginEl.style.display = "none";
  hud = new Hud((i) => input.queueCast(i));
  invUI.showButton();
};
net.onClose = () => {
  if (!connected) {
    // Never connected — show it ON the login card (which is on top), not in
    // #status behind it, so the click visibly does something.
    loginMsg.textContent = "Couldn't reach the server. Is `npm run dev` running?";
    playBtn.disabled = false;
    playBtn.textContent = "Enter the world";
  } else {
    const s = document.getElementById("status");
    if (s) s.innerHTML = '<b style="color:#ff6a6a">Disconnected.</b> Refresh to rejoin.';
  }
};
net.onEvents = (events) => {
  if (net.cur) renderer.handleEvents(events, net.cur.ents, net.you);
  for (const e of events) {
    if (e.e === "boss") {
      if (e.state === "spawn") showToast("⚠ A BOSS has awoken — dodge its bolts! ⚠", "#e7b3ff");
      else showToast("☠ The boss has been slain! ☠", "#ffd34d");
    }
  }
};

function start() {
  if (playBtn.disabled) return;
  const nameInput = document.getElementById("name") as HTMLInputElement;
  const name = (nameInput.value || `Hero${Math.floor(Math.random() * 999)}`).slice(0, 16);
  loginMsg.textContent = "";
  playBtn.disabled = true;
  playBtn.textContent = "Connecting…";
  let token: string | undefined;
  try {
    token = localStorage.getItem("dcc.token") ?? undefined;
  } catch {
    token = undefined;
  }
  net.connect(name, token);
}
playBtn.addEventListener("click", start);
(document.getElementById("name") as HTMLInputElement).addEventListener("keydown", (e) => {
  if (e.key === "Enter") start();
});

// Inventory + loot keys (work alongside the movement/cast keys in input.ts).
addEventListener("keydown", (e) => {
  if (!connected) return;
  const k = e.key.toLowerCase();
  if (k === "i") invUI.toggle();
  else if (k === "e") { if (nearestBagId) invUI.requestLoot(nearestBagId); }
  else if (k === "escape") { invUI.close(); invUI.closeLoot(); }
  else if (net.self?.reached) {
    // Waiting-room spectate controls.
    if (k === "tab") { e.preventDefault(); spectateMode = "follow"; followIdx++; }
    else if (k === "v") spectateMode = spectateMode === "follow" ? "free" : "follow";
  }
});
// Mobile loot button (mirrors the E key).
lootBtn.addEventListener("click", () => { if (nearestBagId) invUI.requestLoot(nearestBagId); });

resetRunBtn.addEventListener("click", async () => {
  if (!confirm("Reset the current round for every connected player?")) return;

  // TEMP: token prompt removed — the server bypasses auth while ADMIN_OPEN="true".
  // Restore the prompt + Authorization header when re-securing the endpoint.
  resetRunBtn.disabled = true;
  resetRunBtn.textContent = "Resetting...";
  try {
    const response = await fetch("/admin/new-run", { method: "POST" });
    if (!response.ok) {
      throw new Error(response.status === 403 ? "Reset forbidden (token required)." : `Reset failed (${response.status}).`);
    }
    showToast("Round reset.", "#9be7ff");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Round reset failed.", "#ff8a8a");
  } finally {
    resetRunBtn.disabled = false;
    resetRunBtn.textContent = "Reset round";
  }
});

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const reached = net.self?.reached === true;
  const mv = input.moveVec();
  predictor.update(net, mv, dt);

  // Aim from the pointer (mouse or active touch) projected to the ground.
  input.aim = renderer.aimFromPointer(input.pointer.x, input.pointer.y, predictor.x, predictor.y);
  // Movement/casts only while alive AND still in play (not in the waiting room).
  if (net.self?.status === "alive" && !reached) input.pump(net, now);

  // Enter/leave the waiting room (reached the stairs -> safe spectate).
  if (reached && !wasReached) {
    spectateTarget.x = predictor.x;
    spectateTarget.y = predictor.y;
    spectateMode = "follow";
    followIdx = 0;
    hudEl.style.display = "none"; // no ability bar while waiting
    showToast("✓ Reached the stairs — waiting for the party", "#5dff9b");
    invUI.refresh(); // surface the sell buttons if the screen is open
  } else if (!reached && wasReached) {
    hudEl.style.display = "";
    waitingEl.style.display = "none";
    invUI.refresh();
  }
  wasReached = reached;

  // Camera + fog center: the local player while in play; a spectate target while
  // waiting (the local character has left the floor).
  let camX = predictor.x;
  let camY = predictor.y;
  if (reached) {
    const players = net.cur ? net.cur.ents.filter((e) => e.kind === "player") : [];
    if (spectateMode === "follow" && players.length) {
      const t = players[followIdx % players.length]!;
      const k = Math.min(1, dt * 6); // ease toward the followed player
      spectateTarget.x += (t.x - spectateTarget.x) * k;
      spectateTarget.y += (t.y - spectateTarget.y) * k;
    } else {
      const PAN = 620; // free-pan (or follow with nobody left): WASD moves the camera
      spectateTarget.x += mv[0] * PAN * dt;
      spectateTarget.y += mv[1] * PAN * dt;
    }
    camX = spectateTarget.x;
    camY = spectateTarget.y;
    updateWaitingBanner();
  }

  if (net.cur) {
    renderer.sync(net.cur.ents, net.you, { x: camX, y: camY });
    renderer.follow(camX, camY);
    hud?.update(net);
    if (invUI.isOpen()) invUI.syncBar(); // keep the action-bar swap section live
  }

  // Loot prompt: the nearest bag within reach of the (predicted) player.
  nearestBagId = null;
  if (net.cur && net.self?.status === "alive" && !reached) {
    let best = LOOT_REACH * LOOT_REACH;
    for (const e of net.cur.ents) {
      if (e.kind !== "lootbag") continue;
      const dx = e.x - predictor.x;
      const dy = e.y - predictor.y;
      const d = dx * dx + dy * dy;
      if (d <= best) {
        best = d;
        nearestBagId = e.id;
      }
    }
  }
  lootBtn.style.display = nearestBagId ? "block" : "none";
  // Close an open loot panel once its bag is gone (looted, despawned, or walked away).
  const openBag = invUI.lootOpenBagId();
  if (openBag && !net.cur?.ents.some((e) => e.kind === "lootbag" && e.id === openBag)) invUI.closeLoot();

  // Floor/run transitions -> place the stairs marker (rebuilt from the seed) and
  // toast. Key on seed:depth so a NEW run at the same depth still rebuilds.
  const floorKey = net.floor ? `${net.floor.info.seed}:${net.floor.info.depth}` : "";
  if (net.floor && floorKey !== lastFloorKey && net.run?.phase !== "ended") {
    lastFloorKey = floorKey;
    const f = generateFloor(net.floor.info.seed, net.floor.info.depth);
    predictor.setCollision(f.collision);
    renderer.setFloor(f);
    showToast(`⬇ Floor ${net.floor.info.depth} — ${net.floor.info.theme}`, "#9be7ff");
  }
  if (net.run && net.run.phase !== lastRunPhase) {
    lastRunPhase = net.run.phase;
    if (net.run.phase === "ended") {
      renderer.clearStairs();
      showToast("🏁 The run is over.", "#ffd34d");
    }
  }

  if (toastHideAt && now > toastHideAt) {
    toastEl.style.opacity = "0";
    toastHideAt = 0;
  }
  renderer.draw();
}
requestAnimationFrame(frame);
