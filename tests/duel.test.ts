import { describe, expect, it } from "vitest";
import { CARDS, DuelSession, deriveBans } from "../src/duel/session.ts";

function fill(session: DuelSession): void {
  for (let slot = 1; slot <= 8; slot++) {
    const card = CARDS.find((c) => session.canPlace(slot, c.id).ok);
    if (card) session.setSlot(slot, card.id);
  }
}

function play(seed: number): DuelSession {
  const s = new DuelSession();
  s.newRun(seed);
  s.revealBans();
  s.beginCompose();
  fill(s);
  expect(s.canStart().ok).toBe(true);
  expect(s.startResolution()).toBe(true);
  let guard = 0;
  while (!s.done && guard++ < 20000) s.step();
  return s;
}

describe("种子与禁用派生", () => {
  it("同种子禁用完全一致，不同种子会变化", () => {
    expect(deriveBans(20260101)).toEqual(deriveBans(20260101));
    const a = JSON.stringify(deriveBans(1));
    const b = JSON.stringify(deriveBans(2));
    expect(a).not.toBe(b);
  });

  it("禁用只来自 8 技能 + 2 位移（不会禁掉起手结构牌）", () => {
    for (let seed = 1; seed < 30; seed++) {
      const bans = deriveBans(seed);
      expect(bans.skills.length).toBe(2);
      expect(["dash", "blink"]).toContain(bans.move);
      expect(bans.skills).not.toContain("stance");
      expect(bans.skills).not.toContain("gamble");
    }
  });
});

describe("确定性", () => {
  it("同种子 + 同编排，两次跑逐项一致", () => {
    const a = play(20260101);
    const b = play(20260101);
    expect(a.logs.map((l) => l.text)).toEqual(b.logs.map((l) => l.text));
    expect([a.winner, a.heroHp, a.enemyHp, a.frame]).toEqual([b.winner, b.heroHp, b.enemyHp, b.frame]);
    expect(a.summary).toBe(b.summary);
  });

  it("归因日志字段齐全，末项队列为 0", () => {
    const s = play(20260101);
    expect(s.logs.length).toBeGreaterThan(0);
    for (const l of s.logs) {
      for (const key of ["runId", "seed", "frame", "slot", "phase", "actor", "skill", "hit", "damage", "affinity", "displacement", "freeze", "queueLenAfter"]) {
        expect(l).toHaveProperty(key);
      }
    }
    expect(s.queueLength()).toBe(0);
    expect(s.lingeringTimers()).toBe(0);
    expect(s.summary ?? "").toContain("queueLen=0");
  });
});

function composeWith(session: DuelSession, prefs: Record<number, string[]>): void {
  for (let slot = 1; slot <= 8; slot++) {
    const list = prefs[slot] ?? [];
    let picked = list.find((id) => session.canPlace(slot, id).ok);
    if (!picked) picked = CARDS.find((c) => session.canPlace(slot, c.id).ok)?.id;
    if (picked) session.setSlot(slot, picked);
  }
}

describe("8 槽分段约束", () => {
  it("起手 3 槽总时长 ≥ 180 帧（3 秒）", () => {
    const s = new DuelSession();
    s.newRun(20260101);
    s.revealBans();
    s.beginCompose();
    fill(s);
    expect(s.openerFrames()).toBeGreaterThanOrEqual(180);
  });

  it("起手不允许直接输出牌；收尾不允许爆发牌", () => {
    const s = new DuelSession();
    s.newRun(20260101);
    s.revealBans();
    s.beginCompose();
    expect(s.canPlace(1, "thrust").ok).toBe(false);
    const burstOk = s.canPlace(4, "execute").ok;
    expect(burstOk).toBe(false);
    expect(s.canPlace(7, "stance").ok).toBe(false);
  });

  it("禁用后仍能排出两种归因上可区分的策略", () => {
    const play = (prefs: Record<number, string[]>) => {
      const s = new DuelSession();
      s.newRun(20260101);
      s.revealBans();
      s.beginCompose();
      composeWith(s, prefs);
      expect(s.canStart().ok).toBe(true);
      s.startResolution();
      let guard = 0;
      while (!s.done && guard++ < 20000) s.step();
      return s;
    };
    const a = play({ 1: ["stance"], 2: ["guard"], 3: ["dash", "blink"], 4: ["rend"], 5: ["hammer"], 6: ["thrust"], 7: ["execute"], 8: ["disengage"] });
    const b = play({ 1: ["gamble"], 2: ["stance"], 3: ["guard"], 4: ["thrust"], 5: ["rend"], 6: ["hammer"], 7: ["execute"], 8: ["disengage"] });
    const skillsA = a.logs.filter((l) => l.actor === "hero").map((l) => l.skill).join(",");
    const skillsB = b.logs.filter((l) => l.actor === "hero").map((l) => l.skill).join(",");
    expect(skillsA).not.toBe(skillsB);
    const reasonsA = a.logs.filter((l) => l.affinity.triggered).map((l) => l.affinity.reason);
    expect(reasonsA.length).toBeGreaterThan(0);
    expect(a.logs.some((l) => l.affinity.reason.includes("错位"))).toBe(false);
    expect(b.logs.some((l) => l.affinity.reason.includes("错位"))).toBe(true);
  });

  it("清空起手任一一格就无法开始", () => {
    const s = new DuelSession();
    s.newRun(20260101);
    s.revealBans();
    s.beginCompose();
    fill(s);
    s.setSlot(2, null);
    expect(s.canStart().ok).toBe(false);
  });
});


