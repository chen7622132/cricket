import type { DuelSession } from "../duel/session.ts";
import type { SkillId } from "../engine/types.ts";

interface Handlers {
  onCompose: () => void;
  onResolve: () => void;
  onNext: () => void;
}

/**
 * 编排面板：敌方意图（公开）→ 手牌 → 4 槽 → 结算。
 * 支持拖拽与点击两种放置方式（移动端也能用）。
 */
export class DuelPanel {
  private readonly panel = document.getElementById("duel-ui") as HTMLElement;
  private readonly runEl = document.getElementById("duel-run") as HTMLElement;
  private readonly intentsEl = document.getElementById("duel-intents") as HTMLElement;
  private readonly cardsEl = document.getElementById("duel-cards") as HTMLElement;
  private readonly slotsEl = document.getElementById("duel-slots") as HTMLElement;
  private readonly statusEl = document.getElementById("duel-status") as HTMLElement;
  private readonly composeBtn = document.getElementById("duel-compose") as HTMLButtonElement;
  private readonly startBtn = document.getElementById("duel-start") as HTMLButtonElement;
  private readonly nextBtn = document.getElementById("duel-next") as HTMLButtonElement;

  private selected: SkillId | null = null;

  constructor(
    private readonly session: DuelSession,
    private readonly handlers: Handlers,
  ) {
    this.composeBtn.addEventListener("click", () => {
      this.session.beginCompose();
      this.handlers.onCompose();
      this.render();
    });
    this.startBtn.addEventListener("click", () => {
      if (this.session.startResolution()) {
        this.handlers.onResolve();
        this.render();
      }
    });
    this.nextBtn.addEventListener("click", () => this.handlers.onNext());
  }

  show(): void {
    this.panel.classList.remove("hidden");
  }

  hide(): void {
    this.panel.classList.add("hidden");
  }

  render(): void {
    const s = this.session;
    const locked = s.phase === "RESOLUTION";

    this.runEl.textContent = `run#${s.runId}`;
    this.intentsEl.innerHTML = s.intents
      .map(
        (intent, i) =>
          `<div class="intent"><b>${intent.icon}</b><span>${intent.name}</span><i>${i + 1}</i></div>`,
      )
      .join("");

    this.cardsEl.innerHTML = s.cards
      .map(
        (card) => `
        <div class="duel-card${card.disabled ? " disabled" : ""}${this.selected === card.skill ? " selected" : ""}"
             data-skill="${card.skill}" draggable="${!card.disabled && !locked}">
          <b>${card.name}</b>
          <span>${card.disabled ? "本局禁用" : card.desc}</span>
        </div>`,
      )
      .join("");

    this.slotsEl.innerHTML = s.slots
      .map(
        (skill, i) => `
        <div class="duel-slot${skill ? " filled" : ""}" data-index="${i}">
          <i>${i + 1}</i>
          <span>${skill ? this.cardName(skill) : "拖入技能"}</span>
        </div>`,
      )
      .join("");

    this.bindDragAndDrop(locked);

    this.composeBtn.classList.toggle("hidden", s.phase !== "ENEMY_INTENT_REVEAL");
    this.startBtn.classList.toggle("hidden", s.phase !== "PLAYER_SEQUENCE");
    this.nextBtn.classList.toggle("hidden", s.phase !== "TURN_END");
    this.startBtn.disabled = s.slots.every((x) => x === null);

    this.statusEl.textContent =
      s.phase === "ENEMY_INTENT_REVEAL"
        ? "敌方意图已公开：先看牌，再编排"
        : s.phase === "PLAYER_SEQUENCE"
          ? "把技能放进 1-4 号槽位；相邻「裂伤→碎地锤」伤害 +50%"
          : s.phase === "RESOLUTION"
            ? "结算中…（输入已锁定）"
            : s.winner === "hero"
              ? `胜利 · 敌人剩余 ${s.enemyHp}`
              : s.winner === "enemy"
                ? `失败 · 英雄剩余 ${s.heroHp}`
                : "平局";
  }

  private cardName(skill: SkillId): string {
    return this.session.cards.find((c) => c.skill === skill)?.name ?? skill;
  }

  private bindDragAndDrop(locked: boolean): void {
    if (locked) return;

    for (const card of this.cardsEl.querySelectorAll<HTMLElement>(".duel-card")) {
      if (card.classList.contains("disabled")) continue;
      const skill = card.dataset.skill as SkillId;

      card.addEventListener("click", () => {
        this.selected = this.selected === skill ? null : skill;
        this.render();
      });
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", skill);
        this.selected = skill;
      });
    }

    for (const slot of this.slotsEl.querySelectorAll<HTMLElement>(".duel-slot")) {
      const index = Number(slot.dataset.index);
      slot.addEventListener("dragover", (event) => event.preventDefault());
      slot.addEventListener("drop", (event) => {
        event.preventDefault();
        const skill = (event.dataTransfer?.getData("text/plain") || "") as SkillId;
        if (!skill) return;
        this.session.setSlot(index, skill);
        this.selected = null;
        this.render();
      });
      slot.addEventListener("click", () => {
        if (this.selected) {
          this.session.setSlot(index, this.selected);
          this.selected = null;
        } else {
          this.session.setSlot(index, null);
        }
        this.render();
      });
    }
  }
}
