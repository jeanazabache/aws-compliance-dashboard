import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Use './' so asset paths are relative — required for S3 static website hosting.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
