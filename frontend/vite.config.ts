import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_CDN_URL || "/",
  plugins: [react()],
  server: {
    host: true,
  },
});
