import { SKILLS } from "../engine/skills.ts";
import type {
  BattleEvent,
  BattleSnapshot,
  CombatSource,
  SkillId,
  StatusId,
} from "../engine/types.ts";

export type DuelPhase = "ENEMY_INTENT_REVEAL" | "PLAYER_SEQUENCE" | "RESOLUTION" | "TURN_END";
export type DuelActor = "hero" | "enemy";

export interface DuelIntent {
  skill: SkillId;
  name: string;
  icon: string;
  note: string;
}

export interface DuelCard {
  skill: SkillId;
  name: string;
  desc: string;
  disabled: boolean;
}

export interface DuelLogEntry {
  runId: number;
  frame: number;
  actionIndex: number;
  actor: DuelActor;
  skill: SkillId;
  damage: number;
  hook: string | null;
  text: string;
}

interface Action {
  actor: DuelActor;
  skill: SkillId;
  slot: number;
}

const CARDS: Array<{ skill: SkillId; name: string; desc: string }> = [
  { skill: "hero_thrust", name: "突刺", desc: "8 伤害" },
  { skill: "hero_rend", name: "裂伤", desc: "5 伤害 + 流血" },
  { skill: "hero_earthhammer", name: "碎地锤", desc: "12 伤害；紧接裂伤 +50%" },
  { skill: "hero_guard", name: "格挡", desc: "下一次受击 -60%" },
];

const INTENT_PATTERNS: DuelIntent[][] = [
  [
    { skill: "enemy_swipe", name: "横扫", icon: "⚔", note: "6 伤害" },
    { skill: "enemy_charge", name: "蓄力", icon: "蓄", note: "下一次攻击 +50%" },
    { skill: "enemy_slam", name: "重锤", icon: "锤", note: "12 伤害" },
    { skill: "enemy_swipe", name: "横扫", icon: "⚔", note: "6 伤害" },
  ],
  [
    { skill: "enemy_charge", name: "蓄力", icon: "蓄", note: "下一次攻击 +50%" },
    { skill: "enemy_slam", name: "重锤", icon: "锤", note: "12 伤害" },
    { skill: "enemy_swipe", name: "横扫", icon: "⚔", note: "6 伤害" },
    { skill: "enemy_slam", name: "重锤", icon: "锤", note: "12 伤害" },
  ],
  [
    { skill: "enemy_swipe", name: "横扫", icon: "⚔", note: "6 伤害" },
    { skill: "enemy_swipe", name: "横扫", icon: "⚔", note: "6 伤害" },
    { skill: "enemy_charge", name: "蓄力", icon: "蓄", note: "下一次攻击 +50%" },
    { skill: "enemy_slam", name: "重锤", icon: "锤", note: "12 伤害" },
  ],
];

const HERO_MAX = 40;
const ENEMY_MAX = 36;

/**
 * 编排对决：战前把技能排进 4 个槽位，然后严格交替自动结算。
 * 只依赖事件总线，渲染层不需要知道这是规则引擎还是编排引擎。
 */
export class DuelSession implements CombatSource {
  runId = 0;
  phase: DuelPhase = "ENEMY_INTENT_REVEAL";
  frame = 0;
  done = false;
  winner: "hero" | "enemy" | "draw" | null = null;

  heroHp = HERO_MAX;
  enemyHp = ENEMY_MAX;
  heroMaxHp = HERO_MAX;
  enemyMaxHp = ENEMY_MAX;

  intents: DuelIntent[] = [];
  cards: DuelCard[] = [];
  disabledIndex = -1;
  slots: Array<SkillId | null> = [null, null, null, null];
  logs: DuelLogEntry[] = [];

  private statuses: Record<DuelActor, Map<StatusId, number>> = {
    hero: new Map(),
    enemy: new Map(),
  };
  private heroGuard = 0;
  private enemyCharged = false;
  private enemyStunSkip = false;

  private actions: Action[] = [];
  private actionIndex = -1;
  private current: { action: Action; elapsed: number; hit: boolean } | null = null;

  private events: BattleEvent[] = [];
  private cursor = 0;

  // ------------------------------------------------------------ phases

