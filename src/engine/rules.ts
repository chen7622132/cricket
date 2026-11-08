import {
  JUDGE_TOLERANCE_FRAMES,
} from "./skills.ts";
import type { RuleDef, RuleTag, Side, SkillId } from "./types.ts";

/**
 * 规则表：WHEN <condition> → DO <skill>，带 priority / cost / cooldown。
 *
 * 规则序号（index）由 makeRuleset 按数组顺序 1..n 生成，日志里的"规则[n]"就是它，
 * 换规则表后序号会变 —— 这正是玩家能看出"规则改动"的抓手。
 */

type RuleDraft = Omit<RuleDef, "index">;

export interface Ruleset {
  id: RulesetId;
  name: string;
  side: Side;
  description: string;
  rules: RuleDef[];
}

export type RulesetId = "A" | "B" | "C" | "ENEMY" | "ENEMY_B";

function makeRuleset(
  id: RulesetId,
  name: string,
  side: Side,
  description: string,
  drafts: RuleDraft[],
): Ruleset {
  return {
    id,
    name,
    side,
    description,
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
      when: "战斗≥1.5s 或 血量<55% 且 未蓄力",
      skill: "enemy_charge",
      priority: 85,
      cost: { kind: "none" },
      cooldown: 220,
      tags: tag("attack"),
      reveal: "敌方规则触发：战斗≥1.5s（或血<55%）→ 蓄力碎地锤",
      test: ({ self, frame }) =>
        (frame >= 90 || self.hp / self.maxHp < 0.55) && !self.charging,
    },
    {
      id: "EB_slam",
      side: "enemy",
      name: "碎地重锤",
      when: "距离≤1 且 未蓄力",
      skill: "enemy_slam",
      priority: 60,
      cost: { kind: "none" },
      cooldown: 140,
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

export const ENEMY_RULESETS: Record<"ENEMY" | "ENEMY_B", Ruleset> = {
  ENEMY: ENEMY_RULES,
  ENEMY_B: ENEMY_RULES_B,
};

export const HERO_RULESETS: Record<"A" | "B" | "C", Ruleset> = {
  A: HERO_RULES_A,
  B: HERO_RULES_B,
  C: HERO_RULES_C,
};

export function getRuleset(id: RulesetId): Ruleset {
  if (id === "ENEMY" || id === "ENEMY_B") return ENEMY_RULESETS[id];
  return HERO_RULESETS[id];
}
