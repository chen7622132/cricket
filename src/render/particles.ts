import * as PIXI from "pixi.js";
import {
  AlphaBehaviour,
  Emitter,
  RadialBurstBehaviour,
  StaticScaleBehaviour,
} from "pixi-particles-engine";

function makeSparkTexture(): PIXI.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,226,150,0.95)");
    grad.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(4, 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = PIXI.Texture.from(canvas);
  tex.source.scaleMode = "nearest";
  return tex;
}

/**
 * pixi-particles-engine 的命中粒子池。
 * 用 manual 模式：只有命中 cue 触发 emitBurst，平时不耗粒子；每帧手动驱动 updateEmitter。
 */
export class HitParticles {
  readonly emitters: Emitter[] = [];
  private cursor = 0;

  constructor() {
    const texture = makeSparkTexture();
    const provider = {
      initialTexture: () => texture,
      textureForSpawn: () => texture,
    };

    for (let i = 0; i < 4; i++) {
      const emitter = new Emitter(
        {
          maxParticles: 80,
          mode: "manual",
          lifetime: { min: 0.18, max: 0.5 },
          behaviours: [
            new RadialBurstBehaviour(40, 170, 0, Math.PI * 2),
            new StaticScaleBehaviour(1.4),
            new AlphaBehaviour(1, 0),
          ],
        },
        provider,
      );
      this.emitters.push(emitter);
    }
  }

  burst(x: number, y: number, count: number): void {
    const emitter = this.emitters[this.cursor % this.emitters.length];
    this.cursor++;
    emitter.position.set(x, y);
    emitter.emitBurst(count);
  }

  update(dtMs: number): void {
    const ticker = { deltaMS: dtMs } as unknown as PIXI.Ticker;
    for (const emitter of this.emitters) emitter.updateEmitter(ticker);
  }
}
