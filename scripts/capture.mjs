import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const EDGE = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const URL = process.env.APP_URL ?? "http://127.0.0.1:5273/";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "--window-size=1400,860",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 860, deviceScaleFactor: 1 });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

const resp = await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
console.log("http status:", resp?.status());

const shots = process.env.SHOT_PLAN
  ? JSON.parse(process.env.SHOT_PLAN)
  : [
      { at: 900, name: "01-boot" },
      { at: 2400, name: "02-fight" },
      { at: 3000, name: "03-mid" },
      { at: 3000, name: "04-late" },
      { at: 3000, name: "05-end" },
    ];

let last = 0;
for (const s of shots) {
  await new Promise((r) => setTimeout(r, Math.max(0, s.at - last)));
  last = s.at;
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
}

const info = await page.evaluate(() => ({
  hasCanvas: !!document.querySelector("#stage canvas"),
  canvas: (() => {
    const c = document.querySelector("#stage canvas");
    return c ? `${c.width}x${c.height} css ${Math.round(c.getBoundingClientRect().width)}px` : "none";
  })(),
  logLines: document.querySelectorAll(".log-line").length,
  banner: document.getElementById("banner")?.textContent ?? "",
}));
console.log("page:", JSON.stringify(info));

const errors = logs.filter((l) => l.startsWith("[pageerror]") || l.startsWith("[error]"));
console.log("errors:", errors.length ? JSON.stringify(errors, null, 2) : "none");
if (logs.length) console.log("warnings:", logs.filter((l) => l.startsWith("[warning]")).slice(0, 2).join(" | ") || "none");

await browser.close();
