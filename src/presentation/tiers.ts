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
  /** 镜头沿命中方向的轻推像素 */
  cameraPush: number;
  /** 屏幕震动强度（0 = 不动） */
  shake: number;
  /** 短慢放倍率（1 = 不慢放） */
  timeScale: number;
  /** pixelfx 特效放大倍数 */
  fxScale: number;
  /** 是否允许大位移 */
  displacement: "none" | "dash" | "knockback" | "swap";
  note: string;
}

export const TIERS: Record<Tier, TierProfile> = {
  normal: {
    tier: "normal",
    label: "普通命中",
    hitstopFrames: 4,
    camera: "none",
    cameraPush: 0,
    shake: 0,
    timeScale: 1,
    fxScale: 1,
    displacement: "none",
    note: "轻特效、不位移、镜头不动",
  },
  key: {
    tier: "key",
    label: "关键判定",
    hitstopFrames: 10,
    camera: "push",
    cameraPush: 6,
    shake: 2,
    timeScale: 1,
    fxScale: 1.6,
    displacement: "none",
    note: "打断成功 / 暴击 / 击晕 / 格挡，镜头轻推",
  },
  ultimate: {
    tier: "ultimate",
    label: "全场最重",
    hitstopFrames: 20,
    camera: "crash-zoom",
    cameraPush: 0,
    shake: 4,
    timeScale: 0.35,
    fxScale: 2.2,
    displacement: "swap",
    note: "处决 / 优先级抢断换位，短慢放 + crash-zoom",
  },
};

export const TIER_RANGES: Record<Tier, [number, number]> = {
  normal: [3, 5],
  key: [8, 12],
  ultimate: [15, 25],
};

/** 普通攻击（不触发任何关键判定时的 tier 兜底）。 */
export const PLAIN_HIT_SKILLS = new Set(["hero_thrust", "hero_rend", "enemy_swipe"]);
