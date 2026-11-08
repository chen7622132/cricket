import * as PIXI from "pixi.js";
import {
  AlphaBehaviour,
  CircleSpawnBehaviour,
  Emitter,
  RadialBurstBehaviour,
  StaticScaleBehaviour,
} from "pixi-particles-engine";

function makeSparkTexture(): PIXI.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 6;
  canvas.height = 6;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(3, 3, 0, 3, 3, 3);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,220,140,0.9)");
    grad.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(3, 3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = PIXI.Texture.from(canvas);
  tex.source.scaleMode = "nearest";
  return tex;
}

/**
 * 命中碎屑：环形爆发（中心留空，不糊角色），加色混合、低 alpha、短寿命。
 * manual 模式：只有命中 cue 触发 emitBurst。
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
          maxParticles: 12,
          mode: "manual",
          lifetime: { min: 0.12, max: 0.28 },
          behaviours: [
            // 环状出生：innerRadius 让爆发中心留空
            new CircleSpawnBehaviour(22, 11),
            new RadialBurstBehaviour(40, 130, 0, Math.PI * 2),
            new StaticScaleBehaviour(1.1),
            new AlphaBehaviour(0.85, 0),
          ],
        },
        provider,
      );
      emitter.blendMode = "add";
      this.emitters.push(emitter);
    }
  }

  burst(x: number, y: number, count: number): void {
    const emitter = this.emitters[this.cursor % this.emitters.length];
    this.cursor++;
    emitter.position.set(x, y);
    emitter.emitBurst(Math.min(12, count));
  }

  update(dtMs: number): void {
    const ticker = { deltaMS: dtMs } as unknown as PIXI.Ticker;
    for (const emitter of this.emitters) emitter.updateEmitter(ticker);
  }
}
