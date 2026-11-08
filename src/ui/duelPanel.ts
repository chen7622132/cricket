import { CARDS, type CardDef, type DuelSession } from "../duel/session.ts";

interface Handlers {
  onNewRun: (seed: number) => void;
  onResolve: () => void;
  onNext: () => void;
}

/** 8 槽编排面板：种子 → 禁用 → 分段编排 → 结算 → 复盘。 */
export class DuelPanel {
  private readonly panel = document.getElementById("duel-ui") as HTMLElement;
  private readonly runEl = document.getElementById("duel-run") as HTMLElement;
  private readonly seedInput = document.getElementById("duel-seed") as HTMLInputElement;
  private readonly intentsEl = document.getElementById("duel-intents") as HTMLElement;
  private readonly bansEl = document.getElementById("duel-bans") as HTMLElement;
  private readonly cardsEl = document.getElementById("duel-cards") as HTMLElement;
  private readonly slotsEl = document.getElementById("duel-slots") as HTMLElement;
  private readonly statusEl = document.getElementById("duel-status") as HTMLElement;
  private readonly contextBtn = document.getElementById("duel-compose") as HTMLButtonElement;
  private readonly startBtn = document.getElementById("duel-start") as HTMLButtonElement;
  private readonly nextBtn = document.getElementById("duel-next") as HTMLButtonElement;
  private readonly collapseBtn = document.getElementById("duel-collapse") as HTMLButtonElement;

  private selected: string | null = null;
  private message = "";
  private collapsed = localStorage.getItem("cricket-duel-panel") === "collapsed";

  constructor(
    private readonly session: DuelSession,
    private readonly handlers: Handlers,
  ) {
    this.contextBtn.addEventListener("click", () => {
      if (this.session.state === "SEED_REVEAL") this.session.revealBans();
      else if (this.session.state === "BAN_REVEAL") this.session.beginCompose();
      this.render();
    });
    this.startBtn.addEventListener("click", () => {
      if (this.session.startResolution()) {
        this.handlers.onResolve();
        this.render();
      } else {
        this.message = this.session.canStart().reason;
        this.render();
      }
    });
    this.nextBtn.addEventListener("click", () => this.handlers.onNext());
    this.collapseBtn.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      localStorage.setItem("cricket-duel-panel", this.collapsed ? "collapsed" : "open");
      this.applyCollapsed();
    });
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    this.panel.classList.toggle("collapsed", this.collapsed);
    this.collapseBtn.textContent = this.collapsed ? "展开" : "收起";
  }

  show(): void {
    this.panel.classList.remove("hidden");
    this.applyCollapsed();
  }

  hide(): void {
    this.panel.classList.add("hidden");
  }

  render(): void {
    const s = this.session;
    if (document.activeElement !== this.seedInput) this.seedInput.value = String(s.seed);
    this.runEl.textContent = `run#${s.runId}`;

    this.intentsEl.innerHTML = s.intents
      .map(
        (i) =>
          `<div class="intent ph-${this.phaseOf(i.slot)}"><b>${i.icon}</b><span>${i.name}</span><i>${i.slot}</i></div>`,
      )
      .join("");

    this.bansEl.innerHTML =
      s.bans.skills
        .map((id) => `<span class="ban">禁 ${this.nameOf(id)}</span>`)
        .concat(`<span class="ban">禁 ${this.nameOf(s.bans.move)}</span>`)
        .join("");

    const locked = s.state !== "PLAYER_SEQUENCE";
    this.cardsEl.innerHTML = CARDS.map((card) => {
      const banned = s.isBanned(card.id);
      const phaseText = card.phases === "any" ? "任意段" : card.phases.map((p) => this.phaseName(p)).join("/");
      return `<div class="duel-card${banned ? " disabled" : ""}${this.selected === card.id ? " selected" : ""}"
        data-card="${card.id}" draggable="${!banned && !locked}">
        <b>${card.name}<em>${phaseText}</em></b>
        <span>${banned ? "本局禁用" : card.desc}</span>
      </div>`;
    }).join("");

    this.slotsEl.innerHTML = s.slots
      .map((cardId, i) => {
        const slot = i + 1;
        const phase = this.phaseOf(slot);
        const card = cardId ? this.cardOf(cardId) : null;
        return `<div class="duel-slot ph-${phase}${card ? " filled" : ""}" data-slot="${slot}">
          <i>${slot}</i>
          <span>${card ? card.name : this.phaseName(phase)}</span>
        </div>`;
      })
      .join("");

    this.bindDragAndDrop(locked);

    const startCheck = s.canStart();
    this.contextBtn.classList.toggle("hidden", s.state !== "SEED_REVEAL" && s.state !== "BAN_REVEAL");
    this.contextBtn.textContent = s.state === "SEED_REVEAL" ? "查看禁用" : "开始编排";
    this.startBtn.classList.toggle("hidden", s.state !== "PLAYER_SEQUENCE");
    this.startBtn.disabled = !startCheck.ok;
    this.nextBtn.classList.toggle("hidden", s.state !== "TURN_END");

    this.statusEl.textContent =
      this.message ||
      (s.state === "SEED_REVEAL"
        ? `seed=${s.seed} · 先看禁用`
        : s.state === "BAN_REVEAL"
          ? "禁用由种子派生；确认后开始编排"
          : s.state === "PLAYER_SEQUENCE"
            ? `起手 ${s.openerFrames()}f / 180f · ${startCheck.ok ? "可以结算" : startCheck.reason}`
            : s.state === "RESOLUTION"
              ? `结算中… 已完成 ${s.logs.length} 槽`
              : s.summary ?? "本局结束");
    this.message = "";
  }

  private phaseOf(slot: number): "windup" | "burst" | "finish" {
    if (slot <= 3) return "windup";
    if (slot <= 6) return "burst";
    return "finish";
  }

  private phaseName(phase: string): string {
    return phase === "WINDUP" || phase === "windup"
      ? "起手"
      : phase === "BURST" || phase === "burst"
        ? "爆发"
        : "收尾";
  }

  private cardOf(id: string): CardDef | undefined {
    return CARDS.find((c) => c.id === id);
  }

  private nameOf(id: string): string {
    return this.cardOf(id)?.name ?? id;
  }

  private bindDragAndDrop(locked: boolean): void {
    if (locked) return;
    for (const card of this.cardsEl.querySelectorAll<HTMLElement>(".duel-card")) {
      if (card.classList.contains("disabled")) continue;
      const id = card.dataset.card as string;
      card.addEventListener("click", () => {
        this.selected = this.selected === id ? null : id;
        this.render();
      });
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", id);
        this.selected = id;
      });
    }
    for (const slot of this.slotsEl.querySelectorAll<HTMLElement>(".duel-slot")) {
      const index = Number(slot.dataset.slot);
      slot.addEventListener("dragover", (event) => event.preventDefault());
      slot.addEventListener("drop", (event) => {
        event.preventDefault();
        const id = event.dataTransfer?.getData("text/plain") || "";
        if (!id) return;
        const err = this.session.setSlot(index, id);
        if (err) this.message = err;
        this.selected = null;
        this.render();
      });
      slot.addEventListener("click", () => {
        if (this.selected) {
          const err = this.session.setSlot(index, this.selected);
          if (err) this.message = err;
          this.selected = null;
        } else {
          this.session.setSlot(index, null);
        }
        this.render();
      });
    }
  }
}


