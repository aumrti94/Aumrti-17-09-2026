import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const svgPath = path.join(rootDir, "docs", "social", "aumrti-physician-time-split.svg");
const pngPath = path.join(rootDir, "docs", "social", "aumrti-physician-time-split.png");
const svg = await readFile(svgPath, "utf8");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1080, height: 1080 } });
  console.log(`PNG written to ${pngPath}`);
} finally {
  await browser.close();
}
