import { Rng, type RngDraw } from "./rng.ts";
import {
  ARENA_MAX_SLOT,
  ARENA_MIN_SLOT,
  BIG_MOVE_COOLDOWN,
  DAMAGE,
  ENEMY_MAX_HP,
  ENEMY_START_SLOT,
  HERO_MAX_HP,
  HERO_START_SLOT,
  INSIGHT_REGEN_FRAMES,
  JUDGE_TOLERANCE_FRAMES,
  SKILLS,
} from "./skills.ts";
import { ENEMY_RULESETS, HERO_RULESETS, MECHANIC_LABEL, type Mechanic, type Ruleset } from "./rules.ts";
import type {
  ActorSnapshot,
  ActorView,
  BattleEvent,
  BattleSnapshot,
  EventType,
  LogEntry,
  RuleDef,
  Side,
  SkillDef,
  SkillId,
  StatusId,
  Tier,
} from "./types.ts";

export type Element = "fire" | "thunder" | "ice";

export interface BattleConfig {
  seed: number;
  heroElement?: Element;
  enemyElement?: Element;
  heroRangedDamage?: number;
  enemyRangedDamage?: number;
  heroRanged2?: boolean;
  enemyRanged2?: boolean;
  /** 英雄规则表：A 突刺优先 / B 全格挡流 / C 识破流，或一个自定义 Ruleset */
  heroRuleset: "A" | "B" | "C" | "D" | "E" | Ruleset;
  /** 敌方规则表：ENEMY 碎地重锤 / ENEMY_B 压制连锤 */
  enemyRuleset?: "ENEMY" | "ENEMY_B" | "ENEMY_C" | "ENEMY_D" | "ENEMY_E";
  maxFrames?: number;
}

interface ActionState {
  def: SkillDef;
  elapsed: number;
  resolved: boolean;
  rule: RuleDef | null;
}

interface ActorState {
  side: Side;
  name: string;
  hp: number;
  maxHp: number;
  slot: number;
  insight: number;
  maxInsight: number;
  statuses: Map<StatusId, number>;
  action: ActionState | null;
  cooldowns: Map<string, number>;
  lock: number;
  regenTimer: number;
  damageDealt: number;
  airHits: number;
  comboHits: number;
  lastHitFrame: number;
  nextActionAt: number;
}

export interface ChainState {
  id: string;
  name: string;
  of: number;
  labels: string[];
  step: number;
  attempts: number;
  completions: number;
}

export interface Milestone {
  frame: number;
  key: string;
  text: string;
}


export interface BattleStats {
  crits: number;
  interrupts: number;
  clashes: number;
  swaps: number;
  executes: number;
  knockbacks: number;
  dashes: number;
  guards: number;
  dodges: number;
  insightSpent: number;
}

export interface BattleResult {
  seed: number;
  heroRuleset: "A" | "B" | "C" | "D" | "E";
  enemyRuleset: "ENEMY" | "ENEMY_B" | "ENEMY_C" | "ENEMY_D" | "ENEMY_E";
  winner: "hero" | "enemy" | "draw";
  frames: number;
  heroHp: number;
  enemyHp: number;
  events: BattleEvent[];
  log: LogEntry[];
  milestones: Milestone[];
  chains: Record<string, ChainState>;
  rngDraws: RngDraw[];
  stats: BattleStats;
  digest: string;
}



