/**
 * 确定性随机数：mulberry32。
 *
 * 引擎里禁止 Math.random / Date.now —— 所有随机都必须从这里取，
 * 并且带标签记录（frame + label + value），这样"换个种子为什么不一样"
 * 可以从日志里逐条对出来。
 */
export interface RngDraw {
  frame: number;
  label: string;
  value: number;
}

export class Rng {
  readonly seed: number;
  readonly draws: RngDraw[] = [];
  private s: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.s = (this.seed || 0x9e3779b9) >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 取一个随机数并记录，日志复盘用。 */
  draw(label: string, frame: number): number {
    const v = this.next();
    this.draws.push({ frame, label, value: v });
    return v;
  }

  chance(p: number, label: string, frame: number): boolean {
    return this.draw(label, frame) < p;
  }

  range(min: number, max: number, label: string, frame: number): number {
    return min + this.draw(label, frame) * (max - min);
  }

  int(n: number, label: string, frame: number): number {
    return Math.floor(this.draw(label, frame) * n);
  }
}
