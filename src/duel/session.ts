import type {
  BattleEvent,
  BattleSnapshot,
  CombatSource,
  SkillId,
  StatusId,
} from "../engine/types.ts";

export type DuelState =
  | "SEED_REVEAL"
  | "BAN_REVEAL"
  | "PLAYER_SEQUENCE"
  | "RESOLUTION"
  | "TURN_END";
export type SlotPhase = "WINDUP" | "BURST" | "FINISH";
export type DuelActor = "hero" | "enemy";
export type CardKind = "skill" | "move";

export interface CardDef {
  id: string;
  name: string;
  kind: CardKind;
  phases: SlotPhase[] | "any";
  desc: string;
  windup: number;
  recovery: number;
  freeze: number;
  source: string;
}

/**
 * 10 张牌 = 8 技能 + 2 位移。
 * windup 对齐 pixelfx act（见每张牌 source）；recovery 取 act 剩余段的一部分。
 */
export const CARDS: CardDef[] = [
  { id: "stance", name: "架势", kind: "skill", phases: ["WINDUP"], desc: "下一爆发 +25%", windup: 75, recovery: 15, freeze: 0, source: "lightning/charge-up duration 0.9s" },
  { id: "guard", name: "格挡", kind: "skill", phases: ["WINDUP"], desc: "下一次受击 -50%", windup: 60, recovery: 12, freeze: 0, source: "melee/uppercut act（防御段）" },
  { id: "dash", name: "突进", kind: "move", phases: ["WINDUP"], desc: "靠近一档；下一爆发 +10%", windup: 55, recovery: 12, freeze: 0, source: "melee/thrust act poses（位移段）" },
  { id: "blink", name: "瞬移绕后", kind: "move", phases: ["WINDUP"], desc: "双方换位；下一爆发 +10%", windup: 50, recovery: 12, freeze: 0, source: "arcane/blink-in（接口化位移）" },
  { id: "thrust", name: "突刺", kind: "skill", phases: ["BURST"], desc: "8 伤害", windup: 10, recovery: 14, freeze: 0, source: "melee/thrust act.hits[0].t=0.07" },
  { id: "rend", name: "裂伤", kind: "skill", phases: ["BURST"], desc: "5 伤害 + 流血", windup: 8, recovery: 16, freeze: 0, source: "melee/double-slash act.hits" },
  { id: "hammer", name: "碎地锤", kind: "skill", phases: ["BURST"], desc: "12 伤害；流血目标 +50% 并击晕", windup: 18, recovery: 20, freeze: 8, source: "melee/hammer-smash act.hits[0].stop=0.14" },
  { id: "execute", name: "处决", kind: "skill", phases: ["FINISH"], desc: "对流血/击晕 24，否则 8", windup: 20, recovery: 24, freeze: 16, source: "melee/thrust act + 处决 stop 0.26" },
  { id: "disengage", name: "脱离", kind: "skill", phases: ["FINISH"], desc: "回复 4，下一次受击 -50%", windup: 12, recovery: 14, freeze: 0, source: "melee/uppercut act（后撤段）" },
  { id: "gamble", name: "赌命一击", kind: "skill", phases: "any", desc: "爆发段 10；错位放 16 但自伤 4", windup: 14, recovery: 16, freeze: 0, source: "melee/heavy-cleave act" },
];

const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));
const MOVE_IDS = ["dash", "blink"];
const ALL_SKILLS = ["stance", "guard", "thrust", "rend", "hammer", "execute", "disengage"];
const NON_STRUCTURAL = ["thrust", "rend", "hammer", "execute", "disengage"];
const OPENERS = [1, 2, 3];

const ENEMY_TIMING: Record<string, { windup: number; recovery: number }> = {
  enemy_swipe: { windup: 8, recovery: 14 },
  enemy_charge: { windup: 36, recovery: 8 },
  enemy_slam: { windup: 12, recovery: 20 },
};

const HERO_MAX = 60;
const ENEMY_MAX = 56;

export interface Intent {
  slot: number;
  cardId: string;
  name: string;
  icon: string;
  note: string;
}