const CHAIN_DEFS: Omit<ChainState, "step" | "attempts" | "completions">[] = [
  {
    id: "interrupt_chase",
    name: "打断链",
    of: 2,
    labels: ["敌方开始蓄力", "突刺打断成功"],
  },
  {
    id: "bleed_exec",
    name: "流血处决链",
    of: 3,
    labels: ["裂伤挂流血", "碎地锤击晕", "处决突刺"],
  },
  {
    id: "guard_counter",
    name: "格挡还击链",
    of: 3,
    labels: ["敌方开始蓄力", "格挡吃下攻击", "后摇还击命中"],
  },
  {
    id: "read_crit",
    name: "看破暴击链",
    of: 2,
    labels: ["消耗识破看破", "看破后的暴击"],
  },
];

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export class Battle {
  readonly rng: Rng;
  readonly heroRuleset: Ruleset;
  readonly enemyRuleset: Ruleset;
  readonly maxFrames: number;
  readonly heroElement?: Element;
  readonly enemyElement?: Element;
  readonly heroRangedDamage: number;
  readonly enemyRangedDamage: number;
  readonly heroRanged2: boolean;
  readonly enemyRanged2: boolean;
  private readonly mechSeen = new Set<string>();

  hero: ActorState;
  enemy: ActorState;
  frame = 0;
  done = false;
  winner: "hero" | "enemy" | "draw" | null = null;

  events: BattleEvent[] = [];
  log: LogEntry[] = [];
  milestones: Milestone[] = [];
  chains: Record<string, ChainState> = {};
  stats: BattleStats = {
    crits: 0,
    interrupts: 0,
    clashes: 0,
    swaps: 0,
    executes: 0,
    knockbacks: 0,
    dashes: 0,
    guards: 0,
    dodges: 0,
    insightSpent: 0,
  };

  private milestoneSeen = new Set<string>();
  private lastBigMoveFrame = -99999;
  private pendingSwapAt: number | null = null;
  private eventCursor = 0;

  constructor(cfg: BattleConfig) {
    this.rng = new Rng(cfg.seed);
    this.heroRuleset =
      typeof cfg.heroRuleset === "string" ? HERO_RULESETS[cfg.heroRuleset] : cfg.heroRuleset;
    this.enemyRuleset = ENEMY_RULESETS[cfg.enemyRuleset ?? "ENEMY"];
    this.maxFrames = cfg.maxFrames ?? 4800;
    this.heroElement = cfg.heroElement;
    this.enemyElement = cfg.enemyElement;
    this.heroRangedDamage = cfg.heroRangedDamage ?? 8;
    this.enemyRangedDamage = cfg.enemyRangedDamage ?? 7;
    this.heroRanged2 = cfg.heroRanged2 === true;
    this.enemyRanged2 = cfg.enemyRanged2 === true;

    this.hero = this.makeActor("hero", "英雄", HERO_MAX_HP, HERO_START_SLOT, 2);
    this.enemy = this.makeActor("enemy", "敌人", ENEMY_MAX_HP, ENEMY_START_SLOT, 0);
    this.enemy.maxInsight = 0; // 敌人不使用识破

    for (const def of CHAIN_DEFS) {
      this.chains[def.id] = { ...def, step: 0, attempts: 0, completions: 0 };
    }

    this.logLine("system", `开局 seed=${cfg.seed}｜规则表 ${this.heroRuleset.id}「${this.heroRuleset.name}」｜敌方 ${this.enemyRuleset.id}「${this.enemyRuleset.name}」`);
    this.logLine("system", `机制｜英雄：${MECHANIC_LABEL[this.heroRuleset.mechanic]}｜敌方：${MECHANIC_LABEL[this.enemyRuleset.mechanic]}`);
    this.logLine("system", `初始站位 英雄#${this.hero.slot} / 敌人#${this.enemy.slot}｜识破 ${this.hero.insight}/${this.hero.maxInsight}`);
  }

  private makeActor(side: Side, name: string, hp: number, slot: number, insight: number): ActorState {
    return {
      side,
      name,
      hp,
      maxHp: hp,
      slot,
      insight,
      maxInsight: 3,
      statuses: new Map(),
      action: null,
      cooldowns: new Map(),
      lock: 0,
      regenTimer: 0,
      damageDealt: 0,
      airHits: 0,
      comboHits: 0,
      lastHitFrame: -999,
      nextActionAt: 0,
    };
  }

  // ---------------------------------------------------------------- views

  private view(actor: ActorState): ActorView {
    const statuses = actor.statuses;
    const action = actor.action;
    return {
      side: actor.side,
      hp: actor.hp,
      maxHp: actor.maxHp,
      slot: actor.slot,
      distance: Math.abs(this.hero.slot - this.enemy.slot),
      insight: actor.insight,
      maxInsight: actor.maxInsight,
      has: (s) => (statuses.get(s) ?? 0) > 0,
      frames: (s) => statuses.get(s) ?? 0,
      windupLeft:
        action && !action.resolved ? Math.max(0, action.def.windup - action.elapsed) : 0,
      windupSkill: action && !action.resolved ? action.def.id : undefined,
      recovering: !!action && action.resolved,
      charging: (statuses.get("charge") ?? 0) > 0,
      cooldown: (id) => actor.cooldowns.get(id) ?? 0,
      lock: actor.lock,
      read: (statuses.get("read") ?? 0) > 0,
    };
  }

  // ---------------------------------------------------------------- loop

  run(): BattleResult {
    while (!this.done && this.frame < this.maxFrames) this.step();
    if (!this.done) {
      this.done = true;
      this.winner = "draw";
      this.emit("BATTLE_END", `达到帧上限 ${this.maxFrames}，判为平局`, {
        data: { winner: "draw", frames: this.frame, heroHp: this.hero.hp, enemyHp: this.enemy.hp },
      });
    }
    return this.result();
  }

  step(): void {
    if (this.done) return;
    this.frame++;

    this.tickTimers(this.hero);
    this.tickTimers(this.enemy);
    this.tickStatuses(this.hero);
    this.tickStatuses(this.enemy);
    this.tickAction(this.hero);
    this.tickAction(this.enemy);
    this.tickPendingSwap();
    this.tryAct(this.hero);
    this.tryAct(this.enemy);
    this.tickInsight(this.hero);
    this.tickInsight(this.enemy);

    if (!this.done && this.frame >= this.maxFrames) {
      this.done = true;
      this.winner = "draw";
      this.emit("BATTLE_END", `达到帧上限 ${this.maxFrames}，判为平局`, {
        data: { winner: "draw", frames: this.frame, heroHp: this.hero.hp, enemyHp: this.enemy.hp },
      });
    }
  }

  private tickTimers(a: ActorState) {
    if (a.lock > 0) a.lock--;
    for (const [k, v] of a.cooldowns) {
      if (v <= 0) a.cooldowns.delete(k);
      else a.cooldowns.set(k, v - 1);
    }
  }

  private tickStatuses(a: ActorState) {
    const bleedDouble = a.side === "enemy" && this.heroRuleset.mechanic === "bleed";
    for (const [id, frames] of [...a.statuses]) {
      if (id === "bleed") {
        // 每 30 帧结算；裂伤处决机制下双跳
        if (frames > 0 && frames % 30 === 0) {
            this.applyDamage(a, bleedDouble ? 2 : 1, "bleed", null, "normal", bleedDouble ? "流血（双跳）" : "流血");
          if (bleedDouble) this.mechOnce("hero:bleed_tick", "机制触发｜裂伤：流血双跳");
        }
      }
      const left = frames - 1;
      if (left <= 0) {
        a.statuses.delete(id);
        if (id === "airborne") a.airHits = 0;
        if (id === "downed") {
          a.statuses.set("iframes", 24);
          a.statuses.set("ukemi_counter", 60);
          this.emit("GETUP", `${a.name} 受身起身（24f 无敌 + 60f 反击窗口）`, {
            side: a.side,
            data: { iframes: 24, counter: 60 },
          });
          this.logLine("event", `${a.name} 受身：获得 24 帧无敌`);
        }
      } else a.statuses.set(id, left);
    }
  }

  private tickAction(a: ActorState) {
    const act = a.action;
    if (!act) return;
    act.elapsed++;
    if (!act.resolved && act.elapsed >= act.def.windup) {
      act.resolved = true;
      this.resolveHit(a, act);
    }
    if (act.elapsed >= act.def.windup + act.def.recovery) {
      a.action = null;
      a.nextActionAt = this.frame + 8; // 中立间隔：拉开回合，避免动作无缝连播
    }
  }

  private tickPendingSwap() {
    if (this.pendingSwapAt === null) return;
    if (this.frame < this.pendingSwapAt) return;
    this.pendingSwapAt = null;
    const hs = this.hero.slot;
    const es = this.enemy.slot;
    this.hero.slot = es;
    this.enemy.slot = hs;
    this.lastBigMoveFrame = this.frame;
    this.stats.swaps++;
    this.emit("SWAP", `优先级抢断换位：双方交换位置（英雄#${this.hero.slot} / 敌人#${this.enemy.slot}）`, {
      tier: "ultimate",
      data: { heroSlot: this.hero.slot, enemySlot: this.enemy.slot, kind: "priority-swap" },
    });
    this.milestone("first-swap", "首次优先级抢断换位");
  }

  private tickInsight(a: ActorState) {
    if (a.insight >= a.maxInsight) {
      a.regenTimer = 0;
      return;
    }
    a.regenTimer++;
    if (a.regenTimer >= INSIGHT_REGEN_FRAMES) {
      a.regenTimer = 0;
      a.insight++;
      this.logLine("event", `识破回复：${a.name} 识破 ${a.insight}/${a.maxInsight}`);
    }
  }

  // ---------------------------------------------------------------- rules

  private rulesFor(side: Side): RuleDef[] {
    return side === "hero" ? this.heroRuleset.rules : this.enemyRuleset.rules;
  }

  private ruleAvailable(actor: ActorState, rule: RuleDef): boolean {
    if (rule.id === "hero_ranged2_rule" && !this.heroRanged2) return false;
    if (rule.id === "enemy_ranged2_rule" && !this.enemyRanged2) return false;
    if ((actor.cooldowns.get(rule.id) ?? 0) > 0) return false;
    if (rule.cost.kind === "resource" && actor.insight < rule.cost.insight) return false;
    const foe = actor.side === "hero" ? this.enemy : this.hero;
    return rule.test({ self: this.view(actor), foe: this.view(foe), frame: this.frame });
  }

  private tryAct(actor: ActorState) {
    if (this.done) return;
    if (actor.action || actor.lock > 0) return;
    if (this.frame < actor.nextActionAt) return;
    if ((actor.statuses.get("stun") ?? 0) > 0) return;

    const all = this.rulesFor(actor.side);
    const candidates = all.filter((r) => this.ruleAvailable(actor, r));
    if (candidates.length === 0) return;

    candidates.sort((a, b) => b.priority - a.priority || a.index - b.index);
    const winner = candidates[0];

    if (candidates.length > 1) {
      const runnerUp = candidates[1];
      const gap = winner.priority - runnerUp.priority;
      this.stats.clashes++;
      this.emit(
        "PRIORITY_CLASH",
        `规则[${winner.index}] 抢在规则[${runnerUp.index}] 前面触发（priority ${winner.priority} > ${runnerUp.priority}，差 ${gap}）`,
        {
          side: actor.side,
          data: {
            winner: winner.index,
            winnerName: winner.name,
            loser: runnerUp.index,
            loserName: runnerUp.name,
            gap,
            candidates: candidates.map((c) => ({ index: c.index, name: c.name, priority: c.priority })),
          },
        },
      );

      // 优先级抢断换位：防守规则以 ≥40 的差距抢掉攻击规则，并且大位移冷却就绪
      const winnerIsDefense = winner.tags.includes("defense");
      const loserIsAttack = runnerUp.tags.includes("attack");
      const cooldownReady = this.frame - this.lastBigMoveFrame >= BIG_MOVE_COOLDOWN;
      if (
        winnerIsDefense &&
        loserIsAttack &&
        gap >= 40 &&
        cooldownReady &&
        this.pendingSwapAt === null &&
        actor.side === "hero"
      ) {
        this.pendingSwapAt = this.frame + 14;
        this.logLine("clash", `规则[${winner.index}] 以 ${gap} 点优先级差抢断 → 14 帧后双方换位`);
      } else if (winnerIsDefense && loserIsAttack && gap >= 40 && !cooldownReady) {
        this.logLine(
          "clash",
          `换位被空间转换冷却拦下（距上次大位移 ${this.frame - this.lastBigMoveFrame}/${BIG_MOVE_COOLDOWN} 帧）`,
        );
      }
    }

    this.payCost(actor, winner);
    this.startSkill(actor, winner);
  }

  private payCost(actor: ActorState, rule: RuleDef) {
    const cost = rule.cost;
    if (cost.kind === "resource") {
      const before = actor.insight;
      actor.insight -= cost.insight;
      this.stats.insightSpent += cost.insight;
      this.logLine(
        "event",
        `识破消耗：${before} → ${actor.insight}/${actor.maxInsight}（${rule.name}）`,
      );
    } else if (cost.kind === "skip_next") {
      actor.lock = Math.max(actor.lock, 20);
      this.logLine("event", `代价[跳过下一条]：${actor.name} 锁 20 帧（${rule.name}）`);
    } else if (cost.kind === "hard_cc") {
      actor.lock = Math.max(actor.lock, cost.frames);
      this.logLine("event", `代价[硬直]：${actor.name} 自锁 ${cost.frames} 帧（${rule.name}）`);
    }
  }

  private startSkill(actor: ActorState, rule: RuleDef) {
    const def = SKILLS[rule.skill];
    actor.action = { def, elapsed: 0, resolved: false, rule };
    if (rule.cooldown) {
      // 敌方节奏带 0~36 帧的种子抖动：同一张规则表也会因为种子不同而错拍
      const jitter =
        actor.side === "enemy" ? this.rng.int(36, `cd.${rule.id}`, this.frame) : 0;
      actor.cooldowns.set(rule.id, rule.cooldown + jitter);
    }

    const costText =
      rule.cost.kind === "resource"
        ? `识破-${rule.cost.insight}`
        : rule.cost.kind === "skip_next"
          ? "跳过下一条"
          : rule.cost.kind === "hard_cc"
            ? `硬直${rule.cost.frames}帧`
            : "无";

    this.emit("RULE_TRIGGER", `规则[${rule.index}] ${rule.name} 触发：${rule.when} → ${def.name}（代价：${costText}）`, {
      side: actor.side,
      skill: def.id,
      data: {
        ruleIndex: rule.index,
        ruleName: rule.name,
        priority: rule.priority,
        when: rule.when,
        cost: costText,
        reveal: rule.reveal ?? null,
      },
    });

    if (rule.reveal && actor.side === "enemy") {
      this.logLine("reveal", `${rule.reveal}（规则[${rule.index}]）`);
    }

    this.emit(
      "SKILL_START",
      `${actor.name} 起手 ${def.name}：${def.windup} 帧后命中`,
      {
        side: actor.side,
        skill: def.id,
        tier: def.tier,
        data: {
          windup: def.windup,
          recovery: def.recovery,
          tier: def.tier,
          fx: def.fx,
          name: def.name,
        },
      },
    );

    // 起手即生效的效果
    switch (def.id) {
      case "hero_guard":
        actor.statuses.set("guard", 120);
        this.emit("STATUS_APPLY", `${actor.name} 进入格挡（120 帧）`, {
          side: actor.side,
          skill: def.id,
          data: { status: "guard", frames: 120 },
        });
        break;
      case "hero_dodge":
        actor.statuses.set("iframes", 14);
        break;
      case "hero_read":
        actor.statuses.set("read", 150);
        this.emit("STATUS_APPLY", `${actor.name} 看破：下一次命中必定暴击`, {
          side: actor.side,
          skill: def.id,
          data: { status: "read", frames: 150 },
        });
        this.advanceChain("read_crit", 1);
        break;
      case "hero_step":
        this.stepToward(actor, this.enemy, "垫步");
        break;
      case "enemy_step":
        this.stepToward(actor, this.hero, "逼近");
        break;
      case "enemy_charge":
        actor.statuses.set("charge", 90);
        this.emit("STATUS_APPLY", `${actor.name} 开始蓄力（90 帧）`, {
          side: actor.side,
          skill: def.id,
          data: { status: "charge", frames: 90 },
        });
        this.milestone("first-charge", "敌人首次蓄力");
        break;
      case "enemy_slam":
        if (actor.statuses.has("charge")) {
          actor.statuses.delete("charge");
          this.logLine("event", "蓄力结束 → 释放碎地重锤");
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- hits

  private resolveHit(att: ActorState, act: ActionState) {
    const def = att === this.hero ? this.enemy : this.hero;
    const skill = act.def;
    const isRangedSkill = skill.id === "hero_ranged" || skill.id === "enemy_ranged"
      || skill.id === "hero_ranged_2" || skill.id === "enemy_ranged_2";
    const isStrongRanged = skill.id === "hero_ranged_2" || skill.id === "enemy_ranged_2";
    let base = DAMAGE[skill.id] ?? 0;
    if (isRangedSkill) base = att.side === "hero" ? this.heroRangedDamage : this.enemyRangedDamage;
    if (isStrongRanged) base += 3;
    if (base <= 0) {
      if (skill.id === "hero_retreat" || skill.id === "enemy_retreat") {
        this.stepAway(att, def, 2);
        att.statuses.set("roaming", 90);
        this.logLine("event", `${att.name} 进入游走状态（90 帧内保持距离）`);
      }
      if (skill.id === "enemy_step" && this.enemyRuleset.mechanic === "kite") {
        att.statuses.set("evasion", 30);
        this.logLine("event", `游走：${att.name} 后撤进入闪避姿态（30f 内下次受击减半）`);
      }
      return;
    }

    const tags = act.rule?.tags ?? [];

    // 无敌帧（闪避）
    if (def.statuses.has("iframes")) {
      this.stats.dodges++;
      this.emit("DODGE", `${def.name} 闪避了 ${skill.name}`, {
        side: def.side,
        skill: skill.id,
        tier: "key",
        data: { skill: skill.id },
      });
      this.milestone("first-dodge", "首次闪避成功");
      return;
    }

    let tier: Tier = skill.tier;
    let guardMult = 1;
    let guardSuccess = false;

    // 格挡（铁壁机制：减伤 90%，还击窗口 70f）
    if (def.statuses.has("guard")) {
      const ironWall = def.side === "hero" && this.heroRuleset.mechanic === "guard";
      guardMult = ironWall ? 0.1 : 0.2;
      guardSuccess = true;
      this.stats.guards++;
      def.statuses.set("riposte", ironWall ? 70 : 50);
      tier = "key";
      this.emit("GUARD", `格挡成功：${def.name} 吃下 ${skill.name}（伤害 ×${ironWall ? "0.1" : "0.2"}），还击窗口 ${ironWall ? 70 : 50} 帧`, {
        side: def.side,
        skill: skill.id,
        tier: "key",
        data: { skill: skill.id, riposte: 50 },
      });
      this.milestone("first-guard", "首次格挡成功");
    }

    const isPunish = skill.id === "hero_riposte" && att.statuses.has("riposte");
    if (isPunish) {
      att.statuses.delete("riposte");
      tier = "key";
    }
    const read = att.statuses.has("read");
    if (read) {
      att.statuses.delete("read");
      if (att.side === "hero" && this.heroRuleset.mechanic === "insight" && att.insight < att.maxInsight) {
        att.insight++;
        this.logLine("event", `识破经济：看破返还 1 识破 → ${att.insight}/${att.maxInsight}`);
      }
    }
    const critChance = read ? 1 : att.side === "hero" ? 0.18 : 0.12;
    const crit = this.rng.chance(critChance, `crit.${att.side}.${skill.id}`, this.frame);
    if (crit) {
      this.stats.crits++;
      tier = "key";
      this.emit("CRIT", `暴击！${att.name} 的 ${skill.name}${read ? "（看破）" : ""}`, {
        side: att.side,
        skill: skill.id,
        tier: "key",
        data: { rng: this.rng.draws[this.rng.draws.length - 1].value, read },
      });
      this.milestone("first-crit", "首次暴击");
      if (read) this.advanceChain("read_crit", 2);
    }

    // 打断：突刺 + 打断规则 + 目标蓄力
    const isInterrupt =
      skill.id === "hero_thrust" && tags.includes("interrupt") && def.statuses.has("charge");
    if (isInterrupt) {
      this.stats.interrupts++;
      tier = "key";
      def.statuses.delete("charge");
      const stunFrames = att.side === "hero" && this.heroRuleset.mechanic === "interrupt" ? 60 : 45;
      def.statuses.set("stun", stunFrames);
      def.action = null;
      this.emit("INTERRUPT_SUCCESS", `打断成功：${att.name} 的突刺打断 ${def.name} 的蓄力，眩晕 ${stunFrames} 帧`, {
        side: att.side,
        skill: skill.id,
        tier: "key",
        data: { target: def.side, stun: stunFrames },
      });
      this.milestone("first-interrupt", "首次打断成功");
      this.advanceChain("interrupt_chase", 2);
      // 空间转换 1：突刺打断 → 自己前冲
      if (Math.abs(this.hero.slot - this.enemy.slot) > 1) this.dashToward(att, def);
      else this.logLine("event", "已贴身，前冲改为原地突刺（不产生空间转换）");
    }

    // 处决：处决突刺 + 目标击晕
    const isExecute = skill.id === "hero_execute" && def.statuses.has("stun");
    if (isExecute) {
      this.stats.executes++;
      tier = "ultimate";
      this.emit("EXECUTE", `处决！${att.name} 对击晕的 ${def.name} 打出 ${skill.name}`, {
        side: att.side,
        skill: skill.id,
        tier: "ultimate",
        data: { target: def.side },
      });
      this.milestone("first-execute", "首次处决");
      this.advanceChain("bleed_exec", 3);
      if (def.hp > 0) {
        def.statuses.set("airborne", 75);
        def.statuses.set("downed", 45);
        def.airHits = 0;
        this.emit("STATUS_APPLY", `${def.name} 被击飞（浮空 75f / 倒地 45f）`, {
          side: def.side,
          skill: skill.id,
          data: { status: "airborne", frames: 75 },
        });
        this.emit("DOWNED", `${def.name} 倒地`, { side: def.side, data: { frames: 45 } });
      }
    }

    // 流血：裂伤
    if (skill.id === "hero_rend" && !def.statuses.has("bleed")) {
      def.statuses.set("bleed", 240);
      this.emit("STATUS_APPLY", `${def.name} 流血 240 帧（每 30 帧 1 点）`, {
        side: def.side,
        skill: skill.id,
        data: { status: "bleed", frames: 240 },
      });
      this.milestone("first-bleed", "首次挂流血");
      this.advanceChain("bleed_exec", 1);
    }

    // 碎地锤：对流血目标击晕 + 击退
    if (skill.id === "hero_earthhammer" && def.statuses.has("bleed")) {
      def.statuses.set("stun", 90);
      def.action = null;
      tier = "key";
      this.emit("STATUS_APPLY", `${def.name} 被碎地锤击晕 90 帧`, {
        side: def.side,
        skill: skill.id,
        tier: "key",
        data: { status: "stun", frames: 90, source: "earthhammer" },
      });
      this.milestone("first-stun", "首次击晕");
      this.advanceChain("bleed_exec", 2);
      this.knockback(att, def);
    }

    const variance = this.rng.range(0.9, 1.1, `dmg.${att.side}.${skill.id}`, this.frame);
    const critMult = crit ? 1.6 : 1;
    const interruptMult = isInterrupt ? 1.5 : 1;

    // 机制增伤
    const mech = att.side === "hero" ? this.heroRuleset.mechanic : this.enemyRuleset.mechanic;
    let mechMult = 1;
    if (att.side === "hero" && mech === "desperate" && att.hp / att.maxHp < 0.4) {
      mechMult *= 1.35;
      this.mechOnce("hero:desperate", "机制触发｜背水一战：血量 <40%，伤害 ×1.35");
    }
    if (att.side === "enemy" && mech === "pressure" && def.statuses.has("guard")) {
      mechMult *= 2.0;
      this.mechOnce("enemy:pressure", "机制触发｜破防压制：对格挡目标伤害 ×2.0");
    }
    if (att.side === "enemy" && mech === "heavy" && skill.id === "enemy_slam") {
      mechMult *= 1.2;
      this.mechOnce("enemy:heavy", "机制触发｜蓄力重锤：重锤伤害 ×1.2");
    }
    if (isPunish) mechMult *= 1.5;
    if (att.side === "hero" && mech === "bleed" && skill.id === "hero_execute" && def.statuses.has("bleed")) {
      mechMult *= 1.3;
      this.mechOnce("hero:bleed", "机制触发｜裂伤处决：处决流血目标伤害 ×1.3");
    }

    let counterMult = 1;
    if (att.statuses.has("ukemi_counter")) {
      att.statuses.delete("ukemi_counter");
      counterMult = 1.3;
      this.logLine("event", `受身反击：${att.name} 下一击伤害 ×1.3`);
    }
    let airScale = 1;
    if (def.statuses.has("airborne") && !guardSuccess) {
      def.airHits++;
      // 空连延长滞空：每段 +20f，上限 110f，让下一段能接上
      const left = def.statuses.get("airborne") ?? 0;
      def.statuses.set("airborne", Math.min(110, left + 20));
      airScale = Math.max(0.5, 1 - 0.1 * (def.airHits - 1));
      this.logLine("event", `空连 ${def.airHits} 段：伤害 ×${airScale.toFixed(2)}（滞空延长）`);
    }
    // 连段递减：同一攻击方 45 帧内连续命中，每段 -8%，最低 50%
    if (this.frame - att.lastHitFrame <= 45) att.comboHits++;
    else att.comboHits = 1;
    att.lastHitFrame = this.frame;
    const comboScale = Math.max(0.5, 1 - 0.08 * (att.comboHits - 1));
    if (att.comboHits > 1) {
      this.logLine("event", `连段 ${att.comboHits} 段：伤害 ×${comboScale.toFixed(2)}`);
    }
    let amount = Math.max(1, Math.round(base * variance * critMult * guardMult * interruptMult * mechMult * airScale * comboScale * counterMult));
    // 游走机制：后撤后的第一次受击减半
    if (def.side === "enemy" && def.statuses.has("evasion")) {
      amount = Math.max(1, Math.round(amount * 0.5));
      def.statuses.delete("evasion");
      this.logLine("event", `游走闪避：${def.name} 卸掉一半伤害（${amount}）`);
    }

    const hitTier: Tier = guardSuccess ? "key" : tier;
    this.emit(
      "HIT",
      `${att.name} ${skill.name} 命中 ${def.name}：${amount} 伤害${crit ? "（暴击）" : ""}${guardSuccess ? "（被格挡）" : ""}｜层级 ${hitTier}｜hitstop ${hitstopForTier(hitTier)} 帧`,
      {
        side: att.side,
        skill: skill.id,
        tier: hitTier,
        data: {
          damage: amount,
          crit,
          guard: guardSuccess,
          interrupt: isInterrupt,
          execute: isExecute,
          from: att.side,
          to: def.side,
          read,
        },
      },
    );

    this.applyDamage(def, amount, "hit", skill.id, hitTier, skill.name, att);

    if (isRangedSkill) {
      const element = att.side === "hero" ? this.heroElement : this.enemyElement;
      if (element === "fire") {
        def.statuses.set("burn", 120);
        this.emit("STATUS_APPLY", `${def.name} 灼烧 120 帧`, { side: def.side, skill: skill.id, data: { status: "burn", frames: 120 } });
      } else if (element === "thunder") {
        def.statuses.set("stun", 20);
        this.emit("STATUS_APPLY", `${def.name} 被雷击麻痹 20 帧`, { side: def.side, skill: skill.id, data: { status: "stun", frames: 20 } });
      } else if (element === "ice") {
        def.statuses.set("stun", 12);
        this.emit("STATUS_APPLY", `${def.name} 被冰冻 12 帧`, { side: def.side, skill: skill.id, data: { status: "stun", frames: 12 } });
      }
    }

    // 提前蓄力机制：重锤附带眩晕
    if (att.side === "enemy" && mech === "early_charge" && skill.id === "enemy_slam" && !def.statuses.has("stun")) {
      def.statuses.set("stun", 30);
      this.emit("STATUS_APPLY", `提前蓄力：${def.name} 被重锤震晕 30 帧`, {
        side: def.side,
        skill: skill.id,
        data: { status: "stun", frames: 30, source: "early_charge" },
      });
    }

    // 快刀机制：横扫追加 50% 二段
    if (att.side === "enemy" && mech === "fast" && skill.id === "enemy_swipe") {
      const second = Math.max(1, Math.round(amount * 0.5));
      this.applyDamage(def, second, "hit", skill.id, "normal", "快刀二段", att);
      this.mechOnce("enemy:fast", "机制触发｜快刀：横扫追加二段");
    }

    if (skill.id === "hero_riposte") this.advanceChain("guard_counter", 3);

    if (isPunish) {
      att.statuses.set("combo_ready", 70);
      this.emit("PUNISH", `确反！${att.name} 在格挡后用 ${skill.name} 打出确反（伤害 ×1.5，连招窗口 70f）`, {
        side: att.side,
        skill: skill.id,
        tier: "key",
        data: { punish: true, comboWindow: 70 },
      });
      this.mechOnce("hero:punish", "机制触发｜确反：格挡后还击伤害 ×1.5");
    }
    if (att.statuses.has("combo_ready") && (skill.id === "hero_earthhammer" || skill.id === "hero_execute")) {
      att.statuses.delete("combo_ready");
    }

    if (guardSuccess) {
      this.advanceChain("guard_counter", 2);
      if (def.statuses.has("riposte")) this.milestone("first-riposte-window", "还击窗口开启");
    }
  }

  private applyDamage(
    target: ActorState,
    amount: number,
    source: "hit" | "bleed",
    skill: SkillId | null,
    tier: Tier,
    label: string,
    attacker: ActorState | null = null,
  ) {
    if (this.done) return;
    target.hp = Math.max(0, target.hp - amount);
    if (attacker) attacker.damageDealt += amount;

    this.emit("DAMAGE", `${target.name} -${amount}（${label}）→ HP ${target.hp}/${target.maxHp}`, {
      side: target.side,
      skill: skill ?? undefined,
      tier,
      data: { amount, hp: target.hp, source, skill },
    });

    if (source === "hit") this.milestone("first-damage", "首次造成伤害");

    if (target.side === "enemy" && target.hp / target.maxHp <= 0.4) {
      this.milestone("enemy-40", "敌方跌破 40% 血线（蓄力条件成立）");
    }

    if (target.hp <= 0) {
      this.finish(target.side === "hero" ? "enemy" : "hero");
    }
  }

  private mechOnce(key: string, text: string): void {
    if (this.mechSeen.has(key)) return;
    this.mechSeen.add(key);
    this.logLine("event", text);
    this.emit("MECHANIC", text, {
      side: key.startsWith("hero") ? "hero" : "enemy",
      data: { key },
    });
  }

  private finish(winner: "hero" | "enemy") {
    if (this.done) return;
    this.done = true;
    this.winner = winner;
    const loser = winner === "hero" ? this.enemy : this.hero;
    this.logLine("system", `${loser.name} 倒下 → ${winner === "hero" ? "英雄" : "敌人"} 获胜（第 ${this.frame} 帧，${(this.frame / 60).toFixed(2)}s）`);
    this.emit("BATTLE_END", `战斗结束：${winner === "hero" ? "英雄" : "敌人"} 获胜，用时 ${(this.frame / 60).toFixed(2)}s`, {
      data: { winner, frames: this.frame, heroHp: this.hero.hp, enemyHp: this.enemy.hp },
    });
  }

  // ---------------------------------------------------------------- space

  private stepAway(actor: ActorState, foe: ActorState, slots: number) {
    const dir = Math.sign(actor.slot - foe.slot) || 1;
    const next = Math.max(ARENA_MIN_SLOT, Math.min(ARENA_MAX_SLOT, actor.slot + dir * slots));
    if (next === actor.slot) return;
    const from = actor.slot;
    actor.slot = next;
    this.emit("MOVE", `${actor.name} 拉开距离：#${from} → #${next}（距 ${Math.abs(this.hero.slot - this.enemy.slot)}）`, {
      side: actor.side,
      data: { kind: "retreat", from, to: next },
    });
  }

  private stepToward(actor: ActorState, foe: ActorState, label: string) {
    // 游走状态：不主动贴脸，改为保持/拉开距离
    if (actor.statuses.has("roaming") && Math.abs(actor.slot - foe.slot) <= 2) {
      this.stepAway(actor, foe, 1);
      return;
    }
    const dir = Math.sign(foe.slot - actor.slot);
    if (dir === 0) return;
    const next = Math.max(ARENA_MIN_SLOT, Math.min(ARENA_MAX_SLOT, actor.slot + dir));
    if (next === actor.slot || next === foe.slot) return;
    const from = actor.slot;
    actor.slot = next;
    this.emit("MOVE", `${actor.name} ${label}：#${from} → #${next}（距 ${Math.abs(this.hero.slot - this.enemy.slot)}）`, {
      side: actor.side,
      data: { kind: "step", from, to: next },
    });
  }

  private dashToward(actor: ActorState, foe: ActorState) {
    if (this.frame - this.lastBigMoveFrame < BIG_MOVE_COOLDOWN) {
      this.logLine("event", `前冲被空间转换冷却拦下（${this.frame - this.lastBigMoveFrame}/${BIG_MOVE_COOLDOWN} 帧）`);
      return;
    }
    const dir = Math.sign(foe.slot - actor.slot);
    if (dir === 0) return;
    const next = actor.slot + dir;
    if (next === foe.slot || next < ARENA_MIN_SLOT || next > ARENA_MAX_SLOT) return;
    const from = actor.slot;
    actor.slot = next;
    this.lastBigMoveFrame = this.frame;
    this.stats.dashes++;
    this.emit("MOVE", `突刺前冲：${actor.name} #${from} → #${next}（距 ${Math.abs(this.hero.slot - this.enemy.slot)}）`, {
      side: actor.side,
      tier: "key",
      data: { kind: "dash", from, to: next },
    });
    this.milestone("first-dash", "首次突刺前冲");
  }

  private knockback(att: ActorState, def: ActorState) {
    if (this.frame - this.lastBigMoveFrame < BIG_MOVE_COOLDOWN) {
      this.logLine("event", `击退被空间转换冷却拦下（${this.frame - this.lastBigMoveFrame}/${BIG_MOVE_COOLDOWN} 帧）`);
      return;
    }
    const dir = Math.sign(def.slot - att.slot);
    if (dir === 0) return;
    const next = def.slot + dir;
    if (next < ARENA_MIN_SLOT || next > ARENA_MAX_SLOT || next === att.slot) return;
    const from = def.slot;
    def.slot = next;
    this.lastBigMoveFrame = this.frame;
    this.stats.knockbacks++;
    this.emit("KNOCKBACK", `碎地锤击退：${def.name} #${from} → #${next}`, {
      side: def.side,
      tier: "key",
      data: { from, to: next, distance: Math.abs(this.hero.slot - this.enemy.slot) },
    });
    this.milestone("first-knockback", "首次击退");
  }

  // ---------------------------------------------------------------- chains

  private advanceChain(chainId: string, step: number) {
    const chain = this.chains[chainId];
    if (!chain) return;
    if (step === 1) {
      chain.attempts++;
      chain.step = 1;
    } else if (step === chain.step + 1) {
      chain.step = step;
    } else {
      return;
    }
    const completed = chain.step >= chain.of;
    if (completed) chain.completions++;
    const label = chain.labels[chain.step - 1] ?? `第${chain.step}步`;
    this.emit(
      "COMBO_STEP",
      `combo 链[${chain.name}] ${chain.step}/${chain.of}：${label}${completed ? " ✓ 链路成立" : ""}`,
      {
        data: {
          chain: chain.id,
          chainName: chain.name,
          step: chain.step,
          of: chain.of,
          label,
          completed,
        },
      },
    );
  }

  // ---------------------------------------------------------------- emit

  private emit(
    type: EventType,
    text: string,
    opts: { side?: Side; skill?: SkillId; tier?: Tier; data?: Record<string, unknown> } = {},
  ) {
    const ev: BattleEvent = {
      frame: this.frame,
      type,
      side: opts.side,
      skill: opts.skill,
      tier: opts.tier,
      text,
      data: opts.data,
    };
    this.events.push(ev);
    this.onEvent(ev);
    const kind =
      type === "RULE_TRIGGER"
        ? "rule"
        : type === "PRIORITY_CLASH"
          ? "clash"
          : type === "COMBO_STEP"
            ? "combo"
            : type === "DAMAGE"
              ? "damage"
              : "event";
    this.logLine(kind, text);
  }

  private onEvent(ev: BattleEvent) {
    if (ev.type === "SKILL_START" && ev.skill === "enemy_charge") {
      this.advanceChain("interrupt_chase", 1);
      this.advanceChain("guard_counter", 1);
    }
  }

  private logLine(kind: LogEntry["kind"], text: string) {
    this.log.push({ frame: this.frame, kind, text });
  }

  private milestone(key: string, text: string) {
    if (this.milestoneSeen.has(key)) return;
    this.milestoneSeen.add(key);
    this.milestones.push({ frame: this.frame, key, text });
  }

  // ---------------------------------------------------------------- output

  snapshot(): BattleSnapshot {
    return {
      frame: this.frame,
      hero: this.snapActor(this.hero),
      enemy: this.snapActor(this.enemy),
      done: this.done,
      winner: this.winner,
    };
  }

  private snapActor(a: ActorState): ActorSnapshot {
    const statuses: Partial<Record<StatusId, number>> = {};
    for (const [k, v] of a.statuses) statuses[k] = v;
    const act = a.action;
    return {
      side: a.side,
      hp: a.hp,
      maxHp: a.maxHp,
      slot: a.slot,
      insight: a.insight,
      maxInsight: a.maxInsight,
      statuses,
      action: act
        ? {
            skill: act.def.id,
            phase: act.elapsed < act.def.windup ? "windup" : act.elapsed === act.def.windup ? "hit" : "recovery",
            progress: act.elapsed / (act.def.windup + act.def.recovery),
          }
        : null,
      tier: act?.def.tier ?? "normal",
      name: a.name,
    };
  }

  /** 取出上次之后新增的事件（渲染层用）。 */
  drainEvents(): BattleEvent[] {
    const out = this.events.slice(this.eventCursor);
    this.eventCursor = this.events.length;
    return out;
  }

  result(): BattleResult {
    const digest = fnv1a(
      JSON.stringify({
        seed: this.rng.seed,
        rules: this.heroRuleset.id,
        ruleSig: this.heroRuleset.rules
          .map((r) => `${r.id}:${r.priority}:${r.cost.kind}`)
          .join("|"),
        enemyRules: this.enemyRuleset.id,
        events: this.events.map((e) => [e.frame, e.type, e.side, e.skill, e.tier]),
        log: this.log.map((l) => [l.frame, l.text]),
      }),
    );
    return {
      seed: this.rng.seed,
      heroRuleset: this.heroRuleset.id as "A" | "B" | "C",
      enemyRuleset: this.enemyRuleset.id as "ENEMY" | "ENEMY_B",
      winner: this.winner ?? "draw",
      frames: this.frame,
      heroHp: this.hero.hp,
      enemyHp: this.enemy.hp,
      events: this.events,
      log: this.log,
      milestones: this.milestones,
      chains: this.chains,
      rngDraws: this.rng.draws,
      stats: this.stats,
      digest,
    };
  }
}

/** 演出层级 → hitstop 帧数（与 src/presentation/tiers.ts 保持一致）。 */
export function hitstopForTier(tier: Tier): number {
  return tier === "normal" ? 4 : tier === "key" ? 9 : 17;
}

export function describeCost(rule: RuleDef): string {
  switch (rule.cost.kind) {
    case "resource":
      return `识破-${rule.cost.insight}`;
    case "skip_next":
      return "跳过下一条";
    case "hard_cc":
      return `硬直${rule.cost.frames}帧`;
    default:
      return "无";
  }
}

























