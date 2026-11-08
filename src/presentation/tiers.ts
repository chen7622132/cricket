import type { Tier } from "../engine/types.ts";

/**
 * 演出层级表：逻辑层只给 tier，渲染层照这张表播。
 * 验收脚本也读同一张表，避免"代码一套、验收一套"。
 */
export interface TierProfile {
  tier: Tier;
  label: string;
  /** hitstop 帧数（60fps），只冻结表现层时间缩放 */
  hitstopFrames: number;
  camera: "none" | "push" | "crash-zoom";
  /** 镜头沿命中方向的推近像素 */
  cameraPush: number;
  /** 屏幕震动强度（0 = 不动） */
  shake: number;
  /** 短慢放倍率（1 = 不慢放） */
  timeScale: number;
  /** 慢放持续毫秒 */
  slowmoMs: number;
  /** pixelfx 特效放大倍数 */
  fxScale: number;
  /** 是否允许大位移 */
  displacement: "none" | "dash" | "knockback" | "swap";
  note: string;
}

export const TIERS: Record<Tier, TierProfile> = {
  normal: {
    tier: "normal",
    label: "轻击",
    hitstopFrames: 3,
    camera: "none",
    cameraPush: 0,
    shake: 1,
    timeScale: 1,
    slowmoMs: 0,
    fxScale: 1,
    displacement: "none",
    note: "微小火花 + 1-2px 屏幕微震，不推镜",
  },
  key: {
    tier: "key",
    label: "中击",
    hitstopFrames: 8,
    camera: "push",
    cameraPush: 4,
    shake: 3,
    timeScale: 1,
    slowmoMs: 0,
    fxScale: 1.4,
    displacement: "none",
    note: "打断成功 / 暴击 / 击晕，定向震动 + 后仰",
  },
  ultimate: {
    tier: "ultimate",
    label: "重击 / 处决",
    hitstopFrames: 16,
    camera: "crash-zoom",
    cameraPush: 12,
    shake: 10,
    timeScale: 0.3,
    slowmoMs: 300,
    fxScale: 2,
    displacement: "swap",
    note: "爆发碎屑 + 镜头沿打击轴推近 + 0.3s 慢放",
  },
};

export const TIER_RANGES: Record<Tier, [number, number]> = {
  normal: [2, 4],
  key: [6, 10],
  ultimate: [12, 18],
};

/** 普通攻击（不触发任何关键判定时的 tier 兜底）。 */
export const PLAIN_HIT_SKILLS = new Set(["hero_thrust", "hero_rend", "enemy_swipe"]);
