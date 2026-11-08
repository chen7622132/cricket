import * as PIXI from "pixi.js";
import type { Tier } from "../engine/types.ts";
import { TIERS } from "../presentation/tiers.ts";

/**
 * 固定广角镜头：不旋转、不跟拍。
 * 只有关键判定才轻推，处决/换位才 crash-zoom。
 */
export class CameraRig {
  private time = 0;
  private push = 0;
  private pushDir = 1;
  private shake = 0;
  private zoom = 0;

  kick(tier: Tier, dir = 1): void {
    const p = TIERS[tier];
    if (p.camera === "none") return;
    if (p.cameraPush > 0) {
      this.push = Math.max(this.push, p.cameraPush);
      this.pushDir = dir;
    }
    this.shake = Math.max(this.shake, p.shake);
    if (p.camera === "crash-zoom") this.zoom = Math.max(this.zoom, 0.16);
  }

  update(dt: number): void {
    this.time += dt;
    this.push *= Math.exp(-dt * 7);
    this.shake *= Math.exp(-dt * 9);
    this.zoom *= Math.exp(-dt * 6);
    if (this.push < 0.05) this.push = 0;
    if (this.shake < 0.05) this.shake = 0;
    if (this.zoom < 0.002) this.zoom = 0;
  }

  apply(world: PIXI.Container, w: number, h: number): void {
    const sx = Math.sin(this.time * 91) * this.shake;
    const sy = Math.cos(this.time * 73) * this.shake * 0.6;
    world.pivot.set(w / 2, h / 2);
    world.position.set(w / 2 + sx + this.push * this.pushDir, h / 2 + sy);
    // 固定广角 + 1.22 基础裁切：不跟拍，只把 6 个格点压进构图中心
    world.scale.set((1 + this.zoom) * 1.25);
  }

  get shakeAmount(): number {
    return this.shake;
  }

  get zoomAmount(): number {
    return this.zoom;
  }
}

