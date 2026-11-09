import * as PIXI from "pixi.js";

import { SKILLS } from "../engine/skills.ts";
import type { BattleEvent, BattleSnapshot, CombatSource, LogEntry, StatusId, Tier } from "../engine/types.ts";
import { TIERS } from "../presentation/tiers.ts";
import { ARENA, createArena, SLOT_X, slotX, terrainY } from "./arena.ts";
import { CameraRig } from "./camera.ts";
import { PixelFxLayer } from "./fx.ts";
import { attackForSkill, HeroActor, type HeroState } from "./hero.ts";
import { characterOf, type CharacterDef } from "./characters.ts";
import { flashScreen } from "./flash.ts";
import { HitParticles } from "./particles.ts";
import { ImpactFx, type ImpactKind } from "./impact.ts";

export interface PresenterHooks {
  onLog(entry: LogEntry): void;
  onSnapshot(snapshot: BattleSnapshot): void;
  onBanner(text: string, kind: "clash" | "combo" | "reveal" | "end"): void;
  onEnd(winner: string, frames: number): void;
  onRule?: (ruleIndex: number, text: string, side: "hero" | "enemy") => void;
  onCombo?: (n: number, air: number) => void;
}

interface FloatText {
  text: PIXI.Text;
  life: number;
  max: number;
}

interface Mark {
  g: PIXI.Graphics;
  life: number;
}

type Side = "hero" | "enemy";
const FIXED_MS = 1000 / 60;
const LUNGE_SPEED = 230; // world px/s（冲刺速度，接近 BvN 的快速位移）

/**
 * 演出层：订阅引擎事件，把它们翻译成 hitstop / 镜头 / 粒子 / 特效 / 位移。
 * 攻击前先 RUN 冲刺到对方面前，命中瞬间分离 + 挤压回弹，再退回原位。
 * hitstop 只冻结表现层时间缩放，战斗逻辑照常推进。
 */
export class Presenter {
  readonly world = new PIXI.Container();
  private readonly fxLayer: PixelFxLayer;
  private readonly particles = new HitParticles();
  private readonly hero: HeroActor;
  private readonly enemy: HeroActor;
  private readonly camera = new CameraRig();
  private readonly floatLayer = new PIXI.Container();
  private readonly markLayer = new PIXI.Container();
  private readonly impact: ImpactFx;
  private readonly aura = new PIXI.Graphics();
  private clock = 0;
  private combo = 0;
  private comboOwner: Side | null = null;
  private airCombo: Record<Side, number> = { hero: 0, enemy: 0 };
  private kdActive: Record<Side, boolean> = { hero: false, enemy: false };
  private ukemiCount = 0;
  private camZoom = 1;
  private readonly chars: { hero: CharacterDef; enemy: CharacterDef };
  private projectiles: Array<{ g: PIXI.Container; owner: Side; life: number; max: number; vx: number; kind: "arrow" | "orb" | "swordwave" | "wave"; anim?: PIXI.AnimatedSprite }> = [];
  private pendingLean: Record<Side, number> = { hero: 0, enemy: 0 };
  private arcQueue: Array<{ at: number; x: number; y: number; dir: number; color: number; radius: number }> = [];
  private koMs = 0;
  /** 屏幕空间叠层：必杀 cut-in / K.O.，不随世界镜头缩放。 */
  readonly overlay = new PIXI.Container();
  private readonly cutinBg = new PIXI.Graphics();
  private readonly cutinText: PIXI.Text;
  private readonly koText: PIXI.Text;
  private cutinMs = 0;
  private cutinName = "";
  private knockdownCount = 0;
  private comboTimer = 0;
  private readonly hooks: PresenterHooks;

  private floats: FloatText[] = [];
  private marks: Mark[] = [];
  private freezeMs = 0;
  private slowmoMs = 0;
  private slowmoScale = 0.3;
  private settleMs = 0;
  private time = 0;
  private animScale = 1;
  private hudAcc = 0;
  private ended = false;

  private viewport = { w: 960, h: 540 };
  private cover = 3;

  // 前冲 / 物理分离
  private lunge: Record<Side, number> = { hero: 0, enemy: 0 };
  private lungeVel: Record<Side, number> = { hero: 0, enemy: 0 };
  private recoverAt: Record<Side, number> = { hero: 0, enemy: 0 };
  private clashCd = 0;
  private push: Record<Side, number> = { hero: 0, enemy: 0 };
  private trailG = new PIXI.Graphics();
  private tentacleG = new PIXI.Graphics();
  private tentacles: Array<{ x1: number; y1: number; x2: number; y2: number; age: number }> = [];
  private trailPts: Record<Side, Array<{ x: number; y: number; age: number }>> = { hero: [], enemy: [] };
  private trailTick: Record<Side, number> = { hero: 0, enemy: 0 };
  private heroFacing = 1;
  private enemyFacing = -1;
  private prevAir: Record<Side, boolean> = { hero: false, enemy: false };
  private lungeTarget: Record<Side, number> = { hero: 0, enemy: 0 };
  private pendingAttack: Record<Side, "attack1" | "attack2" | "attack3" | null> = { hero: null, enemy: null };
  private separation: Record<Side, number> = { hero: 0, enemy: 0 };
  private dodge: Record<Side, number> = { hero: 0, enemy: 0 };
  private insetLeft = 0;
  private camX = ARENA.w / 2;
  private footY: Record<Side, number> = { hero: ARENA.floorY, enemy: ARENA.floorY };
  private footV: Record<Side, number> = { hero: 0, enemy: 0 };
  private fallFrom: Record<Side, number> = { hero: ARENA.floorY, enemy: ARENA.floorY };
  private launchX: Record<Side, number> = { hero: 0, enemy: 0 };
  private launchVx: Record<Side, number> = { hero: 0, enemy: 0 };
  private launchBoost: Record<Side, number> = { hero: 0, enemy: 0 };
  private baseX: Record<Side, number> = { hero: 0, enemy: 0 };

  constructor(
    private readonly battle: CombatSource,
    sheet: PIXI.Spritesheet,
    enemySheet: PIXI.Spritesheet,
    hooks: PresenterHooks,
    heroChar = "martial",
    enemyChar = "samurai",
  ) {
    this.hooks = hooks;
    this.chars = { hero: characterOf(heroChar), enemy: characterOf(enemyChar) };
    this.fxLayer = new PixelFxLayer(0.45);
    this.hero = new HeroActor(sheet, 0x6fd3ff);
    this.enemy = new HeroActor(enemySheet, 0xff5c5c, 0xffb9b9);
    if (this.chars.hero.rig) this.hero.enableRig();
    if (this.chars.enemy.rig) this.enemy.enableRig();

    this.impact = new ImpactFx(ARENA.w, ARENA.h);
    this.overlay.eventMode = "none";
    this.overlay.visible = false;
    this.cutinText = new PIXI.Text({
      text: "",
      style: { fontFamily: "Courier New, monospace", fontSize: 44, fontWeight: "800", fill: 0xffffff, stroke: { color: 0x5a1a08, width: 4 } },
    });
    this.cutinText.anchor.set(0.5);
    this.koText = new PIXI.Text({
      text: "K.O.",
      style: { fontFamily: "Courier New, monospace", fontSize: 92, fontWeight: "900", fill: 0xffd45c, stroke: { color: 0x5a1a08, width: 8 } },
    });
    this.koText.anchor.set(0.5);
    this.cutinBg.addChild(this.cutinText);
    this.overlay.addChild(this.cutinBg, this.koText);
    this.world.addChildAt(this.aura, 0);

    this.world.addChild(createArena());
    this.world.addChild(this.markLayer);
    this.world.addChild(this.hero.root);
    this.world.addChild(this.enemy.root);
    for (const emitter of this.particles.emitters) this.world.addChild(emitter);
    this.world.addChild(this.fxLayer.container);
    this.world.addChild(this.floatLayer);
    this.world.addChild(this.impact.container);

    const snap = battle.snapshot();
    this.baseX.hero = this.slotToX(snap.hero.slot);
    this.baseX.enemy = this.slotToX(snap.enemy.slot);
    this.hero.x = this.baseX.hero;
    this.enemy.x = this.baseX.enemy;
    this.hero.update(0, this.hero.x, 1, snap.hero.statuses, terrainY(this.hero.x));
    this.enemy.update(0, this.enemy.x, -1, snap.enemy.statuses, terrainY(this.enemy.x));
  }

