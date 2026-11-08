import type { BattleSnapshot } from "../engine/battle.ts";
import type { LogEntry, StatusId } from "../engine/types.ts";

const STATUS_LABEL: Record<StatusId, string> = {
  bleed: "流血",
  stun: "击晕",
  charge: "蓄力",
  imbalance: "失衡",
  guard: "格挡",
  riposte: "还击",
  iframes: "闪避",
  read: "看破",
};

const LOG_CLASS: Record<LogEntry["kind"], string> = {
  system: "k-system",
  rule: "k-rule",
  clash: "k-clash",
  event: "k-event",
  combo: "k-combo",
  reveal: "k-reveal",
  damage: "k-damage",
};

/** DOM HUD：血条、识破、状态、日志、横幅。 */
export class Hud {
  private heroHp = document.getElementById("hero-hp") as HTMLElement;
  private heroHpText = document.getElementById("hero-hp-text") as HTMLElement;
  private heroInsight = document.getElementById("hero-insight") as HTMLElement;
  private heroStatus = document.getElementById("hero-status") as HTMLElement;
  private enemyHp = document.getElementById("enemy-hp") as HTMLElement;
  private enemyHpText = document.getElementById("enemy-hp-text") as HTMLElement;
  private enemyStatus = document.getElementById("enemy-status") as HTMLElement;
  private log = document.getElementById("log") as HTMLElement;
  private bannerEl = document.getElementById("banner") as HTMLElement;
  private seedLabel = document.getElementById("seed-label") as HTMLElement;
  private bannerTimer = 0;

  reset(seed: number, ruleset: string): void {
    this.log.innerHTML = "";
    this.seedLabel.textContent = `seed ${seed} · 规则 ${ruleset}`;
    this.hideBanner();
  }

  updateSnapshot(snap: BattleSnapshot): void {
    this.setHp(this.heroHp, this.heroHpText, snap.hero.hp, snap.hero.maxHp);
    this.setHp(this.enemyHp, this.enemyHpText, snap.enemy.hp, snap.enemy.maxHp);

    const dots = "●".repeat(Math.max(0, snap.hero.insight)) + "○".repeat(Math.max(0, snap.hero.maxInsight - snap.hero.insight));
    this.heroInsight.textContent = `${dots} ${snap.hero.insight}/${snap.hero.maxInsight}`;

    this.setStatus(this.heroStatus, snap.hero.statuses);
    this.setStatus(this.enemyStatus, snap.enemy.statuses);
  }

  private setHp(bar: HTMLElement, text: HTMLElement, hp: number, max: number): void {
    const pct = Math.max(0, Math.min(1, hp / max));
    bar.style.width = `${(pct * 100).toFixed(1)}%`;
    text.textContent = `${hp}/${max}`;
    bar.classList.toggle("low", pct <= 0.35);
  }

  private setStatus(el: HTMLElement, statuses: Partial<Record<StatusId, number>>): void {
    const chips = Object.entries(statuses)
      .filter(([, frames]) => (frames ?? 0) > 0)
      .map(([id, frames]) => `<span class="chip c-${id}">${STATUS_LABEL[id as StatusId]} ${Math.ceil((frames as number) / 60 * 10) / 10}s</span>`)
      .join("");
    el.innerHTML = chips;
  }

  pushLog(entry: LogEntry): void {
    const line = document.createElement("div");
    line.className = `log-line ${LOG_CLASS[entry.kind] ?? "k-event"}`;
    const f = String(entry.frame).padStart(5, "0");
    line.textContent = `[${f}f] ${entry.text}`;
    this.log.appendChild(line);
    while (this.log.childElementCount > 400) this.log.removeChild(this.log.firstChild as HTMLElement);
    this.log.scrollTop = this.log.scrollHeight;
  }

  banner(text: string, kind: "clash" | "combo" | "reveal" | "end"): void {
    this.bannerEl.textContent = text;
    this.bannerEl.className = `show ${kind}`;
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.hideBanner(), kind === "end" ? 4200 : 1600);
  }

  private hideBanner(): void {
    this.bannerEl.className = "";
  }

  end(winner: string, frames: number, seed: number): void {
    const name = winner === "hero" ? "英雄获胜" : winner === "enemy" ? "敌人获胜" : "平局";
    this.banner(`${name} · ${(frames / 60).toFixed(2)}s · seed ${seed}`, "end");
  }
}