export interface Attribution {
  runId: number;
  seed: number;
  frame: number;
  slot: number;
  phase: SlotPhase;
  actor: DuelActor;
  skill: string;
  hit: boolean;
  damage: number;
  affinity: { triggered: boolean; reason: string };
  displacement: { from: number; to: number; frames: number };
  freeze: { triggered: boolean; frames: number };
  queueLenAfter: number;
  text: string;
}

interface QueueItem {
  slot: number;
  phase: SlotPhase;
  actor: DuelActor;
  cardId: string;
  windup: number;
  recovery: number;
  startFrame: number;
  hitFrame: number;
  expireFrame: number;
  resolved: boolean;
  hit: boolean;
  damage: number;
  affinity: { triggered: boolean; reason: string };
  displacement: { from: number; to: number; frames: number };
  freeze: { triggered: boolean; frames: number };
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 禁用完全由种子派生：2 技能 + 1 位移，同种子永远相同。 */
export function deriveBans(seed: number): { skills: string[]; move: string } {
  const rng = mulberry32(seed);
  const banned: string[] = [];
  while (banned.length < 2) {
    const pick = ALL_SKILLS[Math.floor(rng() * ALL_SKILLS.length)];
    if (!banned.includes(pick)) banned.push(pick);
  }
  const move = MOVE_IDS[Math.floor(rng() * MOVE_IDS.length)];
  // 可行性修复：起手结构牌（架势/格挡）不能同时被禁，否则起手 3 格铺不满
  if (banned.includes("stance") && banned.includes("guard")) {
    const replacement = NON_STRUCTURAL.find((id) => !banned.includes(id)) ?? "thrust";
    banned[banned.indexOf("guard")] = replacement;
  }
  return { skills: banned, move };
}

function phaseOfSlot(slot: number): SlotPhase {
  if (slot <= 3) return "WINDUP";
  if (slot <= 6) return "BURST";
  return "FINISH";
}

export class DuelSession implements CombatSource {
  runId = 0;
  seed = 1;
  state: DuelState = "SEED_REVEAL";
  frame = 0;
  done = false;
  winner: "hero" | "enemy" | "draw" | null = null;

  heroHp = HERO_MAX;
  enemyHp = ENEMY_MAX;
  heroMaxHp = HERO_MAX;
  enemyMaxHp = ENEMY_MAX;
  heroPos = 1;
  enemyPos = 3;

  bans: { skills: string[]; move: string } = { skills: [], move: "dash" };
  slots: Array<string | null> = Array(8).fill(null);
  intents: Intent[] = [];
  logs: Attribution[] = [];
  summary: string | null = null;

  private queue: QueueItem[] = [];
  private started = false;
  private statuses: Record<DuelActor, Map<StatusId, number>> = {
    hero: new Map(),
    enemy: new Map(),
  };
  private stanceBuff = false;
  private moveBuff = false;
  private enemyCharged = false;
  private enemyStunSkip = false;
  private heroGuard = false;
  private heroEvade = false;
  private skipNext: Record<DuelActor, boolean> = { hero: false, enemy: false };
  private firstBurstFreezeUsed = false;
  private lastBuff: { triggered: boolean; reason: string } = { triggered: false, reason: "无" };

  private events: BattleEvent[] = [];
  private cursor = 0;

  // ------------------------------------------------------------ states

  newRun(seed: number): void {
    this.runId++;
    this.seed = seed >>> 0;
    this.state = "SEED_REVEAL";
    this.frame = 0;
    this.done = false;
    this.winner = null;
    this.heroHp = HERO_MAX;
    this.enemyHp = ENEMY_MAX;
    this.heroPos = 1;
    this.enemyPos = 3;
    this.slots = Array(8).fill(null);
    this.logs = [];
    this.summary = null;
    this.queue = [];
    this.started = false;
    this.events = [];
    this.cursor = 0;
    this.statuses.hero.clear();
    this.statuses.enemy.clear();
    this.stanceBuff = false;
    this.moveBuff = false;
    this.enemyCharged = false;
    this.enemyStunSkip = false;
    this.heroGuard = false;
    this.heroEvade = false;
    this.skipNext = { hero: false, enemy: false };
    this.firstBurstFreezeUsed = false;
    this.bans = deriveBans(this.seed);
    this.intents = this.buildIntents();
    this.emit("DUEL_LOG", `seed=${this.seed} · run#${this.runId} · 种子已展示`, {
      data: { seed: this.seed, runId: this.runId },
    });
  }

