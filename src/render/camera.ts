import * as PIXI from "pixi.js";
import type { Tier } from "../engine/types.ts";
import { TIERS } from "../presentation/tiers.ts";
import { ARENA } from "./arena.ts";

/**
 * 固定广角镜头：不旋转、不跟拍。
 * 画布铺满游戏区（cover 缩放，不留黑边），只有关键判定才轻推、重击才 crash-zoom。
 */
export class CameraRig {
  private time = 0;
  private push = 0;
  private pushDir = 1;
  private shake = 0;
  private trauma = 0;
  private zoom = 0;

  kick(tier: Tier, dir = 1): void {
    const p = TIERS[tier];
    // 创伤池节流：轻/中反馈在已有 trauma 未衰减时直接丢弃
    if (tier === "normal" && this.trauma > 0.18) return;
    if (tier === "key" && this.trauma > 0.5) return;
    // trauma 模型：每次命中累积创伤，强度按 trauma² 衰减
    const add = tier === "ultimate" ? 0.55 : tier === "key" ? 0.28 : 0.12;
    this.trauma = Math.min(1, this.trauma + add);
    if (p.camera === "none") {
      this.shake = Math.max(this.shake, p.shake);
      return;
    }
    if (p.cameraPush > 0) {
      this.push = Math.max(this.push, p.cameraPush);
      this.pushDir = dir;
    }
    this.shake = Math.max(this.shake, p.shake);
    if (p.camera === "push") this.zoom = Math.max(this.zoom, 0.03);
    if (p.camera === "crash-zoom") this.zoom = Math.max(this.zoom, 0.12);
  }

  update(dt: number): void {
    this.time += dt;
    this.push *= Math.exp(-dt * 9);
    this.shake *= Math.exp(-dt * 10);
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.zoom *= Math.exp(-dt * 7);
    if (this.shake < 0.3) this.shake = 0;
    if (this.push < 0.4) this.push = 0;
    if (this.zoom < 0.002) this.zoom = 0;
  }

  /** cover 缩放：max(viewport/world)，铺满游戏区、裁边而不留黑边。 */
  apply(world: PIXI.Container, viewportW: number, viewportH: number, cover: number, pivotX = ARENA.w / 2, fitZoom = 1): void {
    // 平滑噪声：多个低频正弦叠加，比单频抖动更接近 Perlin trauma
    const n1 = Math.sin(this.time * 23.1 + 1.7) * 0.6 + Math.sin(this.time * 41.7 + 0.3) * 0.3 + Math.sin(this.time * 77.3 + 2.1) * 0.1;
    const n2 = Math.cos(this.time * 19.3 + 0.9) * 0.6 + Math.cos(this.time * 37.9 + 2.7) * 0.3 + Math.cos(this.time * 71.1 + 0.4) * 0.1;
    const amp = this.shake + this.trauma * this.trauma * 6;
    const sx = n1 * amp;
    const sy = n2 * amp * 0.65;
    // 重心下移：保证地板与角色始终在画面内（宽而矮的窗口也不会把脚裁掉）
    const visibleH = viewportH / Math.max(0.0001, cover);
    const pivotY = Math.min(200, Math.max(110, ARENA.floorY - visibleH * 0.28));
    world.pivot.set(pivotX, pivotY);
    world.scale.set(cover * (1 + this.zoom) * fitZoom);
    world.position.set(viewportW / 2 + sx + this.push * this.pushDir, viewportH / 2 + sy);
  }

  get shakeAmount(): number {
    return this.shake + this.trauma * this.trauma * 6;
  }

  get zoomAmount(): number {
    return this.zoom;
  }
}







