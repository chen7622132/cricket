import * as PIXI from "pixi.js";

import { SKILLS } from "../engine/skills.ts";
import type { BattleEvent, BattleSnapshot, CombatSource, LogEntry, StatusId, Tier } from "../engine/types.ts";
import { TIERS } from "../presentation/tiers.ts";
import { ARENA, createArena, SLOT_X, slotX, terrainY } from "./arena.ts";
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
const LUNGE_SPEED = 320; // world px/s（冲刺速度，接近 BvN 的快速位移）

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
  private dodge: Record<Side, number> = { hero: 0, enemy: 0 };
  private insetLeft = 0;
  private camX = ARENA.w / 2;
  private footY: Record<Side, number> = { hero: ARENA.floorY, enemy: ARENA.floorY };
  private footV: Record<Side, number> = { hero: 0, enemy: 0 };
  private fallFrom: Record<Side, number> = { hero: ARENA.floorY, enemy: ARENA.floorY };
  private launchX: Record<Side, number> = { hero: 0, enemy: 0 };
  private launchVx: Record<Side, number> = { hero: 0, enemy: 0 };
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
    this.hero.update(0, this.hero.x, 1, snap.hero.statuses, terrainY(this.hero.x));
    this.enemy.update(0, this.enemy.x, -1, snap.enemy.statuses, terrainY(this.enemy.x));
  }

  /** 对局结束后清空残留特效，保证下一局从干净状态开始。 */
  clearEffects(): void {
    this.fxLayer.clear();
    this.impact.clear();
    this.hero.clearGhosts();
    this.enemy.clearGhosts();
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
          this.pendingAttack[side] = attackForSkill(skill);
          // 远距离时用飞跃入场；碎地锤/处决跳得更高，形成空中攻击
          const leap = skill === "hero_earthhammer" ? 34 : skill === "hero_execute" ? 40 : skill === "hero_thrust" ? 18 : 0;
          if (leap > 0 && gap > 55) actor.startJump(leap);
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
      case "DODGE": {
        const side: Side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        const dir = Math.sign(actor.x - this.actor(side === "hero" ? "enemy" : "hero").x) || 1;
        this.dodge[side] = dir * 58;
        actor.spawnGhost();
        actor.setSquash(1.06, 0.94);
        this.spawnFloat("闪避", actor.x, terrainY(actor.x) - 62, "normal", false);
        this.camera.kick("normal", dir);
        this.hooks.onBanner("闪避", "reveal");
        break;
      }
      case "FX_CUE": {
        const side = ev.side === "enemy" ? "enemy" : "hero";
        const actor = this.actor(side);
        if (String(d.fx ?? "").includes("uppercut") || String(d.fx ?? "").includes("blink")) {
          actor.spawnGhost();
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
    const sep = tier === "ultimate" ? 16 : tier === "key" ? 8 : 3;
    this.separation[o.targetSide] = dir * sep;
    this.separation[o.attackerSide] = -dir * sep * 0.5;
    this.lungeTarget[o.attackerSide] = 0;
    this.pendingAttack[o.attackerSide] = null;

    // 击飞：重击把目标打上天并向后推，落地由 actor 的重力结算
    const launchable = tier === "ultimate" || (o.fx ?? "").includes("hammer") || (o.fx ?? "").includes("scythe");
    if (launchable) {
      o.target.startJump(tier === "ultimate" ? 46 : 26);
      this.launchVx[o.targetSide] = dir * (tier === "ultimate" ? 150 : 80);
    }

    o.target.setSquash(1.12, 0.9);
    o.attacker.setSquash(1.05, 0.95);

    const x = o.target.x;
    const y = terrainY(o.target.x) - 30;
    const count = tier === "normal" ? 8 : tier === "key" ? 10 : 12;
    this.particles.burst(x, y, count);
    this.impact.trigger(x, y, dir, tier, this.impactKind(o.fx, o.skill));
    if (!o.guard) {
      o.target.flashWhite(Math.max(0.07, this.freezeMs / 1000));
      o.attacker.spawnSmear(dir, o.attackerSide === "hero" ? 0xffffff : 0xffd0d0);
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
      this.dodge[side] *= Math.exp(-dt * 7);
    }

    // 基准位单独累积，绘制位 = 基准 + 前冲 + 分离（避免位移反馈叠加跑飞）
    this.baseX.hero = this.approach(this.baseX.hero, heroHome, dt);
    this.baseX.enemy = this.approach(this.baseX.enemy, enemyHome, dt);
    // 击飞：水平位移积分 + 落地回弹
    for (const side of ["hero", "enemy"] as Side[]) {
      this.launchX[side] += this.launchVx[side] * dt;
      this.launchVx[side] *= Math.exp(-dt * 3.2);
      if (!this.actor(side).airborne) this.launchX[side] *= Math.exp(-dt * 4);
    }
    const clampX = (x: number): number => Math.max(26, Math.min(ARENA.w - 26, x));
    const rawHero = this.baseX.hero + this.lunge.hero + this.separation.hero + this.dodge.hero + this.launchX.hero;
    const rawEnemy = this.baseX.enemy + this.lunge.enemy + this.separation.enemy + this.dodge.enemy + this.launchX.enemy;
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
        this.spawnFloat("撞墙", wallX, this.footY[side] - 62, "key", false);
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
            this.spawnFloat("落地硬直", x, target - 58, "key", false);
            this.camera.kick("key", side === "hero" ? 1 : -1);
          }
        }
      } else {
        this.footV[side] = 0;
      }
      this.footY[side] = fy;
    }

    const heroFacing = heroX <= enemyX ? 1 : -1;

    this.hero.setMoving(Math.abs(this.lungeTarget.hero - this.lunge.hero) > 2);
    this.enemy.setMoving(Math.abs(this.lungeTarget.enemy - this.lunge.enemy) > 2);

    this.hero.update(dt, heroX, heroFacing, snap.hero.statuses, this.footY.hero);
    this.enemy.update(dt, enemyX, -heroFacing, snap.enemy.statuses, this.footY.enemy);

    for (const side of ["hero", "enemy"] as Side[]) {
      const a = this.actor(side);
      if (a.consumeLanded()) {
        this.particles.burst(a.x, terrainY(a.x) - 2, 4);
        this.camera.kick("normal", side === "hero" ? 1 : -1);
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
    const halfView = this.viewport.w / Math.max(0.0001, this.cover) / 2;
    const target = Math.max(halfView, Math.min(ARENA.w - halfView, (this.hero.x + this.enemy.x) / 2));
    this.camX += (target - this.camX) * Math.min(1, 0.12);
    this.camera.apply(this.world, this.viewport.w, this.viewport.h, this.cover, this.camX);
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
    heroY: number;
    enemyY: number;
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
      smears: this.hero.smearCount + this.enemy.smearCount,
      airborne: this.hero.airborne || this.enemy.airborne,
      airY: Math.max(this.hero.airY, this.enemy.airY),
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































