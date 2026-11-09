import * as PIXI from "pixi.js";
import type { Tier } from "../engine/types.ts";

export type ImpactKind =
  | "radial"
  | "thrust"
  | "x"
  | "hammer"
  | "execute"
  | "heavy"
  | "swipe"
  | "guard";

interface ShapeFx {
  g: PIXI.Graphics;
  life: number;
  max: number;
  grow: number;
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
 * 火柴人式打击层：impact frame + 按技能分型的几何打击。
 * 突刺=横向长条、裂伤=X 交叉、碎地锤=地面冲击环、处决=纵向全屏切线、错位牌=锯齿。
 */
export class ImpactFx {
  readonly container = new PIXI.Container();
  private readonly flash = new PIXI.Graphics();
  private readonly shapeLayer = new PIXI.Container();
  private readonly shardLayer = new PIXI.Container();

  private steps: FlashStep[] = [];
  private stepMs = 0;
  private shapes: ShapeFx[] = [];
  private shards: ShardFx[] = [];

  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {
    this.flash.alpha = 0;
    this.container.addChild(this.flash, this.shapeLayer, this.shardLayer);
  }

  trigger(x: number, y: number, dir: number, tier: Tier, kind: ImpactKind = "radial"): void {
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

    this.spawnShape(x, y, dir, kind, heavy, key);
    this.spawnShards(x, y, heavy ? 12 : key ? 8 : 4, dir, kind);
  }