  newRound(): void {
    this.runId++;
    this.phase = "ENEMY_INTENT_REVEAL";
    this.frame = 0;
    this.done = false;
    this.winner = null;
    this.heroHp = HERO_MAX;
    this.enemyHp = ENEMY_MAX;
    this.statuses.hero.clear();
    this.statuses.enemy.clear();
    this.heroGuard = 0;
    this.enemyCharged = false;
    this.enemyStunSkip = false;
    this.slots = [null, null, null, null];
    this.logs = [];
    this.events = [];
    this.cursor = 0;
    this.actions = [];
    this.actionIndex = -1;
    this.current = null;

    this.intents = INTENT_PATTERNS[(this.runId - 1) % INTENT_PATTERNS.length].map((i) => ({ ...i }));
    this.disabledIndex = (this.runId - 1) % CARDS.length;
    this.cards = CARDS.map((c, i) => ({ ...c, disabled: i === this.disabledIndex }));

    this.emit("DUEL_LOG", `run#${this.runId} 敌方意图已公开；本局禁用「${CARDS[this.disabledIndex].name}」`, {
      data: { runId: this.runId, phase: this.phase },
    });
  }

  beginCompose(): void {
    if (this.phase !== "ENEMY_INTENT_REVEAL") return;
    this.phase = "PLAYER_SEQUENCE";
    this.emit("DUEL_LOG", `run#${this.runId} 进入编排：拖拽技能到 4 个槽位`, {
      data: { runId: this.runId, phase: this.phase },
    });
  }

  setSlot(index: number, skill: SkillId | null): void {
    if (this.phase !== "PLAYER_SEQUENCE") return;
    const card = this.cards.find((c) => c.skill === skill);
    if (skill && card?.disabled) return;
    this.slots[index] = skill;
  }

  startResolution(): boolean {
    if (this.phase !== "PLAYER_SEQUENCE") return false;
    const player: Action[] = [];
    this.slots.forEach((skill, i) => {
      if (skill) player.push({ actor: "hero", skill, slot: i + 1 });
    });
    const enemy: Action[] = this.intents.map((intent, i) => ({
      actor: "enemy" as const,
      skill: intent.skill,
      slot: i + 1,
    }));

    // 严格交替：玩家1 → 敌人1 → 玩家2 → 敌人2……多出的一方连续执行
    this.actions = [];
    const max = Math.max(player.length, enemy.length);
    for (let i = 0; i < max; i++) {
      if (player[i]) this.actions.push(player[i]);
      if (enemy[i]) this.actions.push(enemy[i]);
    }

    this.phase = "RESOLUTION";
    this.frame = 0;
    this.actionIndex = -1;
    this.current = null;
    this.nextAction();
    return true;
  }

  // ------------------------------------------------------------ simulation

  step(): void {
    if (this.phase !== "RESOLUTION" || this.done) return;
    this.frame++;

    // 流血：每 30 帧 1 点
    if ((this.statuses.enemy.get("bleed") ?? 0) > 0 && this.frame % 30 === 0) {
      this.damage("enemy", 1, "hero", "hero_rend", "流血");
      this.tickLog("hero", "hero_rend", 1, null, "流血跳伤");
      if (this.checkEnd()) return;
    }

    for (const actor of ["hero", "enemy"] as DuelActor[]) {
      const map = this.statuses[actor];
      for (const [id, frames] of [...map]) {
        if (frames <= 1) map.delete(id);
        else map.set(id, frames - 1);
      }
    }
    if (this.heroGuard > 0) this.heroGuard--;

    const cur = this.current;
    if (!cur) return;
    cur.elapsed++;

    const def = SKILLS[cur.action.skill];
    if (!cur.hit && cur.elapsed >= def.windup) {
      cur.hit = true;
      this.resolveHit(cur.action);
      if (this.checkEnd()) return;
    }
    const recovery = Math.max(6, Math.round(def.recovery * 0.6));
    if (cur.elapsed >= def.windup + recovery) this.nextAction();
  }

