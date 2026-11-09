import * as PIXI from "pixi.js";
import type { CombatSource } from "../engine/types.ts";
import { Presenter, type PresenterHooks } from "./presenter.ts";
import { CHARACTERS } from "./characters.ts";

const FIXED_MS = 1000 / 60;

/** 固定 60Hz 逻辑 + 可变帧率渲染。画布铺满左侧游戏区。 */
export class Game {
  private app: PIXI.Application | null = null;
  private readonly root = new PIXI.Container();
  private presenter: Presenter | null = null;
  private battle: CombatSource | null = null;
  private sheets = new Map<string, PIXI.Spritesheet>();
  private acc = 0;
  private speed = 1;
  private doneMs = 0;
  private effectsCleared = false;

  async init(container: HTMLElement): Promise<void> {
    // 像素游戏：所有纹理默认最近邻采样
    PIXI.TextureSource.defaultOptions.scaleMode = "nearest";
    PIXI.TextureSource.defaultOptions.autoGenerateMipmaps = false;

    const app = new PIXI.Application();
    await app.init({
      resizeTo: container,
      background: 0x05070c,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      preference: "webgl",
    });
    container.appendChild(app.canvas);
    app.stage.addChild(this.root);
    app.ticker.maxFPS = 60;
    app.ticker.add((ticker) => this.tick(ticker.deltaMS));
    this.app = app;

    // 切后台暂停，回来时不补帧（避免一睁眼战斗已经打完）
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        app.ticker.stop();
      } else {
        this.acc = 0;
        app.ticker.start();
      }
    });

    // 换显示器 / 调缩放时，同步渲染分辨率
    window.addEventListener("resize", () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (Math.abs(app.renderer.resolution - dpr) > 0.01) {
        app.renderer.resolution = dpr;
        app.resize();
        this.presenter?.setViewport(app.screen.width, app.screen.height);
      }
    });

    // WebGL 上下文丢失（驱动崩溃/省电切换）：交给页面提示，而不是黑屏
    app.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("cricket-fatal", { detail: "WebGL 上下文丢失，请刷新页面" }));
    });

    // Martial Hero 序列帧（CC0）打包成的 atlas + animations
    await PIXI.Assets.load("assets/fx/fireball.png");
    for (const def of CHARACTERS) {
      const sheet = await PIXI.Assets.load<PIXI.Spritesheet>(def.sheetUrl);
      for (const texture of Object.values(sheet.textures)) {
        texture.source.scaleMode = "nearest";
        texture.source.autoGenerateMipmaps = false;
        texture.source.update();
      }
      this.sheets.set(def.id, sheet);
    }

    // 画布跟随父容器（resizeTo），渲染器尺寸变化时同步世界 cover 缩放
    app.renderer.on("resize", (w: number, h: number) => {
      this.presenter?.setViewport(w, h);
    });
  }

  play(battle: CombatSource, hooks: PresenterHooks, heroChar: string = "martial", enemyChar: string = "samurai"): void {
    if (this.sheets.size === 0 || !this.app) throw new Error("game not initialised");
    this.battle = battle;
    this.acc = 0;
    this.doneMs = 0;
    this.effectsCleared = false;
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    const heroSheet = this.sheets.get(heroChar) ?? this.sheets.get("martial")!;
    const enemySheet = this.sheets.get(enemyChar) ?? this.sheets.get("samurai") ?? heroSheet;
    this.presenter = new Presenter(battle, heroSheet, enemySheet, hooks, heroChar, enemyChar);
    this.presenter.setViewport(this.app.screen.width, this.app.screen.height);
    this.root.addChild(this.presenter.world);
    this.root.addChild(this.presenter.overlay);
  }

  /** 容器尺寸变化（例如收起日志栏）后重算画布与 cover 缩放。 */
  resize(): void {
    if (!this.app) return;
    this.app.resize();
    this.presenter?.setViewport(this.app.screen.width, this.app.screen.height);
  }

  setStageInset(px: number): void {
    this.presenter?.setInset(px);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** 运行时探针（无头验证用）。 */
  debugState(): unknown {
    return this.presenter?.debugState() ?? null;
  }

  get currentBattle(): CombatSource | null {
    return this.battle;
  }

  private tick(dtMs: number): void {
    const battle = this.battle;
    const presenter = this.presenter;
    if (!battle || !presenter) return;

    // 夹住异常大的帧间隔，防止切后台回来一次性快进
    const dt = Math.min(100, dtMs);

    if (!battle.done) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= FIXED_MS && steps < 16) {
        battle.step();
        this.acc -= FIXED_MS;
        steps++;
        if (battle.done) break;
      }
    }

    const events = battle.drainEvents();
    if (events.length) presenter.consume(events);
    presenter.update(dt);

    // 对局结束后 0.9s 清空残留特效（无定时器，靠帧累加）
    if (battle.done) {
      this.doneMs += dt;
      if (this.doneMs > 900 && !this.effectsCleared) {
        this.effectsCleared = true;
        presenter.clearEffects();
      }
    }
  }
}












