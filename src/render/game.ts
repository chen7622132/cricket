import * as PIXI from "pixi.js";
import type { Battle } from "../engine/battle.ts";
import { Presenter, type PresenterHooks } from "./presenter.ts";

const FIXED_MS = 1000 / 60;

/** 固定 60Hz 逻辑 + 可变帧率渲染。画布铺满左侧游戏区。 */
export class Game {
  private app: PIXI.Application | null = null;
  private readonly root = new PIXI.Container();
  private presenter: Presenter | null = null;
  private battle: Battle | null = null;
  private sheet: PIXI.Spritesheet | null = null;
  private acc = 0;
  private speed = 1;

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
    app.ticker.add((ticker) => this.tick(ticker.deltaMS));
    this.app = app;

    // Martial Hero 序列帧（CC0）打包成的 atlas + animations
    this.sheet = await PIXI.Assets.load<PIXI.Spritesheet>("assets/martial-hero/hero.json");
    for (const texture of Object.values(this.sheet.textures)) {
      texture.source.scaleMode = "nearest";
      texture.source.autoGenerateMipmaps = false;
      texture.source.update();
    }

    // 画布跟随父容器（resizeTo），渲染器尺寸变化时同步世界 cover 缩放
    app.renderer.on("resize", (w: number, h: number) => {
      this.presenter?.setViewport(w, h);
    });
  }

  play(battle: Battle, hooks: PresenterHooks): void {
    if (!this.sheet || !this.app) throw new Error("game not initialised");
    this.battle = battle;
    this.acc = 0;
    for (const child of this.root.removeChildren()) child.destroy({ children: true });
    this.presenter = new Presenter(battle, this.sheet, hooks);
    this.presenter.setViewport(this.app.screen.width, this.app.screen.height);
    this.root.addChild(this.presenter.world);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** 运行时探针（无头验证用）。 */
  debugState(): unknown {
    return this.presenter?.debugState() ?? null;
  }

  get currentBattle(): Battle | null {
    return this.battle;
  }

  private tick(dtMs: number): void {
    const battle = this.battle;
    const presenter = this.presenter;
    if (!battle || !presenter) return;

    if (!battle.done) {
      this.acc += dtMs * this.speed;
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
    presenter.update(dtMs);
  }
}
