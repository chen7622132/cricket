import "./style.css";
import { Battle } from "./engine/battle.ts";
import { applyRuleOverrides, getRuleset, MECHANIC_LABEL, type Ruleset } from "./engine/rules.ts";
import { characterOf } from "./render/characters.ts";
import type { PresenterHooks } from "./render/presenter.ts";
import { Game } from "./render/game.ts";
import { RuleEditor } from "./ui/editor.ts";
import { Hud } from "./ui/hud.ts";
import { DuelSession } from "./duel/session.ts";
import { DuelPanel } from "./ui/duelPanel.ts";

async function boot(): Promise<void> {
  const stage = document.getElementById("stage");
  if (!stage) throw new Error("#stage missing");

  const bootEl = document.getElementById("boot") as HTMLElement;
  const bootText = document.getElementById("boot-text") as HTMLElement;
  const showFatal = (message: string): void => {
    bootEl.classList.remove("done");
    bootEl.classList.add("error");
    bootText.textContent = message;
  };
  window.addEventListener("cricket-fatal", (event) => {
    showFatal(String((event as CustomEvent).detail ?? "运行时错误，请刷新页面"));
  });

  const hud = new Hud();
  const game = new Game();
  try {
    await game.init(stage);
  } catch (err) {
    showFatal(`启动失败：${(err as Error).message}。请刷新重试。`);
    return;
  }
  bootEl.classList.add("done");

  // 运行时探针：给无头验证脚本读 presenter 状态（hitstop / 镜头 / 特效）
  (window as unknown as Record<string, unknown>).__cricket = {
    game,
    state: () => game.debugState(),
    battle: () => {
      const b = game.currentBattle;
      return b ? { frame: b.frame, done: b.done, winner: b.winner } : null;
    },
  };

  const seedInput = document.getElementById("seed-input") as HTMLInputElement;
  const rulesetSelect = document.getElementById("ruleset-select") as HTMLSelectElement;
  const enemySelect = document.getElementById("enemy-ruleset-select") as HTMLSelectElement;
  const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
  const speedBtn = document.getElementById("speed-btn") as HTMLButtonElement;
  const heroCharSelect = document.getElementById("hero-char") as HTMLSelectElement;
  const enemyCharSelect = document.getElementById("enemy-char") as HTMLSelectElement;
  const CHAR_IDS = ["martial", "boxer", "samurai", "huntress", "wizard", "skeleton"];
  const currentChars = (): { hero: string; enemy: string } => ({
    hero: CHAR_IDS.includes(heroCharSelect.value) ? heroCharSelect.value : "martial",
    enemy: CHAR_IDS.includes(enemyCharSelect.value) ? enemyCharSelect.value : "samurai",
  });
  heroCharSelect.value = "martial";
  enemyCharSelect.value = "samurai";
  const rulesBtn = document.getElementById("rules-btn") as HTMLButtonElement;
  const rulesClose = document.getElementById("rules-close") as HTMLButtonElement;
  const shareBtn = document.getElementById("share-btn") as HTMLButtonElement;
  const editBtn = document.getElementById("edit-btn") as HTMLButtonElement;
  const modeBtn = document.getElementById("mode-btn") as HTMLButtonElement;

  rulesBtn.addEventListener("click", () => hud.toggleRules());
  rulesClose.addEventListener("click", () => hud.toggleRules(false));

  type HeroId = "A" | "B" | "C" | "D" | "E";
  type EnemyId = "ENEMY" | "ENEMY_B" | "ENEMY_C" | "ENEMY_D" | "ENEMY_E";
  const HERO_IDS: HeroId[] = ["A", "B", "C", "D", "E"];
  const ENEMY_IDS: EnemyId[] = ["ENEMY", "ENEMY_B", "ENEMY_C", "ENEMY_D", "ENEMY_E"];
  const currentHeroId = (): HeroId => {
    const v = rulesetSelect.value as HeroId;
    return HERO_IDS.includes(v) ? v : "A";
  };

  let customRuleset: Ruleset | null = null;
  const editor = new RuleEditor((overrides, base) => {
    customRuleset = applyRuleOverrides(base, overrides);
    start();
  });

  editBtn.addEventListener("click", () => {
    editor.open(customRuleset ?? getRuleset(currentHeroId()));
  });
  rulesetSelect.addEventListener("change", () => {
    // 换基准表后旧的覆盖不再适用
    customRuleset = null;
  });

  const speeds = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
  let speedIdx = 3;

  // URL 参数：?seed=7&rules=C&enemy=ENEMY_B&speed=2 —— 一局就是一个可分享的链接
  const params = new URLSearchParams(window.location.search);
  const seedParam = Number.parseInt(params.get("seed") ?? "", 10);
  if (Number.isFinite(seedParam) && seedParam > 0) seedInput.value = String(seedParam);
  const rulesParam = params.get("rules");
  if (HERO_IDS.includes(rulesParam as HeroId)) rulesetSelect.value = rulesParam as HeroId;
  const enemyParam = params.get("enemy") as EnemyId;
  if (ENEMY_IDS.includes(enemyParam)) enemySelect.value = enemyParam;
  const heroCharParam = params.get("heroChar");
  if (heroCharParam && CHAR_IDS.includes(heroCharParam)) heroCharSelect.value = heroCharParam;
  const enemyCharParam = params.get("enemyChar");
  if (enemyCharParam && CHAR_IDS.includes(enemyCharParam)) enemyCharSelect.value = enemyCharParam;
  const speedParam = Number.parseFloat(params.get("speed") ?? "");
  if (speeds.includes(speedParam)) {
    speedIdx = speeds.indexOf(speedParam);
    game.setSpeed(speedParam);
    speedBtn.textContent = `${speedParam}×`;
  }

  shareBtn.addEventListener("click", async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      hud.banner("链接已复制，发给别人即可复现这一局", "reveal");
    } catch {
      window.prompt("复制这个链接：", url);
    }
  });

  const start = (): void => {
    const parsed = Number.parseInt(seedInput.value, 10);
    const seed = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const ruleset = currentHeroId();
    const enemyRuleset = ENEMY_IDS.includes(enemySelect.value as EnemyId)
    ? (enemySelect.value as EnemyId)
    : "ENEMY";
    const heroRules = customRuleset ?? ruleset;

    // 把当前对局写进 URL，刷新/分享都能还原
    const query = new URLSearchParams({
      seed: String(seed),
      rules: ruleset,
      enemy: enemyRuleset,
      speed: String(speeds[speedIdx]),
      heroChar: currentChars().hero,
      enemyChar: currentChars().enemy,
    });
    window.history.replaceState(null, "", `?${query.toString()}`);

    const chars = currentChars();
    const heroDef = characterOf(chars.hero);
    const enemyDef = characterOf(chars.enemy);
    const battle = new Battle({
      seed,
      heroRuleset: heroRules,
      enemyRuleset,
      heroElement: heroDef.element,
      enemyElement: enemyDef.element,
      heroRangedDamage: heroDef.rangedDamage,
      enemyRangedDamage: enemyDef.rangedDamage,
      heroRanged2: heroDef.rangedPrimary === true,
      heroTentacle: heroDef.id === "wizard",
      heroMonkCombo: heroDef.id === "martial" || heroDef.id === "boxer",
      heroBoxer: heroDef.id === "martial" || heroDef.id === "boxer",
      heroSamuraiKit: heroDef.id === "samurai",
      enemySamuraiKit: enemyDef.id === "samurai",
      enemyBoxer: enemyDef.id === "martial" || enemyDef.id === "boxer",
      enemyMonkCombo: enemyDef.id === "martial" || enemyDef.id === "boxer",
      enemyTentacle: enemyDef.id === "wizard",
      enemyRanged2: enemyDef.rangedPrimary === true,
    });

    // 同 seed 预演一局：开场日志里给出"预测结果"，实况结束时应当完全一致（确定性自证）
    const forecast = new Battle({
      seed,
      heroRuleset: heroRules,
      enemyRuleset,
      heroElement: heroDef.element,
      enemyElement: enemyDef.element,
      heroRangedDamage: heroDef.rangedDamage,
      enemyRangedDamage: enemyDef.rangedDamage,
      heroRanged2: heroDef.rangedPrimary === true,
      heroTentacle: heroDef.id === "wizard",
      heroMonkCombo: heroDef.id === "martial" || heroDef.id === "boxer",
      heroBoxer: heroDef.id === "martial" || heroDef.id === "boxer",
      heroSamuraiKit: heroDef.id === "samurai",
      enemySamuraiKit: enemyDef.id === "samurai",
      enemyBoxer: enemyDef.id === "martial" || enemyDef.id === "boxer",
      enemyMonkCombo: enemyDef.id === "martial" || enemyDef.id === "boxer",
      enemyTentacle: enemyDef.id === "wizard",
      enemyRanged2: enemyDef.rangedPrimary === true,
    }).run();

    const baseHeroLabel = getRuleset(ruleset).name;
    const enemyLabel = getRuleset(enemyRuleset).name;
    const heroTag = customRuleset ? `自定义（基于 ${ruleset} ${baseHeroLabel}）` : `${ruleset} ${baseHeroLabel}`;
    hud.reset(seed, `${heroTag} · 敌方 ${enemyLabel}`);
    const forecastName = forecast.winner === "hero" ? "英雄" : forecast.winner === "enemy" ? "敌人" : "平局";
    hud.pushLog({
      frame: 0,
      kind: "system",
      text: `预演（同 seed 同规则）：${forecastName}胜 · 预计第 ${forecast.frames} 帧（${(forecast.frames / 60).toFixed(2)}s）结束 · 英雄剩 ${forecast.heroHp}/160`,
    });
    hud.pushLog({
      frame: 0,
      kind: "system",
      text: `机制｜英雄：${MECHANIC_LABEL[battle.heroRuleset.mechanic]}｜敌方：${MECHANIC_LABEL[battle.enemyRuleset.mechanic]}`,
    });

    const hooks: PresenterHooks = {
      onLog: (entry) => hud.pushLog(entry),
      onSnapshot: (snapshot) => hud.updateSnapshot(snapshot),
      onBanner: (text, kind) => hud.banner(text, kind),
      onEnd: (winner, frames) => hud.end(winner, frames, seed),
      onRule: (index, _text, side) => hud.flashRule(side, index),
      onCombo: (n, air) => hud.setCombo(n, air),
    };
    hud.setRules(battle.heroRuleset.rules, battle.enemyRuleset.rules, `英雄 ${heroTag} · 敌方 ${enemyLabel}`);
    game.play(battle, hooks, chars.hero, chars.enemy);
  };

  // ---------------------------------------------------------- 编排对决模式

  const duel = new DuelSession();
  const duelHooks: PresenterHooks = {
    onLog: (entry) => hud.pushLog(entry),
    onSnapshot: (snapshot) => hud.updateSnapshot(snapshot),
    onBanner: (text, kind) => hud.banner(text, kind),
    onEnd: (winner, frames) => {
      hud.end(winner, frames, duel.runId, "run");
      duelPanel.render();
    },
    onRule: () => {},
    onCombo: (n, air) => hud.setCombo(n, air),
  };

  let duelSeed = 20260101;

  const duelPanel = new DuelPanel(duel, {
    onNewRun: (seed) => startDuelRound(seed),
    onResolve: () => {},
    onNext: () => startDuelRound(duelSeed + 1),
  });

  const duelSeedInput = document.getElementById("duel-seed") as HTMLInputElement;
  const duelNewBtn = document.getElementById("duel-new") as HTMLButtonElement;
  duelNewBtn.addEventListener("click", () => {
    const parsedSeed = Number.parseInt(duelSeedInput.value, 10);
    startDuelRound(Number.isFinite(parsedSeed) && parsedSeed > 0 ? parsedSeed : duelSeed);
  });

  function startDuelRound(seed: number): void {
    duelSeed = seed;
    duel.newRun(seed);
    hud.reset(seed, `编排对决 · seed ${seed} · run#${duel.runId}`);
    hud.pushLog({
      frame: 0,
      kind: "system",
      text: `seed=${seed} run#${duel.runId} · 敌方意图：${duel.intents.map((i) => `${i.icon}${i.name}`).join(" → ")}`,
    });
    duelPanel.render();
    const chars = currentChars();
    game.play(duel, duelHooks, chars.hero, chars.enemy);
  }

  let mode: "auto" | "duel" = "auto";

  function setMode(next: "auto" | "duel"): void {
    mode = next;
    const isDuel = next === "duel";
    document.body.classList.toggle("duel-mode", isDuel);
    modeBtn.textContent = isDuel ? "规则模式" : "编排模式";
    modeBtn.classList.toggle("mode-active", isDuel);
    if (isDuel) {
      duelPanel.show();
      syncStageInset();
      const fromUrl = Number.parseInt(new URLSearchParams(window.location.search).get("seed") ?? "", 10);
      startDuelRound(Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : duelSeed);
    } else {
      duelPanel.hide();
      syncStageInset();
      start();
    }
  }

  modeBtn.addEventListener("click", () => setMode(mode === "duel" ? "auto" : "duel"));

  // 编排面板展开时，把镜头可视中心右移，避免角色被面板挡住
  const duelUi = document.getElementById("duel-ui") as HTMLElement;
  const syncStageInset = (): void => {
    const visible = mode === "duel" && !duelUi.classList.contains("hidden");
    game.setStageInset(visible ? duelUi.offsetWidth + 8 : 0);
  };
  new ResizeObserver(syncStageInset).observe(duelUi);

  Object.assign((window as unknown as Record<string, unknown>).__cricket as object, {
    duel,
    duelPanel,
    startDuelRound,
    setMode,
    mode: () => mode,
  });

  // 日志边栏收起/展开（记住选择）
  const logToggle = document.getElementById("log-toggle") as HTMLButtonElement;
  let sidebarCollapsed = localStorage.getItem("cricket-sidebar") === "collapsed";
  const applySidebar = (collapsed: boolean, persist = true): void => {
    sidebarCollapsed = collapsed;
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    logToggle.textContent = collapsed ? "展开日志" : "收起日志";
    if (persist) localStorage.setItem("cricket-sidebar", collapsed ? "collapsed" : "open");
    requestAnimationFrame(() => game.resize());
  };
  logToggle.addEventListener("click", () => applySidebar(!sidebarCollapsed));
  applySidebar(sidebarCollapsed, false);

  runBtn.addEventListener("click", start);
  speedBtn.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    const s = speeds[speedIdx];
    game.setSpeed(s);
    speedBtn.textContent = `${s}×`;
  });
  seedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") start();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "r") (mode === "duel" ? startDuelRound(duelSeed) : start());
    if (e.key.toLowerCase() === "t") hud.toggleRules();
    if (e.key.toLowerCase() === "l") applySidebar(!sidebarCollapsed);
  });

  if (params.get("mode") === "duel") setMode("duel");
  else start();
}

void boot();






























