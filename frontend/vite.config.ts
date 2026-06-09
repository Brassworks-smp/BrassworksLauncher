import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    outDir: "out",
    emptyOutDir: true,
  },
});
