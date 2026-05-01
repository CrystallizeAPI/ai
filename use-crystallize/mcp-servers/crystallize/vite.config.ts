import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { skillsPlugin } from "./vite/plugins/skills";
import { appsPlugin } from "./vite/plugins/apps";

export default defineConfig(() => {
    return {
        plugins: [cloudflare(), skillsPlugin(), appsPlugin()],
    };
});
