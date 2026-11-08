import * as PIXI from "pixi.js";
import type { Battle } from "../engine/battle.ts";
import { SKILLS } from "../engine/skills.ts";
import type { BattleEvent, LogEntry, StatusId, Tier } from "../engine/types.ts";
import { TIERS } from "../presentation/tiers.ts";
import { ARENA, createArena, slotX } from "./arena.ts";
import { CameraRig } from "./camera.ts";
import { PixelFxLayer } from "./fx.ts";
import { attackForSkill, HeroActor, type HeroState } from "./hero.ts";
import { HitParticles } from "./particles.ts";

export interface PresenterHooks {
  onLog(entry: LogEntry): void;
  onSnapshot(snapshot: ReturnType<Battle["snapshot"]>): void;
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
  private readonly flash: PIXI.Graphics;
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

  // 前冲 / 物理分离
  private lunge: Record<Side, number> = { hero: 0, enemy: 0 };
  private lungeTarget: Record<Side, number> = { hero: 0, enemy: 0 };
  private pendingAttack: Record<Side, "attack1" | "attack2" | null> = { hero: null, enemy: null };
  private separation: Record<Side, number> = { hero: 0, enemy: 0 };

  constructor(
    private readonly battle: Battle,
    sheet: PIXI.Spritesheet,
    hooks: PresenterHooks,
  ) {
    this.hooks = hooks;
    this.fxLayer = new PixelFxLayer(0.55);
    this.hero = new HeroActor(sheet, 0x6fd3ff);
    this.enemy = new HeroActor(sheet, 0xff5c5c, 0xffb9b9);

    this.flash = new PIXI.Graphics();
    this.flash.rect(0, 0, ARENA.w, ARENA.h).fill({ color: 0xffffff, alpha: 1 });
    this.flash.alpha = 0;
    this.flash.blendMode = "add";

    this.world.addChild(createArena());
    this.world.addChild(this.markLayer);
    this.world.addChild(this.hero.root);
    this.world.addChild(this.enemy.root);
    for (const emitter of this.particles.emitters) this.world.addChild(emitter);
    this.world.addChild(this.fxLayer.container);
    this.world.addChild(this.floatLayer);
    this.world.addChild(this.flash);

    const snap = battle.snapshot();
    this.hero.x = slotX(snap.hero.slot);
    this.enemy.x = slotX(snap.enemy.slot);
    this.hero.update(0, this.hero.x, 1, snap.hero.statuses, ARENA.floorY);
    this.enemy.update(0, this.enemy.x, -1, snap.enemy.statuses, ARENA.floorY);
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
          this.lungeTarget[side] = dir * Math.max(0, gap - 30);
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
        });
        this.pushLog(ev, "event");
        break;
      }
      case "DAMAGE":
        this.hooks.onLog({ frame: ev.frame, kind: "damage", text: ev.text });
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
        this.flash.alpha = 0.28;
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
    },
  ): void {
    const profile = TIERS[tier];
    const dir = Math.sign(o.target.x - o.attacker.x) || 1;

    this.freezeMs = Math.max(this.freezeMs, profile.hitstopFrames * FIXED_MS);
    this.camera.kick(tier, dir);
    if (profile.slowmoMs > 0) {
      this.slowmoMs = profile.slowmoMs;
      this.slowmoScale = profile.timeScale;
    }

    // 物理分离：攻击者后坐、受击者沿打击轴弹开，再弹回
    this.separation[o.targetSide] = dir * 1.5;
    this.separation[o.attackerSide] = -dir * 0.8;
    this.lungeTarget[o.attackerSide] = 0;
    this.pendingAttack[o.attackerSide] = null;

    o.target.setSquash(1.12, 0.9);
    o.attacker.setSquash(1.05, 0.95);

    const x = o.target.x;
    const y = ARENA.floorY - 30;
    const count = tier === "normal" ? 8 : tier === "key" ? 10 : 12;
    this.particles.burst(x, y, count);

    if (o.guard) {
      this.fxLayer.spawn("impacts/shield-block", x, y, { flip: dir < 0 }, 0.8);
      o.target.playAttack("attack2");
    } else {
      o.target.playHit();
      if (tier === "normal") {
        this.fxLayer.spawn("impacts/hit-spark", x, y, { flip: dir < 0 }, 0.35);
      } else {
        const fxKey = SKILLS[o.skill as keyof typeof SKILLS]?.fx;
        if (fxKey) this.fxLayer.spawn(fxKey, x, y, { flip: dir < 0 }, 0.9);
      }
      if (tier === "key" && o.crit) {
        this.fxLayer.spawn("impacts/crit-hit", x + dir * 6, y - 4, { flip: dir < 0 }, 0.9);
      }
      if (tier === "ultimate") {
        this.fxLayer.spawn("impacts/ground-slam", x, ARENA.floorY, {}, 0.7);
        this.flash.alpha = 0.2;
      }
    }

    if (o.damage > 0) this.spawnFloat(`${o.damage}`, x, y - 8, tier, o.crit);
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
    this.flash.alpha = Math.max(0, this.flash.alpha - (dtMs / 1000) * 3.2);

    if (this.freezeMs > 0) {
      this.freezeMs -= dtMs;
      this.applyCamera();
      return;
    }

    const scale = this.slowmoMs > 0 ? this.slowmoScale : 1;
    if (this.slowmoMs > 0) this.slowmoMs -= dtMs;
    const dt = (dtMs / 1000) * scale;

    const snap = this.battle.snapshot();
    const heroHome = slotX(snap.hero.slot);
    const enemyHome = slotX(snap.enemy.slot);

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

    const heroX = this.approach(this.hero.x, heroHome, dt) + this.lunge.hero + this.separation.hero;
    const enemyX = this.approach(this.enemy.x, enemyHome, dt) + this.lunge.enemy + this.separation.enemy;
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
    const cover = Math.max(this.viewport.w / ARENA.w, this.viewport.h / ARENA.h);
    this.camera.apply(this.world, this.viewport.w, this.viewport.h, cover);
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
    cover: number;
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
      cover: Number(Math.max(this.viewport.w / ARENA.w, this.viewport.h / ARENA.h).toFixed(2)),
    };
  }
}



