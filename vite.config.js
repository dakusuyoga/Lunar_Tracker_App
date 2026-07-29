import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built site works from any GitHub Pages sub-path.
  base: "./",
  build: {
    // es2020 keeps the bundle runnable on older Safari (the practical floor
    // is Safari 15 / iOS 15, which the wasm glue needs for BigInt64Array).
    target: "es2020",
  },
});
