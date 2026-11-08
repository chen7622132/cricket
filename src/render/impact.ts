import * as PIXI from "pixi.js";
import type { Tier } from "../engine/types.ts";

interface LineFx {
  g: PIXI.Graphics;
  life: number;
  max: number;
}

interface ShardFx {
  g: PIXI.Graphics;
  vx: number;
  vy: number;
  life: number;
}

interface FlashStep {
  color: number;
  alpha: number;
  ms: number;
}

/**
 * 火柴人式打击层：
 * - impact frame：1-2 帧全屏高对比闪白/闪黑（不是慢慢淡出的柔光）
 * - 放射速度线：命中点向外 8-14 条硬直线，120ms 内消失
 * - 硬边碎屑：小方块抛射 + 重力，不用柔边粒子
 */
export class ImpactFx {
  readonly container = new PIXI.Container();
  private readonly flash = new PIXI.Graphics();
  private readonly lineLayer = new PIXI.Container();
  private readonly shardLayer = new PIXI.Container();

  private steps: FlashStep[] = [];
  private stepMs = 0;
  private lines: LineFx[] = [];
  private shards: ShardFx[] = [];

  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {
    this.flash.alpha = 0;
    this.container.addChild(this.flash, this.lineLayer, this.shardLayer);
  }

  trigger(x: number, y: number, dir: number, tier: Tier): void {
    const heavy = tier === "ultimate";
    const key = tier === "key";

    if (heavy) {
      this.steps = [
        { color: 0xffffff, alpha: 0.95, ms: 17 },
        { color: 0x0b0d12, alpha: 0.4, ms: 17 },
        { color: 0xffffff, alpha: 0.25, ms: 17 },
      ];
    } else if (key) {
      this.steps = [
        { color: 0xffffff, alpha: 0.5, ms: 17 },
        { color: 0x0b0d12, alpha: 0.18, ms: 17 },
      ];
    }
    this.stepMs = 0;

    this.speedLines(x, y, heavy ? 10 : key ? 7 : 0, heavy ? 72 : 50);
    this.spawnShards(x, y, heavy ? 12 : key ? 8 : 4, dir);
  }

  private speedLines(x: number, y: number, count: number, length: number): void {
    if (count <= 0) return;
    const g = new PIXI.Graphics();
    g.setStrokeStyle({ width: 2.2, color: 0xffffff, alpha: 0.9, cap: "round" });
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + 0.17;
      const inner = 16 + (i % 3) * 4;
      const len = length * (0.5 + ((i * 7) % 10) / 16);
      g.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      g.lineTo(x + Math.cos(angle) * (inner + len), y + Math.sin(angle) * (inner + len));
    }
    g.stroke();
    this.lineLayer.addChild(g);
    this.lines.push({ g, life: 0.12, max: 0.12 });
  }

  private spawnShards(x: number, y: number, count: number, dir: number): void {
    for (let i = 0; i < count; i++) {
      const size = 2 + (i % 3);
      const g = new PIXI.Graphics();
      g.rect(-size / 2, -size / 2, size, size).fill({ color: i % 4 === 0 ? 0x9fe8ff : 0xffffff });
      g.position.set(x, y);
      g.rotation = (i / count) * Math.PI * 2;
      this.shardLayer.addChild(g);
      const angle = (i / count) * Math.PI * 2 + 0.4;
      const speed = 70 + (i % 5) * 26;
      this.shards.push({
        g,
        vx: Math.cos(angle) * speed + dir * 40,
        vy: Math.sin(angle) * speed - 40,
        life: 0.32,
      });
    }
  }

  update(dtMs: number): void {
    // impact frame：按步进播放，不淡出
    if (this.steps.length > 0) {
      this.stepMs += dtMs;
      if (this.stepMs >= this.steps[0].ms) {
        this.stepMs = 0;
        this.steps.shift();
      }
      if (this.steps.length > 0) {
        const step = this.steps[0];
        this.flash.clear();
        this.flash.rect(0, 0, this.w, this.h).fill({ color: step.color, alpha: step.alpha });
        this.flash.alpha = 1;
      } else {
        this.flash.alpha = 0;
      }
    } else if (this.flash.alpha > 0) {
      this.flash.alpha = 0;
      this.flash.clear();
    }

    const dt = dtMs / 1000;

    for (const line of this.lines) {
      line.life -= dt;
      line.g.alpha = Math.max(0, line.life / line.max);
    }
    this.lines = this.lines.filter((l) => {
      if (l.life <= 0) {
        l.g.destroy();
        return false;
      }
      return true;
    });

    for (const shard of this.shards) {
      shard.life -= dt;
      shard.vy += 520 * dt;
      shard.g.x += shard.vx * dt;
      shard.g.y += shard.vy * dt;
      shard.g.rotation += dt * 6;
    }
    this.shards = this.shards.filter((s) => {
      if (s.life <= 0) {
        s.g.destroy();
        return false;
      }
      return true;
    });
  }

  clear(): void {
    this.steps = [];
    this.flash.alpha = 0;
    this.flash.clear();
    for (const l of this.lines) l.g.destroy();
    for (const s of this.shards) s.g.destroy();
    this.lines = [];
    this.shards = [];
  }

  get active(): boolean {
    return this.steps.length > 0 || this.lines.length > 0 || this.shards.length > 0;
  }
}


