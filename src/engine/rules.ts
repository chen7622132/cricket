import {
  JUDGE_TOLERANCE_FRAMES,
} from "./skills.ts";
import type { Cost, RuleDef, RuleTag, Side, SkillId } from "./types.ts";

/**
 * 规则表：WHEN <condition> → DO <skill>，带 priority / cost / cooldown。
 *
 * 规则序号（index）由 makeRuleset 按数组顺序 1..n 生成，日志里的"规则[n]"就是它，
 * 换规则表后序号会变 —— 这正是玩家能看出"规则改动"的抓手。
 */

type RuleDraft = Omit<RuleDef, "index">;

export const MECHANIC_LABEL: Record<Mechanic, string> = {
  interrupt: "打断专精（打断额外眩晕）",
  guard: "铁壁（格挡减伤 90%，还击窗口 70f）",
  insight: "识破经济（看破返还 1 识破）",
  bleed: "裂伤处决（流血双跳，处决 +30%）",
  desperate: "背水一战（血量 <40% 伤害 +35%）",
  heavy: "蓄力重锤（重锤 +20%）",
  pressure: "破防压制（对格挡目标 +100%）",
  early_charge: "提前蓄力（重锤附带 30f 眩晕）",
  fast: "快刀（横扫追加 50% 二段）",
  kite: "游走（后撤获得 30f 闪避减伤）",
};

export type Mechanic =
  | "interrupt"
  | "guard"
  | "insight"
  | "bleed"
  | "desperate"
  | "heavy"
  | "pressure"
  | "early_charge"
  | "fast"
  | "kite";

export interface Ruleset {
  id: RulesetId;
  name: string;
  side: Side;
  description: string;
  mechanic: Mechanic;
  rules: RuleDef[];
}

export type RulesetId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "ENEMY"
  | "ENEMY_B"
  | "ENEMY_C"
  | "ENEMY_D"
  | "ENEMY_E";

export interface RuleOverride {
  id: string;
  /** 仅用于编辑器展示，应用时忽略 */
  name?: string;
  priority?: number;
  cooldown?: number;
  cost?: Cost;
  disabled?: boolean;
}

function clampInt(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function normalizeCost(cost: Cost, fallback: Cost): Cost {
  if (!cost || typeof cost !== "object") return fallback;
  switch (cost.kind) {
    case "none":
      return { kind: "none" };
    case "resource":
      return { kind: "resource", insight: clampInt(cost.insight, 0, 3, 1) };
    case "skip_next":
      return { kind: "skip_next" };
    case "hard_cc":
      return { kind: "hard_cc", frames: clampInt(cost.frames, 0, 120, 30) };
    default:
      return fallback;
  }
}

/**
 * 把玩家的 JSON 覆盖应用到基准规则表上。
 * index 保持不变 —— 日志里的「规则[n]」始终指基准表的序号，改优先级不会改序号。
 */
export function applyRuleOverrides(base: Ruleset, overrides: RuleOverride[]): Ruleset {
  const byId = new Map<string, RuleOverride>();
  for (const o of overrides) if (o && typeof o.id === "string") byId.set(o.id, o);

  const rules = base.rules
    .filter((r) => !byId.get(r.id)?.disabled)
    .map((r) => {
      const o = byId.get(r.id);
      if (!o) return r;
      return {
        ...r,
        priority: clampInt(o.priority ?? r.priority, 0, 999, r.priority),
        cooldown: o.cooldown === undefined ? r.cooldown : clampInt(o.cooldown, 0, 999, r.cooldown ?? 0),
        cost: normalizeCost(o.cost ?? r.cost, r.cost),
      };
    });

  return { ...base, name: `${base.name}·自定义`, rules };
}

/** 导出可编辑的覆盖列表（编辑器初始化用）。 */
export function exportRuleOverrides(base: Ruleset): RuleOverride[] {
  return base.rules.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    cost: r.cost,
    cooldown: r.cooldown,
    disabled: false,
  }));
}

