import { defineConfig } from "vite";

export default defineConfig({
  // 相对路径：GitHub Pages 的 /cricket/ 子路径与本地 preview 都能用
  base: "./",
  server: {
    port: 5273,
    watch: {
      // 编辑器/工具在 src 下写临时文件时，Windows 上可能 EBUSY 把 watcher 打挂
      ignored: ["**/.*.tmpdir/**", "**/*.tmp", "**/.DS_Store"],
    },
  },
  build: { target: "es2022" },
});
