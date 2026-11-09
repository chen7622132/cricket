/** 全屏冲击闪白：命中/拼刀时短暂泛白，模拟冲击波溢出屏幕。 */
let lastFlash = 0;

export function flashScreen(kind: "normal" | "strong"): void {
  if (typeof document === "undefined") return;
  const now = performance.now();
  // 节流：120ms 内不重复触发，避免连段硬闪
  if (now - lastFlash < 120) return;
  lastFlash = now;
  const el = document.getElementById("screen-flash");
  if (!el) return;
  el.className = "";
  // 强制重排以重启动画
  void el.offsetWidth;
  el.className = kind === "strong" ? "flash-strong" : "flash-normal";
}