function makeRuleset(
  id: RulesetId,
  name: string,
  side: Side,
  description: string,
  mechanic: Mechanic,
  drafts: RuleDraft[],
): Ruleset {
  return {
    id,
    name,
    side,
    description,
    mechanic,
    rules: drafts.map((d, i) => ({ ...d, index: i + 1 })),
  };
}

const tag = (...t: RuleTag[]): RuleTag[] => t;

/** 英雄规则表 A：突刺优先（打断优先，其次处决/碎地/裂伤，识破用尽后退格挡）。 */
export const HERO_RULES_A = makeRuleset(
  "A",
  "突刺优先",
  "hero",
  "有识破就打断蓄力，没识破就格挡还击；流血→碎地→处决是主 combo 链。",
  "interrupt",
  [
    {
      id: "A_interrupt",
      side: "hero",
      name: "突刺打断",
      when: "敌方蓄力 且 距离≤2 且 识破≥1",
      skill: "hero_thrust" as SkillId,
      priority: 90,
      cost: { kind: "resource", insight: 1 },
      tags: tag("interrupt"),
      test: ({ self, foe }) => foe.charging && self.distance <= 2 && self.insight >= 1,
    },
    {
      id: "A_riposte",
      side: "hero",
      name: "后摇还击",
      when: "敌方收招中 且 自己处于还击窗口 且 距离≤1",
      skill: "hero_riposte",
      priority: 88,
      cost: { kind: "none" },
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => foe.recovering && self.has("riposte") && self.distance <= 1,
    },
    {
      id: "A_execute",
      side: "hero",
      name: "处决",
      when: "敌方被击晕 且 距离≤1",
      skill: "hero_execute",
      priority: 86,
      cost: { kind: "hard_cc", frames: 36 },
      cooldown: 120,
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => foe.has("stun") && self.distance <= 1 && !self.has("guard"),
    },
    {
      id: "A_hammer",
      side: "hero",
      name: "碎地锤",
      when: "敌方流血 且 距离≤1",
      skill: "hero_earthhammer",
      priority: 82,
      cost: { kind: "none" },
      cooldown: 200,
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => foe.has("bleed") && self.distance <= 1 && !self.has("guard"),
    },
    {
      id: "A_read",
      side: "hero",
      name: "看破",
      when: "敌方蓄力 且 只剩 1 点识破",
      skill: "hero_read",
      priority: 92,
      cost: { kind: "resource", insight: 1 },
      tags: tag("defense"),
      test: ({ self, foe }) => foe.charging && self.insight === 1 && !self.read,
    },
    {
      id: "A_rend",
      side: "hero",
      name: "裂伤",
      when: "敌方未流血 且 距离≤1",
      skill: "hero_rend",
      priority: 60,
      cost: { kind: "none" },
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => !foe.has("bleed") && self.distance <= 1 && !self.has("guard"),
    },
    {
      id: "A_guard",
      side: "hero",
      name: "格挡",
      when: "敌方蓄力 且 距离≤2 且 识破=0",
      skill: "hero_guard",
      priority: 56,
      cost: { kind: "none" },
      cooldown: 30,
      tags: tag("defense"),
      test: ({ self, foe }) =>
        foe.charging && self.distance <= 2 && self.insight === 0 && !self.has("guard"),
    },
    {
      id: "A_dodge",
      side: "hero",
      name: "闪避",
      when: "敌方重锤起手≤9帧 且 无格挡 且 距离≤1",
      skill: "hero_dodge",
      priority: 54,
      cost: { kind: "skip_next" },
      cooldown: 60,
      tags: tag("defense"),
      test: ({ self, foe }) =>
        foe.windupSkill === "enemy_slam" &&
        foe.windupLeft > 0 &&
        foe.windupLeft <= JUDGE_TOLERANCE_FRAMES &&
        !self.has("guard") &&
        !self.has("iframes") &&
        self.distance <= 1,
    },
    {
      id: "A_step",
      side: "hero",
      name: "垫步",
      when: "距离>1",
      skill: "hero_step",
      priority: 30,
      cost: { kind: "none" },
      tags: tag("move"),
      test: ({ self }) => self.distance > 1,
    },
    {
      id: "A_attack",
      side: "hero",
      name: "突刺",
      when: "距离≤1",
      skill: "hero_thrust",
      priority: 12,
      cost: { kind: "none" },
      tags: tag("attack"),
      test: ({ self }) => self.distance <= 1 && !self.has("guard"),
    },
  ],
);

