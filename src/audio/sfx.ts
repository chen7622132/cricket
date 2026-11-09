/**
 * 程序化打击音效：不依赖外部音频素材，WebAudio 合成。
 * 首次用户交互后才会真正发声（浏览器自动播放策略）。
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("cricket-sfx") === "off";
    } catch {
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem("cricket-sfx", muted ? "off" : "on");
    } catch {
      /* ignore */
    }
  }

  private tone(freq: number, type: OscillatorType, dur: number, gain: number, slideTo?: number): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  private noise(dur: number, gain: number, filterFreq: number, type: BiquadFilterType = "bandpass"): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start(t);
  }

  hit(tier: "normal" | "key" | "ultimate", ranged = false): void {
    if (!this.ctx || this.muted) return;
    const heavy = tier === "ultimate";
    const key = tier === "key";
    this.noise(ranged ? 0.05 : 0.08, heavy ? 0.5 : key ? 0.35 : 0.22, ranged ? 1800 : 900);
    this.tone(heavy ? 90 : key ? 120 : 150, "square", heavy ? 0.18 : 0.09, heavy ? 0.35 : 0.18, heavy ? 45 : 80);
    if (heavy) this.noise(0.25, 0.3, 300, "lowpass");
  }

  guard(): void {
    this.noise(0.06, 0.25, 2400);
    this.tone(1300, "triangle", 0.08, 0.12, 900);
  }

  whoosh(): void {
    this.noise(0.1, 0.12, 700);
  }

  projectile(): void {
    this.tone(520, "triangle", 0.09, 0.1, 900);
  }

  ko(): void {
    this.tone(70, "sine", 0.6, 0.35, 35);
    this.noise(0.5, 0.25, 200, "lowpass");
  }
}

export const sfx = new Sfx();
