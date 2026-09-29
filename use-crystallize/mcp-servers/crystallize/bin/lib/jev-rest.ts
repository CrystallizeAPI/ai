import { readFileSync } from "node:fs";
import type { JevClient } from "../../src/contracts/jev";
import { createJevClient, type JevBinding } from "../../src/core/services/jev-client";

// Shared by the bin/eval-*.ts scripts: live Jev over the Workers AI REST API, outside a Worker.

export const requireEnv = (name: string) => {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing env var ${name}`);
        process.exit(1);
    }
    return value;
};

// Defaults to the current `wrangler login`, so a logged-in developer needs no token at all.
const wranglerToken = () => {
    const out = Bun.spawnSync(["bunx", "wrangler", "auth", "token", "--json"], { stderr: "ignore" });
    try {
        return (JSON.parse(out.stdout.toString()) as { token?: string }).token;
    } catch {
        return undefined;
    }
};

export function createRestJevClient() {
    // The account is pinned in wrangler.jsonc (not a secret); CLOUDFLARE_ACCOUNT_ID overrides it.
    const pinnedAccountId = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf-8").match(
        /"account_id"\s*:\s*"([0-9a-f]+)"/,
    )?.[1];
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || pinnedAccountId || requireEnv("CLOUDFLARE_ACCOUNT_ID");
    const apiToken = process.env.CLOUDFLARE_API_TOKEN || wranglerToken() || requireEnv("CLOUDFLARE_API_TOKEN");

    // A stand-in for the AI binding, so the eval still goes through the production client (envelope unwrapping,
    // validation). REST's `result` is what the binding returns.
    const restBinding: JevBinding = {
        async run(model, input, options) {
            const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    "Content-Type": "application/json",
                    // The REST form of the binding's `collectLog: false`: keep eval prompts out of the gateway log.
                    "cf-aig-collect-log": String(options.gateway.collectLog),
                },
                body: JSON.stringify({ model, input }),
            });
            const json = (await response.json()) as { success: boolean; result: unknown; errors?: unknown };
            if (!json.success) throw new Error(`Workers AI error: ${JSON.stringify(json.errors)}`);
            return json.result;
        },
    };

    const productionClient = createJevClient({ ai: restBinding }, 30_000);
    const usage = { inputTokens: 0, calls: 0, ms: 0 };
    const jevClient: JevClient = async (request) => {
        const started = Date.now();
        const response = await productionClient(request);
        usage.ms += Date.now() - started;
        usage.calls++;
        usage.inputTokens += response.usage?.input_tokens ?? 0;
        return response;
    };

    const printUsage = () =>
        console.log(
            `\nper call: ${Math.round(usage.inputTokens / usage.calls)} input tokens, ` +
                `${Math.round(usage.ms / usage.calls)}ms average latency (REST, from this machine)`,
        );

    return { jevClient, printUsage };
}