/**
 * 英雄规则表 B：全格挡流。
 * 故意去掉打断与处决：同 seed 下战斗进程会分叉，用于验收 #2。
 */
export const HERO_RULES_B = makeRuleset(
  "B",
  "全格挡流",
  "hero",
  "不打断、不处决：靠格挡吃蓄力，再靠后摇还击。规则改动应当改变结局。",
  "guard",
  [
    {
      id: "B_riposte",
      side: "hero",
      name: "后摇还击",
      when: "敌方收招中 且 自己处于还击窗口 且 距离≤1",
      skill: "hero_riposte",
      priority: 90,
      cost: { kind: "none" },
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => foe.recovering && self.has("riposte") && self.distance <= 1,
    },
    {
      id: "B_guard",
      side: "hero",
      name: "格挡",
      when: "敌方蓄力 且 距离≤2 且 未在格挡",
      skill: "hero_guard",
      priority: 84,
      cost: { kind: "none" },
      cooldown: 30,
      tags: tag("defense"),
      test: ({ self, foe }) => foe.charging && self.distance <= 2 && !self.has("guard"),
    },
    {
      id: "B_hammer",
      side: "hero",
      name: "碎地锤",
      when: "敌方流血 且 距离≤1",
      skill: "hero_earthhammer",
      priority: 70,
      cost: { kind: "none" },
      cooldown: 200,
      tags: tag("attack"),
      test: ({ self, foe }) => foe.has("bleed") && self.distance <= 1,
    },
    {
      id: "B_rend",
      side: "hero",
      name: "裂伤",
      when: "敌方未流血 且 距离≤1",
      skill: "hero_rend",
      priority: 50,
      cost: { kind: "none" },
      tags: tag("attack"),
      test: ({ self, foe }) => !foe.has("bleed") && self.distance <= 1,
    },
    {
      id: "B_step",
      side: "hero",
      name: "垫步",
      when: "距离>1",
      skill: "hero_step",
      priority: 30,
      cost: { kind: "none" },
      tags: tag("move"),
      test: ({ self }) => self.distance > 1,
    },
    {
      id: "B_attack",
      side: "hero",
      name: "突刺",
      when: "距离≤1",
      skill: "hero_thrust",
      priority: 12,
      cost: { kind: "none" },
      tags: tag("attack"),
      test: ({ self }) => self.distance <= 1,
    },
  ],
);

/**
 * 英雄规则表 C：识破流。
 * 不用突刺打断蓄力，而是用「看破」把识破换成必暴击；重锤用闪避躲，
 * 识破耗尽后才退回格挡。用来验证：同一 seed 下换英雄规则表，战斗形状完全不同。
 */
