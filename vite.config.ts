import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Vite + React + Tailwind CSS v4 配置
// - @tailwindcss/vite 插件负责编译 Tailwind v4（无需 postcss 配置）
// - "@" 路径别名指向 src 目录
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    open: false,
  },
  build: {
    // Shiki 高亮引擎为懒加载独立 chunk（gzip 后约 58KB，仅代码块出现时加载），
    // 故调高单 chunk 告警阈值
    chunkSizeWarningLimit: 900,
  },
});
