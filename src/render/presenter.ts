import * as PIXI from "pixi.js";
import type { Battle, BattleSnapshot } from "../engine/battle.ts";
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
  onSnapshot(snapshot: BattleSnapshot): void;
  onBanner(text: string, kind: "clash" | "combo" | "reveal" | "end"): void;
  onEnd(winner: string, frames: number): void;
  /** 规则触发时回调，用于在规则表面板上高亮当前规则 */
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

const FIXED_MS = 1000 / 60;

/**
 * 演出层：订阅引擎事件，把它们翻译成 hitstop / 镜头 / 粒子 / 特效 / 位移。
 *
 * 一次命中只走一个入口 `impactCue()`：顿帧、推镜、粒子、pixelfx、飘字、受击动画
 * 都从同一个调用发出，不在事件处理里散落。
 * hitstop 只冻结表现层时间缩放，战斗逻辑（引擎 step）照常推进。
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
  private settleMs = 0;
  private time = 0;
  private hudAcc = 0;
  private ended = false;

  constructor(
    private readonly battle: Battle,
    sheet: PIXI.Spritesheet,
    hooks: PresenterHooks,
  ) {
    this.hooks = hooks;
    this.fxLayer = new PixelFxLayer(0.7);
    this.hero = new HeroActor(sheet);
    this.enemy = new HeroActor(sheet, 0xffb9b9);

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

  // ------------------------------------------------------------ events

  consume(events: BattleEvent[]): void {
    for (const ev of events) this.handle(ev);
  }

  private handle(ev: BattleEvent): void {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    switch (ev.type) {
      case "SKILL_START": {
        const actor = this.actor(ev.side ?? "hero");
        const skill = String(ev.skill ?? "");
        actor.playAttack(attackForSkill(skill));
        this.pushLog(ev, "rule");
        break;
      }
      case "HIT": {
        const tier = (ev.tier ?? "normal") as Tier;
        const target = this.actor(String(d.to ?? "") as "hero" | "enemy");
        const attacker = this.actor(String(d.from ?? "") as "hero" | "enemy");
        this.impactCue(tier, {
          target,
          attacker,
          damage: Number(d.damage ?? 0),
          crit: d.crit === true,
          guard: d.guard === true,
          skill: String(ev.skill ?? ""),
        });
        this.pushLog(ev, "event");
        break;
      }
      case "DAMAGE": {
        this.hooks.onLog({ frame: ev.frame, kind: "damage", text: ev.text });
        break;
      }
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
        const w = d.winnerName ?? "";
        const l = d.loserName ?? "";
        this.hooks.onBanner(`规则[${d.winner}] 抢在 规则[${d.loser}] 前面触发：${w} ＞ ${l}`, "clash");
        break;
      }
      case "COMBO_STEP": {
        this.pushLog(ev, "combo");
        if (d.completed) this.hooks.onBanner(ev.text, "combo");
        break;
      }
      case "INTERRUPT_SUCCESS": {
        this.hooks.onBanner("打断成功", "clash");
        this.fxLayer.spawn("impacts/blunt-hit", this.enemy.x, ARENA.floorY - 26, {}, 1.2);
        break;
      }
      case "EXECUTE": {
        this.hooks.onBanner("处决", "end");
        this.flash.alpha = 0.3;
        break;
      }
      case "SWAP": {
        this.hero.spawnGhost();
        this.enemy.spawnGhost();
        this.addMark(this.hero.x);
        this.addMark(this.enemy.x);
        this.settleMs = 260;
        this.hooks.onBanner("优先级抢断换位", "clash");
        break;
      }
      case "KNOCKBACK": {
        this.enemy.spawnGhost();
        this.addMark(this.enemy.x);
        this.settleMs = 240;
        this.fxLayer.spawn("impacts/ground-slam", this.enemy.x, ARENA.floorY, {}, 1.2);
        break;
      }
      case "MOVE": {
        const kind = String(d.kind ?? "step");
        if (kind === "dash") {
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
          this.fxLayer.spawn("status/stunned", target.x, ARENA.floorY - 52, {}, 1.2);
        } else if (status === "bleed") {
          this.fxLayer.spawn("status/bleeding", target.x, ARENA.floorY - 48, {}, 1.4);
        } else if (status === "charge") {
          this.fxLayer.spawn("lightning/charge-up", this.enemy.x, ARENA.floorY - 32, {}, 1.6);
          this.hooks.onBanner("敌人开始蓄力", "reveal");
        } else if (status === "read") {
          this.fxLayer.spawn("ui/exclamation", target.x, ARENA.floorY - 56, {}, 1.0);
        }
        break;
      }
      case "CRIT": {
        this.hooks.onLog({ frame: ev.frame, kind: "event", text: ev.text });
        break;
      }
      case "BATTLE_END": {
        this.pushLog(ev, "system");
        if (!this.ended) {
          this.ended = true;
          const loser = this.battle.winner === "hero" ? this.enemy : this.hero;
          loser.playDeath();
        }
        this.hooks.onEnd(this.battle.winner ?? "draw", this.battle.frame);
        break;
      }
      default:
        break;
    }
  }

  /**
   * 统一命中 cue：顿帧 + 镜头 + 粒子 + pixelfx + 飘字 + 受击动画。
   * 所有命中只从这里进，避免散落的 setTimeout / 重复触发。
   */
  private impactCue(
    tier: Tier,
    opts: { target: HeroActor; attacker: HeroActor; damage: number; crit: boolean; guard: boolean; skill: string },
  ): void {
    const profile = TIERS[tier];
    const dir = Math.sign(opts.target.x - opts.attacker.x) || 1;

    this.freezeMs = Math.max(this.freezeMs, profile.hitstopFrames * FIXED_MS);
    this.camera.kick(tier, dir);

    const x = opts.target.x;
    const y = ARENA.floorY - 28;

    // 粒子：普通命中少量，关键判定才放大
    const count = tier === "normal" ? 12 : tier === "key" ? 34 : 64;
    this.particles.burst(x, y, count);

    if (opts.guard) {
      this.fxLayer.spawn("impacts/shield-block", x, y, { flip: dir < 0 }, 1.0);
      opts.target.playAttack("attack2");
    } else {
      opts.target.playHit();
      if (tier === "normal") {
        this.fxLayer.spawn("impacts/hit-spark", x, y, { flip: dir < 0 }, 0.5);
      } else {
        const fxKey = SKILLS[opts.skill as keyof typeof SKILLS]?.fx;
        if (fxKey) this.fxLayer.spawn(fxKey, x, y, { flip: dir < 0 }, 1.6);
      }
      if (tier === "key" && opts.crit) {
        this.fxLayer.spawn("impacts/crit-hit", x + dir * 6, y - 4, { flip: dir < 0 }, 1.2);
      }
      if (tier === "ultimate") {
        this.fxLayer.spawn("impacts/ground-slam", x, ARENA.floorY, {}, 1.2);
        this.slowmoMs = 450;
        this.flash.alpha = 0.22;
      }
    }

    if (opts.damage > 0) this.spawnFloat(`${opts.damage}`, x, y - 6, tier, opts.crit);
  }

  private actor(side: string): HeroActor {
    return side === "enemy" ? this.enemy : this.hero;
  }

  private pushLog(ev: BattleEvent, kind: LogEntry["kind"]): void {
    this.hooks.onLog({ frame: ev.frame, kind, text: ev.text });
  }

  // ------------------------------------------------------------ visuals

  private spawnFloat(text: string, x: number, y: number, tier: Tier, crit: boolean): void {
    const color = tier === "ultimate" ? 0xffe066 : tier === "key" ? 0xff8a5c : 0xd8e4ff;
    const t = new PIXI.Text({
      text,
      style: {
        fontFamily: "monospace",
        fontSize: crit ? 16 : 12,
        fontWeight: "bold",
        fill: color,
        stroke: { color: 0x090b10, width: 3 },
      },
    });
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
    this.marks.push({ g, life: 1.1 });
  }

  update(dtMs: number): void {
    this.time += dtMs / 1000;
    this.flash.alpha = Math.max(0, this.flash.alpha - (dtMs / 1000) * 3.2);

    if (this.freezeMs > 0) {
      this.freezeMs -= dtMs;
      this.applyCamera();
      return;
    }

    const scale = this.slowmoMs > 0 ? 0.35 : 1;
    if (this.slowmoMs > 0) this.slowmoMs -= dtMs;
    const dt = (dtMs / 1000) * scale;

    const snap = this.battle.snapshot();
    const heroTarget = slotX(snap.hero.slot);
    const enemyTarget = slotX(snap.enemy.slot);
    const hx = this.approach(this.hero.x, heroTarget, dt);
    const ex = this.approach(this.enemy.x, enemyTarget, dt);
    const heroFacing = hx <= ex ? 1 : -1;

    // 位移 → RUN 动画；停下 → IDLE（攻击中不切）
    this.hero.setMoving(Math.abs(heroTarget - this.hero.x) > 2);
    this.enemy.setMoving(Math.abs(enemyTarget - this.enemy.x) > 2);

    this.hero.update(dt, hx, heroFacing, snap.hero.statuses, ARENA.floorY);
    this.enemy.update(dt, ex, -heroFacing, snap.enemy.statuses, ARENA.floorY);

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
    const step = Math.sign(dx) * Math.min(Math.abs(dx), 620 * dt);
    return current + step;
  }

  private applyCamera(): void {
    this.camera.apply(this.world, ARENA.w, ARENA.h);
  }

  get isSettling(): boolean {
    return this.settleMs > 0;
  }

  get frozen(): boolean {
    return this.freezeMs > 0;
  }

  /** 运行时探针：无头浏览器用它验证 hitstop / 镜头 / 动画状态。 */
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
    };
  }
}
