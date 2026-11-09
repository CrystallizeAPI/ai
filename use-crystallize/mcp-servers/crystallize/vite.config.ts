import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { skillsPlugin } from "./vite/plugins/skills";
import { appsPlugin } from "./vite/plugins/apps";

export default defineConfig(() => {
    return {
        // A fixed environment name, so the build lands in `dist/mcp_server/` whichever worker it targets (the plugin
        // would otherwise name it after the top-level worker, i.e. the dev one, even for a production build).
        plugins: [cloudflare({ viteEnvironment: { name: "mcp_server" } }), skillsPlugin(), appsPlugin()],
    };
});
