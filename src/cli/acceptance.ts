/**
 * P0 最小验收（headless，不需要浏览器）。
 *
 * 1) 同一套规则，换 3 个 seed：日志/结局不同，且能给出"为什么不一样"的因果说明
 * 2) 同一个 seed，换一套规则：结果改变，且能定位到规则改动导致的分叉
 * 3) ≥3 条 combo 链在日志里能被识别为"链"
 * 4) 普通命中与关键判定在演出层级上明显分层
 *
 * 运行：npm run accept
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Battle, type BattleResult } from "../engine/battle.ts";
import type { BattleEvent } from "../engine/types.ts";
import { TIERS, TIER_RANGES } from "../presentation/tiers.ts";

const SEEDS = [20260101, 7, 424242];
const BASE_SEED = SEEDS[0];
const OUT_DIR = join(process.cwd(), "logs");

type Check = { id: string; name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function sec(frames: number): string {
  return `${(frames / 60).toFixed(2)}s`;
}

function milestoneMap(r: BattleResult): Map<string, { frame: number; text: string }> {
  return new Map(r.milestones.map((m) => [m.key, { frame: m.frame, text: m.text }]));
}

/** 从事件/里程碑里抽取"这一局为什么和那一局不一样"的证据。 */
function explain(a: BattleResult, b: BattleResult): string[] {
  const out: string[] = [];
  const ma = milestoneMap(a);
  const mb = milestoneMap(b);

  out.push(
    `结局：seed ${a.seed} → ${a.winner}（${sec(a.frames)}，英雄 ${a.heroHp}/160）｜seed ${b.seed} → ${b.winner}（${sec(b.frames)}，英雄 ${b.heroHp}/160）`,
  );

  const critA = a.events.find((e) => e.type === "CRIT");
  const critB = b.events.find((e) => e.type === "CRIT");
  if (critA && critB) {
    const ra = (critA.data?.rng as number | undefined) ?? -1;
    const rb = (critB.data?.rng as number | undefined) ?? -1;
    out.push(
      `首次暴击：第 ${critA.frame} 帧（rng ${ra.toFixed(3)}）vs 第 ${critB.frame} 帧（rng ${rb.toFixed(3)}）—— 同一条暴击判定，种子不同抽到的数不同`,
    );
  } else if (critA || critB) {
    out.push(`一局出了暴击（${critA ? `seed ${a.seed} 第 ${critA.frame} 帧` : `seed ${b.seed} 第 ${critB!.frame} 帧`}），另一局直到结束都没暴击`);
  }

  const h40a = ma.get("enemy-40");
  const h40b = mb.get("enemy-40");
  if (h40a && h40b) {
    const diff = h40b.frame - h40a.frame;
    out.push(
      `敌方跌破 40% 血线：第 ${h40a.frame} 帧 vs 第 ${h40b.frame} 帧（差 ${diff} 帧）→ 蓄力/重锤的触发时机整体平移`,
    );
  } else if (h40a || h40b) {
    out.push(`一局把敌人打进了 40% 血线，另一局没有 → 敌方蓄力规则是否启用不同`);
  }

  const chA = ma.get("first-charge");
  const chB = mb.get("first-charge");
  if (chA && chB) {
    out.push(`敌方首次蓄力：第 ${chA.frame} 帧 vs 第 ${chB.frame} 帧`);
  }

  out.push(
    `识破消耗 ${a.stats.insightSpent} vs ${b.stats.insightSpent}；打断 ${a.stats.interrupts} vs ${b.stats.interrupts}；格挡 ${a.stats.guards} vs ${b.stats.guards}`,
  );

  return out;
}