export const HERO_RULES_C = makeRuleset(
  "C",
  "识破流",
  "hero",
  "不打断：蓄力时看破换暴击，重锤靠闪避，识破耗尽才格挡还击。",
  "insight",
  [
    {
      id: "C_riposte",
      side: "hero",
      name: "后摇还击",
      when: "敌方收招中 且 自己处于还击窗口 且 距离≤1",
      skill: "hero_riposte",
      priority: 90,
      cost: { kind: "none" },
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => foe.recovering && self.has("riposte") && self.distance <= 1,
    },
    {
      id: "C_read",
      side: "hero",
      name: "看破",
      when: "敌方蓄力 且 识破≥1",
      skill: "hero_read",
      priority: 92,
      cost: { kind: "resource", insight: 1 },
      tags: tag("defense"),
      test: ({ self, foe }) => foe.charging && self.insight >= 1 && !self.read,
    },
    {
      id: "C_execute",
      side: "hero",
      name: "处决",
      when: "敌方被击晕 且 距离≤1",
      skill: "hero_execute",
      priority: 86,
      cost: { kind: "hard_cc", frames: 36 },
      cooldown: 120,
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => foe.has("stun") && self.distance <= 1 && !self.has("guard"),
    },
    {
      id: "C_dodge",
      side: "hero",
      name: "闪避",
      when: "敌方重锤起手≤9帧 且 未格挡 且 距离≤1",
      skill: "hero_dodge",
      priority: 84,
      cost: { kind: "skip_next" },
      cooldown: 50,
      tags: tag("defense"),
      test: ({ self, foe }) =>
        foe.windupSkill === "enemy_slam" &&
        foe.windupLeft > 0 &&
        foe.windupLeft <= JUDGE_TOLERANCE_FRAMES &&
        !self.has("guard") &&
        !self.has("iframes") &&
        self.distance <= 1,
    },
    {
      id: "C_hammer",
      side: "hero",
      name: "碎地锤",
      when: "敌方流血 且 距离≤1",
      skill: "hero_earthhammer",
      priority: 82,
      cost: { kind: "none" },
      cooldown: 200,
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => foe.has("bleed") && self.distance <= 1 && !self.has("guard"),
    },
    {
      id: "C_rend",
      side: "hero",
      name: "裂伤",
      when: "敌方未流血 且 距离≤1",
      skill: "hero_rend",
      priority: 60,
      cost: { kind: "none" },
      tags: tag("combo", "attack"),
      test: ({ self, foe }) => !foe.has("bleed") && self.distance <= 1 && !self.has("guard"),
    },
    {
      id: "C_guard",
      side: "hero",
      name: "格挡",
      when: "敌方蓄力 且 识破=0 且 距离≤2",
      skill: "hero_guard",
      priority: 56,
      cost: { kind: "none" },
      cooldown: 30,
      tags: tag("defense"),
      test: ({ self, foe }) =>
        foe.charging && self.insight === 0 && self.distance <= 2 && !self.has("guard"),
    },
    {
      id: "C_step",
      side: "hero",
      name: "垫步",
      when: "距离>1",
      skill: "hero_step",
      priority: 30,
      cost: { kind: "none" },
      tags: tag("move"),
      test: ({ self }) => self.distance > 1,
    },
    {
      id: "C_attack",
      side: "hero",
      name: "突刺",
      when: "距离≤1",
      skill: "hero_thrust",
      priority: 12,
      cost: { kind: "none" },
      tags: tag("attack"),
      test: ({ self }) => self.distance <= 1 && !self.has("guard"),
    },
  ],
);

/** 敌方规则表：血线 → 蓄力 → 重锤，其余时间横扫/逼近。 */
export const ENEMY_RULES = makeRuleset(
  "ENEMY",
  "碎地重锤",
  "enemy",
  "血<40% 开始蓄力，蓄力末端释放重锤；平时横扫与逼近。",
  "heavy",
  [
    {
      id: "E_release",
      side: "enemy",
      name: "重锤释放",
      when: "蓄力剩余≤12帧",
      skill: "enemy_slam",
      priority: 95,
      cost: { kind: "none" },
      tags: tag("attack"),
      reveal: "敌方规则触发：蓄力末端 → 碎地重锤",
      test: ({ self }) => self.has("charge") && self.frames("charge") <= 12,
    },
    {
      id: "E_charge",
      side: "enemy",
      name: "蓄力",
      when: "自身血量<40%（或战斗≥4s）且 未蓄力",
      skill: "enemy_charge",
      priority: 80,
      cost: { kind: "none" },
      cooldown: 300,
      tags: tag("attack"),
      reveal: "敌方规则触发：血<40%（或战斗≥4s）→ 蓄力碎地锤",
      test: ({ self, frame }) =>
        (self.hp / self.maxHp < 0.4 || frame >= 240) && !self.charging,
    },
    {
      id: "E_slam",
      side: "enemy",
      name: "碎地重锤",
      when: "距离≤1 且 重锤冷却就绪",
      skill: "enemy_slam",
      priority: 50,
      cost: { kind: "none" },
      cooldown: 240,
      tags: tag("attack"),
      reveal: "敌方规则触发：距离≤1 且 冷却就绪 → 碎地重锤",
      test: ({ self }) => self.distance <= 1 && !self.charging,
    },
    {
      id: "E_swipe",
      side: "enemy",
      name: "横扫",
      when: "距离≤1",
      skill: "enemy_swipe",
      priority: 30,
      cost: { kind: "none" },
      cooldown: 70,
      tags: tag("attack"),
      reveal: "敌方规则触发：距离≤1 → 横扫",
      test: ({ self }) => self.distance <= 1 && !self.charging,
    },
    {
      id: "E_step",
      side: "enemy",
      name: "逼近",
      when: "距离>1",
      skill: "enemy_step",
      priority: 20,
      cost: { kind: "none" },
      tags: tag("move"),
      test: ({ self }) => self.distance > 1,
    },
  ],
);

