import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const svgPath = path.join(rootDir, "docs", "pitch", "aumrti-block-flow-diagram.svg");
const pngPath = path.join(rootDir, "docs", "pitch", "aumrti-block-flow-diagram.png");

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });

  const svg = await readFile(svgPath, "utf8");
  await page.setContent(
    `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            html, body { width: 1600px; height: 1000px; margin: 0; overflow: hidden; background: #f6f8fb; }
            svg { display: block; width: 1600px; height: 1000px; }
          </style>
        </head>
        <body>${svg}</body>
      </html>`,
    { waitUntil: "load" }
  );
  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1600, height: 1000 } });
  console.log(`PNG written to ${pngPath}`);
} finally {
  await browser.close();
}
