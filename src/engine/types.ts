/** 引擎共享类型。渲染层只依赖这里的 BattleEvent / Tier，不反向依赖引擎内部。 */

export type Side = "hero" | "enemy";

export type StatusId =
  | "bleed" // 流血：每 30 帧结算 1 点
  | "stun" // 击晕：无法行动
  | "charge" // 蓄力：敌方正在攒大招，可被突刺打断
  | "imbalance" // 失衡：受击后的短硬直
  | "guard" // 格挡：减伤 + 成功格挡后开还击窗口
  | "riposte" // 还击窗口
  | "iframes" // 闪避无敌帧
  | "evasion" // 游走：下一次受击减半
  | "airborne" // 浮空：处决击飞，可被空连
  | "downed" // 倒地：受身前的硬直
  | "ukemi_counter" // 受身反击：起身后下一击增伤
  | "read"; // 看破：下一次命中必暴击

export type Tier = "normal" | "key" | "ultimate";

export type SkillId =
  | "hero_thrust"
  | "hero_rend"
  | "hero_earthhammer"
  | "hero_execute"
  | "hero_guard"
  | "hero_riposte"
  | "hero_dodge"
  | "hero_read"
  | "hero_step"
  | "enemy_charge"
  | "enemy_slam"
  | "enemy_swipe"
  | "enemy_step";

export interface SkillDef {
  id: SkillId;
  name: string;
  /** 基础层级；命中时可能被上下文升级（暴击/打断/处决）。 */
  tier: Tier;
  /** 起手到命中帧的帧数（60Hz）。 */
  windup: number;
  /** 命中帧之后的收招帧数。 */
  recovery: number;
  /** pixelfx 招式资源键，见 src/render/fx.ts 的映射表。 */
  fx: string;
  note: string;
}

export type Cost =
  | { kind: "none" }
  | { kind: "resource"; insight: number }
  | { kind: "skip_next" }
  | { kind: "hard_cc"; frames: number };

export interface RuleCtx {
  self: ActorView;
  foe: ActorView;
  frame: number;
}

export interface ActorView {
  side: Side;
  hp: number;
  maxHp: number;
  slot: number;
  distance: number;
  insight: number;
  maxInsight: number;
  /** 目标是否处于某状态 */
  has: (s: StatusId) => boolean;
  /** 状态剩余帧 */
  frames: (s: StatusId) => number;
  /** 自己起手还剩几帧命中（未出手为 0） */
  windupLeft: number;
  /** 自己起手中招式的 id（未出手为 undefined） */
  windupSkill?: SkillId;
  /** 自己是否在收招（已过命中帧） */
  recovering: boolean;
  /** 目标是否在蓄力 */
  charging: boolean;
  /** 规则冷却剩余帧 */
  cooldown: (ruleId: string) => number;
  /** 硬直 / 跳过下一条的锁定帧 */
  lock: number;
  /** 下一次命中是否必暴击 */
  read: boolean;
}

export type RuleTag = "attack" | "defense" | "interrupt" | "combo" | "move";

export interface RuleDef {
  /** 规则表内序号，日志里写"规则[3]"。 */
  index: number;
  id: string;
  side: Side;
  name: string;
  /** 人类可读条件，日志直接展示。 */
  when: string;
  test: (ctx: RuleCtx) => boolean;
  skill: SkillId;
  priority: number;
  cost: Cost;
  cooldown?: number;
  tags: RuleTag[];
  /** 敌方规则揭示文案（玩家可见的"敌方规则触发：…"） */
  reveal?: string;
  chain?: string;
}

export type EventType =
  | "RULE_TRIGGER"
  | "PRIORITY_CLASH"
  | "INTERRUPT_SUCCESS"
  | "COMBO_STEP"
  | "STATUS_APPLY"
  | "CRIT"
  | "KNOCKBACK"
  | "SWAP"
  | "EXECUTE"
  // 以下是渲染层需要的补充事件
  | "SKILL_START"
  | "HIT"
  | "DAMAGE"
  | "GUARD"
  | "DODGE"
  | "MOVE"
  | "DUEL_LOG"
  | "FX_CUE"
  | "DODGE"
  | "MECHANIC"
  | "DOWNED"
  | "GETUP"
  | "BATTLE_END";

export interface BattleEvent {
  frame: number;
  type: EventType;
  side?: Side;
  skill?: SkillId;
  tier?: Tier;
  text: string;
  data?: Record<string, unknown>;
}

export interface LogEntry {
  frame: number;
  kind: "system" | "rule" | "clash" | "event" | "combo" | "reveal" | "damage";
  text: string;
}

/** 渲染层需要的最小战场快照（Battle 与 DuelEngine 共用）。 */
export interface ActorSnapshot {
  side: Side;
  hp: number;
  maxHp: number;
  slot: number;
  insight: number;
  maxInsight: number;
  statuses: Partial<Record<StatusId, number>>;
  action: { skill: SkillId; phase: "windup" | "hit" | "recovery"; progress: number } | null;
  tier: Tier;
  name: string;
}

export interface BattleSnapshot {
  frame: number;
  hero: ActorSnapshot;
  enemy: ActorSnapshot;
  done: boolean;
  winner: "hero" | "enemy" | "draw" | null;
}

/** 渲染层只依赖这个接口，不关心背后是规则引擎还是编排引擎。 */
export interface CombatSource {
  frame: number;
  done: boolean;
  winner: "hero" | "enemy" | "draw" | null;
  step(): void;
  snapshot(): BattleSnapshot;
  drainEvents(): BattleEvent[];
}








