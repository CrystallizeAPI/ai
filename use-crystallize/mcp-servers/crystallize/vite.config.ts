import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { skillsPlugin } from "./vite/plugins/skills";

export default defineConfig(() => {
    return {
        plugins: [cloudflare(), skillsPlugin()],
    };
});
