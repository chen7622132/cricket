import * as PIXI from "pixi.js";
import type { Side, StatusId } from "../engine/types.ts";

export interface Pose {
  crouch: number;
  lean: number;
  frontArm: number;
  backArm: number;
  weapon: number;
  weaponLen: number;
  weaponKind: "spear" | "hammer" | "blade" | "fist";
}

export const IDLE_POSE: Pose = {
  crouch: 0,
  lean: 0,
  frontArm: 0.35,
  backArm: -0.3,
  weapon: -0.9,
  weaponLen: 22,
  weaponKind: "spear",
};

export const WINDUP_POSE: Pose = {
  crouch: 3,
  lean: -4,
  frontArm: 2.5,
  backArm: -1.2,
  weapon: -2.2,
  weaponLen: 22,
  weaponKind: "spear",
};

export const STRIKE_POSE: Pose = {
  crouch: 1,
  lean: 7,
  frontArm: 1.45,
  backArm: -0.6,
  weapon: -0.12,
  weaponLen: 24,
  weaponKind: "spear",
};

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

const INK = 0x05070c;

interface Geo {
  hip: [number, number];
  shoulder: [number, number];
  head: [number, number];
  hands: [[number, number], [number, number]];
  weaponEnd: [number, number];
}

/** 火柴人几何：绘制与残影共用同一套点，保证残影是"那一帧的姿态"。 */
function geometry(pose: Pose, ox = 0): Geo {
  const hip: [number, number] = [ox, -14 - pose.crouch];
  const shoulder: [number, number] = [ox + pose.lean * 0.6, -26 - pose.crouch];
  const head: [number, number] = [ox + pose.lean, -33 - pose.crouch];
  const hand = (ang: number): [number, number] => [
    shoulder[0] + Math.sin(ang) * 9,
    shoulder[1] + Math.cos(ang) * 9,
  ];
  const hands: [[number, number], [number, number]] = [hand(pose.frontArm), hand(pose.backArm)];
  const weaponEnd: [number, number] = [
    hands[0][0] + Math.cos(pose.weapon) * pose.weaponLen,
    hands[0][1] + Math.sin(pose.weapon) * pose.weaponLen,
  ];
  return { hip, shoulder, head, hands, weaponEnd };
}

export class FighterView {
  readonly root = new PIXI.Container();
  readonly ghosts = new PIXI.Container();
  private readonly body = new PIXI.Graphics();
  private readonly shadow = new PIXI.Graphics();
  private readonly icons = new PIXI.Container();
  private readonly iconMap = new Map<StatusId, PIXI.Container>();
  private readonly color: number;
  private readonly accent: number;
  private readonly side: Side;

  x = 0;
  facing = 1;
  flash = 0;
  recoil = 0;
  pose: Pose = { ...IDLE_POSE };
  weaponKind: Pose["weaponKind"] = "spear";
  weaponLen = 22;

  /** 受击方向（+1 向右推，-1 向左推），后仰沿这个方向。 */
  private hitDir = 1;
  private action: { skill: string; windup: number; recovery: number; t: number } | null = null;
  private bob = 0;

  constructor(side: Side) {
    this.side = side;
    this.color = side === "hero" ? 0xdff0ff : 0xffc2c2;
    this.accent = side === "hero" ? 0x6fd3ff : 0xff5c5c;
    this.root.addChild(this.shadow);
    this.root.addChild(this.ghosts);
    this.root.addChild(this.body);
    this.root.addChild(this.icons);
    this.root.scale.set(1.35);
  }

  setWeapon(kind: Pose["weaponKind"], len: number): void {
    this.weaponKind = kind;
    this.weaponLen = len;
  }

  startAction(skill: string, windup: number, recovery: number): void {
    this.action = { skill, windup, recovery, t: 0 };
  }

  flashHit(dir = 1): void {
    this.flash = 0.12;
    this.recoil = 1;
    this.hitDir = dir === 0 ? 1 : dir;
  }

