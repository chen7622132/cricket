import * as PIXI from "pixi.js";
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
};

/** 帧内角色锚点：脚底在 128/200，身体中心在 97/200（据素材 alpha 包围盒实测）。 */
const ANCHOR_X = 0.485;
const ANCHOR_Y = 0.64;
const BASE_SCALE = 1.2;

const SPEED: Record<HeroState, number> = {
  IDLE: 0.08,
  RUN: 0.18,
  ATTACK_1: 0.18,
  ATTACK_2: 0.18,
  HIT: 0.2,
  DEATH: 0.07,
};

/**
 * Martial Hero 序列帧角色。
 * 状态集驱动 AnimatedSprite：切状态只换纹理数组 + animationSpeed，不硬切贴图。
 * 攻击动画的命中帧（第 2 帧）通过 onFrameChange 回调抛出，供特效/顿帧对齐。
 */
export class HeroActor {
  readonly root = new PIXI.Container();
  readonly sprite: PIXI.AnimatedSprite;
  readonly ghosts = new PIXI.Container();
  private readonly icons = new PIXI.Container();
  private readonly iconMap = new Map<StatusId, PIXI.Container>();
  private readonly sheet: PIXI.Spritesheet;
  private readonly tint?: number;

  x = 0;
  facing = 1;
  state: HeroState = "IDLE";
  hitFrameCount = 0;
  onHitFrame?: () => void;

  private actionTimer = 0;
  private actionKind: "attack1" | "attack2" | null = null;
  private bob = 0;

  constructor(sheet: PIXI.Spritesheet, tint?: number) {
    this.sheet = sheet;
    this.tint = tint;

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
      // 攻击/受击播完回 IDLE；死亡保持最后一帧
      if (this.state !== "DEATH") this.play("IDLE", true);
    };
    this.sprite.play();

    this.root.addChild(this.ghosts, this.sprite, this.icons);
    this.root.scale.set(1);
  }

  play(state: HeroState, force = false): void {
    if (this.state === state && !force) return;
    this.state = state;
    this.sprite.textures = this.sheet.animations[state === "ATTACK_1" ? "attack1" : state === "ATTACK_2" ? "attack2" : state.toLowerCase()];
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

  /** 大位移时播 RUN；结束时由 update 的 moving 标志切回 IDLE。 */
  setMoving(moving: boolean): void {
    if (this.state === "DEATH" || this.actionKind) return;
    if (moving && this.state !== "RUN") this.play("RUN", true);
    if (!moving && this.state === "RUN") this.play("IDLE", true);
  }

  spawnGhost(): void {
    const ghost = new PIXI.AnimatedSprite(this.sprite.textures);
    ghost.anchor.copyFrom(this.sprite.anchor);
    ghost.scale.copyFrom(this.sprite.scale);
    ghost.position.copyFrom(this.sprite.position);
    ghost.gotoAndStop(this.sprite.currentFrame);
    ghost.alpha = 0.42;
    ghost.tint = 0x9fd8ff;
    ghost.roundPixels = true;
    const holder = new PIXI.Container() as PIXI.Container & { life: number };
    holder.life = 0.42;
    holder.addChild(ghost);
    this.ghosts.addChild(holder);
  }

  update(dt: number, x: number, facing: number, statuses: Partial<Record<StatusId, number>>, floorY: number): void {
    this.x = x;
    this.facing = facing;
    this.root.position.set(x, floorY);
    this.sprite.scale.x = Math.abs(this.sprite.scale.y) * facing;
    this.bob += dt;

    if (this.actionKind) {
      this.actionTimer += dt;
      // 动画结束后清掉 action 标记，允许回到 IDLE/RUN
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
      chip.position.set((i - (entries.length - 1) / 2) * 13, -74 + Math.sin(this.bob * 6 + i) * 0.8);
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
    bg.roundRect(-6, -5.5, 12, 11, 2).fill({ color: 0x0b1018, alpha: 0.85 });
    bg.roundRect(-6, -5.5, 12, 11, 2).stroke({ color: style.color, width: 0.8, alpha: 0.8 });
    const label = new PIXI.Text({
      text: style.label,
      style: { fontFamily: "monospace", fontSize: 8, fontWeight: "bold", fill: style.color },
    });
    label.anchor.set(0.5);
    container.addChild(bg, label);
    return container;
  }

  private updateGhosts(dt: number): void {
    for (const child of [...this.ghosts.children]) {
      const holder = child as PIXI.Container & { life: number };
      holder.life -= dt;
      holder.alpha = Math.max(0, holder.life * 2.2);
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