/**
 * 敌方规则表 B：压制连锤。
 * 更早进入蓄力、重锤冷却更短，并且会主动「破防」英雄的格挡。
 * 用于验证：同一套英雄规则下，换敌方规则表也会改变结果。
 */
export const ENEMY_RULES_B = makeRuleset(
  "ENEMY_B",
  "压制连锤",
  "enemy",
  "战斗 1.5s 后就蓄力，重锤冷却更短；英雄一开格挡就提前破防。",
  "pressure",
  [
    {
      id: "EB_release",
      side: "enemy",
      name: "重锤释放",
      when: "蓄力剩余≤12帧",
      skill: "enemy_slam",
      priority: 96,
      cost: { kind: "none" },
      tags: tag("attack"),
      reveal: "敌方规则触发：蓄力末端 → 碎地重锤",
      test: ({ self }) => self.has("charge") && self.frames("charge") <= 12,
    },
    {
      id: "EB_punish_guard",
      side: "enemy",
      name: "破防重锤",
      when: "英雄格挡中 且 距离≤1 且 未蓄力",
      skill: "enemy_slam",
      priority: 90,
      cost: { kind: "none" },
      cooldown: 180,
      tags: tag("attack"),
      reveal: "敌方规则触发：英雄格挡 → 破防重锤",
      test: ({ self, foe }) => foe.has("guard") && self.distance <= 1 && !self.charging,
    },
    {
      id: "EB_charge",
      side: "enemy",
      name: "蓄力",
      when: "战斗≥0.5s 或 血量<55% 且 未蓄力",
      skill: "enemy_charge",
      priority: 85,
      cost: { kind: "none" },
      cooldown: 20,
      tags: tag("attack"),
      reveal: "敌方规则触发：战斗≥0.5s（或血<55%）→ 蓄力碎地锤",
      test: ({ self, frame }) =>
        (frame >= 10 || self.hp / self.maxHp < 0.55) && !self.charging,
    },
    {
      id: "EB_slam",
      side: "enemy",
      name: "碎地重锤",
      when: "距离≤1 且 未蓄力",
      skill: "enemy_slam",
      priority: 60,
      cost: { kind: "none" },
      cooldown: 20,
      tags: tag("attack"),
      reveal: "敌方规则触发：距离≤1 → 碎地重锤",
      test: ({ self }) => self.distance <= 1 && !self.charging,
    },
    {
      id: "EB_swipe",
      side: "enemy",
      name: "横扫",
      when: "距离≤1 且 未蓄力",
      skill: "enemy_swipe",
      priority: 25,
      cost: { kind: "none" },
      cooldown: 50,
      tags: tag("attack"),
      reveal: "敌方规则触发：距离≤1 → 横扫",
      test: ({ self }) => self.distance <= 1 && !self.charging,
    },
    {
      id: "EB_step",
      side: "enemy",
      name: "压上",
      when: "距离>1",
      skill: "enemy_step",
      priority: 40,
      cost: { kind: "none" },
      tags: tag("move"),
      test: ({ self }) => self.distance > 1,
    },
  ],
);

