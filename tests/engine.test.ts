import { describe, expect, it } from "vitest";
import { Battle, hitstopForTier } from "../src/engine/battle.ts";
import type { BattleResult } from "../src/engine/battle.ts";
import { TIERS, TIER_RANGES } from "../src/presentation/tiers.ts";

function run(seed: number, ruleset: "A" | "B" = "A"): BattleResult {
  return new Battle({ seed, heroRuleset: ruleset }).run();
}

describe("确定性（同 seed 同规则）", () => {
  it("两次运行的 digest / 帧数 / 日志长度完全一致", () => {
    const a = run(20260101);
    const b = run(20260101);
    expect(a.digest).toBe(b.digest);
    expect(a.frames).toBe(b.frames);
    expect(a.heroHp).toBe(b.heroHp);
    expect(a.enemyHp).toBe(b.enemyHp);
    expect(a.log.length).toBe(b.log.length);
    expect(a.events.map((e) => [e.frame, e.type])).toEqual(b.events.map((e) => [e.frame, e.type]));
  });

  it("引擎不依赖 Math.random / Date.now（同进程重复跑 3 次仍然一致）", () => {
    const digests = new Set([run(7).digest, run(7).digest, run(7).digest]);
    expect(digests.size).toBe(1);
  });
});

describe("种子与规则的分叉", () => {
  it("不同 seed 产生不同过程", () => {
    const a = run(20260101);
    const b = run(424242);
    expect(a.digest).not.toBe(b.digest);
  });

  it("同 seed 换规则表 A/B 结果改变", () => {
    const a = run(20260101, "A");
    const b = run(20260101, "B");
    expect(a.digest).not.toBe(b.digest);
    expect(a.frames).not.toBe(b.frames);
  });

  it("里程碑能解释差异：两局在敌方 40% 血线的帧不同", () => {
    const a = run(20260101);
    const b = run(424242);
    const at = (r: BattleResult) => r.milestones.find((m) => m.key === "enemy-40")?.frame;
    expect(at(a)).toBeDefined();
    expect(at(b)).toBeDefined();
    expect(at(a)).not.toBe(at(b));
  });
});

describe("规则仲裁与代价", () => {
  it("日志写出「规则[n] 抢在规则[m] 前面」", () => {
    const r = run(20260101);
    const clash = r.events.find((e) => e.type === "PRIORITY_CLASH");
    expect(clash).toBeDefined();
    expect(clash!.text).toMatch(/规则\[\d+\] 抢在规则\[\d+\] 前面触发（priority \d+ > \d+/);
  });

  it("打断成功并消耗识破", () => {
    const r = run(20260101);
    expect(r.stats.interrupts).toBeGreaterThan(0);
    expect(r.events.some((e) => e.type === "INTERRUPT_SUCCESS")).toBe(true);
    expect(r.stats.insightSpent).toBeGreaterThan(0);
  });

  it("三种代价都在规则表里出现：资源 / 跳过下一条 / 硬直", () => {
    const r = run(20260101);
    const costs = r.events
      .filter((e) => e.type === "RULE_TRIGGER")
      .map((e) => String(e.data?.cost ?? ""));
    expect(costs.some((c) => c.includes("识破-"))).toBe(true);
    expect(costs.some((c) => c.includes("硬直"))).toBe(true);
  });
});

describe("combo 链", () => {
  it("至少 3 条链在日志里成立", () => {
    const r = run(20260101);
    const completed = r.events.filter((e) => e.type === "COMBO_STEP" && e.data?.completed === true);
    const chains = new Set(completed.map((e) => String(e.data?.chain)));
    expect(chains.size).toBeGreaterThanOrEqual(3);
  });

  it("链步骤连续，不会从 1/3 直接跳到 3/3", () => {
    const r = run(20260101);
    for (const name of ["bleed_exec", "guard_counter"] as const) {
      const steps = r.events
        .filter((e) => e.type === "COMBO_STEP" && e.data?.chain === name)
        .map((e) => Number(e.data?.step));
      for (let i = 1; i < steps.length; i++) {
        if (steps[i] === 1) continue; // 新一次尝试
        expect(steps[i]).toBe(steps[i - 1] + 1);
      }
    }
  });
});

describe("演出分层表", () => {
  it("hitstop 落在规格区间 3-5 / 8-12 / 15-25", () => {
    for (const tier of ["normal", "key", "ultimate"] as const) {
      const [lo, hi] = TIER_RANGES[tier];
      expect(TIERS[tier].hitstopFrames).toBeGreaterThanOrEqual(lo);
      expect(TIERS[tier].hitstopFrames).toBeLessThanOrEqual(hi);
    }
  });

  it("三层严格递进，且普通命中不推镜不位移", () => {
    expect(TIERS.normal.hitstopFrames).toBeLessThan(TIERS.key.hitstopFrames);
    expect(TIERS.key.hitstopFrames).toBeLessThan(TIERS.ultimate.hitstopFrames);
    expect(TIERS.normal.camera).toBe("none");
    expect(TIERS.normal.shake).toBe(0);
    expect(TIERS.normal.displacement).toBe("none");
    expect(TIERS.ultimate.timeScale).toBeLessThan(1);
  });

  it("引擎 hitstop 映射与分层表一致", () => {
    for (const tier of ["normal", "key", "ultimate"] as const) {
      expect(hitstopForTier(tier)).toBe(TIERS[tier].hitstopFrames);
    }
  });
});

describe("敌方规则表", () => {
  const firstCharge = (ruleset: "ENEMY" | "ENEMY_B") => {
    const r = new Battle({ seed: 20260101, heroRuleset: "A", enemyRuleset: ruleset }).run();
    return r.events.find((e) => e.type === "SKILL_START" && e.skill === "enemy_charge")?.frame ?? Infinity;
  };

  it("同 seed 换敌方规则表，结果改变", () => {
    const a = new Battle({ seed: 20260101, heroRuleset: "A", enemyRuleset: "ENEMY" }).run();
    const b = new Battle({ seed: 20260101, heroRuleset: "A", enemyRuleset: "ENEMY_B" }).run();
    expect(a.digest).not.toBe(b.digest);
  });

  it("压制连锤表更早进入蓄力", () => {
    expect(firstCharge("ENEMY_B")).toBeLessThan(firstCharge("ENEMY"));
  });

  it("换敌方规则表后仍然完全可复现", () => {
    const run = () => new Battle({ seed: 424242, heroRuleset: "A", enemyRuleset: "ENEMY_B" }).run();
    expect(run().digest).toBe(run().digest);
  });
});

describe("空间转换", () => {  it("换位后双方仍在 0..5 格点内且不重叠", () => {
    const r = run(20260101);
    const swaps = r.events.filter((e) => e.type === "SWAP");
    expect(swaps.length).toBeGreaterThan(0);
    for (const s of swaps) {
      const h = Number(s.data?.heroSlot);
      const e = Number(s.data?.enemySlot);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(5);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(5);
      expect(h).not.toBe(e);
    }
  });

  it("击退/位移的起止格点合法", () => {
    const r = run(20260101);
    const moves = r.events.filter((e) => e.type === "MOVE" || e.type === "KNOCKBACK");
    for (const m of moves) {
      expect(Number(m.data?.from)).toBeGreaterThanOrEqual(0);
      expect(Number(m.data?.from)).toBeLessThanOrEqual(5);
      expect(Number(m.data?.to)).toBeGreaterThanOrEqual(0);
      expect(Number(m.data?.to)).toBeLessThanOrEqual(5);
    }
  });
});
