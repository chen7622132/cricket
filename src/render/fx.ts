import * as PIXI from "pixi.js";
import { createFrame, clearFrame, createFx, composite, type Frame, type Fx, type FxMod } from "pixelfx";

import * as thrust from "pixelfx/fx/melee/thrust";
import * as doubleSlash from "pixelfx/fx/melee/double-slash";
import * as hammerSmash from "pixelfx/fx/melee/hammer-smash";
import * as daggerFlurry from "pixelfx/fx/melee/dagger-flurry";
import * as spearSweep from "pixelfx/fx/melee/spear-sweep";
import * as parry from "pixelfx/fx/impacts/parry";
import * as critHit from "pixelfx/fx/impacts/crit-hit";
import * as bluntHit from "pixelfx/fx/impacts/blunt-hit";
import * as hitFlash from "pixelfx/fx/impacts/hit-flash";
import * as shieldBlock from "pixelfx/fx/impacts/shield-block";
import * as groundSlam from "pixelfx/fx/impacts/ground-slam";
import * as bleeding from "pixelfx/fx/status/bleeding";
import * as stunned from "pixelfx/fx/status/stunned";
import * as chargeUp from "pixelfx/fx/lightning/charge-up";
import * as exclamation from "pixelfx/fx/ui/exclamation";

/**
 * 招式 → pixelfx 资源映射。引擎只给键（SKILLS[].fx），这里负责落地。
 * pixelfx 每个招式自带 windup → hits → recovery 时间轴，渲染层把它对齐到命中帧播放。
 */
export const FX_MODULES: Record<string, FxMod> = {
  "melee/thrust": thrust as unknown as FxMod,
  "melee/double-slash": doubleSlash as unknown as FxMod,
  "melee/hammer-smash": hammerSmash as unknown as FxMod,
  "melee/dagger-flurry": daggerFlurry as unknown as FxMod,
  "melee/spear-sweep": spearSweep as unknown as FxMod,
  "impacts/parry": parry as unknown as FxMod,
  "impacts/crit-hit": critHit as unknown as FxMod,
  "impacts/blunt-hit": bluntHit as unknown as FxMod,
  "impacts/hit-flash": hitFlash as unknown as FxMod,
  "impacts/shield-block": shieldBlock as unknown as FxMod,
  "impacts/ground-slam": groundSlam as unknown as FxMod,
  "status/bleeding": bleeding as unknown as FxMod,
  "status/stunned": stunned as unknown as FxMod,
  "lightning/charge-up": chargeUp as unknown as FxMod,
  "ui/exclamation": exclamation as unknown as FxMod,
};

const CW = 256;
const CH = 192;
const ORIGIN_X = CW / 2;
const ORIGIN_Y = CH / 2;

interface LiveFx {
  key: string;
  fx: Fx;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  frame: Frame;
  img: ImageData;
  sprite: PIXI.Sprite;
  age: number;
  life: number;
}

/**
 * pixelfx → PixiJS 的桥。
 * 每个特效实例自带 256×192 的 Uint32 帧缓冲与 canvas 纹理，独立缩放、独立生命周期；
 * 合成后上传纹理，天然支持"一层多个特效"，也不会因为共享画布互相裁剪。
 */
export class PixelFxLayer {
  readonly container = new PIXI.Container();
  private live: LiveFx[] = [];
  /** 同时存在的特效上限：高倍速下 hitstop 冻结表现层但逻辑继续跑，必须防止堆积。 */
  private readonly maxLive = 16;

  constructor(private readonly scale = 0.7) {}

  spawn(key: string, x: number, y: number, opts: Record<string, unknown> = {}, life = 1.4): void {
    const mod = FX_MODULES[key];
    if (!mod) return;

    if (this.live.length >= this.maxLive) {
      const oldest = this.live.shift();
      oldest?.sprite.destroy({ texture: true });
    }

    const canvas = document.createElement("canvas");
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tex = PIXI.Texture.from(canvas);
    tex.source.scaleMode = "nearest";

    const sprite = new PIXI.Sprite(tex);
    sprite.eventMode = "none";
    sprite.scale.set(this.scale);
    sprite.position.set(x - ORIGIN_X * this.scale, y - ORIGIN_Y * this.scale);
    sprite.alpha = 0.78;
    this.container.addChild(sprite);

    const fx = createFx(mod, { x: ORIGIN_X, y: ORIGIN_Y, seed: 7, ...opts });
    this.live.push({
      key,
      fx,
      canvas,
      ctx,
      frame: createFrame(CW, CH),
      img: ctx.createImageData(CW, CH),
      sprite,
      age: 0,
      life,
    });
  }

  clear(): void {
    for (const item of this.live) item.sprite.destroy({ texture: true });
    this.live = [];
  }

  get count(): number {
    return this.live.length;
  }

  update(dt: number): void {
    for (const item of this.live) {
      item.age += dt;
      // 循环特效（流血/蓄力）到寿终时停掉，避免 done() 永远为 false
      if (item.age > item.life) item.fx.stop();
      item.fx.update(dt);

      clearFrame(item.frame);
      item.fx.draw(item.frame, "back");
      item.fx.draw(item.frame, "front");
      composite(item.frame, item.img.data, null);
      item.ctx.putImageData(item.img, 0, 0);
      item.sprite.texture.source.update();
    }

    const dead = this.live.filter((item) => item.fx.done());
    if (dead.length) {
      for (const item of dead) item.sprite.destroy({ texture: true });
      this.live = this.live.filter((item) => !item.fx.done());
    }
  }
}

