import type { SkillDef, SkillId, Tier } from "./types.ts";

/**
 * 招式表。
 * windup = 起手到命中帧；recovery = 命中帧到收招结束（60Hz 帧数）。
 * 演出层用同一份数字排 hitstop / 特效，保证"触发点对齐 hits 阶段"。
 */
export const SKILLS: Record<SkillId, SkillDef> = {
  hero_thrust: {
    id: "hero_thrust",
    name: "突刺",
    tier: "normal",
    windup: 10,
    recovery: 16,
    fx: "melee/thrust",
    note: "基础突刺；命中蓄力目标且由打断规则触发时升级为打断",
  },
  hero_rend: {
    id: "hero_rend",
    name: "裂伤",
    tier: "normal",
    windup: 8,
    recovery: 18,
    fx: "melee/double-slash",
    note: "挂流血，combo 链起手",
  },
  hero_earthhammer: {
    id: "hero_earthhammer",
    name: "碎地锤",
    tier: "key",
    windup: 16,
    recovery: 28,
    fx: "melee/hammer-smash",
    note: "对流血目标击晕并击退",
  },
  hero_execute: {
    id: "hero_execute",
    name: "处决突刺",
    tier: "ultimate",
    windup: 18,
    recovery: 36,
    fx: "melee/dagger-flurry",
    note: "对击晕目标处决；自身硬直 36 帧作为代价",
  },
  hero_guard: {
    id: "hero_guard",
    name: "格挡",
    tier: "normal",
    windup: 2,
    recovery: 4,
    fx: "impacts/parry",
    note: "减伤 80%，成功格挡开还击窗口",
  },
  hero_riposte: {
    id: "hero_riposte",
    name: "还击",
    tier: "key",
    windup: 6,
    recovery: 12,
    fx: "melee/thrust",
    note: "格挡成功后的后摇反击",
  },
  hero_special: {
    id: "hero_special",
    name: "角色特技",
    tier: "key",
    windup: 20,
    recovery: 30,
    fx: "melee/heavy-cleave",
    note: "各角色专属近身技，演出随武器变化",
  },
  enemy_special: {
    id: "enemy_special",
    name: "角色特技",
    tier: "key",
    windup: 20,
    recovery: 30,
    fx: "melee/heavy-cleave",
    note: "敌方专属近身技",
  },
  hero_ranged: {
    id: "hero_ranged",
    name: "远程牵制",
    tier: "normal",
    windup: 12,
    recovery: 18,
    fx: "melee/thrust",
    note: "中距离飞道，近战角色也会投掷/发劲",
  },
  hero_ranged_2: {
    id: "hero_ranged_2",
    name: "强射",
    tier: "key",
    windup: 18,
    recovery: 22,
    fx: "melee/thrust",
    note: "远程角色的第二发，伤害更高、弹道更大",
  },
  enemy_ranged_2: {
    id: "enemy_ranged_2",
    name: "强射",
    tier: "key",
    windup: 18,
    recovery: 22,
    fx: "melee/thrust",
    note: "敌方第二发远程",
  },
  enemy_ranged: {
    id: "enemy_ranged",
    name: "远程骚扰",
    tier: "normal",
    windup: 12,
    recovery: 18,
    fx: "melee/thrust",
    note: "敌方中距离飞道",
  },
  hero_retreat: {
    id: "hero_retreat",
    name: "拉开距离",
    tier: "normal",
    windup: 4,
    recovery: 10,
    fx: "ui/exclamation",
    note: "主动后撤两格，重置立回距离",
  },
  enemy_retreat: {
    id: "enemy_retreat",
    name: "游走",
    tier: "normal",
    windup: 4,
    recovery: 10,
    fx: "ui/exclamation",
    note: "敌方后撤两格，诱使英雄追击",
  },
  hero_dodge: {
    id: "hero_dodge",
    name: "闪避",
    tier: "key",
    windup: 2,
    recovery: 8,
    fx: "impacts/hit-flash",
    note: "无敌帧 14；代价是跳过下一条",
  },
  hero_read: {
    id: "hero_read",
    name: "看破",
    tier: "normal",
    windup: 4,
    recovery: 6,
    fx: "ui/exclamation",
    note: "消耗识破，下一次命中必暴击",
  },
  hero_step: {
    id: "hero_step",
    name: "垫步",
    tier: "normal",
    windup: 6,
    recovery: 8,
    fx: "",
    note: "拉近距离（小位移，不算空间转换）",
  },
  enemy_charge: {
    id: "enemy_charge",
    name: "蓄力",
    tier: "normal",
    windup: 36,
    recovery: 8,
    fx: "lightning/charge-up",
    note: "攒碎地重锤；可被突刺打断",
  },
  enemy_slam: {
    id: "enemy_slam",
    name: "碎地重锤",
    tier: "key",
    windup: 12,
    recovery: 40,
    fx: "melee/hammer-smash",
    note: "高伤 + 长后摇，是还击窗口",
  },
  enemy_swipe: {
    id: "enemy_swipe",
    name: "横扫",
    tier: "normal",
    windup: 8,
    recovery: 14,
    fx: "melee/spear-sweep",
    note: "敌方普通攻击",
  },
  enemy_step: {
    id: "enemy_step",
    name: "逼近",
    tier: "normal",
    windup: 6,
    recovery: 6,
    fx: "",
    note: "拉近距离",
  },
};

/** 基础伤害；0 表示非伤害招式。 */
export const DAMAGE: Record<SkillId, number> = {
  hero_thrust: 7,
  hero_rend: 5,
  hero_earthhammer: 13,
  hero_execute: 34,
  hero_guard: 0,
  hero_riposte: 9,
  hero_dodge: 0,
  hero_special: 14,
  enemy_special: 13,
  hero_ranged: 8,
  hero_ranged_2: 11,
  enemy_ranged: 7,
  enemy_ranged_2: 10,
  hero_retreat: 0,
  enemy_retreat: 0,
  hero_read: 0,
  hero_step: 0,
  enemy_charge: 0,
  enemy_slam: 30,
  enemy_swipe: 10,
  enemy_step: 0,
};

export const HERO_MAX_HP = 280;
export const ENEMY_MAX_HP = 560;
/** 识破回复：900 帧 = 15s 才回 1 点，强调"资源有限"。 */
export const INSIGHT_REGEN_FRAMES = 900;
export const HERO_START_SLOT = 1;
export const ENEMY_START_SLOT = 4;
export const ARENA_MIN_SLOT = 0;
export const ARENA_MAX_SLOT = 5;

/** 大位移（前冲 / 击退 / 换位）之间的最小间隔：180 帧 = 3s。 */
export const BIG_MOVE_COOLDOWN = 180;
/** 大位移落地后的停顿：0.2~0.3s。 */
export const BIG_MOVE_SETTLE = 15;
/** 判定宽容值 0.15s = 9 帧。 */
export const JUDGE_TOLERANCE_FRAMES = 9;

export function tierRank(t: Tier): number {
  return t === "normal" ? 0 : t === "key" ? 1 : 2;
}













