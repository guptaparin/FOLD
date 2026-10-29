/**
 * Procedural sound: paper rustle tied to fold speed, a crisp crease snap,
 * Karplus–Strong koto plucks on a pentatonic scale, and a night ambience of
 * wind and crickets. No audio files are downloaded.
 */

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private rustleGain: GainNode | null = null;
  private rustleFilter: BiquadFilterNode | null = null;
  private plucks = new Map<number, AudioBuffer>();
  private ambienceOn = false;
  private nextPluck = 0;
  private reverb!: ConvolverNode;
  muted = false;
  musicLevel = 0.55;
  /** Root note of the generative music, changes per chapter. */
  root = 57;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicLevel;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.25;
    this.sfxBus.connect(sfxSend).connect(this.reverb);
    // One second of white noise, reused everywhere.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startRustleBed();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.1);
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  /** Continuous paper rustle; level driven by fold speed every frame. */
  private startRustleBed(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(hp).connect(g).connect(this.sfxBus);
    src.start();
    this.rustleGain = g;
    this.rustleFilter = bp;
  }

  /** speed: radians per second of the fold being dragged. */
  rustle(speed: number): void {
    if (!this.ctx || !this.rustleGain || !this.rustleFilter) return;
    const v = Math.min(1, Math.abs(speed) / 6);
    // Crinkly: jitter the band so it never sounds like plain hiss.
    const t = this.ctx.currentTime;
    this.rustleGain.gain.setTargetAtTime(v * 0.22 * (0.7 + Math.random() * 0.6), t, 0.03);
    this.rustleFilter.frequency.setTargetAtTime(1600 + v * 2600 + Math.random() * 900, t, 0.02);
  }

  private burst(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', at = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', at = 0, bus?: AudioNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Light tick when fingers take hold of the paper. */
  pickup(): void {
    if (!this.ctx) return;
    this.burst(0.05, 4200, 1.2, 0.25);
    this.burst(0.09, 1800, 0.8, 0.12, 'bandpass', 0.01);
  }

  /** The satisfying snap of a crease being pressed flat. */
  crease(step = 0): void {
    if (!this.ctx) return;
    this.burst(0.035, 5200, 0.9, 0.55, 'highpass');
    this.burst(0.16, 900, 0.7, 0.35);
    this.tone(90, 0.12, 0.25, 'sine', 0.005);
    // A rising pluck for progress.
    this.pluck(this.root + PENTA[Math.min(PENTA.length - 1, 4 + step)], 0.4, 0.04);
  }

  private rainGain: GainNode | null = null;

  /** Soft rain on paper; level 0..1. Used by the Shelter chapter. */
  setRain(level: number): void {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7000;
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(hp).connect(lp).connect(this.rainGain).connect(this.musicBus);
      src.start();
    }
    this.rainGain.gain.setTargetAtTime(level * 0.09, this.ctx.currentTime, 0.4);
  }

  /** A note from the pentatonic scale, `step` places up from the root. */
  note(step: number, gain = 0.3): void {
    this.pluck(this.root + PENTA[Math.max(0, Math.min(PENTA.length - 1, step))], gain);
  }

  /** Water droplet plink. */
  drip(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1400 + Math.random() * 500, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.15);
  }

  /** Air rushing past paper wings. */
  whoosh(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.6);
    f.frequency.exponentialRampToValueAtTime(600, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, 0, 1.6);
  }

  /** A slow, rising chord for the moon. */
  moonrise(): void {
    if (!this.ctx) return;
    [0, 4, 7, 12, 16].forEach((st, i) => this.tone(this.midi(this.root + 12 + st), 4, 0.035, 'sine', i * 0.35, this.musicBus));
  }

  /** A fingertip running along a crease: a short, crisp paper hiss. */
  sharpen(done = false): void {
    if (!this.ctx) return;
    this.burst(0.06, 6200, 1.4, 0.16, 'bandpass');
    if (done) this.pluck(this.root + 24, 0.22, 0.02);
  }

  /** Paper sliding back after a let-go. */
  release(): void {
    if (!this.ctx) return;
    this.burst(0.22, 1400, 0.6, 0.18);
  }

  hover(): void {
    if (!this.ctx) return;
    this.tone(1760, 0.06, 0.04, 'sine');
  }

  click(): void {
    if (!this.ctx) return;
    this.burst(0.03, 3000, 1, 0.3);
    this.pluck(this.root + 12, 0.35);
  }

  /** Chapter fanfare: a gentle rising arpeggio with a shimmer. */
  bloom(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 8; i++) this.pluck(this.root + PENTA[i], 0.5, i * 0.11);
    for (let i = 0; i < 5; i++) {
      this.tone(this.midi(this.root + 24 + PENTA[(i * 2) % PENTA.length]), 2.2, 0.03, 'sine', 0.5 + i * 0.12, this.musicBus);
    }
  }

  /** Short magical sparkle when the model comes to life. */
  sparkle(): void {
    if (!this.ctx) return;
    for (let i = 0; i < 7; i++) {
      this.tone(this.midi(this.root + 24 + PENTA[(i * 3) % PENTA.length]), 0.6, 0.035, 'triangle', i * 0.05);
    }
  }

  midi(n: number): number {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  /** Karplus–Strong plucked string, cached per note. */
  pluck(note: number, gain = 0.4, at = 0, bus?: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    let buf = this.plucks.get(note);
    if (!buf) {
      const f = this.midi(note);
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * 2.2);
      buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const period = Math.max(2, Math.round(sr / f));
      const ring = new Float32Array(period);
      for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
      let idx = 0;
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const cur = ring[idx];
        const next = ring[(idx + 1) % period];
        const val = 0.996 * 0.5 * (cur + next);
        ring[idx] = val;
        d[i] = cur * 0.6 + prev * 0.4;
        prev = cur;
        idx = (idx + 1) % period;
      }
      this.plucks.set(note, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    src.connect(lp).connect(g).connect(bus ?? this.musicBus);
    src.start(ctx.currentTime + at);
  }

  /** Night ambience: wind bed, distant crickets, sparse koto melody. */
  startAmbience(): void {
    if (!this.ctx || this.ambienceOn) return;
    this.ambienceOn = true;
    const ctx = this.ctx;
    // Wind.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.musicBus);
    src.start();
    lfo.start();
    // Soft drone.
    for (const [n, gain] of [
      [this.root - 12, 0.025],
      [this.root - 5, 0.015],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = this.midi(n);
      const og = ctx.createGain();
      og.gain.value = gain;
      o.connect(og).connect(this.musicBus);
      o.start();
    }
    this.nextPluck = ctx.currentTime + 1.5;
  }

  /** Called every frame; schedules the generative melody and crickets. */
  tick(): void {
    if (!this.ctx || !this.ambienceOn) return;
    const now = this.ctx.currentTime;
    if (now >= this.nextPluck) {
      const n = this.root + PENTA[Math.floor(Math.random() * 8)];
      this.pluck(n, 0.16 + Math.random() * 0.08);
      if (Math.random() < 0.35) this.pluck(n + (Math.random() < 0.5 ? 5 : 7), 0.08, 0.22);
      if (Math.random() < 0.25) {
        // Cricket chirp pair.
        for (let k = 0; k < 3; k++) this.tone(4300 + Math.random() * 300, 0.035, 0.012, 'sine', 0.6 + k * 0.07, this.musicBus);
      }
      this.nextPluck = now + 1.6 + Math.random() * 3.2;
    }
  }
}

export const sound = new Sound();
