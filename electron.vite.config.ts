import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
const protocol = resolve("packages/protocol/src/index.ts");
export default defineConfig({
  main: {
    resolve: { alias: { "@protocol": protocol } },
    build: {
      lib: {
        entry: {
          index: resolve("apps/desktop/main/index.ts"),
          runtime: resolve("apps/runtime/src/index.ts"),
        },
        formats: ["es"],
      },
      rollupOptions: { output: { entryFileNames: "[name].js" } },
    },
  },
  preload: {
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
    root: resolve("apps/desktop/renderer"),
    resolve: { alias: { "@protocol": protocol } },
    esbuild: { jsx: "automatic" },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    build: {
      rollupOptions: { input: resolve("apps/desktop/renderer/index.html") },
    },
  },
});