  revealBans(): void {
    if (this.state !== "SEED_REVEAL") return;
    this.state = "BAN_REVEAL";
    this.emit(
      "DUEL_LOG",
      `seed=${this.seed} 禁用：${this.bans.skills.map((id) => CARD_BY_ID.get(id)?.name ?? id).join("、")} + 位移「${CARD_BY_ID.get(this.bans.move)?.name}」`,
      { data: { ...this.bans } },
    );
  }

  beginCompose(): void {
    if (this.state !== "BAN_REVEAL") return;
    this.state = "PLAYER_SEQUENCE";
    this.emit("DUEL_LOG", `seed=${this.seed} 进入编排：起手 1-3 必须铺满`, { data: {} });
  }

  isBanned(cardId: string): boolean {
    return this.bans.skills.includes(cardId) || cardId === this.bans.move;
  }

  canPlace(slot: number, cardId: string): { ok: boolean; reason: string } {
    const card = CARD_BY_ID.get(cardId);
    if (!card) return { ok: false, reason: "未知卡牌" };
    if (this.isBanned(cardId)) return { ok: false, reason: "本局禁用" };
    const phase = phaseOfSlot(slot);
    if (card.phases !== "any" && !card.phases.includes(phase)) {
      return { ok: false, reason: `${card.name} 只能放 ${card.phases.join("/")}` };
    }
    if (slot <= 3 && card.kind === "skill" && card.id !== "stance" && card.id !== "guard" && card.id !== "gamble") {
      return { ok: false, reason: "起手只允许位移/架势/错位牌" };
    }
    return { ok: true, reason: "" };
  }

  setSlot(slot: number, cardId: string | null): string | null {
    if (this.state !== "PLAYER_SEQUENCE") return "当前不可编排";
    if (cardId === null) {
      this.slots[slot - 1] = null;
      return null;
    }
    const check = this.canPlace(slot, cardId);
    if (!check.ok) return check.reason;
    this.slots[slot - 1] = cardId;
    return null;
  }

  openerFrames(): number {
    let total = 0;
    for (const slot of OPENERS) {
      const id = this.slots[slot - 1];
      const card = id ? CARD_BY_ID.get(id) : null;
      if (card) total += card.windup + card.recovery;
    }
    return total;
  }

  canStart(): { ok: boolean; reason: string } {
    if (this.state !== "PLAYER_SEQUENCE") return { ok: false, reason: "状态不对" };
    if (OPENERS.some((s) => !this.slots[s - 1])) return { ok: false, reason: "起手 1-3 必须铺满" };
    if (this.openerFrames() < 180) {
      return { ok: false, reason: `起手 ${this.openerFrames()}f < 180f（3 秒）` };
    }
    if (!this.slots.slice(3).some(Boolean)) return { ok: false, reason: "至少放 1 张爆发/收尾" };
    return { ok: true, reason: "" };
  }

  startResolution(): boolean {
    if (!this.canStart().ok) return false;

    const player: QueueItem[] = [];
    this.slots.forEach((id, i) => {
      if (id) player.push(this.makeItem(i + 1, "hero", id));
    });
    const enemy = this.intents.map((intent) => this.makeItem(intent.slot, "enemy", intent.cardId));

    this.queue = [];
    for (let i = 0; i < 8; i++) {
      if (player[i]) this.queue.push(player[i]);
      if (enemy[i]) this.queue.push(enemy[i]);
    }

    this.state = "RESOLUTION";
    this.frame = 0;
    this.started = false;
    return true;
  }

