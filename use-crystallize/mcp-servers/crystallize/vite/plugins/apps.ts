import fs from "node:fs";
import path from "node:path";
import { build as viteBuild, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const VIRTUAL_PREFIX = "virtual:app/";

type RollupAsset = { type: "asset"; fileName: string; source: string | Uint8Array };
type RollupOutputLike = { output: Array<RollupAsset | { type: "chunk"; fileName: string }> };

async function buildSingleApp(appDir: string): Promise<string> {
    const result = (await viteBuild({
        root: appDir,
        configFile: false,
        envFile: false,
        logLevel: "warn",
        plugins: [viteSingleFile()],
        build: {
            write: false,
            cssCodeSplit: false,
            assetsInlineLimit: 100_000_000,
            chunkSizeWarningLimit: 100_000_000,
            reportCompressedSize: false,
            rollupOptions: {
                input: path.join(appDir, "index.html"),
            },
        },
    })) as RollupOutputLike | RollupOutputLike[];

    const output = Array.isArray(result) ? result[0] : result;
    const htmlAsset = output.output.find((o): o is RollupAsset => o.type === "asset" && o.fileName.endsWith(".html"));
    if (!htmlAsset) {
        throw new Error(`Singlefile build for ${appDir} produced no HTML asset`);
    }
    return typeof htmlAsset.source === "string" ? htmlAsset.source : Buffer.from(htmlAsset.source).toString("utf-8");
}

export function appsPlugin(): Plugin {
    const appsDir = path.resolve(process.cwd(), "src/core/mcp/apps");

    const slugFromId = (id: string): string | null => {
        if (!id.startsWith(VIRTUAL_PREFIX)) return null;
        return id.slice(VIRTUAL_PREFIX.length);
    };

    return {
        name: "vite-plugin-crystallize-apps",
        resolveId(id) {
            const slug = slugFromId(id);
            if (slug === null) return undefined;
            return "\0" + id;
        },
        async load(id) {
            const realId = id.startsWith("\0") ? id.slice(1) : id;
            const slug = slugFromId(realId);
            if (slug === null) return undefined;
            const appDir = path.join(appsDir, slug);
            if (!fs.existsSync(path.join(appDir, "index.html"))) {
                throw new Error(`MCP App '${slug}' not found at ${appDir}/index.html`);
            }
            const html = await buildSingleApp(appDir);
            return `export default ${JSON.stringify(html)};`;
        },
        configureServer(server) {
            if (!fs.existsSync(appsDir)) return;
            server.watcher.add(appsDir);
            server.watcher.on("all", (_event, file) => {
                if (!file.startsWith(appsDir)) return;
                const rel = path.relative(appsDir, file);
                const slug = rel.split(path.sep)[0];
                if (!slug) return;
                const moduleId = "\0" + VIRTUAL_PREFIX + slug;
                const mod = server.moduleGraph.getModuleById(moduleId);
                if (mod) server.moduleGraph.invalidateModule(mod);
            });
        },
    };
}