/** 同 seed 换规则：找第一处"实际决策"分叉（同一帧打出的招式不同），而不是先比规则序号。 */
function firstDivergence(a: BattleResult, b: BattleResult): string {
  const triggersA = a.events.filter((e) => e.type === "RULE_TRIGGER");
  const triggersB = b.events.filter((e) => e.type === "RULE_TRIGGER");
  const n = Math.min(triggersA.length, triggersB.length);
  for (let i = 0; i < n; i++) {
    const ea = triggersA[i];
    const eb = triggersB[i];
    if (ea.frame === eb.frame && ea.side === eb.side && ea.skill === eb.skill) continue;
    return `第 ${i + 1} 次规则触发处分叉：A 表在第 ${ea.frame} 帧由 规则[${ea.data?.ruleIndex}]「${ea.data?.ruleName}」→ ${ea.skill}；B 表在第 ${eb.frame} 帧由 规则[${eb.data?.ruleIndex}]「${eb.data?.ruleName}」→ ${eb.skill}`;
  }
  return "两局规则触发序列完全一致（差异只出现在伤害随机数上）";
}

function hits(r: BattleResult): BattleEvent[] {
  return r.events.filter((e) => e.type === "HIT");
}

function story(r: BattleResult): string[] {
  const lines: string[] = [];
  const interesting = new Set(["first-damage", "first-bleed", "first-stun", "first-execute", "first-crit", "first-guard", "first-interrupt", "first-charge", "first-swap", "first-knockback"]);
  for (const m of r.milestones) {
    if (interesting.has(m.key)) lines.push(`  第 ${m.frame} 帧（${sec(m.frame)}）· ${m.text}`);
  }
  for (const e of r.events) {
    if (e.type === "COMBO_STEP" && e.data?.completed) {
      lines.push(`  第 ${e.frame} 帧 · ${e.text}`);
    }
    if (e.type === "INTERRUPT_SUCCESS" || e.type === "EXECUTE" || e.type === "SWAP") {
      lines.push(`  第 ${e.frame} 帧 · ${e.text}`);
    }
  }
  lines.push(`  第 ${r.frames} 帧 · 结束：${r.winner} 获胜，英雄剩 ${r.heroHp}/160，敌人剩 ${r.enemyHp}/480`);
  return lines;
}

function logText(r: BattleResult): string {
  const head = [
    `seed=${r.seed} ruleset=${r.heroRuleset} winner=${r.winner} frames=${r.frames} digest=${r.digest}`,
    `stats=${JSON.stringify(r.stats)}`,
    `chains=${JSON.stringify(r.chains)}`,
    "",
  ];
  return (
    head.join("\n") +
    r.log.map((l) => `[${String(l.frame).padStart(5, "0")}f] ${l.kind.padEnd(6)} ${l.text}`).join("\n") +
    "\n"
  );
}

// ---------------------------------------------------------------- run

console.log("=".repeat(78));
console.log("cricket · P0 规则表驱动自动战斗 · 验收");
console.log("=".repeat(78));

mkdirSync(OUT_DIR, { recursive: true });

const runsA = SEEDS.map((seed) => new Battle({ seed, heroRuleset: "A" }).run());
const repeatA = new Battle({ seed: BASE_SEED, heroRuleset: "A" }).run();
const runB = new Battle({ seed: BASE_SEED, heroRuleset: "B" }).run();
const runC = new Battle({ seed: BASE_SEED, heroRuleset: "C" }).run();
const runEnemyB = new Battle({ seed: BASE_SEED, heroRuleset: "A", enemyRuleset: "ENEMY_B" }).run();

for (const r of [...runsA, runB, runC, runEnemyB]) {
  writeFileSync(
    join(OUT_DIR, `battle-seed${r.seed}-hero${r.heroRuleset}-enemy${r.enemyRuleset}.log`),
    logText(r),
    "utf8",
  );
}

console.log("\n【对局一览·规则表 A「突刺优先」】");
for (const r of runsA) {
  const chains = Object.values(r.chains)
    .map((c) => `${c.name} ${c.completions > 0 ? "✓" : "×"}${c.completions}/${c.attempts}`)
    .join("｜");
  console.log(
    `  seed ${String(r.seed).padStart(8)} → ${r.winner.padEnd(5)} ${String(r.frames).padStart(4)} 帧（${sec(r.frames).padStart(6)}）英雄 ${String(r.heroHp).padStart(3)}/160 敌人 ${String(r.enemyHp).padStart(3)}/480`,
  );
  console.log(`     链：${chains}`);
}