  private makeItem(slot: number, actor: DuelActor, cardId: string): QueueItem {
    const card = CARD_BY_ID.get(cardId);
    const timing = card ?? ENEMY_TIMING[cardId] ?? { windup: 10, recovery: 12 };
    return {
      slot,
      phase: phaseOfSlot(slot),
      actor,
      cardId,
      windup: timing.windup,
      recovery: timing.recovery,
      startFrame: 0,
      hitFrame: 0,
      expireFrame: 0,
      resolved: false,
      hit: false,
      damage: 0,
      affinity: { triggered: false, reason: "—" },
      displacement: { from: actor === "hero" ? this.heroPos : this.enemyPos, to: actor === "hero" ? this.heroPos : this.enemyPos, frames: 0 },
      freeze: { triggered: false, frames: 0 },
    };
  }

  // ------------------------------------------------------------ simulation

  step(): void {
    if (this.state !== "RESOLUTION" || this.done) return;
    this.frame++;

    if (!this.started) {
      this.started = true;
      this.startNextItem();
    }

    const cur = this.queue[0];
    if (!cur) {
      this.finish();
      return;
    }

    if (!cur.resolved && this.frame >= cur.hitFrame) {
      cur.resolved = true;
      this.resolveItem(cur);
      this.checkEnd();
      if (this.done) return;
    }

    if (this.frame >= cur.expireFrame) {
      this.queue.shift();
      this.emitAttribution(cur);
      this.startNextItem();
      if (this.queue.length === 0) this.finish();
    }
  }

  private startNextItem(): void {
    const item = this.queue[0];
    if (!item) return;

    if (this.skipNext[item.actor]) {
      this.skipNext[item.actor] = false;
      item.startFrame = this.frame;
      item.hitFrame = this.frame;
      item.expireFrame = this.frame + 1;
      item.resolved = true;
      item.hit = false;
      item.damage = 0;
      item.affinity = { triggered: true, reason: "落地硬直：跳过这一拍" };
      this.emit("DUEL_LOG", `slot${item.slot} ${item.actor} 落地硬直，跳过`, { data: { skip: true } });
      return;
    }

    if (item.actor === "enemy" && this.enemyStunSkip) {
      this.enemyStunSkip = false;
      item.startFrame = this.frame;
      item.hitFrame = this.frame;
      item.expireFrame = this.frame + 1;
      item.resolved = true;
      item.hit = false;
      item.damage = 0;
      item.affinity = { triggered: false, reason: "被击晕，跳过这一拍" };
      this.emit("DUEL_LOG", `slot${item.slot} 敌人被击晕，跳过`, { data: { skip: true } });
      return;
    }

    item.startFrame = this.frame;
    item.hitFrame = this.frame + item.windup;
    item.expireFrame = this.frame + item.windup + item.recovery;

    const name = CARD_BY_ID.get(item.cardId)?.name ?? item.cardId;
    const tier: BattleEvent["tier"] = item.phase === "FINISH" ? "ultimate" : "normal";
    this.emit("SKILL_START", `${item.actor === "hero" ? "英雄" : "敌人"} 起手 ${name}`, {
      side: item.actor,
      skill: this.skillForFx(item.cardId),
      tier,
      data: {
        windup: item.windup,
        recovery: item.recovery,
        tier,
        fx: this.fxFor(item.cardId),
        name,
      },
    });
  }