/**
 * 规则表变体：复用同一批判定，只改优先级/冷却，保证行为差异可被日志观察。
 */
function variant(
  base: Ruleset,
  id: RulesetId,
  name: string,
  side: Side,
  description: string,
  mechanic: Mechanic,
  tweaks: Record<string, { priority?: number; cooldown?: number; name?: string; disabled?: boolean }>,
): Ruleset {
  const rules = base.rules
    .filter((r) => !tweaks[r.id]?.disabled)
    .map((r) => {
      const t = tweaks[r.id];
      if (!t) return { ...r };
      return {
        ...r,
        name: t.name ?? r.name,
        priority: t.priority ?? r.priority,
        cooldown: t.cooldown ?? r.cooldown,
      };
    })
    .map((r, i) => ({ ...r, index: i + 1 }));
  return { id, name, side, description, mechanic, rules };
}

/** D：裂伤处决流（先裂伤，再碎地，最后处决）。 */
export const HERO_RULES_D = variant(
  HERO_RULES_A,
  "D",
  "裂伤处决",
  "hero",
  "优先铺裂伤→碎地→处决，打断与识破让位给 combo。",
  "bleed",
  {
    A_interrupt: { priority: 55 },
    A_read: { priority: 50 },
    A_guard: { priority: 40 },
    A_rend: { priority: 92, name: "裂伤起手" },
    A_hammer: { priority: 90, name: "碎地收割" },
    A_execute: { priority: 94, name: "处决终结" },
  },
);

/** E：守势反击流（格挡/闪避/识破优先，只在安全窗口还击）。 */
export const HERO_RULES_E = variant(
  HERO_RULES_B,
  "E",
  "守势反击",
  "hero",
  "先格挡/识破/闪避，等敌方收招再还击；伤害低但很难被一套打死。",
  "desperate",
  {
    B_guard: { priority: 92 },
    B_dodge: { priority: 90 },
    B_read: { priority: 88 },
    B_riposte: { priority: 86, name: "反击窗口" },
    B_thrust: { priority: 40 },
  },
);

export const ENEMY_RULESETS = {
  ENEMY: ENEMY_RULES,
  ENEMY_B: ENEMY_RULES_B,
} as unknown as Record<"ENEMY" | "ENEMY_B" | "ENEMY_C" | "ENEMY_D" | "ENEMY_E", Ruleset>;

/** C：蓄力处决（更早蓄力、重锤更频繁）。 */
export const ENEMY_RULES_C = variant(
  ENEMY_RULES_B,
  "ENEMY_C",
  "蓄力处决",
  "enemy",
  "更早进入蓄力，重锤释放优先级最高，横扫只做填充。",
  "early_charge",
  {
    EB_charge: { priority: 94, cooldown: 160, name: "提前蓄力" },
    EB_release: { priority: 98 },
    EB_slam: { priority: 70 },
    EB_swipe: { priority: 15 },
  },
);

/** D：快刀压制（横扫为主，几乎不蓄力）。 */
export const ENEMY_RULES_D = variant(
  ENEMY_RULES,
  "ENEMY_D",
  "快刀压制",
  "enemy",
  "贴身连续横扫，蓄力极少；用高频小伤害压制英雄。",
  "fast",
  {
    E_swipe: { priority: 96, cooldown: 24, name: "连扫" },
    E_slam: { priority: 55, cooldown: 200 },
    E_charge: { priority: 20, cooldown: 300 },
    E_step: { priority: 70 },
  },
);