console.log("\n【每一局的「为什么不一样」】\n");
for (let i = 0; i < runsA.length; i++) {
  for (let j = i + 1; j < runsA.length; j++) {
    console.log(`  seed ${runsA[i].seed} vs seed ${runsA[j].seed}:`);
    for (const line of explain(runsA[i], runsA[j])) console.log(`    · ${line}`);
    console.log("");
  }
}

console.log(`【同 seed 换规则】seed ${BASE_SEED}：A「突刺优先」vs B「全格挡流」vs C「识破流」`);
console.log(`  ${firstDivergence(runsA[0], runB)}`);
console.log(`  结局：A → ${runsA[0].winner}（${sec(runsA[0].frames)}）｜B → ${runB.winner}（${sec(runB.frames)}）｜C → ${runC.winner}（${sec(runC.frames)}）`);
console.log(`  识破消耗：A ${runsA[0].stats.insightSpent}｜B ${runB.stats.insightSpent}｜C ${runC.stats.insightSpent}；打断：A ${runsA[0].stats.interrupts}｜B ${runB.stats.interrupts}｜C ${runC.stats.interrupts}`);
console.log(
  `  敌方规则表：ENEMY → ${runsA[0].winner}（${sec(runsA[0].frames)}，英雄剩 ${runsA[0].heroHp}）｜ENEMY_B → ${runEnemyB.winner}（${sec(runEnemyB.frames)}，英雄剩 ${runEnemyB.heroHp}）`,
);

console.log("\n【种子 20260101 · 规则表 A 的关键时间线】");
console.log(story(runsA[0]).join("\n"));

// ---------------------------------------------------------------- checks

// 1. 同规则 3 seed
{
  const digests = new Set(runsA.map((r) => r.digest));
  const outcomes = new Set(runsA.map((r) => `${r.winner}:${r.frames}`));
  const pass = digests.size === 3 && outcomes.size === 3;
  checks.push({
    id: "A1",
    name: "同一套规则，3 个 seed 打出 3 局不同过程",
    pass,
    detail: `digest 去重 ${digests.size}/3；结局(胜者:帧数) 去重 ${outcomes.size}/3；每对 seed 都给出了因果说明（见上）`,
  });
}

// 2. 同 seed 换规则
{
  const a = runsA[0];
  const b = runB;
  const pass = a.digest !== b.digest && (a.winner !== b.winner || Math.abs(a.frames - b.frames) > 30);
  checks.push({
    id: "A2",
    name: "同一个 seed，换英雄规则表结果改变",
    pass,
    detail: `A: ${a.winner}/${sec(a.frames)}/英雄${a.heroHp}｜B: ${b.winner}/${sec(b.frames)}/英雄${b.heroHp}｜C: ${runC.winner}/${sec(runC.frames)}/英雄${runC.heroHp}；分叉点：${firstDivergence(a, b)}`,
  });
}

// 2b. 同 seed 只换敌方规则表
{
  const a = runsA[0];
  const e = runEnemyB;
  const pass = a.digest !== e.digest && (a.winner !== e.winner || Math.abs(a.frames - e.frames) > 30);
  checks.push({
    id: "A2b",
    name: "同一个 seed，换敌方规则表结果也改变",
    pass,
    detail: `敌方 ENEMY: ${a.winner}/${sec(a.frames)}/英雄${a.heroHp}｜敌方 ENEMY_B: ${e.winner}/${sec(e.frames)}/英雄${e.heroHp}`,
  });
}

