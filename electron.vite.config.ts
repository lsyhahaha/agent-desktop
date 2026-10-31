import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
// 同一次配置加载中的各进程共享构建标识，检测重建后仅刷新窗口造成的混用。
const define = { __APP_BUILD_ID__: JSON.stringify(randomUUID()) };
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
