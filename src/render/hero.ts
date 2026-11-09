import * as PIXI from "pixi.js";
import { OutlineFilter } from "pixi-filters";
import type { Side, StatusId } from "../engine/types.ts";

export type HeroState = "IDLE" | "RUN" | "ATTACK_1" | "ATTACK_2" | "HIT" | "DEATH";

const STATUS_STYLE: Record<StatusId, { label: string; color: number }> = {
  bleed: { label: "血", color: 0xff4d5e },
  stun: { label: "晕", color: 0xffd447 },
  charge: { label: "蓄", color: 0x6fa8ff },
  imbalance: { label: "失", color: 0xff9f43 },
  guard: { label: "格", color: 0x53e0c2 },
  riposte: { label: "还", color: 0xffe066 },
  iframes: { label: "避", color: 0xb388ff },
  read: { label: "破", color: 0xff7ae0 },
  evasion: { label: "游", color: 0x7ef2c4 },
  airborne: { label: "浮", color: 0x9fd8ff },
  downed: { label: "倒", color: 0xff8a5c },
  ukemi_counter: { label: "反", color: 0xffd45c },
  combo_ready: { label: "连", color: 0x7effc4 },
};

const ANCHOR_X = 0.485;
const ANCHOR_Y = 0.64;
const BASE_SCALE = 1.2;

const SPEED: Record<HeroState, number> = {
  IDLE: 0.08,
  RUN: 0.15,
  ATTACK_1: 0.14,
  ATTACK_2: 0.14,
  HIT: 0.2,
  DEATH: 0.07,
};

/**
 * Martial Hero 序列帧角色。
 * 状态集驱动 AnimatedSprite；攻击命中帧通过 onFrameChange 抛出。
 * 描边 + 落地投影保证在任何特效下都能一眼定位角色。
 */
export class HeroActor {
  readonly root = new PIXI.Container();
  readonly sprite: PIXI.AnimatedSprite;
  readonly ghosts = new PIXI.Container();
  private readonly body = new PIXI.Container();
  private readonly icons = new PIXI.Container();
  private readonly shadow = new PIXI.Graphics();
  private readonly outlines: PIXI.Sprite[] = [];
  private readonly iconMap = new Map<StatusId, PIXI.Container>();
  private readonly sheet: PIXI.Spritesheet;

  x = 0;
  facing = 1;
  state: HeroState = "IDLE";
  hitFrameCount = 0;
  onHitFrame?: () => void;

  private flashMs = 0;
  private kdMs = 0;
  private kdDir = 1;
  private airHeight = 0;
  private airVel = 0;
  private landedThisFrame = false;
  private readonly baseTint: number;
  private squashX = 1;
  private squashY = 1;
  private actionTimer = 0;
  private actionKind: "attack1" | "attack2" | null = null;
  private bob = 0;

  constructor(sheet: PIXI.Spritesheet, outlineColor: number, tint?: number) {
    this.sheet = sheet;
    this.baseTint = tint ?? 0xffffff;

    this.sprite = new PIXI.AnimatedSprite(sheet.animations.idle);
    this.sprite.anchor.set(ANCHOR_X, ANCHOR_Y);
    this.sprite.scale.set(BASE_SCALE);
    this.sprite.animationSpeed = SPEED.IDLE;
    this.sprite.loop = true;
    this.sprite.roundPixels = true;
    if (tint !== undefined) this.sprite.tint = tint;



    this.sprite.onFrameChange = (frame) => {
      if (this.state === "ATTACK_1" || this.state === "ATTACK_2") {
        if (frame === 1) {
          this.hitFrameCount++;
          this.onHitFrame?.();
        }
      }
    };
    this.sprite.onComplete = () => {
      if (this.state !== "DEATH") this.play("IDLE", true);
    };
    this.sprite.play();

    // 落地投影：明确站立位置
    this.shadow.ellipse(0, 0, 17, 5).fill({ color: 0x000000, alpha: 0.5 });
    this.shadow.ellipse(0, 0, 10, 3).fill({ color: 0x000000, alpha: 0.35 });

    // 手工描边：4 向 + 4 斜向偏移的染色副本，不依赖 GPU filter，任何设备都能渲染
    const offsets: Array<[number, number]> = [
      [-1.8, 0], [1.8, 0], [0, -1.8], [0, 1.8],
      [-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3],
    ];
    for (const [dx, dy] of offsets) {
      const copy = new PIXI.Sprite(this.sprite.texture);
      copy.anchor.set(ANCHOR_X, ANCHOR_Y);
      copy.tint = outlineColor;
      copy.position.set(dx, dy);
      copy.roundPixels = true;
      this.outlines.push(copy);
    }
    this.body.addChild(this.ghosts, ...this.outlines, this.sprite, this.icons);
    this.root.addChild(this.shadow, this.body);
  }