/** E：游走消耗（保持距离，抓空档重锤）。 */
export const ENEMY_RULES_E = variant(
  ENEMY_RULES_B,
  "ENEMY_E",
  "游走消耗",
  "enemy",
  "先拉开距离再抓空档，重锤少但更突然。",
  "kite",
  {
    EB_step: { priority: 92, name: "拉开距离" },
    EB_slam: { priority: 60, cooldown: 220 },
    EB_charge: { priority: 65, cooldown: 260 },
    EB_swipe: { priority: 30 },
  },
);



/** 确反连招：格挡还击（确反）后 70 帧内自动接裂伤 / 碎地锤。 */
const COMBO_RULES: RuleDraft[] = [
  {
    id: "combo_hammer",
    side: "hero",
    name: "确反→碎地",
    when: "确反连招窗口 且 敌方流血 且 距离≤1",
    skill: "hero_earthhammer",
    priority: 99,
    cost: { kind: "none" },
    tags: tag("combo", "attack"),
    test: ({ self, foe }) => self.has("combo_ready") && foe.has("bleed") && self.distance <= 1,
  },
  {
    id: "combo_rend",
    side: "hero",
    name: "确反→裂伤",
    when: "确反连招窗口 且 敌方未流血 且 距离≤1",
    skill: "hero_rend",
    priority: 99,
    cost: { kind: "none" },
    tags: tag("combo", "attack"),
    test: ({ self, foe }) => self.has("combo_ready") && !foe.has("bleed") && self.distance <= 1,
  },
];

const SPACING_RULE: RuleDraft = {
  id: "spacing_retreat",
  side: "hero",
  name: "拉开距离",
  when: "距离≤1 且 没有更高优先级的攻击",
  skill: "hero_retreat",
  priority: 30,
  cost: { kind: "none" },
  cooldown: 160,
  tags: tag("move"),
  test: ({ self }) => self.distance <= 1 || (self.hp / self.maxHp < 0.35 && self.distance <= 2),
};

const ENEMY_SPACING_RULE: RuleDraft = {
  ...SPACING_RULE,
  id: "enemy_spacing_retreat",
  side: "enemy",
  name: "游走",
  skill: "enemy_retreat",
  when: "距离≤1 且 没有更高优先级的攻击",
  test: ({ self }) => self.distance <= 1 || (self.hp / self.maxHp < 0.35 && self.distance <= 2),
};

const HERO_RANGED_RULE: RuleDraft = {
  id: "hero_ranged_rule",
  side: "hero",
  name: "远程牵制",
  when: "距离 2~4",
  skill: "hero_ranged",
  priority: 45,
  cost: { kind: "none" },
  cooldown: 110,
  tags: tag("attack"),
  test: ({ self }) => self.distance >= 2 && self.distance <= 4,
};

const ENEMY_RANGED_RULE: RuleDraft = {
  ...HERO_RANGED_RULE,
  id: "enemy_ranged_rule",
  side: "enemy",
  name: "远程骚扰",
  skill: "enemy_ranged",
};

const HERO_TENTACLE_RULE: RuleDraft = {
  id: "hero_tentacle_rule",
  side: "hero",
  name: "暗触禁锢",
  when: "距离 2~4",
  skill: "hero_tentacle",
  priority: 60,
  cost: { kind: "none" },
  cooldown: 240,
  tags: tag("attack"),
  test: ({ self }) => self.distance >= 2 && self.distance <= 4,
};

const ENEMY_TENTACLE_RULE: RuleDraft = { ...HERO_TENTACLE_RULE, id: "enemy_tentacle_rule", side: "enemy", skill: "enemy_tentacle" };

const HERO_FLURRY_RULE: RuleDraft = {
  id: "hero_flurry_rule",
  side: "hero",
  name: "高频突刺",
  when: "距离≤1",
  skill: "hero_flurry",
  priority: 56,
  cost: { kind: "none" },
  cooldown: 180,
  tags: tag("attack"),
  test: ({ self }) => self.distance <= 1,
};

const ENEMY_FLURRY_RULE: RuleDraft = { ...HERO_FLURRY_RULE, id: "enemy_flurry_rule", side: "enemy", skill: "enemy_flurry" };