  private resolveItem(item: QueueItem): void {
    if (item.actor === "enemy") {
      this.resolveEnemy(item);
      return;
    }

    switch (item.cardId) {
      case "guard":
        this.emit("FX_CUE", "格挡：架盾", { side: "hero", data: { fx: "impacts/shield-block" } });
        this.heroGuard = true;
        item.affinity = { triggered: true, reason: "格挡铺设：下一次受击 -50%" };
        break;
      case "stance":
        this.emit("FX_CUE", "架势：蓄力表演", { side: "hero", data: { fx: "lightning/charge-up" } });
        this.stanceBuff = true;
        item.affinity = { triggered: true, reason: "架势铺设：下一爆发 +25%" };
        break;
      case "dash": {
        this.emit("FX_CUE", "突进：位移", { side: "hero", data: { fx: "melee/uppercut" } });
        const to = Math.min(3, this.heroPos + 1);
        item.displacement = { from: this.heroPos, to, frames: item.windup };
        this.heroPos = to;
        this.moveBuff = true;
        item.affinity = { triggered: true, reason: "突进铺设：下一爆发 +10%" };
        break;
      }
      case "blink": {
        this.emit("FX_CUE", "瞬移绕后", { side: "hero", data: { fx: "arcane/blink-in" } });
        const from = this.heroPos;
        item.displacement = { from, to: this.enemyPos, frames: item.windup };
        [this.heroPos, this.enemyPos] = [this.enemyPos, this.heroPos];
        this.moveBuff = true;
        this.heroEvade = true;
        item.affinity = { triggered: true, reason: "绕后铺设：下一爆发 +10% 且闪避一次" };
        break;
      }
      case "thrust":
        item.damage = this.consumeBurst(8);
        item.affinity = this.lastBuff;
        this.maybeBurstFreeze(item);
        this.damage("enemy", item.damage, item.freeze.frames, this.fxFor(item.cardId));
        item.hit = true;
        break;
      case "rend":
        item.damage = this.consumeBurst(5);
        item.affinity = this.lastBuff;
        this.statuses.enemy.set("bleed", 600);
        this.emit("STATUS_APPLY", "敌人流血", { side: "enemy", data: { status: "bleed" } });
        this.maybeBurstFreeze(item);
        this.damage("enemy", item.damage, item.freeze.frames, this.fxFor(item.cardId));
        item.hit = true;
        break;
      case "hammer": {
        const bleeding = (this.statuses.enemy.get("bleed") ?? 0) > 0;
        let dmg = 12 + this.consumeBurst(0);
        if (bleeding) {
          dmg = Math.round(dmg * 1.5);
          this.enemyStunSkip = true;
          this.statuses.enemy.set("stun", 90);
          this.emit("STATUS_APPLY", "敌人被击晕", { side: "enemy", data: { status: "stun" } });
          item.affinity = { triggered: true, reason: "流血→碎地锤：+50% 并击晕" };
        } else {
          item.affinity = { triggered: false, reason: "目标未流血，无亲和" };
        }
        item.damage = dmg;
        item.hit = true;
        this.maybeBurstFreeze(item);
        this.damage("enemy", dmg, item.freeze.frames, this.fxFor(item.cardId));
        break;
      }
      case "execute": {
        const vulnerable =
          (this.statuses.enemy.get("stun") ?? 0) > 0 || (this.statuses.enemy.get("bleed") ?? 0) > 0;
        item.damage = vulnerable ? 24 : 8;
        item.hit = true;
        item.freeze = { triggered: true, frames: 16 };
        item.affinity = vulnerable
          ? { triggered: true, reason: "目标流血/击晕：处决 24" }
          : { triggered: false, reason: "目标无破绽：仅 8" };
        this.damage("enemy", item.damage, item.freeze.frames, this.fxFor(item.cardId));
        if (this.enemyHp > 0) this.skipNext.enemy = true; // 落地硬直：下一拍跳过
        break;
      }
      case "disengage":
        this.emit("FX_CUE", "脱离：后撤", { side: "hero", data: { fx: "arcane/blink-out" } });
        this.heroHp = Math.min(this.heroMaxHp, this.heroHp + 4);
        this.heroGuard = true;
        item.affinity = { triggered: true, reason: "脱离：回复 4，下一次受击 -50%" };
        break;
      case "gamble": {
        const offPhase = item.phase !== "BURST";
        item.damage = offPhase ? 16 : 10;
        item.hit = true;
        item.affinity = offPhase
          ? { triggered: true, reason: "错位牌：16 伤害，自伤 4" }
          : { triggered: false, reason: "放在爆发段：仅 10" };
        this.maybeBurstFreeze(item);
        this.damage("enemy", item.damage, item.freeze.frames, this.fxFor(item.cardId));
        if (offPhase) this.heroHp = Math.max(1, this.heroHp - 4);
        break;
      }
      default:
        break;
    }
  }