  private spawnShape(x: number, y: number, dir: number, kind: ImpactKind, heavy: boolean, key: boolean): void {
    const g = new PIXI.Graphics();
    const scale = heavy ? 1.35 : key ? 1.1 : 0.9;

    switch (kind) {
      case "thrust": {
        // 横向穿刺：主条 + 两条细线
        g.setStrokeStyle({ width: 4 * scale, color: 0xffffff, alpha: 0.95, cap: "round" });
        g.moveTo(x - dir * 36 * scale, y).lineTo(x + dir * 30 * scale, y);
        g.stroke();
        g.setStrokeStyle({ width: 1.5, color: 0x9fe8ff, alpha: 0.9 });
        for (const off of [-6, 6]) g.moveTo(x - dir * 24 * scale, y + off).lineTo(x + dir * 22 * scale, y + off);
        g.stroke();
        this.addShape(g, 0.12, 0);
        this.star(x + dir * 16, y, 7 * scale);
        break;
      }
      case "x": {
        // 交叉斩
        g.setStrokeStyle({ width: 3.5 * scale, color: 0xffffff, alpha: 0.95, cap: "round" });
        const r = 30 * scale;
        g.moveTo(x - r, y - r).lineTo(x + r, y + r);
        g.moveTo(x - r, y + r).lineTo(x + r, y - r);
        g.stroke();
        g.setStrokeStyle({ width: 1.5, color: 0xff6b6b, alpha: 0.9 });
        g.moveTo(x - r * 0.7, y - r * 0.7).lineTo(x + r * 0.7, y + r * 0.7);
        g.stroke();
        this.addShape(g, 0.16, 0.2);
        this.star(x, y, 8 * scale);
        break;
      }
      case "hammer": {
        // 地面冲击环 + 竖直尘柱（同一个 Graphics 只注册一次）
        const gy = this.h - 62;
        g.setStrokeStyle({ width: 3 * scale, color: 0xffffff, alpha: 0.9 });
        g.ellipse(x, gy, 26, 8);
        g.stroke();
        g.setStrokeStyle({ width: 2, color: 0xffe27a, alpha: 0.85 });
        for (const off of [-10, 0, 10]) {
          g.moveTo(x + off, gy).lineTo(x + off * 1.4, gy - 32);
        }
        g.stroke();
        this.addShape(g, 0.2, 1.4);
        this.star(x, y, 10 * scale);
        break;
      }
      case "execute": {
        // 纵向全屏切线 + 横向余线
        g.setStrokeStyle({ width: 5 * scale, color: 0xffffff, alpha: 0.95, cap: "round" });
        g.moveTo(x, 0).lineTo(x, this.h);
        g.stroke();
        g.setStrokeStyle({ width: 1.5, color: 0xc77dff, alpha: 0.9 });
        g.moveTo(x - 18, 0).lineTo(x - 18, this.h);
        g.moveTo(x + 18, 0).lineTo(x + 18, this.h);
        g.stroke();
        this.addShape(g, 0.16, 0);
        this.star(x, y, 14 * scale);
        break;
      }
      case "heavy": {
        // 锯齿冲击（错位牌）
        g.setStrokeStyle({ width: 3.5 * scale, color: 0xffffff, alpha: 0.95 });
        g.moveTo(x - dir * 30, y - 10);
        for (let i = 0; i < 5; i++) {
          g.lineTo(x - dir * (22 - i * 12), y + (i % 2 === 0 ? 12 : -12));
        }
        g.stroke();
        this.addShape(g, 0.15, 0);
        this.star(x, y, 9 * scale);
        break;
      }
      case "swipe": {
        // 扇形横扫
        g.setStrokeStyle({ width: 3, color: 0xffffff, alpha: 0.9 });
        for (let i = 0; i < 5; i++) {
          const ang = -0.6 + i * 0.3;
          const len = 34 * scale;
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(ang) * dir * len, y + Math.sin(ang) * len);
        }
        g.stroke();
        this.addShape(g, 0.13, 0);
        this.star(x, y, 7 * scale);
        break;
      }
      case "guard": {
        // 弧形格挡
        g.setStrokeStyle({ width: 3, color: 0x9fe8ff, alpha: 0.95 });
        g.arc(x, y, 22 * scale, -1.2, 1.2);
        g.stroke();
        this.addShape(g, 0.14, 0.3);
        break;
      }
      default: {
        // 通用放射线
        g.setStrokeStyle({ width: 2.2, color: 0xffffff, alpha: 0.9, cap: "round" });
        const count = heavy ? 10 : key ? 7 : 0;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + 0.17;
          const inner = 16 + (i % 3) * 4;
          const len = (heavy ? 72 : 50) * (0.5 + ((i * 7) % 10) / 16);
          g.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
          g.lineTo(x + Math.cos(angle) * (inner + len), y + Math.sin(angle) * (inner + len));
        }
        g.stroke();
        this.addShape(g, 0.12, 0);
        this.star(x, y, 8 * scale);
      }
    }
  }

  private star(x: number, y: number, r: number): void {
    const g = new PIXI.Graphics();
    g.moveTo(x, y - r).lineTo(x + r * 0.22, y - r * 0.22).lineTo(x + r, y);
    g.lineTo(x + r * 0.22, y + r * 0.22).lineTo(x, y + r).lineTo(x - r * 0.22, y + r * 0.22);
    g.lineTo(x - r, y).lineTo(x - r * 0.22, y - r * 0.22);
    g.closePath().fill({ color: 0xffffff, alpha: 0.95 });
    this.addShape(g, 0.1, 0);
  }

  /** 近战命中：KOF/BvN 式星芒 + 八向射线 + 冲击环。 */
  meleeSpark(x: number, y: number, dir: number, tier: Tier, color = 0xffffff): void {
    const heavy = tier === "ultimate";
    const key = tier === "key";
    const r = heavy ? 20 : key ? 15 : 10;

    this.star(x, y, r);

    const g = new PIXI.Graphics();
    g.setStrokeStyle({ width: 2, color, alpha: 0.95, cap: "round" });
    const rays = heavy ? 10 : key ? 8 : 6;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2 + 0.12;
      const r0 = r * 0.7;
      const r1 = r * (1.4 + (k % 3) * 0.25);
      g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    }
    g.stroke();
    this.addShape(g, 0.1, 0);

    const ring = new PIXI.Graphics();
    ring.circle(0, 0, r * 0.55).stroke({ width: 2, color, alpha: 0.85 });
    ring.position.set(x, y);
    this.addShape(ring, 0.16, 1.8);

    this.spawnShards(x, y, heavy ? 8 : key ? 6 : 3, dir, "radial");
  }

  /** 元素命中：火/雷/冰各自的硬边形态。 */
  elementBurst(x: number, y: number, element: "fire" | "thunder" | "ice"): void {
    const g = new PIXI.Graphics();
    if (element === "fire") {
      g.circle(x, y, 10).fill({ color: 0xff7a1a, alpha: 0.55 });
      g.circle(x, y, 5).fill({ color: 0xffe066, alpha: 0.9 });
      for (const [dx, h] of [[-8, 18], [0, 26], [8, 16]] as const) {
        g.poly([x + dx - 3, y, x + dx, y - h, x + dx + 3, y]).fill({ color: 0xff9f43, alpha: 0.8 });
      }
      this.addShape(g, 0.22, 0.5);
    } else if (element === "thunder") {
      g.setStrokeStyle({ width: 2.5, color: 0xffe14d, alpha: 0.95 });
      for (const dir of [-1, 1]) {
        g.moveTo(x, y);
        g.lineTo(x + 10 * dir, y - 12);
        g.lineTo(x + 4 * dir, y - 18);
        g.lineTo(x + 16 * dir, y - 30);
      }
      g.stroke();
      this.addShape(g, 0.16, 0);
    } else {
      g.circle(x, y, 12).stroke({ width: 2, color: 0x9fe8ff, alpha: 0.9 });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        g.poly([
          x + Math.cos(a) * 6, y + Math.sin(a) * 6,
          x + Math.cos(a + 0.18) * 18, y + Math.sin(a + 0.18) * 18,
          x + Math.cos(a + 0.36) * 6, y + Math.sin(a + 0.36) * 6,
        ]).fill({ color: 0xc9f6ff, alpha: 0.85 });
      }
      this.addShape(g, 0.2, 0.3);
    }
  }

  /** 武器挥砍弧线：2-3 帧硬边新月，补足攻击动作的轨迹感。 */
  arc(x: number, y: number, dir: number, color = 0x9fe8ff, radius = 30, tilt = 0): void {
    const g = new PIXI.Graphics();
    g.setStrokeStyle({ width: 4, color, alpha: 0.95, cap: "round" });
    g.arc(0, 0, radius, -0.9, 0.9);
    g.stroke();
    g.setStrokeStyle({ width: 1.5, color: 0xffffff, alpha: 0.9 });
    g.arc(0, 0, radius + 5, -0.7, 0.7);
    g.stroke();
    g.position.set(x, y);
    g.rotation = tilt;
    g.scale.set(dir, 1);
    this.addShape(g, 0.13, 0.4);
  }

  private addShape(g: PIXI.Graphics, life: number, grow: number): void {
    this.shapeLayer.addChild(g);
    this.shapes.push({ g, life, max: life, grow });
  }

  private spawnShards(x: number, y: number, count: number, dir: number, kind: ImpactKind): void {
    for (let i = 0; i < count; i++) {
      const size = 2 + (i % 3);
      const g = new PIXI.Graphics();
      g.rect(-size / 2, -size / 2, size, size).fill({ color: i % 4 === 0 ? 0x9fe8ff : 0xffffff });
      g.position.set(x, y);
      g.rotation = (i / count) * Math.PI * 2;
      this.shardLayer.addChild(g);
      const angle = kind === "thrust" || kind === "execute" ? (dir > 0 ? 0 : Math.PI) + (i / count - 0.5) * 1.2 : (i / count) * Math.PI * 2;
      const speed = 60 + (i % 5) * 24;
      this.shards.push({
        g,
        vx: Math.cos(angle) * speed + dir * 30,
        vy: Math.sin(angle) * speed - 50,
        life: 0.3,
      });
    }
  }

  update(dtMs: number): void {
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

    for (const shape of this.shapes) {
      shape.life -= dt;
      shape.g.alpha = Math.max(0, shape.life / shape.max);
      if (shape.grow > 0) {
        shape.g.scale.set(1 + (1 - shape.life / shape.max) * shape.grow);
      }
    }
    this.shapes = this.shapes.filter((s) => {
      if (s.life <= 0) {
        s.g.destroy();
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
    for (const s of this.shapes) s.g.destroy();
    for (const s of this.shards) s.g.destroy();
    this.shapes = [];
    this.shards = [];
  }

  get active(): boolean {
    return this.steps.length > 0 || this.shapes.length > 0 || this.shards.length > 0;
  }
}