// 3. combo 链
{
  const union = new Map<string, { name: string; completions: number; attempts: number }>();
  for (const r of [...runsA, runB]) {
    for (const c of Object.values(r.chains)) {
      const cur = union.get(c.id) ?? { name: c.name, completions: 0, attempts: 0 };
      cur.completions += c.completions;
      cur.attempts += c.attempts;
      union.set(c.id, cur);
    }
  }
  const completedChains = [...union.values()].filter((c) => c.completions > 0);
  const chainStepEvents = [...runsA, runB].flatMap((r) =>
    r.events.filter((e) => e.type === "COMBO_STEP" && e.data?.completed),
  );
  const pass = completedChains.length >= 3 && chainStepEvents.length >= 3;
  checks.push({
    id: "A3",
    name: "≥3 条 combo 链在日志里被识别为链",
    pass,
    detail: [...union.entries()]
      .map(([id, c]) => `${c.name}(${id}) 完成 ${c.completions}/${c.attempts}`)
      .join("；") + `｜共 ${chainStepEvents.length} 次链路成立`,
  });
}

// 4. 演出分层
{
  const all = [...runsA, runB];
  const tierRangesOk = (["normal", "key", "ultimate"] as const).every((t) => {
    const [lo, hi] = TIER_RANGES[t];
    const f = TIERS[t].hitstopFrames;
    return f >= lo && f <= hi;
  });

  const hs = all.flatMap(hits);
  const normalHits = hs.filter((h) => h.tier === "normal");
  const keyHits = hs.filter((h) => h.tier === "key");
  const ultHits = hs.filter((h) => h.tier === "ultimate");

  const normalClean = normalHits.every((h) => {
    const p = TIERS.normal;
    return p.camera === "none" && p.shake <= 2 && p.displacement === "none";
  });
  const keyStronger = keyHits.every((h) => TIERS.key.hitstopFrames > TIERS.normal.hitstopFrames);
  const ultStrongest = ultHits.every((h) => TIERS.ultimate.hitstopFrames > TIERS.key.hitstopFrames);

  const executeEvents = all.flatMap((r) => r.events.filter((e) => e.type === "EXECUTE"));
  const swapEvents = all.flatMap((r) => r.events.filter((e) => e.type === "SWAP"));
  const heavyOk = [...executeEvents, ...swapEvents].every((e) => e.tier === "ultimate");

  const pass =
    tierRangesOk &&
    normalHits.length > 0 &&
    keyHits.length > 0 &&
    ultHits.length > 0 &&
    normalClean &&
    keyStronger &&
    ultStrongest &&
    heavyOk;

  checks.push({
    id: "A4",
    name: "普通命中 / 关键判定 / 全场最重 三层明显分层",
    pass,
    detail: `hitstop ${TIERS.normal.hitstopFrames}/${TIERS.key.hitstopFrames}/${TIERS.ultimate.hitstopFrames} 帧（区间 3-5 / 8-12 / 15-25）；命中数 normal ${normalHits.length}｜key ${keyHits.length}｜ultimate ${ultHits.length}；处决 ${executeEvents.length} 次、换位 ${swapEvents.length} 次均为 ultimate；普通命中不推镜｜ranges=${tierRangesOk} normalClean=${normalClean} heavy=${heavyOk} counts=${normalHits.length}/${keyHits.length}/${ultHits.length}`,
  });
}

// 5. 确定性（附加）
{
  const pass = repeatA.digest === runsA[0].digest;
  checks.push({
    id: "D1",
    name: "同一 seed + 同一规则表完全可复现（附加）",
    pass,
    detail: `两次运行 digest ${runsA[0].digest} vs ${repeatA.digest}`,
  });
}

console.log("\n" + "=".repeat(78));
console.log("验收结果");
console.log("=".repeat(78));
for (const c of checks) {
  console.log(`${c.pass ? "✓ PASS" : "✗ FAIL"}  ${c.id}  ${c.name}`);
  console.log(`        ${c.detail}`);
}

const failed = checks.filter((c) => !c.pass);
console.log(
  `\n${failed.length === 0 ? "全部通过" : `${failed.length} 项未通过`}｜完整日志已写入 ${OUT_DIR}`,
);
process.exitCode = failed.length === 0 ? 0 : 1;