  play(state: HeroState, force = false): void {
    if (this.state === state && !force) return;
    this.state = state;
    const key =
      state === "ATTACK_1" ? "attack1" : state === "ATTACK_2" ? "attack2" : state.toLowerCase();
    this.sprite.textures = this.sheet.animations[key];
    this.sprite.animationSpeed = SPEED[state];
    this.sprite.loop = state === "IDLE" || state === "RUN";
    this.sprite.gotoAndPlay(0);
  }

  playAttack(kind: "attack1" | "attack2"): void {
    this.actionKind = kind;
    this.actionTimer = 0;
    this.play(kind === "attack1" ? "ATTACK_1" : "ATTACK_2", true);
  }

  playHit(): void {
    this.actionKind = null;
    this.play("HIT", true);
  }

  playDeath(): void {
    this.actionKind = null;
    this.play("DEATH", true);
    this.sprite.loop = false;
    this.sprite.gotoAndPlay(0);
  }

  /** 受击闪白：1-2 帧高对比，比柔光更像火柴人动画。 */
  flashWhite(seconds = 0.07): void {
    this.flashMs = Math.max(this.flashMs, seconds);
    this.sprite.tint = 0xffffff;
  }

  /** 挤压回弹：命中瞬间给质量感。 */
  setSquash(sx: number, sy: number): void {
    this.squashX = sx;
    this.squashY = sy;
  }

  setMoving(moving: boolean): void {
    if (this.state === "DEATH" || this.actionKind) return;
    if (moving && this.state !== "RUN") this.play("RUN", true);
    if (!moving && this.state === "RUN") this.play("IDLE", true);
  }

  spawnGhost(): void {
    // 残影：2 帧纯色实心副本（不做 alpha 渐隐，避免脏色）
    for (const offset of [-5, -11]) {
      const ghost = new PIXI.AnimatedSprite(this.sprite.textures);
      ghost.anchor.copyFrom(this.sprite.anchor);
      ghost.scale.copyFrom(this.sprite.scale);
      ghost.gotoAndStop(this.sprite.currentFrame);
      ghost.tint = 0x2b4f73;
      ghost.roundPixels = true;
      ghost.position.set(offset * this.facing, 0);
      const holder = new PIXI.Container() as PIXI.Container & { life: number };
      holder.life = 0.05; // 3 帧后删除，不改 alpha
      holder.addChild(ghost);
      this.ghosts.addChild(holder);
    }
  }

  /** 重击倒地：身体绕脚点旋转 90°，短暂僵直后起身。 */
  knockdown(dir: number, ms = 0.55): void {
    this.kdMs = ms;
    this.kdDir = dir;
    this.play("HIT", true);
  }

  /** 程序化腾空：没有跳跃序列帧，用垂直位移 + 影子缩放表现滞空。 */
  startJump(height: number): void {
    if (this.airHeight > 2) return;
    this.airVel = Math.sqrt(2 * 900 * Math.max(6, height));
  }

  get kdLeft(): number {
    return this.kdMs;
  }

  get knockedDown(): boolean {
    return this.kdMs > 0;
  }

  get airborne(): boolean {
    return this.airHeight > 0.5;
  }

  get airY(): number {
    return this.airHeight;
  }

  consumeLanded(): boolean {
    const landed = this.landedThisFrame;
    this.landedThisFrame = false;
    return landed;
  }

  /** smear frame：命中瞬间 2 张横向拉伸的实心拖影，不做 alpha 渐隐。 */
  spawnSmear(dir: number, tint = 0xffffff): void {
    const tex = this.sprite.textures[this.sprite.currentFrame];
    if (!tex) return;
    const specs = [
      { off: -7, stretch: 1.5, life: 0.05 },
      { off: -16, stretch: 1.95, life: 0.034 },
    ];
    for (const spec of specs) {
      const smear = new PIXI.Sprite(tex);
      smear.anchor.copyFrom(this.sprite.anchor);
      smear.scale.set(this.sprite.scale.x * spec.stretch, this.sprite.scale.y);
      smear.tint = tint;
      smear.roundPixels = true;
      smear.position.set(spec.off * dir, 0);
      const holder = new PIXI.Container() as PIXI.Container & { life: number };
      holder.life = spec.life;
      holder.addChild(smear);
      this.ghosts.addChild(holder);
    }
  }

