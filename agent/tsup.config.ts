import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/main.ts",
    tui: "src/tui/main.tsx",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node22",
  external: [
    "ai",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/google",
    "react",
    "ink",
  ],
  splitting: false,
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
