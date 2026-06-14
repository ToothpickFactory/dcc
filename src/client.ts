// The browser client for the game. Served as a single self-contained HTML page
// by the Worker. Renders a top-down ARPG view on a 2D canvas, talks to the
// authoritative game server (the Durable Object) over a WebSocket.
//
// Kept deliberately simple: this is the foundation for playtesting, not the
// final renderer. Swap the canvas drawing for an isometric/3D engine later
// without changing the server protocol.

export const CLIENT_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<title>DCC — Playtest</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0e14; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #e6e9ef; }
  #game { display: block; width: 100vw; height: 100vh; cursor: crosshair; touch-action: none; }

  /* ---- Login overlay ---- */
  #login {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(1200px 800px at 50% -10%, #1a2233, #0b0e14 70%);
    z-index: 20;
  }
  #login .card {
    width: min(92vw, 420px); padding: 32px; border-radius: 16px;
    background: #121826ee; border: 1px solid #243049; box-shadow: 0 20px 60px #0008;
    text-align: center;
  }
  #login h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: 0.5px; }
  #login p { margin: 0 0 20px; color: #97a3bb; font-size: 14px; }
  #login input {
    width: 100%; padding: 12px 14px; font-size: 16px; border-radius: 10px;
    border: 1px solid #2c3a59; background: #0e1422; color: #e6e9ef; outline: none;
  }
  #login input:focus { border-color: #4f7cff; }
  #login button {
    margin-top: 14px; width: 100%; padding: 12px 14px; font-size: 16px; font-weight: 600;
    border: 0; border-radius: 10px; cursor: pointer; color: white;
    background: linear-gradient(180deg, #5b86ff, #3a5fe0);
  }
  #login button:hover { filter: brightness(1.07); }
  #login .hint { margin-top: 14px; font-size: 12px; color: #6b7790; line-height: 1.5; }

  /* ---- HUD ---- */
  #hud { position: fixed; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 10; }
  #abilities { display: flex; gap: 10px; justify-content: center; padding: 14px; }
  .slot {
    width: 64px; height: 64px; border-radius: 12px; position: relative; overflow: hidden;
    background: #141b2b; border: 1px solid #2c3a59; box-shadow: 0 6px 18px #0006;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    pointer-events: auto; cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  }
  .slot:active { border-color: #4f7cff; filter: brightness(1.15); }
  .slot .key { position: absolute; top: 3px; left: 6px; font-size: 11px; color: #9fb0d0; }
  .slot .name { font-size: 11px; color: #cdd6e8; }
  .slot .icon { font-size: 22px; line-height: 1; }
  .slot .cd { position: absolute; inset: 0; background: #000a; transform-origin: bottom; }
  #status { position: fixed; top: 12px; left: 12px; z-index: 10; font-size: 13px; color: #97a3bb; }
  #status b { color: #e6e9ef; }
  #help { position: fixed; top: 12px; right: 12px; z-index: 10; font-size: 12px; color: #6b7790; text-align: right; line-height: 1.6; }
  #help b { color: #aab6cf; }
</style>
</head>
<body>
<canvas id="game"></canvas>

<div id="status"></div>
<div id="help">
  <div><b>WASD / arrows</b> or <b>click/tap ground</b> to move</div>
  <div><b>Click/tap enemy</b> to target</div>
  <div><b>1-4</b> or <b>tap a slot</b> to cast on target</div>
</div>

<div id="hud"><div id="abilities"></div></div>

<div id="login">
  <div class="card">
    <h1>⚔️ DCC</h1>
    <p>Drop into the world. Pick a name.</p>
    <input id="name" maxlength="16" placeholder="Your hero name" autocomplete="off" />
    <button id="play">Enter the world</button>
    <div class="hint">Top-down co-op playground. Fight monsters, cast on each other.<br/>Share this URL with anyone to play together.</div>
  </div>
</div>

<script>
(() => {
  "use strict";

  // ---- Ability definitions (must mirror the server) ----
  const ABILITIES = [
    { key: "1", name: "Fireball",  icon: "🔥", color: "#ff6a3d", cdMs: 900 },
    { key: "2", name: "Frostbolt", icon: "❄️", color: "#5fd0ff", cdMs: 1600 },
    { key: "3", name: "Heal",      icon: "✨", color: "#5dff9b", cdMs: 5000 },
    { key: "4", name: "Smite",     icon: "⚡", color: "#ffd34d", cdMs: 600 },
  ];

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const loginEl = document.getElementById("login");
  const nameInput = document.getElementById("name");
  const statusEl = document.getElementById("status");
  const abilitiesEl = document.getElementById("abilities");

  let dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- Build ability bar ----
  const cdEls = [];
  ABILITIES.forEach((a, i) => {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML =
      '<div class="key">' + a.key + '</div>' +
      '<div class="icon">' + a.icon + '</div>' +
      '<div class="name">' + a.name + '</div>' +
      '<div class="cd"></div>';
    abilitiesEl.appendChild(slot);
    cdEls.push(slot.querySelector(".cd"));
    // Tappable on mobile / clickable on desktop. preventDefault on touchstart
    // stops the synthetic click so we don't double-cast.
    const castThis = (ev) => { ev.preventDefault(); send({ t: "cast", ability: i, target: targetId }); };
    slot.addEventListener("touchstart", castThis, { passive: false });
    slot.addEventListener("click", castThis);
  });

  // ---- Networking ----
  let ws = null;
  let selfId = null;
  let world = { w: 2400, h: 2400 };
  let cooldowns = {}; // ability index -> ready-at (server logical ms)
  let serverNow = 0;

  // Snapshots for interpolation
  let prev = null, cur = null, prevRecv = 0, curRecv = 0;

  function connect(name) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws");
    ws.onopen = () => ws.send(JSON.stringify({ t: "join", name }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "welcome") {
        selfId = m.id;
        world = m.world;
        loginEl.style.display = "none";
      } else if (m.t === "state") {
        prev = cur; prevRecv = curRecv;
        cur = m; curRecv = performance.now();
        serverNow = m.now;
        if (m.cds) cooldowns = m.cds;
        for (const e of m.events) spawnFx(e);
      }
    };
    ws.onclose = () => {
      statusEl.innerHTML = '<b style="color:#ff6a6a">Disconnected.</b> Refresh to rejoin.';
    };
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  // ---- Input ----
  let camX = 0, camY = 0;
  let targetId = null;

  function screenToWorld(sx, sy) {
    return { x: sx - window.innerWidth / 2 + camX, y: sy - window.innerHeight / 2 + camY };
  }

  // Find an entity (monster or other player) near a world point.
  function pickEntity(wx, wy) {
    if (!cur) return null;
    let best = null, bestD = 34 * 34;
    const consider = (ent, kind) => {
      if (ent.dead) return;
      if (kind === "player" && ent.id === selfId) return;
      const dx = ent.x - wx, dy = ent.y - wy, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { id: ent.id, kind }; }
    };
    for (const mo of cur.monsters) consider(mo, "monster");
    for (const p of cur.players) consider(p, "player");
    return best;
  }

  // Tap/click on the world: target an entity if one is under the point,
  // otherwise move there. Shared by mouse and touch so mobile works too.
  function handleTap(clientX, clientY) {
    if (!cur) return;
    const w = screenToWorld(clientX, clientY);
    const hit = pickEntity(w.x, w.y);
    if (hit) {
      targetId = hit.id;
    } else {
      send({ t: "move", x: Math.round(w.x), y: Math.round(w.y) });
    }
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    handleTap(e.clientX, e.clientY);
  });
  canvas.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    if (t) handleTap(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // WASD / arrow keys: continuous directional movement. We track held keys and
  // send a direction vector whenever it changes; the server moves us each tick.
  const MOVE_KEYS = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  const held = new Set();
  function sendDir() {
    let dx = 0, dy = 0;
    if (held.has("w") || held.has("arrowup")) dy -= 1;
    if (held.has("s") || held.has("arrowdown")) dy += 1;
    if (held.has("a") || held.has("arrowleft")) dx -= 1;
    if (held.has("d") || held.has("arrowright")) dx += 1;
    send({ t: "dir", dx, dy });
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const idx = ["1", "2", "3", "4"].indexOf(e.key);
    if (idx >= 0) { send({ t: "cast", ability: idx, target: targetId }); return; }
    if (MOVE_KEYS.includes(k)) {
      if (k.startsWith("arrow")) e.preventDefault();
      if (!held.has(k)) { held.add(k); sendDir(); }
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (held.has(k)) { held.delete(k); sendDir(); }
  });
  // Releasing focus (alt-tab, etc.) shouldn't leave us walking forever.
  window.addEventListener("blur", () => { if (held.size) { held.clear(); sendDir(); } });

  // ---- Floating combat text / cast FX ----
  const fx = [];
  function spawnFx(e) {
    if (e.type === "dmg") fx.push({ kind: "text", x: e.x, y: e.y, vy: -34, life: 0, ttl: 0.9, text: "-" + e.amount, color: "#ff7a6b" });
    else if (e.type === "heal") fx.push({ kind: "text", x: e.x, y: e.y, vy: -34, life: 0, ttl: 0.9, text: "+" + e.amount, color: "#5dff9b" });
    else if (e.type === "death") fx.push({ kind: "ring", x: e.x, y: e.y, life: 0, ttl: 0.5, color: "#ffffff" });
    else if (e.type === "cast") fx.push({ kind: "ring", x: e.x, y: e.y, life: 0, ttl: 0.35, color: e.color || "#8aa0ff" });
  }

  // ---- Interpolated lookups ----
  function lerpEntities(list) {
    // Build id -> prev pos for smoothing
    const out = [];
    let alpha = 1;
    if (prev && cur && curRecv > prevRecv) {
      const dt = curRecv - prevRecv;
      alpha = Math.min(1, (performance.now() - curRecv) / dt);
    }
    const prevMap = {};
    if (prev) for (const e of prev[list]) prevMap[e.id] = e;
    for (const e of cur[list]) {
      const p = prevMap[e.id];
      const x = p ? p.x + (e.x - p.x) * alpha : e.x;
      const y = p ? p.y + (e.y - p.y) * alpha : e.y;
      out.push(Object.assign({}, e, { x, y }));
    }
    return out;
  }

  // ---- Rendering ----
  function drawGrid() {
    const G = 80;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#161d2e";
    const x0 = -window.innerWidth / 2 + camX, y0 = -window.innerHeight / 2 + camY;
    const startX = Math.floor(x0 / G) * G, startY = Math.floor(y0 / G) * G;
    for (let x = startX; x < x0 + window.innerWidth + G; x += G) {
      const sx = x - camX + window.innerWidth / 2;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, window.innerHeight); ctx.stroke();
    }
    for (let y = startY; y < y0 + window.innerHeight + G; y += G) {
      const sy = y - camY + window.innerHeight / 2;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(window.innerWidth, sy); ctx.stroke();
    }
    // World bounds
    ctx.strokeStyle = "#2a3a5e"; ctx.lineWidth = 3;
    ctx.strokeRect(0 - camX + window.innerWidth / 2, 0 - camY + window.innerHeight / 2, world.w, world.h);
  }

  function bar(x, y, w, h, frac, color) {
    ctx.fillStyle = "#0009"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    ctx.strokeStyle = "#0008"; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  }

  function drawActor(e, opts) {
    const sx = e.x - camX + window.innerWidth / 2;
    const sy = e.y - camY + window.innerHeight / 2;
    const r = opts.r;
    // Target ring
    if (e.id === targetId) {
      ctx.strokeStyle = "#ffd34d"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx, sy, r + 7, 0, Math.PI * 2); ctx.stroke();
    }
    // Shadow
    ctx.fillStyle = "#0006";
    ctx.beginPath(); ctx.ellipse(sx, sy + r * 0.7, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    // Body
    ctx.fillStyle = e.dead ? "#3a3f4b" : opts.color;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = opts.stroke; ctx.stroke();
    // HP bar
    if (!e.dead) bar(sx - r, sy - r - 12, r * 2, 5, e.hp / e.maxHp, opts.hp);
    // Name / label
    if (opts.label) {
      ctx.fillStyle = opts.labelColor || "#cdd6e8";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText(opts.label + (e.dead ? " 💀" : ""), sx, sy - r - 18);
    }
  }

  function render() {
    requestAnimationFrame(render);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!cur) return;

    const players = lerpEntities("players");
    const monsters = lerpEntities("monsters");
    const me = players.find((p) => p.id === selfId);
    if (me) { camX += (me.x - camX) * 0.18; camY += (me.y - camY) * 0.18; }

    drawGrid();

    // Projectiles
    for (const pr of cur.projectiles) {
      const sx = pr.x - camX + window.innerWidth / 2;
      const sy = pr.y - camY + window.innerHeight / 2;
      const ab = ABILITIES[pr.ability] || ABILITIES[0];
      ctx.fillStyle = ab.color;
      ctx.shadowColor = ab.color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const mo of monsters) {
      drawActor(mo, { r: 20, color: "#b6433d", stroke: "#e0635c", hp: "#ff5a4d", label: "Monster", labelColor: "#e89a93" });
    }
    for (const p of players) {
      const isSelf = p.id === selfId;
      drawActor(p, {
        r: 17,
        color: isSelf ? "#4f8cff" : "#7c5cff",
        stroke: isSelf ? "#9dc0ff" : "#b6a4ff",
        hp: "#54d98c",
        label: p.name + (p.kills ? " (" + p.kills + ")" : ""),
        labelColor: isSelf ? "#bcd4ff" : "#cdc4ff",
      });
    }

    // FX layer
    const dt = 1 / 60;
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.life += dt;
      if (f.life >= f.ttl) { fx.splice(i, 1); continue; }
      const sx = f.x - camX + window.innerWidth / 2;
      const sy = f.y - camY + window.innerHeight / 2;
      const t = f.life / f.ttl;
      if (f.kind === "text") {
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = f.color;
        ctx.font = "bold 18px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(f.text, sx, sy + f.vy * f.life);
        ctx.globalAlpha = 1;
      } else if (f.kind === "ring") {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = f.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx, sy, 8 + t * 30, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Update ability cooldown overlays
    ABILITIES.forEach((a, i) => {
      const ready = cooldowns[i] || 0;
      const remaining = Math.max(0, ready - serverNow);
      const cdEl = cdEls[i];
      if (remaining > 0) {
        cdEl.style.transform = "scaleY(" + Math.min(1, remaining / a.cdMs) + ")";
      } else {
        cdEl.style.transform = "scaleY(0)";
      }
    });

    // Status line
    if (me) {
      statusEl.innerHTML =
        "<b>" + me.name + "</b> &nbsp; HP " + Math.max(0, Math.round(me.hp)) + "/" + me.maxHp +
        " &nbsp; Kills <b>" + (me.kills || 0) + "</b> &nbsp; Players <b>" + players.length + "</b>" +
        (me.dead ? ' &nbsp; <span style="color:#ff6a6a">Respawning…</span>' : "");
    }
  }
  requestAnimationFrame(render);

  // ---- Login flow ----
  function start() {
    const name = (nameInput.value || "").trim() || "Hero" + Math.floor(Math.random() * 999);
    connect(name.slice(0, 16));
  }
  document.getElementById("play").addEventListener("click", start);
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") start(); });
  nameInput.focus();
})();
</script>
</body>
</html>`;