  clearGhosts(): void {
    for (const child of [...this.ghosts.children]) child.destroy({ children: true });
  }

  get smearCount(): number {
    return this.ghosts.children.length;
  }

  update(dt: number, x: number, facing: number, statuses: Partial<Record<StatusId, number>>, floorY: number): void {
    this.x = x;
    this.facing = facing;
    this.root.position.set(x, floorY);
    if (this.airHeight > 0 || this.airVel > 0) {
      this.airHeight += this.airVel * dt;
      this.airVel -= 900 * dt;
      if (this.airHeight <= 0) {
        this.airHeight = 0;
        this.airVel = 0;
        this.landedThisFrame = true;
        this.setSquash(1.18, 0.84);
      }
    }
    if (this.kdMs > 0) {
      this.kdMs -= dt;
      const t = Math.min(1, (1 - this.kdMs / 0.55) * 4);
      this.body.rotation = this.kdDir * 1.25 * t;
      this.body.y = -this.airHeight - 1 + 7 * t;
      if (this.kdMs <= 0) {
        this.body.rotation = 0;
        this.body.y = -this.airHeight;
      }
    } else {
      this.body.rotation = 0;
      this.body.y = -this.airHeight;
    }
    const shadowScale = Math.max(0.45, 1 - this.airHeight / 90);
    this.shadow.scale.set(shadowScale);
    this.shadow.alpha = 0.4 + shadowScale * 0.35;
    this.bob += dt;
    if (this.flashMs > 0) {
      this.flashMs -= dt;
      if (this.flashMs <= 0) this.sprite.tint = this.baseTint;
    }

    // 挤压回弹
    const k = Math.min(1, dt * 7);
    this.squashX += (1 - this.squashX) * k;
    this.squashY += (1 - this.squashY) * k;
    this.sprite.scale.set(BASE_SCALE * this.squashX * facing, BASE_SCALE * this.squashY);
    for (const copy of this.outlines) {
      copy.texture = this.sprite.texture;
      copy.scale.copyFrom(this.sprite.scale);
    }

    if (this.actionKind) {
      this.actionTimer += dt;
      if (this.actionTimer > 0.9) this.actionKind = null;
    }

    this.updateIcons(statuses);
    this.updateGhosts(dt);
  }

  private updateIcons(statuses: Partial<Record<StatusId, number>>): void {
    const entries = (Object.entries(statuses) as Array<[StatusId, number]>).filter(
      ([, frames]) => (frames ?? 0) > 0,
    );
    let i = 0;
    for (const [id] of entries) {
      let chip = this.iconMap.get(id);
      if (!chip) {
        chip = this.makeChip(id);
        this.iconMap.set(id, chip);
        this.icons.addChild(chip);
      }
      chip.visible = true;
      chip.position.set((i - (entries.length - 1) / 2) * 13, -76 + Math.sin(this.bob * 6 + i) * 0.8);
      i++;
    }
    for (const [id, chip] of this.iconMap) {
      if (!statuses[id]) chip.visible = false;
    }
  }

  private makeChip(id: StatusId): PIXI.Container {
    const style = STATUS_STYLE[id];
    const container = new PIXI.Container();
    const bg = new PIXI.Graphics();
    bg.roundRect(-6, -5.5, 12, 11, 2).fill({ color: 0x0b1018, alpha: 0.9 });
    bg.roundRect(-6, -5.5, 12, 11, 2).stroke({ color: style.color, width: 0.8, alpha: 0.9 });
    const label = new PIXI.Text({
      text: style.label,
      style: { fontFamily: "monospace", fontSize: 8, fontWeight: "bold", fill: style.color },
    });
    label.resolution = 2;
    label.anchor.set(0.5);
    container.addChild(bg, label);
    return container;
  }

  private updateGhosts(dt: number): void {
    for (const child of [...this.ghosts.children]) {
      const holder = child as PIXI.Container & { life: number };
      holder.life -= dt;
      if (holder.life <= 0) holder.destroy({ children: true });
    }
  }
}

/** 把引擎技能映射到两套攻击动画。 */
export function attackForSkill(skill: string): "attack1" | "attack2" {
  if (skill.includes("earthhammer") || skill === "enemy_slam" || skill === "enemy_swipe") return "attack2";
  if (skill.includes("rend")) return "attack2";
  return "attack1";
}

export type { Side };














