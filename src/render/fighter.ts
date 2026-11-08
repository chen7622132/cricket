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

export interface Ghost {
  x: number;
  pose: Pose;
  life: number;
  maxLife: number;
  color: number;
}

export class FighterView {
  readonly root = new PIXI.Container();
  readonly ghosts = new PIXI.Container();
  private readonly body = new PIXI.Graphics();
  private readonly shadow = new PIXI.Graphics();
  private readonly icons = new PIXI.Container();
  private readonly iconMap = new Map<StatusId, PIXI.Text>();
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
  private action: { skill: string; windup: number; recovery: number; t: number } | null = null;
  private bob = 0;

  setWeapon(kind: Pose["weaponKind"], len: number): void {
    this.weaponKind = kind;
    this.weaponLen = len;
  }

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

  startAction(skill: string, windup: number, recovery: number): void {
    this.action = { skill, windup, recovery, t: 0 };
  }

  flashHit(): void {
    this.flash = 0.12;
    this.recoil = 1;
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
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 4);

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
    this.draw(floorY);
    this.updateIcons(statuses);
    this.updateGhosts(dt);
  }

  private draw(floorY: number): void {
    const g = this.body;
    g.clear();

    const flash = this.flash > 0;
    const bodyColor = flash ? 0xffffff : this.color;
    const accent = flash ? 0xffffff : this.accent;

    // 影子
    this.shadow.clear();
    this.shadow
      .ellipse(0, 0, 11, 3.2)
      .fill({ color: 0x000000, alpha: 0.35 });

    const pose = this.pose;
    const recoilX = -this.facing * this.recoil * 5;
    const hipY = -14 - pose.crouch;
    const shoulderX = recoilX + pose.lean * 0.6;
    const shoulderY = -26 - pose.crouch;
    const headX = recoilX + pose.lean;
    const headY = -33 - pose.crouch;

    g.setStrokeStyle({ width: 2.2, color: bodyColor, alpha: 1, cap: "round" });
    // 腿
    g.moveTo(recoilX, hipY).lineTo(-5, 0);
    g.moveTo(recoilX, hipY).lineTo(5, 0);
    // 躯干
    g.moveTo(recoilX, hipY).lineTo(shoulderX, shoulderY);
    g.stroke();

    // 手臂
    const arms: Array<[number, number, number]> = [
      [shoulderX, shoulderY, pose.frontArm],
      [shoulderX, shoulderY, pose.backArm],
    ];
    g.setStrokeStyle({ width: 1.8, color: bodyColor, alpha: 0.95, cap: "round" });
    const hands: Array<[number, number]> = [];
    for (const [sx, sy, ang] of arms) {
      const hx = sx + Math.sin(ang) * 9;
      const hy = sy + Math.cos(ang) * 9;
      g.moveTo(sx, sy).lineTo(hx, hy);
      hands.push([hx, hy]);
    }
    g.stroke();

    // 武器（前手）
    const [hx, hy] = hands[0];
    const wLen = pose.weaponLen;
    const wx = hx + Math.cos(pose.weapon) * wLen;
    const wy = hy + Math.sin(pose.weapon) * wLen;
    g.setStrokeStyle({ width: 2, color: accent, alpha: 1, cap: "round" });
    g.moveTo(hx, hy).lineTo(wx, wy);
    g.stroke();
    if (pose.weaponKind === "hammer") {
      g.circle(wx, wy, 4.5).fill({ color: accent });
    } else if (pose.weaponKind === "blade") {
      g.circle(wx, wy, 1.6).fill({ color: accent });
    }

    // 头
    g.circle(headX, headY, 4.2).fill({ color: bodyColor });
    g.circle(headX + this.facing * 1.4, headY - 0.4, 0.9).fill({ color: 0x111318 });

    // 受击白闪
    if (flash) {
      g.circle(headX, headY, 6).fill({ color: 0xffffff, alpha: 0.25 });
    }
  }

  private updateIcons(statuses: Partial<Record<StatusId, number>>): void {
    const entries = Object.entries(statuses) as Array<[StatusId, number]>;
    let i = 0;
    for (const [id, frames] of entries) {
      if (!frames || frames <= 0) continue;
      let label = this.iconMap.get(id);
      if (!label) {
        const style = STATUS_STYLE[id];
        label = new PIXI.Text({
          text: style.label,
          style: {
            fontFamily: "monospace",
            fontSize: 9,
            fill: style.color,
            stroke: { color: 0x090b10, width: 3 },
          },
        });
        label.anchor.set(0.5);
        this.iconMap.set(id, label);
        this.icons.addChild(label);
      }
      label.visible = true;
      label.position.set((i - (entries.length - 1) / 2) * 11, -50 - this.pose.crouch);
      i++;
    }
    for (const [id, label] of this.iconMap) {
      if (!statuses[id]) label.visible = false;
    }
  }

  private updateGhosts(dt: number): void {
    for (const child of [...this.ghosts.children]) {
      const ghost = child as PIXI.Graphics & { life?: number };
      const life = (ghost as unknown as { life: number }).life - dt;
      (ghost as unknown as { life: number }).life = life;
      ghost.alpha = Math.max(0, life * 2.2);
      if (life <= 0) ghost.destroy();
    }
  }
}

function makeGhost(x: number, pose: Pose, color: number): PIXI.Graphics {
  const g = new PIXI.Graphics() as PIXI.Graphics & { life: number };
  g.life = 0.45;
  g.setStrokeStyle({ width: 2, color, alpha: 0.5 });
  g.moveTo(0, -14 - pose.crouch).lineTo(0, 0);
  g.moveTo(-5, 0).lineTo(0, -14 - pose.crouch).lineTo(5, 0);
  g.circle(0, -33 - pose.crouch, 4).fill({ color, alpha: 0.35 });
  g.stroke();
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