  /** 对局结束后清空残留特效，保证下一局从干净状态开始。 */
  clearEffects(): void {
    this.fxLayer.clear();
    this.impact.clear();
    this.hero.clearGhosts();
    this.enemy.clearGhosts();
    this.combo = 0;
    this.arcQueue = [];
    for (const p of this.projectiles) p.g.destroy();
    this.projectiles = [];
    this.comboOwner = null;
    this.comboTimer = 0;
    this.airCombo = { hero: 0, enemy: 0 };
    this.kdActive = { hero: false, enemy: false };
    this.hooks.onCombo?.(0, 0);
    for (const f of this.floats) f.text.destroy();
    this.floats = [];
    for (const m of this.marks) m.g.destroy();
    this.marks = [];
  }

  setViewport(w: number, h: number): void {
    this.viewport.w = Math.max(1, w);
    this.viewport.h = Math.max(1, h);
    this.applyCamera();
  }

  // ------------------------------------------------------------ events

  consume(events: BattleEvent[]): void {
    for (const ev of events) this.handle(ev);
  }

  private handle(ev: BattleEvent): void {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    switch (ev.type) {
      case "SKILL_START": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        const skill = String(ev.skill ?? "");
        const stance =
          skill === "hero_guard" || skill === "hero_read" || skill === "hero_step" || skill === "enemy_step";
        if (stance) {
          actor.playAttack("attack2");
        } else {
          // 攻击前：先 RUN 冲刺到对方 30px 处，到位才出招
          const foe = this.actor(side === "hero" ? "enemy" : "hero");
          const dir = Math.sign(foe.x - actor.x) || 1;
          const gap = Math.abs(foe.x - actor.x);
          const stop = ev.tier === "ultimate" ? 16 : ev.tier === "key" ? 22 : 28;
          this.lungeTarget[side] = dir * Math.max(0, gap - stop);
          const ranged = this.chars[side].projectile;
          // 真远程判定：只有远程技能发弹道；近身技能一律走突进/近战
          const useRanged = (skill.includes("ranged") || skill.includes("tentacle")) && gap > 36;
          if (useRanged) {
            this.lungeTarget[side] = 0;
            actor.playAttack(attackForSkill(skill));
            if (!skill.includes("tentacle")) this.spawnProjectile(side, ranged, foe.x, this.chars[side].element, skill.includes("_2"));
            else this.fxLayer.spawn("arcane/blink-in", foe.x, terrainY(foe.x) - 36, {}, 0.7, 1.0);
            this.pushLog(ev, "rule");
            break;
          }
          if (skill.includes("whirl")) this.fxLayer.spawn("melee/spin-slash", actor.x, terrainY(actor.x) - 40, {}, 0.8, 1.2);
          if (skill.includes("charge_punch")) this.fxLayer.spawn("lightning/charge-up", actor.x, terrainY(actor.x) - 40, {}, 0.7, 1.3);
          if (skill.includes("iai")) this.fxLayer.spawn("lightning/charge-up", actor.x, terrainY(actor.x) - 40, {}, 0.9, 1.2);
          const heavy = skill === "hero_earthhammer" ? "HAMMER" : skill === "hero_execute" ? "EXEC" : null;
          const attackKind =
            (skill === "enemy_slam" || skill === "hero_riposte") && actor.supportsAttack3
              ? "attack3"
              : attackForSkill(skill);
          this.pendingAttack[side] = heavy ? null : attackKind;
          const leanMap: Record<string, number> = {
            hero_thrust: 0.2, hero_execute: 0.22, hero_rend: 0.14,
            hero_earthhammer: -0.16, enemy_swipe: 0.15, enemy_slam: -0.18,
          };
          this.pendingLean[side] = leanMap[skill] ?? 0;
          if (heavy) {
            actor.play(`${heavy}_WINDUP` as HeroState, true);
            actor.setAttackLean(this.pendingLean[side]);
          }
          // 远距离时用飞跃入场；碎地锤/处决跳得更高，形成空中攻击
          const leap = skill === "hero_earthhammer" ? 82 : skill === "hero_execute" ? 96 : skill === "hero_thrust" ? 42 : 0;
          if (leap > 0 && gap > 55) actor.startJump(leap);
          if (!heavy) actor.play("RUN", true);
          actor.setSquash(0.95, 1.05); // 起手蓄力后仰
        }
        this.pushLog(ev, "rule");
        break;
      }
      case "PARRY": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        this.clashPulse(true);
        this.spawnFloat("弹反", (this.hero.x + this.enemy.x) / 2, terrainY(this.hero.x) - 70, "ultimate", false);
        this.freezeMs = Math.max(this.freezeMs, 280);
        this.fxLayer.spawn("impacts/parry", (this.hero.x + this.enemy.x) / 2, terrainY(this.hero.x) - 36, {}, 1.2, 1.8);
        void side;
        break;
      }
      case "PRIORITY_CLASH": {
        this.clashPulse(false);
        this.pushLog(ev, "clash");
        break;
      }
      case "HIT": {
        const tier = (ev.tier ?? "normal") as Tier;
        const targetSide: Side = d.to === "hero" ? "hero" : "enemy";
        const attackerSide: Side = d.from === "hero" ? "hero" : "enemy";
        const target = this.actor(targetSide);
        const attacker = this.actor(attackerSide);
        this.impactCue(tier, {
          target,
          attacker,
          targetSide,
          attackerSide,
          damage: Number(d.damage ?? 0),
          crit: d.crit === true,
          guard: d.guard === true,
          skill: String(ev.skill ?? ""),
          freezeFrames: typeof d.freezeFrames === "number" ? d.freezeFrames : undefined,
          fx: typeof d.fx === "string" ? d.fx : undefined,
        });
        this.pushLog(ev, "event");
        break;
      }
      case "DAMAGE":
        this.hooks.onLog({ frame: ev.frame, kind: "damage", text: ev.text });
        break;
      case "PUNISH": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        this.impact.trigger(actor.x, terrainY(actor.x) - 34, 1, "key", "thrust");
        this.camera.kick("key", side === "hero" ? 1 : -1);
        this.hooks.onBanner("确反", "combo");
        break;
      }
      case "DOWNED": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        this.kdActive[side] = true;
        this.knockdownCount++;
        actor.knockdown(side === "hero" ? 1 : -1);
        actor.setSquash(1.35, 0.55);
        // 倒地即冻结击飞物理，禁止继续滑行/乱飞
        this.launchX[side] = 0;
        this.launchVx[side] = 0;
        this.launchBoost[side] = 0;
        this.push[side] = 0;
        this.prevAir[side] = false;
        actor.startSpin(0);
        this.airCombo[side] = 0;
        const gy = terrainY(actor.x);
        this.impact.trigger(actor.x, gy - 6, 1, "key", "radial");
        this.impact.trigger(actor.x, gy - 6, -1, "key", "radial");
        this.fxLayer.spawn("impacts/heavy-landing", actor.x, gy, {}, 1.0, 1.2);
        flashScreen("strong");
        this.camera.kick("ultimate", side === "hero" ? 1 : -1);
        this.freezeMs = Math.max(this.freezeMs, 150);
        break;
      }
      case "GETUP": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        if (!this.kdActive[side]) break;
        this.kdActive[side] = false;
        this.ukemiCount++;
        actor.getup();
        actor.spawnGhost();
        actor.flashWhite(0.06);
        this.camera.kick("normal", side === "hero" ? 1 : -1);
        break;
      }
      case "MECHANIC": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        const text = this.mechanicShort(String(d.key ?? ""));
        this.impact.trigger(actor.x, terrainY(actor.x) - 34, 1, "key", "guard");
        break;
      }
      case "DODGE": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        const dir = Math.sign(actor.x - this.actor(side === "hero" ? "enemy" : "hero").x) || 1;
        this.dodge[side] = dir * 58;
        actor.spawnGhost();
        actor.setSquash(1.06, 0.94);
        this.camera.kick("normal", dir);
        this.hooks.onBanner("闪避", "reveal");
        break;
      }
      case "FX_CUE": {
        const side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        if (String(d.fx ?? "").includes("uppercut") || String(d.fx ?? "").includes("blink")) {
          actor.spawnGhost();
          actor.startJump(56);
        }
        const key = String(d.fx ?? "");
        if (key) {
          const mul = key.includes("blink") ? 0.28 : key.includes("uppercut") ? 0.8 : 1;
          this.fxLayer.spawn(key, actor.x, terrainY(actor.x) - 30, { flip: side === "enemy" }, 0.9, mul);
        }
        break;
      }
      case "DUEL_LOG":
        this.hooks.onLog({
          frame: ev.frame,
          kind: typeof d.hook === "string" && d.hook ? "combo" : "event",
          text: ev.text,
        });
        break;
      case "RULE_TRIGGER": {
        this.pushLog(ev, "rule");
        this.hooks.onRule?.(Number(d.ruleIndex ?? 0), ev.text, ev.side === "enemy" ? "enemy" : "hero");
        if (ev.side === "enemy" && typeof d.reveal === "string") {
          this.hooks.onBanner(d.reveal, "reveal");
        }
        break;
      }
      case "PARRY": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        this.clashPulse(true);
        this.spawnFloat("弹反", (this.hero.x + this.enemy.x) / 2, terrainY(this.hero.x) - 70, "ultimate", false);
        this.freezeMs = Math.max(this.freezeMs, 280);
        this.fxLayer.spawn("impacts/parry", (this.hero.x + this.enemy.x) / 2, terrainY(this.hero.x) - 36, {}, 1.2, 1.8);
        void side;
        break;
      }
      case "PRIORITY_CLASH": {
        this.pushLog(ev, "clash");
        this.hooks.onBanner(
          `规则[${d.winner}] 抢在 规则[${d.loser}] 前面触发：${d.winnerName} ＞ ${d.loserName}`,
          "clash",
        );
        break;
      }
      case "COMBO_STEP":
        this.pushLog(ev, "combo");
        if (d.completed) this.hooks.onBanner(ev.text, "combo");
        break;
      case "INTERRUPT_SUCCESS":
        this.pushLog(ev, "clash");
        this.hooks.onBanner("打断成功", "clash");
        this.fxLayer.spawn("impacts/blunt-hit", this.enemy.x, ARENA.floorY - 26, {}, 1.0);
        break;
      case "EXECUTE":
        this.pushLog(ev, "clash");
        this.hooks.onBanner("处决", "end");
        break;
      case "SWAP":
        this.hero.spawnGhost();
        this.enemy.spawnGhost();
        this.addMark(this.hero.x);
        this.addMark(this.enemy.x);
        this.settleMs = 260;
        this.hooks.onBanner("优先级抢断换位", "clash");
        break;
      case "KNOCKBACK":
        this.enemy.spawnGhost();
        this.addMark(this.enemy.x);
        this.settleMs = 240;
        break;
      case "MOVE": {
        if (String(d.kind ?? "step") === "dash") {
          this.hero.spawnGhost();
          this.addMark(this.hero.x);
          this.settleMs = 240;
        }
        break;
      }
      case "STATUS_APPLY": {
        this.pushLog(ev, "event");
        const status = String(d.status ?? "") as StatusId;
        const target = ev.side === "hero" ? this.hero : this.enemy;
        if (status === "stun") {
          this.fxLayer.spawn("status/stunned", target.x, ARENA.floorY - 52, {}, 1.0);
        } else if (status === "bleed") {
          this.fxLayer.spawn("status/bleeding", target.x, ARENA.floorY - 48, {}, 1.2);
        } else if (status === "charge") {
          this.fxLayer.spawn("lightning/charge-up", this.enemy.x, ARENA.floorY - 32, {}, 1.4);
          this.hooks.onBanner("敌人开始蓄力", "reveal");
        } else if (status === "read") {
          this.fxLayer.spawn("ui/exclamation", target.x, ARENA.floorY - 56, {}, 0.9);
        }
        break;
      }
      case "CRIT":
        this.hooks.onLog({ frame: ev.frame, kind: "event", text: ev.text });
        break;
      case "BATTLE_END":
        this.pushLog(ev, "system");
        this.koMs = 900;
        if (!this.ended) {
          this.ended = true;
          (this.battle.winner === "hero" ? this.enemy : this.hero).playDeath();
        }
        this.hooks.onEnd(this.battle.winner ?? "draw", this.battle.frame);
        break;
      default:
        break;
    }
  }

  /**
   * 统一命中 cue：顿帧 + 镜头 + 环形碎屑 + pixelfx + 飘字 + 分离 + 挤压。
   */
  private impactCue(
    tier: Tier,
    o: {
      target: HeroActor;
      attacker: HeroActor;
      targetSide: Side;
      attackerSide: Side;
      damage: number;
      crit: boolean;
      guard: boolean;
      skill: string;
      freezeFrames?: number;
      fx?: string;
    },
  ): void {
    const profile = TIERS[tier];
    if (tier === "ultimate") flashScreen("strong");
    const dir = Math.sign(o.target.x - o.attacker.x) || 1;

    // 编排模式：顿帧只由 pixelfx act.stop 派生的 freezeFrames 决定（0 = 不 freeze）
    const freezeFrames = o.freezeFrames ?? profile.hitstopFrames;
    this.freezeMs = Math.max(this.freezeMs, freezeFrames * FIXED_MS);
    this.camera.kick(tier, dir);
    if (profile.slowmoMs > 0) {
      this.slowmoMs = profile.slowmoMs;
      this.slowmoScale = profile.timeScale;
    }

    // 物理分离：攻击者后坐、受击者沿打击轴弹开，再弹回
    const sep = tier === "ultimate" ? 16 : tier === "key" ? 8 : 3;
    this.separation[o.targetSide] = dir * sep;
    this.separation[o.attackerSide] = -dir * sep * 0.5;
    this.lungeTarget[o.attackerSide] = 0;
    this.pendingAttack[o.attackerSide] = null;

    // 击飞：重击把目标打上天并向后推，落地由 actor 的重力结算
    const launchable = tier === "ultimate" || (o.fx ?? "").includes("hammer") || (o.fx ?? "").includes("scythe");
    if (launchable) {
      o.target.startJump(tier === "ultimate" ? 46 : 26);
      o.target.startSpin(dir * (tier === "ultimate" ? 7 : 4));
      this.launchX[o.targetSide] = 0;
      this.launchVx[o.targetSide] = 0;
      this.launchBoost[o.targetSide] = 0;
      this.launchVx[o.targetSide] = dir * (tier === "ultimate" ? 210 : 110);
      this.launchBoost[o.targetSide] = tier === "ultimate" ? 0.14 : 0.07;
    }

    o.target.play("HIT", true);
    o.attacker.setAttackLean(dir * 0.12);
    this.recoverAt[o.attackerSide] = this.battle.frame + 12;
    o.target.setHurt(dir);
    if (o.attackerSide === "hero" && (o.skill.includes("earthhammer") || o.skill.includes("execute"))) {
      const recovery = o.skill.includes("earthhammer") ? "HAMMER_RECOVERY" : "EXEC_RECOVERY";
      o.attacker.play(recovery as HeroState, true);
    }
    o.target.setSquash(1.12, 0.9);
    o.attacker.setSquash(1.05, 0.95);

    const x = o.target.x;
    const y = terrainY(o.target.x) - 30;
    if (this.chars[o.attackerSide].id === "wizard") {
      this.tentacles.push({ x1: o.attacker.x, y1: terrainY(o.attacker.x) - 42, x2: x, y2: y, age: 0 });
    }
    if (tier === "ultimate") this.fxLayer.spawn("impacts/impact-frame", x, y, {}, 0.9, 1.2);
    if (launchable) this.impact.directionalSpark(x, y, dir, tier === "ultimate", 0xffd27a);
    const arcColor = (o.fx ?? "").includes("scythe") ? 0xc77dff
      : (o.fx ?? "").includes("double-slash") ? 0xff6b6b
      : (o.fx ?? "").includes("hammer") ? 0xffe27a
      : 0x9fe8ff;
    const sparkColor = o.guard ? 0x7fd8ff
      : this.chars[o.attackerSide].element === "fire" ? 0xffb35c
      : this.chars[o.attackerSide].element === "ice" ? 0xc9f6ff
      : 0xffe14d;
    if ((o.skill ?? "").includes("special")) {
      const style = this.chars[o.attackerSide].meleeStyle;
      const mod = style === "blade" ? "melee/sword-slash" : style === "staff" ? "melee/spin-slash" : style === "bow" ? "melee/whip-crack" : "melee/uppercut";
      this.fxLayer.spawn(mod, x, y, { dir }, 1.0, 1.3);
      this.impact.styleBurst(style, x, y, dir, "ultimate", sparkColor);
      this.impact.elementBurst(x, y, this.chars[o.attackerSide].element);
      this.camera.kick("key", dir);
    } else if ((o.skill ?? "").includes("ranged")) {
      this.impact.elementBurst(x, y, this.chars[o.attackerSide].element);
    } else {
      this.impact.arc(x, y, dir, arcColor, tier === "ultimate" ? 38 : 30, dir > 0 ? -0.2 : 0.2);
      if ((o.skill ?? "").includes("iai")) this.impact.line(x, y, dir, 130, 0x9fe8ff);
      if ((o.skill ?? "").includes("uppercut")) this.impact.line(x, y, dir, 90, 0x9fe8ff, true);
      if (o.guard) {
        this.fxLayer.spawn("impacts/ricochet", x, y, { dir }, 0.8, 1.1);
        this.impact.clash(x, y, dir, tier === "ultimate");
        this.camera.kick(tier === "ultimate" ? "ultimate" : "key", dir);
        this.freezeMs = Math.max(this.freezeMs, tier === "ultimate" ? 250 : 140);
      } else if (this.chars[o.attackerSide].id === "martial") {
        this.impact.bluntBurst(x, y, dir, tier === "ultimate", 0xffffff);
        this.fxLayer.spawn("impacts/blunt-hit", x, y, { dir }, 0.7, 1.0);
      } else {
        this.impact.styleBurst(this.chars[o.attackerSide].meleeStyle, x, y, dir, tier, sparkColor);
      }
    }
    if (tier === "ultimate" && !(o.skill ?? "").includes("ranged")) {
      for (const delay of [4, 8]) {
        this.arcQueue.push({ at: this.battle.frame + delay, x, y, dir, color: arcColor, radius: 34 - delay });
      }
    }
    const count = tier === "normal" ? 8 : tier === "key" ? 10 : 12;
    this.particles.burst(x, y, count);
    this.impact.trigger(x, y, dir, tier, this.impactKind(o.fx, o.skill));
    if (!o.guard) {
      o.target.flashHit(tier === "ultimate" ? 0.95 : tier === "key" ? 0.6 : 0.32);
      o.attacker.spawnSmear(dir, o.attackerSide === "hero" ? 0xffffff : 0xffd0d0);

      // 连击 / 浮空追击 / 重击倒地
      if (o.damage > 0) {
        if (this.comboOwner === o.attackerSide) this.combo++;
        else {
          this.comboOwner = o.attackerSide;
          this.combo = 1;
        }
        this.comboTimer = 0.9;
        if (o.target.airborne) {
          this.airCombo[o.targetSide] = Math.min(9, this.airCombo[o.targetSide] + 1);
          o.target.startJump(14);
            } else {
          this.airCombo[o.targetSide] = 0;
        }
        this.hooks.onCombo?.(this.combo, this.airCombo[o.targetSide]);

      }
    }

    if (o.guard) {
      this.fxLayer.spawn("impacts/shield-block", x, y, { flip: dir < 0 }, 0.8);
      o.target.playAttack("attack2");
    } else {
      o.target.playHit();
      if (tier === "normal") {
        this.fxLayer.spawn("impacts/hit-spark", x, y, { flip: dir < 0 }, 0.35);
      } else {
        const fxKey = o.fx || SKILLS[o.skill as keyof typeof SKILLS]?.fx;
        if (fxKey) {
          const palette = this.paletteFor(fxKey);
          this.fxLayer.spawn(fxKey, x, y, palette ? { flip: dir < 0, palette } : { flip: dir < 0 }, 0.9);
        }
      }
      if (tier === "key" && o.crit) {
        this.fxLayer.spawn("impacts/crit-hit", x + dir * 6, y - 4, { flip: dir < 0 }, 0.9);
      }
      if (tier === "ultimate") {
        this.fxLayer.spawn("impacts/ground-slam", x, terrainY(o.target.x), {}, 0.7);
        this.startCutin(SKILLS[o.skill as keyof typeof SKILLS]?.name ?? "必杀");
      }
    }

    if (o.damage > 0 && tier === "ultimate") this.spawnFloat(`${o.damage}`, x, y - 8, tier, o.crit);
  }

  private clashPulse(strong: boolean): void {
    if (this.clashCd > 0) return;
    if (Math.abs(this.hero.x - this.enemy.x) > 170) return;
    this.clashCd = 0.35;
    const x = (this.hero.x + this.enemy.x) / 2;
    const y = terrainY(x) - 36;
    const dir = Math.sign(this.enemy.x - this.hero.x) || 1;
    this.impact.clash(x, y, dir, strong);
    this.fxLayer.spawn("impacts/parry", x, y, { dir }, 1.1, 1.5);
    this.push.hero = -dir * (strong ? 34 : 22);
    this.push.enemy = dir * (strong ? 34 : 22);
    flashScreen(strong ? "strong" : "normal");
    this.camera.kick(strong ? "ultimate" : "key", dir);
    this.freezeMs = Math.max(this.freezeMs, strong ? 250 : 150);
    this.spawnFloat(strong ? "振刀" : "拼刀", x, y - 30, strong ? "key" : "normal", false);
  }

  /** 武士刀光：沿刀尖位置画发光拖尾 + 残影 + 挥刀火花。 */
  private updateSlashTrails(dt: number): void {
    this.trailG.clear();
    for (const side of ["hero", "enemy"] as Side[]) {
      const actor = this.actor(side);
      const pts = this.trailPts[side];
      for (const p of pts) p.age += dt;
      const maxAge = this.chars[side].id === "samurai" ? 0.3 : 0.18;
      while (pts.length && pts[0].age > maxAge) pts.shift();

      const charId = this.chars[side].id;
      const samurai = charId === "samurai";
      const monk = charId === "martial";
      const attacking = actor.state.startsWith("ATTACK") || actor.state.endsWith("WINDUP") || actor.state.endsWith("RECOVERY");
      if ((samurai || monk) && attacking) {
        const facing = side === "hero" ? this.heroFacing : this.enemyFacing;
        pts.push({ x: actor.x + facing * (monk ? 22 : 34), y: terrainY(actor.x) - (monk ? 36 : 38), age: 0 });

        this.trailTick[side] += dt;
        if (this.trailTick[side] > 0.05) {
          this.trailTick[side] = 0;
          actor.spawnGhost();
          this.fxLayer.spawn("impacts/hit-spark", actor.x + facing * 30, terrainY(actor.x) - 40, {}, 0.35, 0.55);
        }
      }

      if (pts.length < 2) continue;
      const color = samurai ? 0x9fe8ff : 0xffcf5c;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const k = 1 - b.age / maxAge;
        this.trailG.moveTo(a.x, a.y).lineTo(b.x, b.y);
        this.trailG.stroke({ width: 3 + 7 * k, color, alpha: 0.16 + 0.3 * k });
      }
      const last = pts[pts.length - 1];
      // 刀尖处的发光月牙，补足单条折线的体积感
      this.trailG.setStrokeStyle({ width: 7, color, alpha: 0.28 });
      this.trailG.arc(last.x, last.y, 26, -1.15, 1.15);
      this.trailG.stroke();
      this.trailG.setStrokeStyle({ width: 2.5, color: 0xffffff, alpha: 0.75 });
      this.trailG.arc(last.x, last.y, 22, -0.85, 0.85);
      this.trailG.stroke();
    }
  }

  /** 跳跃落地冲击：双层环 + 灰尘 + 顿帧 + 震屏。 */
  private landingPulse(side: Side, speed: number): void {
    const actor = this.actor(side);
    this.launchX[side] = 0;
    this.launchVx[side] = 0;
    this.launchBoost[side] = 0;
    const gy = terrainY(actor.x);
    const heavy = speed > 260;
    this.impact.trigger(actor.x, gy - 4, 1, heavy ? "key" : "normal", "radial");
    this.impact.trigger(actor.x, gy - 4, -1, heavy ? "key" : "normal", "radial");
    this.fxLayer.spawn("impacts/heavy-landing", actor.x, gy, {}, 0.8, heavy ? 1.1 : 0.8);
    this.freezeMs = Math.max(this.freezeMs, heavy ? 130 : 66);
    this.camera.kick(heavy ? "key" : "normal", side === "hero" ? 1 : -1);
  }

  /** 法师触手：二次贝塞尔 + 摆动控制点，渐细线段。 */
  private drawTentacles(dt: number): void {
    this.tentacleG.clear();
    this.tentacles = this.tentacles.filter((t) => {
      t.age += dt;
      if (t.age > 0.4) return false;
      const k = 1 - t.age / 0.4;
      const mx = (t.x1 + t.x2) / 2;
      const my = (t.y1 + t.y2) / 2;
      const nx = -(t.y2 - t.y1);
      const ny = t.x2 - t.x1;
      const len = Math.hypot(nx, ny) || 1;
      const sway = Math.sin(t.age * 34) * 26 * k;
      const cx = mx + (nx / len) * sway;
      const cy = my + (ny / len) * sway - 18;
      let px = t.x1;
      let py = t.y1;
      for (let i = 1; i <= 12; i++) {
        const u = i / 12;
        const qx = (1 - u) * (1 - u) * t.x1 + 2 * (1 - u) * u * cx + u * u * t.x2;
        const qy = (1 - u) * (1 - u) * t.y1 + 2 * (1 - u) * u * cy + u * u * t.y2;
        this.tentacleG.moveTo(px, py).lineTo(qx, qy);
        this.tentacleG.stroke({ width: 7 * k * (1 - u * 0.5), color: 0x3b1d5e, alpha: 0.8 * k });
        this.tentacleG.moveTo(px, py - 2).lineTo(qx, qy - 2);
        this.tentacleG.stroke({ width: 2 * k, color: 0xb07cff, alpha: 0.7 * k });
        px = qx;
        py = qy;
      }
      return true;
    });
  }

  private spawnProjectile(side: Side, kind: "arrow" | "orb" | "swordwave" | "wave", targetX: number, element: "fire" | "thunder" | "ice", strong = false): void {
    const a = this.actor(side);
    const dir = Math.sign(targetX - a.x) || 1;
    const tint = element === "fire" ? 0xff7a1a : element === "thunder" ? 0xffe14d : 0x9fe8ff;
    let view!: PIXI.Container;
    let anim: PIXI.AnimatedSprite | undefined;
    const sheet = PIXI.Assets.get("assets/fx/fireball.png") as PIXI.Texture | undefined;
    if (kind === "orb" && sheet) {
      const frames: PIXI.Texture[] = [];
      for (let i = 0; i < 4; i++) {
        frames.push(new PIXI.Texture({ source: sheet.source, frame: new PIXI.Rectangle(i * 24, 128, 24, 16) }));
      }
      anim = new PIXI.AnimatedSprite(frames);
      anim.animationSpeed = 0.5;
      anim.loop = true;
      anim.play();
      anim.anchor.set(0.5);
      view = anim;
    } else {
      const g = new PIXI.Graphics();
    if (kind === "arrow") {
      g.setStrokeStyle({ width: 2, color: tint, alpha: 0.95 });
      g.moveTo(-14, 0).lineTo(10, 0);
      g.stroke();
      g.poly([10, -3, 16, 0, 10, 3]).fill({ color: 0xffffff });
      g.rect(-16, -3, 5, 2).fill({ color: 0xff8a5c });
    } else if (kind === "swordwave") {
      const big = this.chars[side].id === "samurai" ? PIXI.Assets.get("assets/fx/samurai-slash.png") as PIXI.Texture | undefined : undefined;
      if (big) {
        // 武士专属 200x200 大剑气（8 帧）
        const frames: PIXI.Texture[] = [];
        for (let i = 0; i < 8; i++) {
          frames.push(new PIXI.Texture({ source: big.source, frame: new PIXI.Rectangle(i * 200, 0, 200, 200) }));
        }
        anim = new PIXI.AnimatedSprite(frames);
        anim.anchor.set(0.5);
        anim.animationSpeed = 1.6;
        anim.loop = false;
        anim.play();
        view = anim;
        g.setStrokeStyle({ width: 1, color: tint, alpha: 0.01 });
      } else {
      // pixelfx 导出的 24 帧剑斩序列
      const sheet = PIXI.Assets.get("assets/fx/sword-slash.png") as PIXI.Texture | undefined;
      if (sheet) {
        const frames: PIXI.Texture[] = [];
        for (let i = 0; i < 24; i++) {
          frames.push(new PIXI.Texture({
            source: sheet.source,
            frame: new PIXI.Rectangle((i % 5) * 136, Math.floor(i / 5) * 104, 136, 104),
          }));
        }
        anim = new PIXI.AnimatedSprite(frames);
        anim.anchor.set(44 / 136, 92 / 104);
        anim.animationSpeed = 2.4;
        anim.loop = false;
        anim.play();
        view = anim;
        g.setStrokeStyle({ width: 1, color: tint, alpha: 0.01 });
      } else {
        g.setStrokeStyle({ width: 4, color: tint, alpha: 0.95, cap: "round" });
        g.arc(0, 0, 16, -0.75, 0.75);
        g.stroke();
      }
      }
    } else if (kind === "wave") {
      g.setStrokeStyle({ width: 3, color: tint, alpha: 0.9 });
      g.arc(0, 0, 9, -0.9, 0.9);
      g.stroke();
      g.setStrokeStyle({ width: 1.5, color: 0xffffff, alpha: 0.8 });
      g.arc(0, 0, 14, -0.7, 0.7);
      g.stroke();
    } else {
      g.circle(0, 0, 7).fill({ color: tint, alpha: 0.5 });
      g.circle(0, 0, 4).fill({ color: 0xd9c2ff });
      g.circle(0, 0, 1.5).fill({ color: 0xffffff });
    }
      view = view ?? g;
    }
    const x = a.x + dir * 18;
    const y = terrainY(a.x) - 34;
    view.position.set(x, y);
    const zoom = strong ? 2.6 : kind === "swordwave" && this.chars[side].id === "samurai" ? 2.2 : 1.6;
    view.scale.set(dir * zoom, zoom);
    this.world.addChild(view);
    this.projectiles.push({ g: view, owner: side, life: 0.3, max: 0.3, vx: (targetX - x) / 0.3, kind, anim });
  }

  private startCutin(name: string): void {
    this.cutinMs = 380;
    this.cutinName = name;
    this.overlay.visible = true;
  }

  private drawOverlay(dtMs: number): void {
    const w = this.viewport.w;
    const h = this.viewport.h;
    this.cutinBg.clear();
    if (this.cutinMs > 0) {
      this.cutinMs -= dtMs;
      const t = Math.max(0, Math.min(1, this.cutinMs / 380));
      this.cutinBg.rect(0, 0, w, h).fill({ color: 0x0b0d12, alpha: 0.42 * t });
      this.cutinText.text = this.cutinName;
      this.cutinText.position.set(w / 2, h * 0.42);
      this.cutinText.scale.set(1 + (1 - t) * 0.25);
      this.cutinText.alpha = Math.min(1, t * 2);
    } else {
      this.cutinText.alpha = 0;
    }
    if (this.koMs > 0) {
      this.koMs -= dtMs;
      const k = Math.max(0, Math.min(1, this.koMs / 900));
      this.koText.visible = true;
      this.koText.position.set(w / 2, h * 0.45);
      this.koText.scale.set(1 + (1 - k) * 0.15);
      this.koText.alpha = Math.min(1, k * 1.6);
    } else {
      this.koText.visible = false;
    }
    this.overlay.visible = this.cutinMs > 0 || this.koMs > 0;
  }

  private mechanicShort(key: string): string {
    const map: Record<string, string> = {
      "hero:desperate": "背水",
      "hero:bleed": "裂伤强化",
      "hero:bleed_tick": "流血双跳",
      "hero:insight": "识破返还",
      "hero:guard": "铁壁",
      "hero:interrupt": "打断强化",
      "enemy:heavy": "重锤强化",
      "enemy:pressure": "破防",
      "enemy:fast": "快刀二段",
      "enemy:early_charge": "震晕",
      "enemy:kite": "游走",
    };
    return map[key] ?? "机制";
  }

  /** 机制常驻提示：背水红光、格挡护盾、游走残影。 */
  private drawAuras(snap: BattleSnapshot): void {
    this.aura.clear();
    const pulse = 0.5 + Math.sin(this.clock * 8) * 0.5;
    const rules = this.battle as unknown as { heroRuleset?: { mechanic?: string } };
    const heroMech = rules.heroRuleset?.mechanic;

    if (heroMech === "desperate" && snap.hero.hp / snap.hero.maxHp < 0.4) {
      this.aura.circle(this.hero.x, this.footY.hero - 26, 24 + pulse * 4)
        .fill({ color: 0xff4d5e, alpha: 0.08 + pulse * 0.06 });
    }
    if (snap.hero.statuses.guard) {
      this.aura.arc(this.hero.x, this.footY.hero - 26, 24, -1.1, 1.1)
        .stroke({ width: 2, color: 0x7fd8ff, alpha: 0.55 });
    }
    if (snap.hero.statuses.evasion || snap.enemy.statuses.evasion) {
      const side: Side = snap.hero.statuses.evasion ? "hero" : "enemy";
      const actor = this.actor(side);
      this.aura.circle(actor.x, this.footY[side] - 22, 20)
        .stroke({ width: 2, color: 0x7ef2c4, alpha: 0.6 });
    }
  }

  /** 按特效键选择打击形状，避免所有技能共用一套放射线。 */
  private impactKind(fx?: string, skill?: string): ImpactKind {
    const key = fx ?? "";
    if (key.includes("hammer-smash") || key.includes("ground-slam")) return "hammer";
    if (key.includes("scythe-reap") || key.includes("dagger-flurry")) return "execute";
    if (key.includes("double-slash")) return "x";
    if (key.includes("spear-sweep") || skill === "enemy_swipe") return "swipe";
    if (key.includes("heavy-cleave")) return "heavy";
    if (key.includes("shield-block") || key.includes("parry")) return "guard";
    if (key.includes("thrust") || key.includes("uppercut")) return "thrust";
    return "radial";
  }

  /** 不同技能给不同色系，避免整套特效看起来一样。 */
  private paletteFor(fx?: string): string[] | undefined {
    if (!fx) return undefined;
    if (fx.includes("scythe-reap")) return ["#14061f", "#3d1560", "#7a2fbf", "#c77dff", "#efd6ff", "#ffffff"];
    if (fx.includes("double-slash")) return ["#20060b", "#5a1020", "#a01c2e", "#ff4d5e", "#ffb3b3", "#ffffff"];
    if (fx.includes("thrust") || fx.includes("uppercut")) return ["#06283d", "#0f4c75", "#1e88a8", "#55d6ff", "#c9f6ff", "#ffffff"];
    if (fx.includes("heavy-cleave")) return ["#0a2a12", "#155a2a", "#2f9e4f", "#7ef29d", "#d6ffe2", "#ffffff"];
    if (fx.includes("shield") || fx.includes("parry")) return ["#06282a", "#0f5550", "#1e8a80", "#4de0c8", "#c9fff5", "#ffffff"];
    return undefined;
  }

  private actor(side: Side): HeroActor {
    return side === "enemy" ? this.enemy : this.hero;
  }

  private pushLog(ev: BattleEvent, kind: LogEntry["kind"]): void {
    this.hooks.onLog({ frame: ev.frame, kind, text: ev.text });
  }

  private spawnFloat(text: string, x: number, y: number, tier: Tier, crit: boolean): void {
    const color = tier === "ultimate" ? 0xffe066 : tier === "key" ? 0xff8a5c : 0xd8e4ff;
    const t = new PIXI.Text({
      text,
      style: {
        fontFamily: "monospace",
        fontSize: crit ? 15 : 11,
        fontWeight: "bold",
        fill: color,
        stroke: { color: 0x090b10, width: 3 },
      },
    });
    t.resolution = 2;
    t.anchor.set(0.5);
    t.position.set(x + (crit ? 6 : 0), y);
    this.floatLayer.addChild(t);
    this.floats.push({ text: t, life: 0.7, max: 0.7 });
  }

  private addMark(x: number): void {
    const g = new PIXI.Graphics();
    g.ellipse(0, 0, 14, 4).fill({ color: 0x000000, alpha: 0.45 });
    g.position.set(x, ARENA.floorY + 1);
    this.markLayer.addChild(g);
    this.marks.push({ g, life: 1.0 });
  }

  setSpeed(speed: number): void {
    this.animScale = speed;
  }

  update(dtMs: number): void {
    const animMs = dtMs * this.animScale;
    this.time += animMs / 1000;
    this.impact.update(animMs);
    this.drawOverlay(animMs);
    this.drawTentacles(animMs / 1000);
    if (this.freezeMs > 0) {
      this.freezeMs -= dtMs;
      this.applyCamera();
      return;
    }

    const scale = this.slowmoMs > 0 ? this.slowmoScale : 1;
    if (this.slowmoMs > 0) this.slowmoMs -= dtMs;
    const dt = (animMs / 1000) * scale;
    this.clock += dt;

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.combo > 0) {
        this.combo = 0;
        this.comboOwner = null;
        this.hooks.onCombo?.(0, 0);
      }
    }

    const snap = this.battle.snapshot();
    const heroHome = this.slotToX(snap.hero.slot);
    const enemyHome = this.slotToX(snap.enemy.slot);

    // 前冲/退回收放
    for (const side of ["hero", "enemy"] as Side[]) {
      // 弹簧式冲刺：带加速/减速，避免匀速直线瞬移感
      const diff = this.lungeTarget[side] - this.lunge[side];
      const accel = diff * 120 - this.lungeVel[side] * 18;
      this.lungeVel[side] += accel * dt;
      this.lunge[side] += this.lungeVel[side] * dt;
      if (Math.abs(diff) < 0.6 && Math.abs(this.lungeVel[side]) < 3) {
        this.lunge[side] = this.lungeTarget[side];
        this.lungeVel[side] = 0;
      }

      if (this.pendingAttack[side] && Math.abs(diff) < 6) {
        this.actor(side).playAttack(this.pendingAttack[side]!);
        this.actor(side).setAttackLean(this.pendingLean[side]);
        this.pendingAttack[side] = null;
      }
      // 分离回弹
      this.separation[side] *= Math.exp(-dt * 12);
      this.dodge[side] *= Math.exp(-dt * 7);
    }

    // 基准位单独累积，绘制位 = 基准 + 前冲 + 分离（避免位移反馈叠加跑飞）
    this.baseX.hero = this.approach(this.baseX.hero, heroHome, dt);
    this.baseX.enemy = this.approach(this.baseX.enemy, enemyHome, dt);
    // 击飞：水平位移积分 + 落地回弹
    for (const side of ["hero", "enemy"] as Side[]) {
      if (this.launchBoost[side] > 0) {
        this.launchBoost[side] = Math.max(0, this.launchBoost[side] - dt);
        this.launchVx[side] += Math.sign(this.launchVx[side] || 1) * 260 * dt;
      }
      const vmax = 900;
      this.launchVx[side] = Math.max(-vmax, Math.min(vmax, this.launchVx[side]));
      this.launchX[side] += this.launchVx[side] * dt;
      if (Math.abs(this.launchX[side]) > 500) {
        this.launchX[side] = Math.sign(this.launchX[side]) * 500;
        this.launchVx[side] = 0;
      }
      this.launchVx[side] *= Math.exp(-dt * (this.launchBoost[side] > 0 ? 1.4 : 3.4));
      if (!this.actor(side).airborne) this.launchX[side] *= Math.exp(-dt * 4);
    }
    const clampX = (x: number): number => Math.max(26, Math.min(ARENA.w - 26, x));
    this.push.hero *= Math.exp(-dt * 9);
    this.push.enemy *= Math.exp(-dt * 9);
    let rawHero = this.baseX.hero + this.lunge.hero + this.separation.hero + this.dodge.hero + this.launchX.hero + this.push.hero;
    let rawEnemy = this.baseX.enemy + this.lunge.enemy + this.separation.enemy + this.dodge.enemy + this.launchX.enemy + this.push.enemy;
    // 防爆：任何 NaN/Infinity 立即回位
    if (!Number.isFinite(rawHero)) {
      this.baseX.hero = heroHome;
      this.lunge.hero = 0;
      this.launchX.hero = 0;
      this.push.hero = 0;
      rawHero = heroHome;
    }
    if (!Number.isFinite(rawEnemy)) {
      this.baseX.enemy = enemyHome;
      this.lunge.enemy = 0;
      this.launchX.enemy = 0;
      this.push.enemy = 0;
      rawEnemy = enemyHome;
    }
    const heroX = clampX(rawHero);
    const enemyX = clampX(rawEnemy);

    // 击飞撞到场地边界：反向弹回，并给一次重击标记
    for (const side of ["hero", "enemy"] as Side[]) {
      const raw = side === "hero" ? rawHero : rawEnemy;
      const vx = this.launchVx[side];
      const atLeft = raw < 26 && vx < -20;
      const atRight = raw > ARENA.w - 26 && vx > 20;
      if (atLeft || atRight) {
        this.launchVx[side] = -vx * 0.55;
        const wallX = atLeft ? 28 : ARENA.w - 28;
        this.impact.trigger(wallX, this.footY[side] - 30, atLeft ? 1 : -1, "key", "hammer");
        this.camera.kick("key", atLeft ? 1 : -1);
      }
    }

    // 高低柱：走出柱顶会掉落，落地给压缩/尘屑/硬直提示
    const feet: Record<Side, number> = { hero: heroX, enemy: enemyX };
    for (const side of ["hero", "enemy"] as Side[]) {
      const x = feet[side];
      const target = terrainY(x);
      const actor = this.actor(side);
      let fy = this.footY[side];
      if (actor.airborne) {
        fy = target;
        this.footV[side] = 0;
        this.fallFrom[side] = target;
      } else if (target < fy - 0.5) {
        // 走上更高的柱子：直接抬脚
        fy = target;
        this.footV[side] = 0;
        this.fallFrom[side] = target;
      } else if (target > fy + 0.5) {
        // 柱边掉落
        if (this.footV[side] === 0) this.fallFrom[side] = fy;
        this.footV[side] += 900 * dt;
        fy += this.footV[side] * dt;
        if (fy >= target) {
          const drop = target - this.fallFrom[side];
          fy = target;
          this.footV[side] = 0;
          actor.setSquash(1.22, 0.8);
          this.particles.burst(x, target - 2, 4);
          if (drop > 16) {
                  this.camera.kick("key", side === "hero" ? 1 : -1);
          }
        }
      } else {
        this.footV[side] = 0;
      }
      this.footY[side] = fy;
    }

    // 动态镜头：贴身推近、拉开拉远，KO 再推一档
    const gap = Math.abs(heroX - enemyX);
    const baseCover = Math.max(this.viewport.w / ARENA.w, this.viewport.h / ARENA.h);
    // 全屏跳跃：间距大时自动拉远，保证双方都在画面内
    let zoomTarget = Math.max(0.72, Math.min(1.35, this.viewport.w / (baseCover * (gap + 240))));
    if (this.combo >= 3) zoomTarget += 0.06;
    if (this.koMs > 0) zoomTarget = 1.55;
    this.camZoom += (zoomTarget - this.camZoom) * Math.min(1, 0.12);

    this.heroFacing = heroX <= enemyX ? 1 : -1;
    this.enemyFacing = -this.heroFacing;
    const heroFacing = this.heroFacing;

    for (const side of ["hero", "enemy"] as Side[]) {
      if (this.recoverAt[side] > 0 && snap.frame >= this.recoverAt[side]) {
        this.recoverAt[side] = 0;
        this.actor(side).setAttackLean(0);
      }
    }
    if (this.clashCd > 0) this.clashCd -= dt;
    this.hero.setMoving(Math.abs(this.lungeTarget.hero - this.lunge.hero) > 2);
    this.enemy.setMoving(Math.abs(this.lungeTarget.enemy - this.lunge.enemy) > 2);

    for (const p of this.projectiles) {
      p.life -= dt;
      p.g.x += p.vx * dt;
      p.g.alpha = Math.max(0, p.life / p.max);
    }
    this.projectiles = this.projectiles.filter((p) => {
      if (p.life <= 0) {
        p.g.destroy();
        return false;
      }
      return true;
    });

    this.hero.update(dt, heroX, heroFacing, snap.hero.statuses, this.footY.hero);
    this.enemy.update(dt, enemyX, -heroFacing, snap.enemy.statuses, this.footY.enemy);

    // 滞空时使用真实的 Jump/Fall 序列帧，而不是整体平移
    for (const side of ["hero", "enemy"] as Side[]) {
      const a = this.actor(side);
      if (a.airborne && a.state !== "ATTACK_1" && a.state !== "ATTACK_2" && a.state !== "HIT"
        && a.state !== "EXEC_WINDUP" && a.state !== "EXEC_RECOVERY" && a.state !== "HAMMER_WINDUP" && a.state !== "HAMMER_RECOVERY") {
        a.play(a.airRising ? "JUMP" : "FALL");
      }
    }

    for (const side of ["hero", "enemy"] as Side[]) {
      const a = this.actor(side);
      if (a.consumeLanded()) {
        this.particles.burst(a.x, terrainY(a.x) - 2, 4);
        this.camera.kick("normal", side === "hero" ? 1 : -1);
        if (this.airCombo[side] > 0) {
              this.airCombo[side] = 0;
          this.hooks.onCombo?.(this.combo, 0);
        }
      }

    }

    this.drawAuras(snap);
    if (this.arcQueue.length) {
      const due = this.arcQueue.filter((a) => snap.frame >= a.at);
      this.arcQueue = this.arcQueue.filter((a) => snap.frame < a.at);
      for (const a of due) {
        this.impact.arc(a.x, a.y, a.dir, a.color, a.radius, a.dir > 0 ? -0.2 : 0.2);
        this.particles.burst(a.x, a.y, 2);
      }
    }
    this.camera.update(dt);
    this.applyCamera();
    this.fxLayer.update(dt);
    this.particles.update(dtMs * scale);

    for (const f of this.floats) {
      f.life -= dt;
      f.text.y -= dt * 26;
      f.text.alpha = Math.max(0, f.life / f.max);
      if (f.life <= 0) f.text.destroy();
    }
    this.floats = this.floats.filter((f) => f.life > 0);

    for (const m of this.marks) {
      m.life -= dt;
      m.g.alpha = Math.max(0, m.life) * 0.7;
      if (m.life <= 0) m.g.destroy();
    }
    this.marks = this.marks.filter((m) => m.life > 0);

    if (this.settleMs > 0) this.settleMs = Math.max(0, this.settleMs - dtMs);

    this.hudAcc += dtMs;
    if (this.hudAcc >= 66) {
      this.hudAcc = 0;
      this.hooks.onSnapshot(snap);
    }
  }

  private approach(current: number, target: number, dt: number): number {
    const dx = target - current;
    if (Math.abs(dx) < 0.5) return target;
    return current + Math.sign(dx) * Math.min(Math.abs(dx), 620 * dt);
  }

  /** 左侧被编排面板遮住时，把可视中心右移，避免角色跑到面板后面。 */
  setInset(px: number): void {
    this.insetLeft = Math.max(0, px);
    this.applyCamera();
  }

  private applyCamera(): void {
    this.cover = Math.max(this.viewport.w / ARENA.w, this.viewport.h / ARENA.h);
    const halfView = this.viewport.w / Math.max(0.0001, this.cover * this.camZoom) / 2;
    const target = Math.max(halfView, Math.min(ARENA.w - halfView, (this.hero.x + this.enemy.x) / 2));
    this.camX += (target - this.camX) * Math.min(1, 0.12);
    this.camera.apply(this.world, this.viewport.w, this.viewport.h, this.cover, this.camX, this.camZoom);
    if (this.insetLeft > 0) this.world.x += this.insetLeft / 2;
  }

  /** 格点 → 屏幕世界坐标：视口越窄，间距越紧，保证双方永远在画面里。 */
  private slotToX(slot: number): number {
    const visibleW = this.viewport.w / Math.max(0.0001, this.cover);
    const i = Math.max(0, Math.min(SLOT_X.length - 1, Math.round(slot)));
    void visibleW;
    return SLOT_X[i];
  }

  get isSettling(): boolean {
    return this.settleMs > 0;
  }

  get frozen(): boolean {
    return this.freezeMs > 0;
  }

  debugState(): {
    frozen: boolean;
    freezeMs: number;
    slowmoMs: number;
    zoom: number;
    shake: number;
    effects: number;
    settleMs: number;
    heroState: HeroState;
    enemyState: HeroState;
    heroFrame: number;
    enemyFrame: number;
    heroHits: number;
    enemyHits: number;
    fxKeys: string[];
    impactActive: boolean;
    smears: number;
    airborne: boolean;
    airY: number;
    airCombo: number;
    ukemis: number;
    knockdowns: number;
    kdLeft: number;
    cutin: boolean;
    ko: boolean;
    camZoom: number;
    heroY: number;
    enemyY: number;
    cover: number;
    heroX: number;
    enemyX: number;
    heroVisible: boolean;
    enemyVisible: boolean;
    worldScale: number;
    pivotY: number;
    cutinName: string;
    overlayVisible: boolean;
    overlayChildren: number;
    projectiles: number;
  } {
    return {
      frozen: this.freezeMs > 0,
      freezeMs: Math.round(this.freezeMs),
      slowmoMs: Math.round(this.slowmoMs),
      zoom: Number(this.world.scale.x.toFixed(3)),
      shake: Number(this.camera.shakeAmount.toFixed(2)),
      effects: this.fxLayer.count,
      settleMs: Math.round(this.settleMs),
      heroState: this.hero.state,
      enemyState: this.enemy.state,
      heroFrame: this.hero.sprite.currentFrame,
      enemyFrame: this.enemy.sprite.currentFrame,
      heroHits: this.hero.hitFrameCount,
      enemyHits: this.enemy.hitFrameCount,
      fxKeys: this.fxLayer.spawnLog,
      impactActive: this.impact.active,
      smears: this.hero.smearCount + this.enemy.smearCount,
      airborne: this.hero.airborne || this.enemy.airborne,
      airY: Math.max(this.hero.airY, this.enemy.airY),
      airCombo: Math.max(this.airCombo.hero, this.airCombo.enemy),
      ukemis: this.ukemiCount,
      knockdowns: this.knockdownCount,
      kdLeft: Math.max(this.hero.kdLeft, this.enemy.kdLeft),
      cutin: this.cutinMs > 0,
      ko: this.koMs > 0,
      camZoom: this.camZoom,
      projectiles: this.projectiles.length,
      cutinName: this.cutinName,
      overlayVisible: this.overlay.visible,
      overlayChildren: this.overlay.children.length,
      heroY: this.footY.hero,
      enemyY: this.footY.enemy,
      cover: Number(this.cover.toFixed(2)),
      heroX: Math.round(this.hero.x),
      enemyX: Math.round(this.enemy.x),
      heroVisible: this.hero.sprite.visible && this.hero.sprite.alpha > 0,
      enemyVisible: this.enemy.sprite.visible && this.enemy.sprite.alpha > 0,
      worldScale: Number(this.world.scale.x.toFixed(2)),
      pivotY: Math.round((this.world.pivot.y as number) ?? 0),
    };
  }
}



















































































































