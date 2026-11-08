import * as PIXI from "pixi.js";

import { SKILLS } from "../engine/skills.ts";
import type { BattleEvent, BattleSnapshot, CombatSource, LogEntry, StatusId, Tier } from "../engine/types.ts";
import { TIERS } from "../presentation/tiers.ts";
import { ARENA, createArena, slotX } from "./arena.ts";
import { CameraRig } from "./camera.ts";
import { PixelFxLayer } from "./fx.ts";
import { attackForSkill, HeroActor, type HeroState } from "./hero.ts";
import { HitParticles } from "./particles.ts";
import { ImpactFx, type ImpactKind } from "./impact.ts";

export interface PresenterHooks {
  onLog(entry: LogEntry): void;
  onSnapshot(snapshot: BattleSnapshot): void;
  onBanner(text: string, kind: "clash" | "combo" | "reveal" | "end"): void;
  onEnd(winner: string, frames: number): void;
  onRule?: (ruleIndex: number, text: string, side: "hero" | "enemy") => void;
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
const LUNGE_SPEED = 180; // world px/s

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
  private readonly hooks: PresenterHooks;

  private floats: FloatText[] = [];
  private marks: Mark[] = [];
  private freezeMs = 0;
  private slowmoMs = 0;
  private slowmoScale = 0.3;
  private settleMs = 0;
  private time = 0;
  private hudAcc = 0;
  private ended = false;

  private viewport = { w: 960, h: 540 };
  private cover = 3;

  // 前冲 / 物理分离
  private lunge: Record<Side, number> = { hero: 0, enemy: 0 };
  private lungeTarget: Record<Side, number> = { hero: 0, enemy: 0 };
  private pendingAttack: Record<Side, "attack1" | "attack2" | null> = { hero: null, enemy: null };
  private separation: Record<Side, number> = { hero: 0, enemy: 0 };
  private baseX: Record<Side, number> = { hero: 0, enemy: 0 };

  constructor(
    private readonly battle: CombatSource,
    sheet: PIXI.Spritesheet,
    hooks: PresenterHooks,
  ) {
    this.hooks = hooks;
    this.fxLayer = new PixelFxLayer(0.45);
    this.hero = new HeroActor(sheet, 0x6fd3ff);
    this.enemy = new HeroActor(sheet, 0xff5c5c, 0xffb9b9);

    this.impact = new ImpactFx(ARENA.w, ARENA.h);

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
    this.hero.update(0, this.hero.x, 1, snap.hero.statuses, ARENA.floorY);
    this.enemy.update(0, this.enemy.x, -1, snap.enemy.statuses, ARENA.floorY);
  }

  /** 对局结束后清空残留特效，保证下一局从干净状态开始。 */
  clearEffects(): void {
    this.fxLayer.clear();
    this.impact.clear();
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
          this.lungeTarget[side] = dir * Math.max(0, gap - 40);
          this.pendingAttack[side] = attackForSkill(skill);
          actor.play("RUN", true);
          actor.setSquash(0.95, 1.05); // 起手蓄力后仰
        }
        this.pushLog(ev, "rule");
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
      case "FX_CUE": {
        const side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        const key = String(d.fx ?? "");
        if (key) {
          this.fxLayer.spawn(key, actor.x, ARENA.floorY - 30, { flip: side === "enemy" }, 0.9);
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
    const sep = tier === "ultimate" ? 4.5 : tier === "key" ? 2.5 : 1.2;
    this.separation[o.targetSide] = dir * sep;
    this.separation[o.attackerSide] = -dir * sep * 0.5;
    this.lungeTarget[o.attackerSide] = 0;
    this.pendingAttack[o.attackerSide] = null;

    o.target.setSquash(1.12, 0.9);
    o.attacker.setSquash(1.05, 0.95);

    const x = o.target.x;
    const y = ARENA.floorY - 30;
    const count = tier === "normal" ? 8 : tier === "key" ? 10 : 12;
    this.particles.burst(x, y, count);
    this.impact.trigger(x, y, dir, tier, this.impactKind(o.fx, o.skill));
    if (!o.guard) o.target.flashWhite(Math.max(0.07, this.freezeMs / 1000));

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
        this.fxLayer.spawn("impacts/ground-slam", x, ARENA.floorY, {}, 0.7);
      }
    }

    if (o.damage > 0) this.spawnFloat(`${o.damage}`, x, y - 8, tier, o.crit);
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

  update(dtMs: number): void {
    this.time += dtMs / 1000;
    this.impact.update(dtMs);

    if (this.freezeMs > 0) {
      this.freezeMs -= dtMs;
      this.applyCamera();
      return;
    }

    const scale = this.slowmoMs > 0 ? this.slowmoScale : 1;
    if (this.slowmoMs > 0) this.slowmoMs -= dtMs;
    const dt = (dtMs / 1000) * scale;

    const snap = this.battle.snapshot();
    const heroHome = this.slotToX(snap.hero.slot);
    const enemyHome = this.slotToX(snap.enemy.slot);

    // 前冲/退回收放
    for (const side of ["hero", "enemy"] as Side[]) {
      const step = LUNGE_SPEED * dt;
      const diff = this.lungeTarget[side] - this.lunge[side];
      this.lunge[side] += Math.sign(diff) * Math.min(Math.abs(diff), step);

      if (this.pendingAttack[side] && Math.abs(diff) < 4) {
        this.actor(side).playAttack(this.pendingAttack[side]!);
        this.pendingAttack[side] = null;
      }
      // 分离回弹
      this.separation[side] *= Math.exp(-dt * 12);
    }

    // 基准位单独累积，绘制位 = 基准 + 前冲 + 分离（避免位移反馈叠加跑飞）
    this.baseX.hero = this.approach(this.baseX.hero, heroHome, dt);
    this.baseX.enemy = this.approach(this.baseX.enemy, enemyHome, dt);
    const heroX = this.baseX.hero + this.lunge.hero + this.separation.hero;
    const enemyX = this.baseX.enemy + this.lunge.enemy + this.separation.enemy;
    const heroFacing = heroX <= enemyX ? 1 : -1;

    this.hero.setMoving(Math.abs(this.lungeTarget.hero - this.lunge.hero) > 2);
    this.enemy.setMoving(Math.abs(this.lungeTarget.enemy - this.lunge.enemy) > 2);

    this.hero.update(dt, heroX, heroFacing, snap.hero.statuses, ARENA.floorY);
    this.enemy.update(dt, enemyX, -heroFacing, snap.enemy.statuses, ARENA.floorY);

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

  private applyCamera(): void {
    this.cover = Math.max(this.viewport.w / ARENA.w, this.viewport.h / ARENA.h);
    this.camera.apply(this.world, this.viewport.w, this.viewport.h, this.cover);
  }

  /** 格点 → 屏幕世界坐标：视口越窄，间距越紧，保证双方永远在画面里。 */
  private slotToX(slot: number): number {
    const visibleW = this.viewport.w / Math.max(0.0001, this.cover);
    const spacing = Math.max(34, Math.min(56, (visibleW - 90) / 5));
    return ARENA.w / 2 + (slot - 2.5) * spacing;
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
    cover: number;
    heroX: number;
    enemyX: number;
    heroVisible: boolean;
    enemyVisible: boolean;
    worldScale: number;
    pivotY: number;
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

















