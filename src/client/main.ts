import { Net } from "./net";
import { Input } from "./input";
import { Predictor } from "./predict";
import { Renderer } from "./render";
import { Hud } from "./hud";
import { generateFloor } from "../procgen";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const net = new Net();
const input = new Input();
const predictor = new Predictor();
const renderer = new Renderer(canvas);
let hud: Hud | null = null;

input.attach(canvas);

const loginEl = document.getElementById("login") as HTMLElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const loginMsg = document.getElementById("loginMsg") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
let connected = false;
let toastHideAt = 0;
let lastFloorKey = "";
let lastRunPhase = "";

function showToast(text: string, color: string) {
  toastEl.textContent = text;
  toastEl.style.color = color;
  toastEl.style.opacity = "1";
  toastHideAt = performance.now() + 3500;
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

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const mv = input.moveVec();
  predictor.update(net, mv, dt);

  // Aim from the pointer (mouse or active touch) projected to the ground.
  input.aim = renderer.aimFromPointer(input.pointer.x, input.pointer.y, predictor.x, predictor.y);
  // Spectators (dead players) don't send movement/casts.
  if (net.self?.status === "alive") input.pump(net, now);

  if (net.cur) {
    renderer.sync(net.cur.ents, net.you, { x: predictor.x, y: predictor.y });
    renderer.follow(predictor.x, predictor.y);
    hud?.update(net);
  }

  // Floor/run transitions -> place the stairs marker (rebuilt from the seed) and
  // toast. Key on seed:depth so a NEW run at the same depth still rebuilds.
  const floorKey = net.floor ? `${net.floor.info.seed}:${net.floor.info.depth}` : "";
  if (net.floor && floorKey !== lastFloorKey && net.run?.phase !== "ended") {
    lastFloorKey = floorKey;
    const f = generateFloor(net.floor.info.seed, net.floor.info.depth);
    renderer.setStairs(f.stairs.x, f.stairs.y);
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