  private nextAction(): void {
    this.actionIndex++;
    if (this.actionIndex >= this.actions.length) {
      this.finish();
      return;
    }
    const action = this.actions[this.actionIndex];

    // 被击晕的敌人跳过这一拍
    if (action.actor === "enemy" && this.enemyStunSkip) {
      this.enemyStunSkip = false;
      this.tickLog("enemy", action.skill, 0, null, "被击晕，跳过行动");
      this.nextAction();
      return;
    }

    this.current = { action, elapsed: 0, hit: false };
    const def = SKILLS[action.skill];

    if (action.skill === "hero_guard") this.heroGuard = 60;
    if (action.skill === "enemy_charge") {
      this.enemyCharged = true;
      this.statuses.enemy.set("charge", 90);
    }

    this.emit("SKILL_START", `${action.actor === "hero" ? "英雄" : "敌人"} 起手 ${def.name}`, {
      side: action.actor,
      skill: action.skill,
      tier: def.tier,
      data: {
        windup: def.windup,
        recovery: Math.max(6, Math.round(def.recovery * 0.6)),
        tier: def.tier,
        fx: def.fx,
        name: def.name,
      },
    });
  }

  private resolveHit(action: Action): void {
    const actor = action.actor;
    const hook = actor === "hero" && action.skill === "hero_earthhammer" && this.previousHeroSkill(action) === "hero_rend"
      ? "裂伤→碎地锤"
      : null;

    if (actor === "hero") {
      switch (action.skill) {
        case "hero_thrust":
          this.damage("enemy", 8, "hero", action.skill, "突刺");
          this.tickLog("hero", action.skill, 8, null);
          break;
        case "hero_rend":
          this.damage("enemy", 5, "hero", action.skill, "裂伤");
          this.statuses.enemy.set("bleed", 600);
          this.emit("STATUS_APPLY", "敌人流血", { side: "enemy", skill: action.skill, data: { status: "bleed" } });
          this.tickLog("hero", action.skill, 5, null);
          break;
        case "hero_earthhammer": {
          const base = 12;
          const dmg = hook ? Math.round(base * 1.5) : base;
          this.damage("enemy", dmg, "hero", action.skill, hook ? "碎地锤（顺序增益）" : "碎地锤");
          if ((this.statuses.enemy.get("bleed") ?? 0) > 0) {
            this.enemyStunSkip = true;
            this.statuses.enemy.set("stun", 90);
            this.emit("STATUS_APPLY", "敌人被击晕", { side: "enemy", skill: action.skill, data: { status: "stun" } });
          }
          if (hook) this.emit("COMBO_STEP", `顺序增益：${hook}（伤害 +50%）`, { data: { hook } });
          this.tickLog("hero", action.skill, dmg, hook);
          break;
        }
        case "hero_guard":
          this.emit("STATUS_APPLY", "英雄进入格挡", { side: "hero", skill: action.skill, data: { status: "guard" } });
          this.tickLog("hero", action.skill, 0, null, "架起格挡（下一次受击 -60%）");
          break;
        default:
          break;
      }
      return;
    }

    // 敌方
    let dmg = 0;
    if (action.skill === "enemy_swipe") dmg = 6;
    if (action.skill === "enemy_slam") dmg = 12;
    if (action.skill === "enemy_charge") {
      this.tickLog("enemy", action.skill, 0, null, "蓄力（下一次攻击 +50%）");
      return;
    }
    if (this.enemyCharged) {
      dmg = Math.round(dmg * 1.5);
      this.enemyCharged = false;
      this.statuses.enemy.delete("charge");
    }
    let guarded = false;
    if (this.heroGuard > 0) {
      dmg = Math.round(dmg * 0.4);
      this.heroGuard = 0;
      guarded = true;
      this.emit("GUARD", "英雄格挡成功（伤害 -60%）", { side: "hero", skill: action.skill, tier: "key" });
    }
    this.damage("hero", dmg, "enemy", action.skill, guarded ? "被格挡" : SKILLS[action.skill].name);
    this.tickLog("enemy", action.skill, dmg, null, guarded ? "被格挡" : undefined);
  }

  private previousHeroSkill(action: Action): SkillId | null {
    const idx = this.actions.indexOf(action);
    for (let i = idx - 1; i >= 0; i--) {
      if (this.actions[i].actor === "hero") return this.actions[i].skill;
    }
    return null;
  }