  private resolveEnemy(item: QueueItem): void {
    if (item.cardId === "enemy_charge") {
      this.emit("FX_CUE", "敌方蓄力", { side: "enemy", data: { fx: "lightning/charge-up" } });
      this.enemyCharged = true;
      item.affinity = { triggered: false, reason: "敌方蓄力" };
      return;
    }
    if (this.heroEvade) {
      this.heroEvade = false;
      item.hit = false;
      item.damage = 0;
      item.affinity = { triggered: true, reason: "绕后闪避：敌方攻击落空" };
      this.emit("DODGE", "闪避", { side: "hero", data: { dir: this.heroPos <= this.enemyPos ? 1 : -1 } });
      return;
    }
    let dmg = item.cardId === "enemy_slam" ? 12 : 6;
    if (this.enemyCharged) {
      dmg = Math.round(dmg * 1.5);
      this.enemyCharged = false;
    }
    if (this.heroGuard) {
      dmg = Math.round(dmg * 0.5);
      this.heroGuard = false;
      item.affinity = { triggered: true, reason: "脱离减伤 50%" };
    }
    item.damage = dmg;
    item.hit = true;
    this.damage("hero", dmg, 0, this.fxFor(item.cardId));
  }

  private consumeBurst(base: number): number {
    if (this.stanceBuff) {
      this.stanceBuff = false;
      this.lastBuff = { triggered: true, reason: "架势→爆发：+25%" };
      return Math.round(base * 1.25);
    }
    if (this.moveBuff) {
      this.moveBuff = false;
      this.lastBuff = { triggered: true, reason: "位移→爆发：+10%" };
      return Math.round(base * 1.1);
    }
    this.lastBuff = { triggered: false, reason: "起手无亲和" };
    return base;
  }

  private maybeBurstFreeze(item: QueueItem): void {
    if (item.phase === "BURST" && !this.firstBurstFreezeUsed) {
      this.firstBurstFreezeUsed = true;
      item.freeze = { triggered: true, frames: 8 };
    }
  }

  private damage(target: DuelActor, amount: number, freezeFrames = 0, fx = ""): void {
    if (target === "hero") this.heroHp = Math.max(0, this.heroHp - amount);
    else this.enemyHp = Math.max(0, this.enemyHp - amount);
    this.emit("DAMAGE", `${target === "hero" ? "英雄" : "敌人"} -${amount}`, {
      side: target,
      data: { amount, source: "duel" },
    });
    this.emit("HIT", `${target === "hero" ? "英雄" : "敌人"} 受击 ${amount}`, {
      side: target === "hero" ? "enemy" : "hero",
      tier: freezeFrames >= 12 ? "ultimate" : freezeFrames > 0 ? "key" : "normal",
      data: {
        from: target === "hero" ? "enemy" : "hero",
        to: target,
        damage: amount,
        crit: false,
        freezeFrames,
        fx,
      },
    });
  }

  private emitAttribution(item: QueueItem): void {
    const entry: Attribution = {
      runId: this.runId,
      seed: this.seed,
      frame: this.frame,
      slot: item.slot,
      phase: item.phase,
      actor: item.actor,
      skill: item.cardId,
      hit: item.hit,
      damage: item.damage,
      affinity: item.affinity,
      displacement: item.displacement,
      freeze: item.freeze,
      queueLenAfter: this.queue.length,
      text: "",
    };
    entry.text =
      `run#${entry.runId} seed=${entry.seed} f${entry.frame} slot${entry.slot} ${entry.phase} ` +
      `${entry.actor} ${entry.skill} hit=${entry.hit ? 1 : 0} dmg=${entry.damage} ` +
      `affinity=${entry.affinity.triggered ? "triggered" : "not"}(${entry.affinity.reason}) ` +
      `move=${entry.displacement.from}→${entry.displacement.to}/${entry.displacement.frames}f ` +
      `freeze=${entry.freeze.triggered ? entry.freeze.frames : "not"} queueLenAfter=${entry.queueLenAfter}`;
    this.logs.push(entry);
    this.emit("DUEL_LOG", entry.text, { data: { ...entry } });
    try {
      const key = "cricket-duel-logs";
      const prev = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[];
      prev.push(entry);
      localStorage.setItem(key, JSON.stringify(prev.slice(-300)));
    } catch {
      /* Node / 隐私模式忽略 */
    }
  }