const HERO_WHIRL_RULE: RuleDraft = {
  id: "hero_whirl_rule",
  side: "hero",
  name: "旋风斩",
  when: "距离≤1",
  skill: "hero_whirl",
  priority: 58,
  cost: { kind: "none" },
  cooldown: 240,
  tags: tag("attack"),
  test: ({ self }) => self.distance <= 1,
};

const ENEMY_WHIRL_RULE: RuleDraft = { ...HERO_WHIRL_RULE, id: "enemy_whirl_rule", side: "enemy", skill: "enemy_whirl" };

const HERO_SPECIAL_RULE: RuleDraft = {
  id: "hero_special_rule",
  side: "hero",
  name: "角色特技",
  when: "距离≤1",
  skill: "hero_special",
  priority: 52,
  cost: { kind: "none" },
  cooldown: 300,
  tags: tag("attack"),
  test: ({ self }) => self.distance <= 1,
};

const ENEMY_SPECIAL_RULE: RuleDraft = {
  ...HERO_SPECIAL_RULE,
  id: "enemy_special_rule",
  side: "enemy",
  skill: "enemy_special",
};

const HERO_RANGED2_RULE: RuleDraft = {
  id: "hero_ranged2_rule",
  side: "hero",
  name: "强射",
  when: "距离 3~5",
  skill: "hero_ranged_2",
  priority: 44,
  cost: { kind: "none" },
  cooldown: 150,
  tags: tag("attack"),
  test: ({ self }) => self.distance >= 3 && self.distance <= 5,
};

const ENEMY_RANGED2_RULE: RuleDraft = {
  ...HERO_RANGED2_RULE,
  id: "enemy_ranged2_rule",
  side: "enemy",
  skill: "enemy_ranged_2",
};

function withExtras(rs: Ruleset, extras: RuleDraft[]): Ruleset {
  const start = rs.rules.length;
  return {
    ...rs,
    rules: [...rs.rules, ...COMBO_RULES.map((d, i) => ({ ...d, index: start + i + 1 })), ...extras.map((d, i) => ({ ...d, index: start + COMBO_RULES.length + i + 1 }))],
  };
}

function withCombo(rs: Ruleset): Ruleset {
  return withExtras(rs, [SPACING_RULE, HERO_RANGED_RULE, HERO_RANGED2_RULE, HERO_SPECIAL_RULE, HERO_FLURRY_RULE, HERO_WHIRL_RULE, HERO_TENTACLE_RULE]);
}

function withEnemySpacing(rs: Ruleset): Ruleset {
  return withExtras(rs, [ENEMY_SPACING_RULE, ENEMY_RANGED_RULE, ENEMY_RANGED2_RULE, ENEMY_SPECIAL_RULE, ENEMY_FLURRY_RULE, ENEMY_WHIRL_RULE, ENEMY_TENTACLE_RULE]);
}

ENEMY_RULESETS.ENEMY = withEnemySpacing(ENEMY_RULES);
ENEMY_RULESETS.ENEMY_B = withEnemySpacing(ENEMY_RULES_B);
ENEMY_RULESETS.ENEMY_C = withEnemySpacing(ENEMY_RULES_C);
ENEMY_RULESETS.ENEMY_D = withEnemySpacing(ENEMY_RULES_D);
ENEMY_RULESETS.ENEMY_E = withEnemySpacing(ENEMY_RULES_E);

export const HERO_RULESETS: Record<"A" | "B" | "C" | "D" | "E", Ruleset> = {
  A: withCombo(HERO_RULES_A),
  B: withCombo(HERO_RULES_B),
  C: withCombo(HERO_RULES_C),
  D: withCombo(HERO_RULES_D),
  E: withCombo(HERO_RULES_E),
};

export function getRuleset(id: RulesetId): Ruleset {
  if (id in ENEMY_RULESETS) return ENEMY_RULESETS[id as keyof typeof ENEMY_RULESETS];
  return HERO_RULESETS[id as keyof typeof HERO_RULESETS];
}