  spawnGhost(x: number, color = this.accent): void {
    this.ghosts.addChild(makeGhost(x, this.pose, color));
  }

  update(dt: number, x: number, facing: number, statuses: Partial<Record<StatusId, number>>, floorY: number): void {
    this.x = x;
    this.facing = facing;
    this.root.position.set(x, floorY);
    this.bob += dt;

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 3.2);

    const act = this.action;
    if (act) {
      act.t += dt;
      const hitAt = act.windup;
      if (act.t < hitAt - 0.04) {
        const k = Math.min(1, act.t / Math.max(0.01, act.windup));
        this.pose = lerpPose(IDLE_POSE, WINDUP_POSE, easeOut(k));
      } else if (act.t < hitAt + 0.09) {
        this.pose = { ...STRIKE_POSE };
      } else {
        const k = Math.min(1, (act.t - hitAt - 0.09) / Math.max(0.05, act.recovery));
        this.pose = lerpPose(STRIKE_POSE, IDLE_POSE, easeIn(k));
      }
      if (act.t > act.windup + act.recovery) this.action = null;
    } else {
      const sway = Math.sin(this.bob * 2.4) * 0.8;
      this.pose = { ...IDLE_POSE, lean: sway, crouch: Math.sin(this.bob * 2.4) * 0.5 };
    }

    this.pose.weaponKind = this.weaponKind;
    this.pose.weaponLen = this.weaponLen;
    this.draw();
    this.updateIcons(statuses);
    this.updateGhosts(dt);
  }

  private draw(): void {
    const g = this.body;
    g.clear();

    const flash = this.flash > 0;
    const bodyColor = flash ? 0xffffff : this.color;
    const accent = flash ? 0xffffff : this.accent;

    // 地面影子
    this.shadow.clear();
    this.shadow.ellipse(0, 0, 11, 3.2).fill({ color: 0x000000, alpha: 0.35 });

    const pose = this.pose;
    // 后仰沿受击方向，而不是固定的"背向"
    const recoilX = this.hitDir * this.recoil * 6;
    const geo = geometry(pose, recoilX);
    const [h0, h1] = geo.hands;

    const segments: Array<[number, number, number, number]> = [
      [geo.hip[0], geo.hip[1], -5, 0],
      [geo.hip[0], geo.hip[1], 5, 0],
      [geo.hip[0], geo.hip[1], geo.shoulder[0], geo.shoulder[1]],
      [geo.shoulder[0], geo.shoulder[1], h0[0], h0[1]],
      [geo.shoulder[0], geo.shoulder[1], h1[0], h1[1]],
    ];

    // 先描黑边：亮特效背景下角色轮廓仍然可读
    g.setStrokeStyle({ width: 4.2, color: INK, alpha: 0.9, cap: "round" });
    for (const [x1, y1, x2, y2] of segments) g.moveTo(x1, y1).lineTo(x2, y2);
    g.moveTo(h0[0], h0[1]).lineTo(geo.weaponEnd[0], geo.weaponEnd[1]);
    g.stroke();

    // 身体
    g.setStrokeStyle({ width: 2.2, color: bodyColor, alpha: 1, cap: "round" });
    for (const [x1, y1, x2, y2] of segments) g.moveTo(x1, y1).lineTo(x2, y2);
    g.stroke();

    // 武器
    g.setStrokeStyle({ width: 2, color: accent, alpha: 1, cap: "round" });
    g.moveTo(h0[0], h0[1]).lineTo(geo.weaponEnd[0], geo.weaponEnd[1]);
    g.stroke();

    if (pose.weaponKind === "hammer") {
      g.circle(geo.weaponEnd[0], geo.weaponEnd[1], 6).fill({ color: INK });
      g.circle(geo.weaponEnd[0], geo.weaponEnd[1], 4.6).fill({ color: accent });
    } else if (pose.weaponKind === "blade") {
      g.circle(geo.weaponEnd[0], geo.weaponEnd[1], 2).fill({ color: accent });
    } else {
      g.circle(geo.weaponEnd[0], geo.weaponEnd[1], 1.2).fill({ color: accent });
    }

    // 头（黑边 + 身体色）
    g.circle(geo.head[0], geo.head[1], 5.5).fill({ color: INK });
    g.circle(geo.head[0], geo.head[1], 4.2).fill({ color: bodyColor });
    g.circle(geo.head[0] + this.facing * 1.4, geo.head[1] - 0.4, 0.9).fill({ color: 0x111318 });

    if (flash) {
      g.circle(geo.head[0], geo.head[1], 7).fill({ color: 0xffffff, alpha: 0.22 });
    }
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
      const bob = Math.sin(this.bob * 6 + i) * 0.8;
      chip.position.set((i - (entries.length - 1) / 2) * 13, -52 - this.pose.crouch + bob);
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
      style: {
        fontFamily: "monospace",
        fontSize: 8,
        fontWeight: "bold",
        fill: style.color,
      },
    });
    label.anchor.set(0.5);
    container.addChild(bg, label);
    return container;
  }

  private updateGhosts(dt: number): void {
    for (const child of [...this.ghosts.children]) {
      const ghost = child as PIXI.Graphics & { life: number };
      ghost.life -= dt;
      ghost.alpha = Math.max(0, ghost.life * 2.2);
      if (ghost.life <= 0) ghost.destroy();
    }
  }
}

