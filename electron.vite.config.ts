import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
// 同一次配置加载中的各进程共享构建标识，检测重建后仅刷新窗口造成的混用。
// 构建ID检测进程混用；稳定源码摘要限定评估适用版本，不因单纯重建而让选择失效。
const fingerprint = createHash("sha256");
function hashSources(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error("Runtime source symlink is not supported");
    if (entry.isDirectory()) hashSources(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      fingerprint
        .update(path)
        .update("\0")
        .update(readFileSync(path))
        .update("\0");
  }
}
hashSources("apps/runtime/src");
hashSources("packages/protocol/src");
hashSources("apps/desktop/main");
fingerprint.update(readFileSync("electron.vite.config.ts"));
fingerprint.update(readFileSync("package-lock.json"));
const define = {
  __APP_BUILD_ID__: JSON.stringify(randomUUID()),
  __APP_RUNTIME_DIGEST__: JSON.stringify(fingerprint.digest("hex")),
};
const protocol = resolve("packages/protocol/src/index.ts");
export default defineConfig({
  main: {
    define,
    resolve: { alias: { "@protocol": protocol } },
    build: {
      lib: {
        entry: {
          index: resolve("apps/desktop/main/index.ts"),
          runtime: resolve("apps/runtime/src/index.ts"),
          "strategy-lab": resolve("apps/desktop/main/strategy-lab.ts"),
          "evolution-admin": resolve("apps/desktop/main/evolution-admin.ts"),
          "storage-worker": resolve("apps/runtime/src/storage-worker.ts"),
        },
        formats: ["es"],
      },
      rollupOptions: { output: { entryFileNames: "[name].js" } },
    },
  },
  preload: {
    define,
    resolve: { alias: { "@protocol": protocol } },
    build: {
      externalizeDeps: false,
      lib: {
        entry: resolve("apps/desktop/preload/index.ts"),
        formats: ["cjs"],
      },
      rollupOptions: {
        output: { entryFileNames: "index.cjs", inlineDynamicImports: true },
      },
    },
  },
  renderer: {
    define,
    root: resolve("apps/desktop/renderer"),
    resolve: { alias: { "@protocol": protocol } },
    esbuild: { jsx: "automatic" },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    build: {
      rollupOptions: { input: resolve("apps/desktop/renderer/index.html") },
    },
  },
});
