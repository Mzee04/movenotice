import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const proxy = {
  "/lcd-testnet": {
    target: "https://api-testnet.qore.host",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/lcd-testnet/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
});
