import type { RuleOverride, Ruleset } from "../engine/rules.ts";
import { exportRuleOverrides } from "../engine/rules.ts";

/**
 * 规则编辑器：把当前英雄规则表导出成 JSON，允许改
 * priority / cost / cooldown / disabled，应用后立刻用自定义规则表开打。
 *
 * 规则序号（index）保持基准表不变，所以日志里的「规则[n]」仍然对得上。
 */
export class RuleEditor {
  private readonly panel = document.getElementById("editor-panel") as HTMLElement;
  private readonly textarea = document.getElementById("editor-json") as HTMLTextAreaElement;
  private readonly errorEl = document.getElementById("editor-error") as HTMLElement;
  private readonly subEl = document.getElementById("editor-sub") as HTMLElement;
  private base: Ruleset | null = null;

  constructor(private readonly onApply: (overrides: RuleOverride[], base: Ruleset) => void) {
    (document.getElementById("editor-close") as HTMLButtonElement).addEventListener("click", () =>
      this.close(),
    );
    (document.getElementById("editor-apply") as HTMLButtonElement).addEventListener("click", () =>
      this.apply(),
    );
    (document.getElementById("editor-reset") as HTMLButtonElement).addEventListener("click", () =>
      this.reset(),
    );
  }

  open(base: Ruleset): void {
    this.base = base;
    this.subEl.textContent = `基准：${base.id} ${base.name}`;
    this.reset();
    this.panel.classList.remove("hidden");
    this.panel.setAttribute("aria-hidden", "false");
    this.textarea.focus();
  }

  close(): void {
    this.panel.classList.add("hidden");
    this.panel.setAttribute("aria-hidden", "true");
  }

  get isOpen(): boolean {
    return !this.panel.classList.contains("hidden");
  }

  reset(): void {
    if (!this.base) return;
    this.errorEl.textContent = "";
    this.textarea.value = JSON.stringify(exportRuleOverrides(this.base), null, 2);
  }

  private apply(): void {
    if (!this.base) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.textarea.value);
    } catch (err) {
      this.errorEl.textContent = `JSON 语法错误：${(err as Error).message}`;
      return;
    }
    if (!Array.isArray(parsed)) {
      this.errorEl.textContent = "顶层必须是数组（每条规则一个对象）";
      return;
    }
    const overrides: RuleOverride[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const o = item as RuleOverride;
      if (typeof o.id !== "string" || !o.id) continue;
      overrides.push(o);
    }
    if (overrides.length === 0) {
      this.errorEl.textContent = "没有有效规则：每条至少需要 id 字段";
      return;
    }
    this.errorEl.textContent = "";
    this.onApply(overrides, this.base);
  }
}
