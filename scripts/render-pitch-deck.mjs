import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const htmlPath = path.join(rootDir, "docs", "pitch", "aumrti-rtih-ap-pitch-deck.html");
const pdfPath = path.join(rootDir, "docs", "pitch", "aumrti-rtih-ap-pitch-deck.pdf");
const previewPath = path.join(rootDir, "docs", "pitch", "aumrti-rtih-ap-pitch-deck-preview.png");

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });

  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
  await page.screenshot({ path: previewPath, fullPage: false });
  await page.pdf({
    path: pdfPath,
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });

  console.log(`PDF written to ${pdfPath}`);
  console.log(`Preview written to ${previewPath}`);
} finally {
  await browser.close();
}
