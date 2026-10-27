import { chromium } from "playwright";
import { dirname, join, resolve } from "node:path";
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const registry = JSON.parse(
  readFileSync(
    join(
      dirname(require.resolve("playwright-core/package.json")),
      "browsers.json",
    ),
    "utf8",
  ),
);
const cache = dirname(dirname(dirname(chromium.executablePath())));
const root = resolve("resources");
mkdirSync(join(root, "browser"), { recursive: true });
mkdirSync(join(root, "models"), { recursive: true });
for (const name of ["chromium", "chromium-headless-shell"]) {
  const browser = registry.browsers.find((b: any) => b.name === name);
  const folder = `${name.replaceAll("-", "_")}-${browser.revision}`;
  const actual = name === "chromium" ? `chromium-${browser.revision}` : folder;
  if (!existsSync(join(cache, actual)))
    throw new Error(`浏览器未安装：${actual}`);
  cpSync(join(cache, actual), join(root, "browser", actual), {
    recursive: true,
  });
  console.log("Prepared browser:", actual);
}
for (const lang of ["chi_sim", "eng"]) {
  const data = require(`@tesseract.js-data/${lang}`);
  copyFileSync(
    join(data.langPath, `${lang}.traineddata.gz`),
    join(root, "models", `${lang}.traineddata.gz`),
  );
  console.log("Prepared local OCR:", lang);
}
writeFileSync(
  join(root, "resource-manifest.json"),
  JSON.stringify(
    {
      playwright: "1.64.1",
      preparedAt: new Date().toISOString(),
      localOCR: ["chi_sim", "eng"],
    },
    null,
    2,
  ),
);
