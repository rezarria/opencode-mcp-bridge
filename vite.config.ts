import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [/^node:/, "@opencode-ai/plugin", "@opentui/core", "@opentui/solid"],
      output: {
        preserveModules: false,
      },
    },
    outDir: "dist",
    sourcemap: true,
    minify: false,
  },
  plugins: [
    dts({
      include: ["src"],
      outDir: "dist",
      rollupTypes: true,
    }),
  ],
})