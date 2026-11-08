import "./style.css";
import { Battle } from "./engine/battle.ts";
import type { PresenterHooks } from "./render/presenter.ts";
import { Game } from "./render/game.ts";
import { Hud } from "./ui/hud.ts";

async function boot(): Promise<void> {
  const stage = document.getElementById("stage");
  if (!stage) throw new Error("#stage missing");

  const hud = new Hud();
  const game = new Game();
  await game.init(stage);

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
  const rulesBtn = document.getElementById("rules-btn") as HTMLButtonElement;
  const rulesClose = document.getElementById("rules-close") as HTMLButtonElement;
  const shareBtn = document.getElementById("share-btn") as HTMLButtonElement;

  rulesBtn.addEventListener("click", () => hud.toggleRules());
  rulesClose.addEventListener("click", () => hud.toggleRules(false));

  const speeds = [1, 2, 4];
  let speedIdx = 0;

  // URL 参数：?seed=7&rules=C&enemy=ENEMY_B&speed=2 —— 一局就是一个可分享的链接
  const params = new URLSearchParams(window.location.search);
  const seedParam = Number.parseInt(params.get("seed") ?? "", 10);
  if (Number.isFinite(seedParam) && seedParam > 0) seedInput.value = String(seedParam);
  const rulesParam = params.get("rules");
  if (rulesParam === "A" || rulesParam === "B" || rulesParam === "C") rulesetSelect.value = rulesParam;
  const enemyParam = params.get("enemy");
  if (enemyParam === "ENEMY" || enemyParam === "ENEMY_B") enemySelect.value = enemyParam;
  const speedParam = Number.parseInt(params.get("speed") ?? "", 10);
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
    const ruleset = rulesetSelect.value === "B" ? "B" : rulesetSelect.value === "C" ? "C" : "A";
    const enemyRuleset = enemySelect.value === "ENEMY_B" ? "ENEMY_B" : "ENEMY";

    // 把当前对局写进 URL，刷新/分享都能还原
    const query = new URLSearchParams({
      seed: String(seed),
      rules: ruleset,
      enemy: enemyRuleset,
      speed: String(speeds[speedIdx]),
    });
    window.history.replaceState(null, "", `?${query.toString()}`);

    const battle = new Battle({ seed, heroRuleset: ruleset, enemyRuleset });

    // 同 seed 预演一局：开场日志里给出"预测结果"，实况结束时应当完全一致（确定性自证）
    const forecast = new Battle({ seed, heroRuleset: ruleset, enemyRuleset }).run();

    const heroLabel = ruleset === "A" ? "突刺优先" : ruleset === "B" ? "全格挡流" : "识破流";
    const enemyLabel = enemyRuleset === "ENEMY_B" ? "压制连锤" : "碎地重锤";
    hud.reset(seed, `${ruleset} ${heroLabel} · 敌方 ${enemyLabel}`);
    const forecastName = forecast.winner === "hero" ? "英雄" : forecast.winner === "enemy" ? "敌人" : "平局";
    hud.pushLog({
      frame: 0,
      kind: "system",
      text: `预演（同 seed 同规则）：${forecastName}胜 · 预计第 ${forecast.frames} 帧（${(forecast.frames / 60).toFixed(2)}s）结束 · 英雄剩 ${forecast.heroHp}/160`,
    });

    const hooks: PresenterHooks = {
      onLog: (entry) => hud.pushLog(entry),
      onSnapshot: (snapshot) => hud.updateSnapshot(snapshot),
      onBanner: (text, kind) => hud.banner(text, kind),
      onEnd: (winner, frames) => hud.end(winner, frames, seed),
      onRule: (index, _text, side) => hud.flashRule(side, index),
    };
    hud.setRules(battle.heroRuleset.rules, battle.enemyRuleset.rules, `英雄 ${ruleset} ${heroLabel} · 敌方 ${enemyLabel}`);
    game.play(battle, hooks);
  };

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
    if (e.key.toLowerCase() === "r") start();
    if (e.key.toLowerCase() === "t") hud.toggleRules();
  });

  start();
}

void boot();