  private checkEnd(): void {
    if (this.heroHp > 0 && this.enemyHp > 0) return;
    this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.queue = []; // exit 清理：未消费队列项全部丢弃
    this.state = "TURN_END";
    this.winner =
      this.heroHp <= 0
        ? "enemy"
        : this.enemyHp <= 0
          ? "hero"
          : this.heroHp === this.enemyHp
            ? "draw"
            : this.heroHp > this.enemyHp
              ? "hero"
              : "enemy";
    this.summary =
      `run#${this.runId} seed=${this.seed} winner=${this.winner} totalFrames=${this.frame} ` +
      `queueLen=${this.queue.length} activeFx=pending lingeringTimers=${this.lingeringTimers()}`;
    this.emit("BATTLE_END", this.summary, { data: { winner: this.winner } });
  }

  lingeringTimers(): number {
    return 0;
  }

  queueLength(): number {
    return this.queue.length;
  }

  // ------------------------------------------------------------ intents

  private buildIntents(): Intent[] {
    const base = [
      { id: "enemy_swipe", name: "横扫", icon: "⚔", note: "6 伤害" },
      { id: "enemy_charge", name: "蓄力", icon: "蓄", note: "下一次 +50%" },
      { id: "enemy_slam", name: "重锤", icon: "锤", note: "12 伤害" },
    ];
    const pattern = [
      [0, 1, 2, 0, 2, 0, 1, 2],
      [1, 0, 2, 0, 2, 0, 2, 0],
    ][this.seed % 2];
    return pattern.map((idx, i) => ({
      slot: i + 1,
      cardId: base[idx].id,
      name: base[idx].name,
      icon: base[idx].icon,
      note: base[idx].note,
    }));
  }

  // ------------------------------------------------------------ fx mapping

  private skillForFx(cardId: string): BattleEvent["skill"] {
    const map: Record<string, SkillId> = {
      stance: "enemy_charge",
      dash: "hero_step",
      blink: "hero_dodge",
      thrust: "hero_thrust",
      rend: "hero_rend",
      hammer: "hero_earthhammer",
      guard: "hero_guard",
      execute: "hero_execute",
      disengage: "hero_guard",
      gamble: "hero_earthhammer",
      enemy_swipe: "enemy_swipe",
      enemy_charge: "enemy_charge",
      enemy_slam: "enemy_slam",
    };
    return map[cardId] ?? "hero_thrust";
  }

  private fxFor(cardId: string): string {
    const map: Record<string, string> = {
      stance: "lightning/charge-up",
      dash: "melee/uppercut",
      blink: "arcane/blink-in",
      thrust: "melee/thrust",
      rend: "melee/double-slash",
      hammer: "melee/hammer-smash",
      guard: "impacts/shield-block",
      execute: "melee/scythe-reap",
      disengage: "arcane/blink-out",
      gamble: "melee/heavy-cleave",
      enemy_swipe: "melee/spear-sweep",
      enemy_charge: "lightning/charge-up",
      enemy_slam: "melee/hammer-smash",
    };
    return map[cardId] ?? "";
  }

  // ------------------------------------------------------------ output

  private emit(
    type: BattleEvent["type"],
    text: string,
    opts: { side?: DuelActor; skill?: SkillId; tier?: BattleEvent["tier"]; data?: Record<string, unknown> } = {},
  ): void {
    this.events.push({ frame: this.frame, type, side: opts.side, skill: opts.skill, tier: opts.tier, text, data: opts.data });
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
    return {
      frame: this.frame,
      hero: {
        side: "hero",
        name: "英雄",
        hp: this.heroHp,
        maxHp: this.heroMaxHp,
        slot: this.heroPos,
        insight: 0,
        maxInsight: 0,
        statuses: statusesOf("hero"),
        action: null,
        tier: "normal",
      },
      enemy: {
        side: "enemy",
        name: "敌人",
        hp: this.enemyHp,
        maxHp: this.enemyMaxHp,
        slot: this.enemyPos,
        insight: 0,
        maxInsight: 0,
        statuses: statusesOf("enemy"),
        action: null,
        tier: "normal",
      },
      done: this.done,
      winner: this.winner,
    };
  }
}











