export const TONES = ["BEEP", "HIGH", "LOW", "SOFT", "SQUARE", "TRIANGLE", "SAW", "HOLLOW", "UP", "DOWN", "SWEEP", "WOBBLE", "VIBRATE", "PULSE", "STUTTER", "ALARM", "DUAL", "DETUNE", "CHIME", "SPACE"];
export class AudioEngine {
    context;
    compressor;
    master;
    constructor(context = new AudioContext()) {
        this.context = context;
        this.compressor = context.createDynamicsCompressor();
        this.master = context.createGain();
        this.compressor.threshold.value = -18;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 8;
        this.compressor.attack.value = .003;
        this.compressor.release.value = .25;
        this.master.gain.value = .3;
        // A bounded transfer curve protects the output even when many voices coincide.
        const limiter = this.context.createWaveShaper();
        limiter.curve = Float32Array.from({ length: 4097 }, (_, index) => .8 * Math.tanh((index / 2048 - 1) / .8));
        limiter.oversample = "4x";
        this.compressor.connect(this.master).connect(limiter).connect(this.context.destination);
    }
    voice(type, at, duration, amplitude) {
        const context = this.context;
        const envelope = context.createGain();
        const volume = context.createGain();
        const sources = [];
        const nodes = [envelope, volume];
        const end = at + duration;
        volume.gain.value = amplitude;
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(.18, at + Math.min(.008, duration / 4));
        envelope.gain.setValueAtTime(.18, end - Math.min(.025, duration / 3));
        envelope.gain.linearRampToValueAtTime(0, end);
        envelope.connect(volume).connect(this.compressor);
        function oscillator(wave, frequency, gain = 1) {
            const source = context.createOscillator();
            const level = context.createGain();
            source.type = wave;
            source.frequency.setValueAtTime(frequency, at);
            level.gain.value = gain;
            source.connect(level).connect(envelope);
            source.start(at);
            source.stop(end + .01);
            sources.push(source);
            nodes.push(source, level);
            return source;
        }
        const waves = ["sine", "sine", "sine", "sine", "square", "triangle", "sawtooth", "triangle"];
        const frequencies = [660, 1320, 220, 440, 440, 660, 330, 550];
        const primary = oscillator(waves[type - 1] ?? "sine", frequencies[type - 1] ?? 660, type === 5 || type === 7 ? .55 : type === 4 ? .65 : 1);
        if (type === 8)
            oscillator("sine", 1100, .25);
        if (type === 9)
            primary.frequency.exponentialRampToValueAtTime(1760, end);
        if (type === 10)
            primary.frequency.exponentialRampToValueAtTime(180, end);
        if (type === 11) {
            primary.frequency.exponentialRampToValueAtTime(1400, at + duration / 2);
            primary.frequency.exponentialRampToValueAtTime(330, end);
        }
        if ([12, 13, 20].includes(type)) {
            const mod = context.createOscillator();
            const depth = context.createGain();
            mod.frequency.value = type === 12 ? 3 : type === 13 ? 24 : 1.5;
            depth.gain.value = type === 20 ? 280 : type === 12 ? 65 : 30;
            mod.connect(depth).connect(primary.frequency);
            mod.start(at);
            mod.stop(end + .01);
            sources.push(mod);
            nodes.push(mod, depth);
            if (type === 20)
                oscillator("triangle", 332, .25);
        }
        if ([14, 15, 16].includes(type)) {
            const step = type === 15 ? .055 : type === 14 ? .16 : .23;
            if (type !== 16)
                envelope.gain.cancelScheduledValues(at);
            for (let time = at; time < end; time += step) {
                if (type === 16) {
                    primary.frequency.setValueAtTime(Math.round((time - at) / step) % 2 ? 880 : 660, time);
                }
                else {
                    const gateEnd = Math.min(end, time + step * .5);
                    const fade = Math.min(.004, (gateEnd - time) / 3);
                    envelope.gain.setValueAtTime(0, time);
                    envelope.gain.linearRampToValueAtTime(.18, time + fade);
                    envelope.gain.setValueAtTime(.18, gateEnd - fade);
                    envelope.gain.linearRampToValueAtTime(0, gateEnd);
                }
            }
            envelope.gain.setValueAtTime(0, end);
        }
        if (type === 17)
            oscillator("sine", 990, .5);
        if (type === 18) {
            primary.frequency.value = 440;
            oscillator("sine", 443, .7);
        }
        if (type === 19) {
            primary.frequency.value = 880;
            oscillator("sine", 1760, .35);
            oscillator("sine", 2640, .15);
            envelope.gain.setTargetAtTime(.015, at + .01, Math.max(.03, duration / 3));
            envelope.gain.setValueAtTime(.015, end - Math.min(.02, duration / 4));
            envelope.gain.linearRampToValueAtTime(0, end);
        }
        let cleaned = 0;
        for (const source of sources)
            source.onended = () => {
                if (++cleaned === sources.length)
                    for (const node of nodes)
                        node.disconnect();
            };
        return {
            end,
            stop(atTime = context.currentTime) {
                const time = Math.max(atTime, context.currentTime);
                envelope.gain.cancelAndHoldAtTime(time);
                envelope.gain.linearRampToValueAtTime(0, time + .008);
                for (const source of sources) {
                    try {
                        source.stop(time + .01);
                    }
                    catch { }
                }
            },
            level(value) { volume.gain.setTargetAtTime(value, context.currentTime, .015); },
        };
    }
}
