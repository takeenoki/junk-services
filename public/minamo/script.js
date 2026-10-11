import { advance, PARAMETERS as P } from "./physics.js";

const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
const mode = document.querySelector("#mode");
const status = document.querySelector("#status");
let surface = { leaves: [], ripples: [] };
let socket;
let connected = false;
let pending = false;
let retry = 1000;
let offset = 0;
let stoneAt = -Infinity;
let leafAt = readLeafCookie();
let width = 0;
let height = 0;
let scale = 1;
const corrections = new Map();

function readLeafCookie() {
  const value = document.cookie.split("; ").find(item => item.startsWith("minamo_leaf="));
  const time = Number(value?.split("=")[1]);
  return Number.isFinite(time) && time > 0 ? time : -Infinity;
}

function connect() {
  socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/minamo`);
  socket.addEventListener("message", ({ data }) => {
    const event = JSON.parse(data);
    if (event.time) offset = event.time - Date.now();
    if (event.type === "init" || event.type === "state_update") {
      const incoming = { leaves: event.leaves, ripples: event.ripples };
      advance(incoming, Date.now() + offset);
      for (const leaf of incoming.leaves) {
        const previous = surface.leaves.find(item => item.id === leaf.id);
        if (previous) corrections.set(leaf.id, {
          x: previous.x - leaf.x, y: previous.y - leaf.y, at: performance.now(),
        });
      }
      surface = incoming;
      if (event.type === "init") {
        connected = true;
        retry = 1000;
        status.textContent = "水面をクリック";
      }
    } else if (event.type === "stone") {
      surface.ripples.push(event.ripple);
    } else if (event.type === "leaf") {
      surface.leaves.push(event.leaf);
      surface.ripples = event.ripples;
    } else if (event.type === "leaf_remove") {
      surface.leaves = surface.leaves.filter(leaf => leaf.id !== event.id);
      corrections.delete(event.id);
    } else if (event.type === "error") {
      pending = false;
      status.textContent = event.message;
    }
    if (event.own) {
      pending = false;
      if (event.type === "stone") stoneAt = performance.now();
      if (event.type === "leaf") {
        leafAt = Date.now();
        document.cookie = `minamo_leaf=${leafAt}; Max-Age=3600; Path=/minamo; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      }
      status.textContent = "水面をクリック";
    }
  });
  socket.addEventListener("close", () => {
    connected = false;
    pending = false;
    stoneAt = -Infinity;
    status.textContent = "再接続しています…";
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 15000);
  });
  socket.addEventListener("error", () => socket.close());
}

function resize() {
  const box = canvas.getBoundingClientRect();
  width = box.width;
  height = box.height;
  scale = Math.min(width, height) / P.worldSize;
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

canvas.addEventListener("click", event => {
  if (!connected || pending) return;
  leafAt = readLeafCookie();
  const type = Date.now() - leafAt >= P.leafCooldown ? "leaf" : "stone";
  if (type === "stone" && performance.now() - stoneAt < P.stoneCooldown) return;
  const box = canvas.getBoundingClientRect();
  const x = (event.clientX - box.left - width / 2) / scale + P.worldSize / 2;
  const y = (event.clientY - box.top - height / 2) / scale + P.worldSize / 2;
  if (x < 0 || y < 0 || x > P.worldSize || y > P.worldSize) {
    status.textContent = "水面の内側をクリックしてください";
    return;
  }
  pending = true;
  socket.send(JSON.stringify({ type, x, y }));
});

function gauge(name, remaining, duration) {
  document.querySelector(`#${name}`).value = 1 - remaining / duration;
  document.querySelector(`#${name}-time`).textContent = remaining <= 0 ? "投入できます" :
    remaining >= 60000 ? `${Math.ceil(remaining / 60000)}分` : `${Math.ceil(remaining / 1000)}秒`;
}

function draw() {
  const now = Date.now() + offset;
  advance(surface, now);
  context.fillStyle = "#102b30";
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(width / 2, height / 2);
  context.scale(scale, scale);
  context.translate(-500, -500);
  context.fillStyle = "#193d40";
  context.fillRect(0, 0, 1000, 1000);
  context.save();
  context.beginPath();
  context.rect(0, 0, 1000, 1000);
  context.clip();
  for (let row = 0; row < 24; row++) {
    context.beginPath();
    for (let x = 0; x <= 1000; x += 20) {
      const y = row * 45 + Math.sin((x - now / 140) / 110 + row) * 5;
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.strokeStyle = "#bad1b908";
    context.lineWidth = 1 / scale;
    context.stroke();
  }
  for (const ripple of surface.ripples) {
    const age = now - ripple.createdAt;
    for (let ring = 0; ring < 3; ring++) {
      const radius = age / 1000 * P.rippleSpeed - ring * 13;
      if (radius <= 0) continue;
      context.beginPath();
      context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(204,225,212,${Math.max(0, 1 - age / P.rippleLifetime) * (0.4 - ring * .09)})`;
      context.lineWidth = 1.3 / scale;
      context.stroke();
    }
  }
  for (const leaf of surface.leaves) {
    const correction = corrections.get(leaf.id);
    const blend = correction ? Math.max(0, 1 - (performance.now() - correction.at) / 400) : 0;
    if (!blend) corrections.delete(leaf.id);
    context.save();
    context.translate(leaf.x + (correction?.x ?? 0) * blend, leaf.y + (correction?.y ?? 0) * blend);
    context.rotate(Math.sin(leaf.createdAt) * 3 + Math.sin(now / 3000 + leaf.createdAt) * .15);
    context.beginPath();
    context.moveTo(-12, 0);
    context.bezierCurveTo(-4, -12, 9, -10, 14, 0);
    context.bezierCurveTo(5, 10, -5, 9, -12, 0);
    context.fillStyle = "#bb9658";
    context.fill();
    context.beginPath();
    context.moveTo(-15, 0);
    context.lineTo(10, 0);
    context.strokeStyle = "#75603e";
    context.lineWidth = .8;
    context.stroke();
    context.restore();
  }
  context.restore();
  context.restore();
  leafAt = readLeafCookie();
  const leafRemaining = Math.max(0, P.leafCooldown - (Date.now() - leafAt));
  const stoneRemaining = Math.max(0, P.stoneCooldown - (performance.now() - stoneAt));
  gauge("leaf", leafRemaining, P.leafCooldown);
  gauge("stone", stoneRemaining, P.stoneCooldown);
  mode.textContent = !connected ? "水面に接続しています" : pending ? "水面に届けています" :
    leafRemaining === 0 ? "落ち葉を浮かべる" : stoneRemaining === 0 ? "小石を投げる" : "波紋を眺める";
  requestAnimationFrame(draw);
}

new ResizeObserver(resize).observe(canvas);
resize();
connect();
draw();
