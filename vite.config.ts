import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5273,
    watch: {
      // 编辑器/工具在 src 下写临时文件时，Windows 上可能 EBUSY 把 watcher 打挂
      ignored: ["**/.*.tmpdir/**", "**/*.tmp", "**/.DS_Store"],
    },
  },
  build: { target: "es2022" },
});
