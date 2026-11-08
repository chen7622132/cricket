/**
 * 运行时探针：验证演出层真的发生了 hitstop / 镜头推拉 / 空间转换，
 * 而不是"代码里写了但没跑起来"。
 */
import puppeteer from "puppeteer-core";

const EDGE = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.APP_URL ?? "http://127.0.0.1:5273/";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#stage canvas", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 400));
await page.click("#speed-btn"); // 2x
await page.click("#speed-btn"); // 4x

const samples = [];
const started = Date.now();
let frozenStarts = [];
let wasFrozen = false;
let maxZoom = 1;
let maxShake = 0;
let maxEffects = 0;
let settleTicks = 0;
let slowmoTicks = 0;
const heroStates = new Set();
const heroFrames = new Set();
let maxHitFrames = 0;

while (Date.now() - started < 14000) {
  const s = await page.evaluate(() => {
    const c = window.__cricket;
    return { state: c?.state?.(), battle: c?.battle?.() };
  });
  if (!s.state) break;
  samples.push(s);
  const st = s.state;

  if (st.frozen && !wasFrozen) frozenStarts.push(st.freezeMs);
  wasFrozen = st.frozen;
  maxZoom = Math.max(maxZoom, st.zoom);
  maxShake = Math.max(maxShake, st.shake);
  maxEffects = Math.max(maxEffects, st.effects);
  if (st.settleMs > 0) settleTicks++;
  if (st.slowmoMs > 0) slowmoTicks++;
  if (st.heroState) heroStates.add(st.heroState);
  if (typeof st.heroFrame === "number") heroFrames.add(st.heroFrame);
  if (typeof st.heroHits === "number") maxHitFrames = Math.max(maxHitFrames, st.heroHits);

  if (s.battle?.done) break;
  await new Promise((r) => setTimeout(r, 33));
}

const battle = samples[samples.length - 1]?.battle;
const freezeBuckets = frozenStarts.reduce((acc, ms) => {
  const key = ms >= 220 ? "ultimate(16f=267ms)" : ms >= 100 ? "key(8f=133ms)" : "normal(3f=50ms)";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});

const result = {
  framesSimulated: battle?.frame ?? 0,
  battleDone: battle?.done ?? false,
  winner: battle?.winner ?? null,
  hitstopOccurrences: frozenStarts.length,
  hitstopBuckets: freezeBuckets,
  maxZoom,
  maxShake,
  maxLiveEffects: maxEffects,
  settleTicks,
  slowmoTicks,
  heroStates: [...heroStates],
  heroFrameCount: heroFrames.size,
  attackHitFrames: maxHitFrames,
  samples: samples.length,
  errors,
};

console.log(JSON.stringify(result, null, 2));

const checks = {
  hitstop: result.hitstopOccurrences > 0,
  twoTierBuckets: Object.keys(result.hitstopBuckets).length >= 2,
  crashZoom: result.maxZoom > 1.05,
  effectsSpawned: result.maxLiveEffects > 0,
  effectsCapped: result.maxLiveEffects <= 16,
  spaceTransitionSettle: result.settleTicks > 0,
  slowmo: result.slowmoTicks > 0,
  spriteStates: result.heroStates.length >= 2,
  spriteFramesAnimate: result.heroFrameCount >= 2,
  attackHitFrames: result.attackHitFrames > 0,
  noErrors: result.errors.length === 0,
};
console.log("checks:", JSON.stringify(checks));
const ok = Object.values(checks).every(Boolean);
console.log(ok ? "PROBE PASS" : "PROBE FAIL");
process.exitCode = ok ? 0 : 1;
await browser.close();




