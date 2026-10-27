import { build } from "esbuild";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import electron from "electron";
await build({
  entryPoints: [
    process.argv.includes("--live")
      ? "scripts/dedupe-live-check.ts"
      : "scripts/store-check.ts",
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: ".test-data/store-check.mjs",
});
const child = spawn(
  electron as unknown as string,
  [resolve(".test-data/store-check.mjs")],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code || 0));
