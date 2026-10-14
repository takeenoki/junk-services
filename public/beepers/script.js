import { AudioEngine, TONES } from "./audio.js";
const element = (id) => document.getElementById(id);
const overlay = element("overlay");
const message = element("message");
const buttons = [];
const sampleButtons = [];
const clearButton = element("clear");
let debugMode = false;
let clearing = false;
let track;
let offset = 0;
let nextPostAtMs = 0;
let connected = false;
let engine;
let socket;
let reconnectTimer = 0;
let retries = 0;
let generation = 0;
let earliestAudioMs = Infinity;
let lastSchedulerTime = 0;
const eligible = new Map();
const reservations = new Map();
const serverNow = () => Date.now() + offset;
const loopStart = (now) => track.epochMs + Math.floor((now - track.epochMs) / 10000) * 10000;
let holding;
let starting = false;
function cancelReservations() {
    for (const item of reservations.values())
        item.voice.stop();
    reservations.clear();
}
function apply(snapshot, initial = false) {
    if (track && snapshot.version < track.version)
        return;
    if (initial) {
        cancelReservations();
        eligible.clear();
        earliestAudioMs = serverNow();
    }
    const previous = new Map(track?.sounds.map(sound => [sound.id, sound]) ?? []);
    track = snapshot;
    const now = serverNow();
    for (const sound of snapshot.sounds) {
        if (!eligible.has(sound.id))
            eligible.set(sound.id, initial ? now : loopStart(now) + 10000);
    }
    for (const id of eligible.keys())
        if (!snapshot.sounds.some(sound => sound.id === id))
            eligible.delete(id);
    for (const [key, item] of reservations) {
        const sound = snapshot.sounds.find(sound => sound.id === item.sound.id);
        if (!sound || (item.startMs > now && previous.get(sound.id)?.durationMs !== sound.durationMs)) {
            item.voice.stop();
            reservations.delete(key);
        }
        else {
            item.voice.level(Math.pow(.95, snapshot.nextSequence - 1 - sound.sequence));
        }
    }
    if (snapshot.nextPostAtMs !== undefined)
        nextPostAtMs = snapshot.nextPostAtMs;
    if (snapshot.debugMode !== undefined) {
        debugMode = snapshot.debugMode;
        clearButton.hidden = !debugMode;
        element("post-hint").textContent = `${debugMode ? "5秒" : "1時間"}に一度音を追加できます。`;
    }
    render();
}
function render() {
    if (!track)
        return;
    element("count").textContent = String(track.sounds.length);
    element("empty").hidden = track.sounds.length > 0;
    const container = element("sounds");
    container.replaceChildren();
    for (const sound of track.sounds) {
        const segments = [[sound.positionMs, Math.min(sound.durationMs, 10000 - sound.positionMs)]];
        if (sound.positionMs + sound.durationMs > 10000)
            segments.push([0, sound.positionMs + sound.durationMs - 10000]);
        for (const [position, length] of segments) {
            const bar = document.createElement("div");
            bar.className = `sound ${sound.status}`;
            bar.style.left = `${position / 100}%`;
            bar.style.width = `${length / 100}%`;
            bar.style.top = `${(sound.sequence % 20) * 4.7 + 2}%`;
            bar.style.opacity = String(.15 + .85 * Math.pow(.95, track.nextSequence - 1 - sound.sequence));
            bar.title = `${TONES[sound.type - 1]} · ${(sound.positionMs / 1000).toFixed(2)}s · ${(sound.durationMs / 1000).toFixed(2)}s`;
            container.append(bar);
        }
    }
}
async function synchronize(initial = false) {
    const started = Date.now();
    const response = await fetch("/api/beepers/state", { cache: "no-store" });
    if (!response.ok)
        throw new Error("同期に失敗しました。");
    const data = await response.json();
    offset = data.serverTimeMs - (started + Date.now()) / 2;
    apply(data, initial);
}
async function connect() {
    const current = ++generation;
    try {
        await synchronize(true);
        if (current !== generation)
            return;
        socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/beepers/ws`);
        socket.onmessage = event => {
            if (current !== generation)
                return;
            try {
                apply(JSON.parse(event.data));
            }
            catch {
                message.textContent = "同期データを読み取れませんでした。";
            }
        };
        socket.onopen = () => {
            if (current !== generation)
                return;
            connected = true;
            retries = 0;
            element("connection").textContent = "● LIVE / SHARED TRACK";
            message.textContent = "";
        };
        socket.onclose = () => { if (current === generation)
            disconnected(); };
        socket.onerror = () => socket?.close();
    }
    catch {
        if (current === generation)
            disconnected();
    }
}
function disconnected() {
    connected = false;
    cancelReservations();
    element("connection").textContent = "再接続中…";
    clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, Math.min(10000, 500 * 2 ** retries++));
}
function schedule() {
    if (!engine || engine.context.state !== "running" || !track || !connected || document.hidden)
        return;
    const now = serverNow();
    if (lastSchedulerTime && now - lastSchedulerTime > 500) {
        cancelReservations();
        earliestAudioMs = now;
    }
    lastSchedulerTime = now;
    for (const [key, item] of reservations)
        if (item.voice.end < engine.context.currentTime)
            reservations.delete(key);
    const start = loopStart(now);
    for (const sound of track.sounds) {
        for (const boundary of [start, start + 10000]) {
            const startMs = boundary + sound.positionMs;
            if (startMs < now + 5 || startMs < earliestAudioMs ||
                startMs < (eligible.get(sound.id) ?? Infinity) || startMs > now + 150)
                continue;
            const key = `${sound.id}:${boundary}`;
            if (reservations.has(key))
                continue;
            const voice = engine.voice(sound.type, engine.context.currentTime + (startMs - now) / 1000, sound.durationMs / 1000, Math.pow(.95, track.nextSequence - 1 - sound.sequence));
            reservations.set(key, { sound, startMs, voice });
        }
    }
}
function updateUi() {
    const now = serverNow();
    if (track) {
        const position = ((now - track.epochMs) % 10000 + 10000) % 10000;
        element("playhead").style.left = `${position / 100}%`;
        element("position").textContent = (position / 1000).toFixed(2);
    }
    const remaining = Math.max(0, Math.ceil((nextPostAtMs - now) / 1000));
    element("availability").textContent = remaining ? `次の投稿まで ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : connected ? "投稿できます" : "接続を待っています。";
    for (const button of buttons)
        button.disabled = holding?.button === button ? false :
            !connected || remaining > 0 || starting || clearing || Boolean(holding) || !engine;
    for (const button of sampleButtons)
        button.disabled = Boolean(holding && holding.button !== button) || !engine;
    clearButton.disabled = !connected || starting || clearing || Boolean(holding);
    requestAnimationFrame(updateUi);
}
async function post(path, data) {
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            response = await fetch(`/api/beepers/${path}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data), signal: AbortSignal.timeout(5000),
            });
            break;
        }
        catch {
            if (attempt === 1)
                throw new Error("通信できませんでした。接続を確認してください。");
        }
    }
    if (!response)
        throw new Error("投稿に失敗しました。");
    const result = await response.json();
    if (!response.ok) {
        if (result.nextPostAtMs)
            nextPostAtMs = result.nextPostAtMs;
        throw new Error(result.error ?? "投稿に失敗しました。");
    }
    return result;
}
async function finish(operation) {
    if (!operation.id || !operation.token || operation.duration === undefined)
        return;
    try {
        apply(await post("finish", { id: operation.id, token: operation.token, durationMs: operation.duration }));
        message.textContent = `音を残しました。長さ ${(operation.duration / 1000).toFixed(2)}秒。`;
    }
    catch {
        message.textContent = "長さを送信できませんでした。音は最大3秒で確定します。";
    }
}
function release() {
    if (!holding)
        return;
    const operation = holding;
    operation.duration = Math.round(Math.min(3000, Math.max(50, performance.now() - operation.started)));
    operation.voice.stop(engine.context.currentTime + Math.max(0, 50 - (performance.now() - operation.started)) / 1000);
    clearTimeout(operation.timer);
    operation.button.classList.remove("holding");
    holding = undefined;
    if (!operation.sample)
        void finish(operation);
}
for (const sample of [true, false]) {
    for (const [index, name] of TONES.entries()) {
        const button = document.createElement("button");
        button.className = "tone";
        button.type = "button";
        button.disabled = true;
        button.innerHTML = `<span class="number">${String(index + 1).padStart(2, "0")}</span><span class="name">${name}</span>`;
        button.setAttribute("aria-label", `${name}を長押しして${sample ? "試聴" : "投稿"}`);
        button.oncontextmenu = event => event.preventDefault();
        button.onpointerdown = async (event) => {
            if (event.button !== 0 || holding || !engine || (!sample &&
                (starting || clearing || !connected || nextPostAtMs > serverNow())))
                return;
            event.preventDefault();
            void fetch("/api/beepers/log", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ operation: sample ? "SAMPLE" : "PUT", type: index + 1 }),
                signal: AbortSignal.timeout(5000),
            }).catch(() => { });
            if (event.isTrusted)
                button.setPointerCapture(event.pointerId);
            const pressedAtMs = serverNow();
            void engine.context.resume();
            const operation = { button, pointer: event.pointerId, started: performance.now(),
                voice: engine.voice(index + 1, engine.context.currentTime, 3, 1),
                timer: window.setTimeout(release, 3000), requestId: crypto.randomUUID(), sample,
            };
            holding = operation;
            button.classList.add("holding");
            if (sample)
                return;
            starting = true;
            message.textContent = "投稿しています…";
            try {
                const result = await post("start", { type: index + 1, pressedAtMs, requestId: operation.requestId });
                operation.id = result.id;
                operation.token = result.token;
                apply(result);
                if (operation.duration !== undefined)
                    await finish(operation);
                else
                    message.textContent = "押している間、音が続きます。";
            }
            catch (error) {
                operation.voice.stop();
                clearTimeout(operation.timer);
                operation.button.classList.remove("holding");
                if (holding === operation)
                    holding = undefined;
                message.textContent = error.message;
                void synchronize().catch(() => { });
            }
            finally {
                starting = false;
            }
        };
        button.onpointerup = event => { if (holding?.pointer === event.pointerId)
            release(); };
        button.onpointercancel = button.onlostpointercapture = () => { if (holding?.button === button)
            release(); };
        // Keyboard uses the same committed press/release operation.
        button.onkeydown = event => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                event.preventDefault();
                button.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 0 }));
            }
        };
        button.onkeyup = event => { if (event.key === " " || event.key === "Enter")
            release(); };
        (sample ? sampleButtons : buttons).push(button);
        element(sample ? "sample-buttons" : "buttons").append(button);
    }
}
function selectTab(sample) {
    release();
    for (const [id, selected] of [["sample", sample], ["post", !sample]]) {
        const tab = element(`${id}-tab`);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        element(`${id}-panel`).hidden = !selected;
    }
}
for (const id of ["sample", "post"]) {
    const tab = element(`${id}-tab`);
    tab.onclick = () => selectTab(id === "sample");
    tab.onkeydown = event => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const sample = event.key === "Home" || (event.key !== "End" && id === "post");
            selectTab(sample);
            element(sample ? "sample-tab" : "post-tab").focus();
        }
    };
}
clearButton.onclick = async () => {
    if (!debugMode || clearing || starting || holding || !connected)
        return;
    clearing = true;
    try {
        apply(await post("clear", {}));
        message.textContent = "共有トラックの音をクリアしました。";
    }
    catch (error) {
        message.textContent = error.message;
    }
    finally {
        clearing = false;
    }
};
overlay.onclick = async () => {
    try {
        engine ??= new AudioEngine();
        await engine.context.resume();
        earliestAudioMs = serverNow();
        overlay.hidden = true;
    }
    catch {
        message.textContent = "音声を開始できませんでした。もう一度タップしてください。";
    }
};
document.addEventListener("visibilitychange", () => {
    release();
    cancelReservations();
    lastSchedulerTime = 0;
    if (!document.hidden) {
        earliestAudioMs = serverNow();
        void synchronize(true).catch(() => { });
        if (engine)
            void engine.context.resume();
    }
});
window.addEventListener("blur", release);
window.addEventListener("pointerup", event => { if (holding?.pointer === event.pointerId)
    release(); });
window.addEventListener("online", () => { if (!connected) {
    clearTimeout(reconnectTimer);
    void connect();
} });
setInterval(schedule, 25);
setInterval(() => { if (connected && !document.hidden)
    void synchronize().catch(() => { }); }, 30000);
void connect();
requestAnimationFrame(updateUi);