function makeGhost(x: number, pose: Pose, color: number): PIXI.Graphics {
  const g = new PIXI.Graphics() as PIXI.Graphics & { life: number };
  g.life = 0.45;

  const geo = geometry(pose, 0);
  const [h0, h1] = geo.hands;

  g.setStrokeStyle({ width: 2, color, alpha: 0.6, cap: "round" });
  g.moveTo(geo.hip[0], geo.hip[1]).lineTo(-5, 0);
  g.moveTo(geo.hip[0], geo.hip[1]).lineTo(5, 0);
  g.moveTo(geo.hip[0], geo.hip[1]).lineTo(geo.shoulder[0], geo.shoulder[1]);
  g.moveTo(geo.shoulder[0], geo.shoulder[1]).lineTo(h0[0], h0[1]);
  g.moveTo(geo.shoulder[0], geo.shoulder[1]).lineTo(h1[0], h1[1]);
  // 武器残影
  g.moveTo(h0[0], h0[1]).lineTo(geo.weaponEnd[0], geo.weaponEnd[1]);
  g.stroke();

  g.circle(geo.head[0], geo.head[1], 4).fill({ color, alpha: 0.35 });
  g.position.set(x, 0);
  return g;
}

export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return {
    crouch: a.crouch + (b.crouch - a.crouch) * k,
    lean: a.lean + (b.lean - a.lean) * k,
    frontArm: a.frontArm + (b.frontArm - a.frontArm) * k,
    backArm: a.backArm + (b.backArm - a.backArm) * k,
    weapon: a.weapon + (b.weapon - a.weapon) * k,
    weaponLen: a.weaponLen + (b.weaponLen - a.weaponLen) * k,
    weaponKind: b.weaponKind,
  };
}

export function easeOut(k: number): number {
  return 1 - Math.pow(1 - k, 2);
}

export function easeIn(k: number): number {
  return k * k;
}

/** 不同招式的武器外观。 */
export function weaponFor(skill: string): Pick<Pose, "weaponKind" | "weaponLen"> {
  if (skill.includes("earthhammer") || skill === "enemy_slam") return { weaponKind: "hammer", weaponLen: 20 };
  if (skill.includes("execute")) return { weaponKind: "blade", weaponLen: 26 };
  if (skill.includes("rend")) return { weaponKind: "blade", weaponLen: 18 };
  if (skill === "enemy_swipe") return { weaponKind: "blade", weaponLen: 20 };
  return { weaponKind: "spear", weaponLen: 22 };
}

export type { Side };
