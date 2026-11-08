import * as PIXI from "pixi.js";
import type { Battle, BattleSnapshot } from "../engine/battle.ts";
import { SKILLS } from "../engine/skills.ts";
import type { BattleEvent, LogEntry, StatusId, Tier } from "../engine/types.ts";
import { TIERS } from "../presentation/tiers.ts";
import { ARENA, createArena, slotX } from "./arena.ts";
import { CameraRig } from "./camera.ts";
import { FighterView, weaponFor } from "./fighter.ts";
import { PixelFxLayer } from "./fx.ts";

export interface PresenterHooks {
  onLog(entry: LogEntry): void;
  onSnapshot(snapshot: BattleSnapshot): void;
  onBanner(text: string, kind: "clash" | "combo" | "reveal" | "end"): void;
  onEnd(winner: string, frames: number): void;
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
 * 演出层：订阅引擎事件，把它们翻译成 hitstop / 镜头 / 特效 / 位移。
 * 关键约束：hitstop 只冻结表现层时间缩放，战斗逻辑（引擎 step）照常推进。
 */
export class Presenter {
  readonly world = new PIXI.Container();
  private readonly fxLayer: PixelFxLayer;
  private readonly hero: FighterView;
  private readonly enemy: FighterView;
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

  constructor(
    private readonly battle: Battle,
    hooks: PresenterHooks,
  ) {
    this.hooks = hooks;
    this.fxLayer = new PixelFxLayer(0.7);
    this.hero = new FighterView("hero");
    this.enemy = new FighterView("enemy");

    this.flash = new PIXI.Graphics();
    this.flash.rect(0, 0, ARENA.w, ARENA.h).fill({ color: 0xffffff, alpha: 1 });
    this.flash.alpha = 0;
    this.flash.blendMode = "add";

    this.world.addChild(createArena());
    this.world.addChild(this.markLayer);
    this.world.addChild(this.hero.root);
    this.world.addChild(this.enemy.root);
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
        const f = this.fighter(ev.side ?? "hero");
        const windup = Number(d.windup ?? 10) / 60;
        const recovery = Number(d.recovery ?? 10) / 60;
        f.startAction(String(ev.skill ?? ""), windup, recovery);
        const w = weaponFor(String(ev.skill ?? ""));
        f.setWeapon(w.weaponKind, w.weaponLen);
        this.pushLog(ev, "rule");
        break;
      }
      case "HIT": {
        const tier = (ev.tier ?? "normal") as Tier;
        const profile = TIERS[tier];
        this.freezeMs = Math.max(this.freezeMs, profile.hitstopFrames * FIXED_MS);

        const target = this.fighter(String(d.to ?? "") as "hero" | "enemy");
        const attacker = this.fighter(String(d.from ?? "") as "hero" | "enemy");
        const dir = Math.sign(target.x - attacker.x) || 1;
        this.camera.kick(tier, dir);

        if (!d.guard) target.flashHit();

        const x = target.x;
        const y = ARENA.floorY - 24;
        const fxKey = SKILLS[ev.skill!]?.fx;

        if (d.guard === true) {
          this.fxLayer.spawn("impacts/shield-block", x, y, { flip: dir < 0 }, 1.0);
        } else if (tier === "normal") {
          // 普通命中：轻特效，不放大招式
          this.fxLayer.spawn("impacts/hit-spark", x, y, { flip: dir < 0 }, 0.5);
        } else if (fxKey) {
          this.fxLayer.spawn(fxKey, x, y, { flip: dir < 0 }, 1.6);
        }

        if (tier === "key" && d.crit === true) {
          this.fxLayer.spawn("impacts/crit-hit", x + dir * 6, y - 4, { flip: dir < 0 }, 1.2);
        }
        if (tier === "ultimate") {
          this.fxLayer.spawn("impacts/ground-slam", x, ARENA.floorY, {}, 1.2);
          this.slowmoMs = 450;
          this.flash.alpha = 0.22;
        }

        const dmg = Number(d.damage ?? 0);
        if (dmg > 0) this.spawnFloat(`${dmg}`, x, y - 6, tier, d.crit === true);

        // 命中时给目标一个短促的击退/后仰（不是空间转换）
        target.recoil = 1;
        this.pushLog(ev, "event");
        break;
      }
      case "DAMAGE": {
        this.hooks.onLog({ frame: ev.frame, kind: "damage", text: ev.text });
        break;
      }
      case "RULE_TRIGGER": {
        this.pushLog(ev, "rule");
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
        this.hero.spawnGhost(this.hero.x, 0x6fd3ff);
        this.enemy.spawnGhost(this.enemy.x, 0xff6b6b);
        this.addMark(this.hero.x);
        this.addMark(this.enemy.x);
        this.settleMs = 260;
        this.hooks.onBanner("优先级抢断换位", "clash");
        break;
      }
      case "KNOCKBACK": {
        this.enemy.spawnGhost(this.enemy.x, 0xff6b6b);
        this.addMark(this.enemy.x);
        this.settleMs = 240;
        this.fxLayer.spawn("impacts/ground-slam", this.enemy.x, ARENA.floorY, {}, 1.2);
        break;
      }
      case "MOVE": {
        const kind = String(d.kind ?? "step");
        if (kind === "dash") {
          this.hero.spawnGhost(this.hero.x, 0x6fd3ff);
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
          this.fxLayer.spawn("status/stunned", target.x, ARENA.floorY - 46, {}, 1.2);
        } else if (status === "bleed") {
          this.fxLayer.spawn("status/bleeding", target.x, ARENA.floorY - 42, {}, 1.4);
        } else if (status === "charge") {
          this.fxLayer.spawn("lightning/charge-up", this.enemy.x, ARENA.floorY - 28, {}, 1.6);
          this.hooks.onBanner("敌人开始蓄力", "reveal");
        } else if (status === "read") {
          this.fxLayer.spawn("ui/exclamation", target.x, ARENA.floorY - 50, {}, 1.0);
        }
        break;
      }
      case "CRIT": {
        this.hooks.onLog({ frame: ev.frame, kind: "event", text: ev.text });
        break;
      }
      case "BATTLE_END": {
        this.pushLog(ev, "system");
        this.hooks.onEnd(this.battle.winner ?? "draw", this.battle.frame);
        break;
      }
      default:
        break;
    }
  }

  private fighter(side: string): FighterView {
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
    const hx = this.approach(this.hero.x, slotX(snap.hero.slot), dt);
    const ex = this.approach(this.enemy.x, slotX(snap.enemy.slot), dt);
    const heroFacing = hx <= ex ? 1 : -1;

    this.hero.update(dt, hx, heroFacing, snap.hero.statuses, ARENA.floorY);
    this.enemy.update(dt, ex, -heroFacing, snap.enemy.statuses, ARENA.floorY);

    this.camera.update(dt);
    this.applyCamera();
    this.fxLayer.update(dt);

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

  /** 运行时探针：无头浏览器用它验证 hitstop / 镜头 / 慢放确实发生。 */
  debugState(): {
    frozen: boolean;
    freezeMs: number;
    slowmoMs: number;
    zoom: number;
    shake: number;
    effects: number;
    settleMs: number;
  } {
    return {
      frozen: this.freezeMs > 0,
      freezeMs: Math.round(this.freezeMs),
      slowmoMs: Math.round(this.slowmoMs),
      zoom: Number(this.world.scale.x.toFixed(3)),
      shake: Number(this.camera.shakeAmount.toFixed(2)),
      effects: this.fxLayer.count,
      settleMs: Math.round(this.settleMs),
    };
  }
}