  private damage(target: DuelActor, amount: number, from: DuelActor, skill: SkillId, label: string): void {
    if (target === "hero") this.heroHp = Math.max(0, this.heroHp - amount);
    else this.enemyHp = Math.max(0, this.enemyHp - amount);

    this.emit("DAMAGE", `${target === "hero" ? "英雄" : "敌人"} -${amount}（${label}）`, {
      side: target,
      skill,
      data: { amount, source: "duel" },
    });
    this.emit("HIT", `${from === "hero" ? "英雄" : "敌人"} ${SKILLS[skill].name} 命中 ${target === "hero" ? "英雄" : "敌人"}：${amount}`, {
      side: from,
      skill,
      tier: SKILLS[skill].tier,
      data: { from, to: target, damage: amount, crit: false, guard: label === "被格挡" },
    });
  }

  private checkEnd(): boolean {
    if (this.heroHp > 0 && this.enemyHp > 0) return false;
    this.finish();
    return true;
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.winner =
      this.heroHp <= 0
        ? "enemy"
        : this.enemyHp <= 0
          ? "hero"
          : this.heroHp === this.enemyHp
            ? "draw"
            : this.heroHp > this.enemyHp
              ? "hero"
              : "enemy"; // 行动打完：血量高者胜（可解释的判定）
    this.phase = "TURN_END";
    this.emit("BATTLE_END", `第 ${this.runId} 局结束：${this.winner === "hero" ? "英雄" : this.winner === "enemy" ? "敌人" : "平局"}`, {
      data: { winner: this.winner, frames: this.frame },
    });
  }

  private tickLog(
    actor: DuelActor,
    skill: SkillId,
    damage: number,
    hook: string | null,
    note?: string,
  ): void {
    const entry: DuelLogEntry = {
      runId: this.runId,
      frame: this.frame,
      actionIndex: Math.max(0, this.actionIndex + 1),
      actor,
      skill,
      damage,
      hook,
      text:
        `run#${this.runId} f${this.frame} a${Math.max(0, this.actionIndex + 1)} ` +
        `${actor === "hero" ? "英雄" : "敌人"} ${SKILLS[skill].name} damage=${damage}` +
        (hook ? ` hook=${hook}` : " hook=-") +
        (note ? ` · ${note}` : ""),
    };
    this.logs.push(entry);
    this.emit("DUEL_LOG", entry.text, { data: { ...entry, hook } });
  }

  // ------------------------------------------------------------ output

  private emit(
    type: BattleEvent["type"],
    text: string,
    opts: { side?: DuelActor; skill?: SkillId; tier?: BattleEvent["tier"]; data?: Record<string, unknown> } = {},
  ): void {
    this.events.push({
      frame: this.frame,
      type,
      side: opts.side,
      skill: opts.skill,
      tier: opts.tier,
      text,
      data: opts.data,
    });
  }

  drainEvents(): BattleEvent[] {
    const out = this.events.slice(this.cursor);
    this.cursor = this.events.length;
    return out;
  }

  snapshot(): BattleSnapshot {
    const statusesOf = (actor: DuelActor): Partial<Record<StatusId, number>> => {
      const out: Partial<Record<StatusId, number>> = {};
      for (const [id, frames] of this.statuses[actor]) out[id] = frames;
      return out;
    };
    const actionOf = (actor: DuelActor) => {
      if (!this.current || this.current.action.actor !== actor) return null;
      const def = SKILLS[this.current.action.skill];
      const recovery = Math.max(6, Math.round(def.recovery * 0.6));
      return {
        skill: this.current.action.skill,
        phase:
          this.current.elapsed < def.windup
            ? ("windup" as const)
            : this.current.elapsed === def.windup
              ? ("hit" as const)
              : ("recovery" as const),
        progress: this.current.elapsed / (def.windup + recovery),
      };
    };

    return {
      frame: this.frame,
      hero: {
        side: "hero",
        name: "英雄",
        hp: this.heroHp,
        maxHp: this.heroMaxHp,
        slot: 2,
        insight: 0,
        maxInsight: 0,
        statuses: statusesOf("hero"),
        action: actionOf("hero"),
        tier: "normal",
      },
      enemy: {
        side: "enemy",
        name: "敌人",
        hp: this.enemyHp,
        maxHp: this.enemyMaxHp,
        slot: 3,
        insight: 0,
        maxInsight: 0,
        statuses: statusesOf("enemy"),
        action: actionOf("enemy"),
        tier: "normal",
      },
      done: this.done,
      winner: this.winner,
    };
  }
}


