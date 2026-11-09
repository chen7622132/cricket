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
  private zoom = 0;

  kick(tier: Tier, dir = 1): void {
    const p = TIERS[tier];
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
    this.zoom *= Math.exp(-dt * 7);
    if (this.shake < 0.3) this.shake = 0;
    if (this.push < 0.4) this.push = 0;
    if (this.zoom < 0.002) this.zoom = 0;
  }

  /** cover 缩放：max(viewport/world)，铺满游戏区、裁边而不留黑边。 */
  apply(world: PIXI.Container, viewportW: number, viewportH: number, cover: number, pivotX = ARENA.w / 2, fitZoom = 1): void {
    const sx = Math.sin(this.time * 91) * this.shake;
    const sy = Math.cos(this.time * 73) * this.shake * 0.6;
    // 重心下移：保证地板与角色始终在画面内（宽而矮的窗口也不会把脚裁掉）
    const visibleH = viewportH / Math.max(0.0001, cover);
    const pivotY = Math.min(200, Math.max(110, ARENA.floorY - visibleH * 0.28));
    world.pivot.set(pivotX, pivotY);
    world.scale.set(cover * (1 + this.zoom) * fitZoom);
    world.position.set(viewportW / 2 + sx + this.push * this.pushDir, viewportH / 2 + sy);
  }

  get shakeAmount(): number {
    return this.shake;
  }

  get zoomAmount(): number {
    return this.zoom;
  }
}





