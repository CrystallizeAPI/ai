import z from "zod";
import { AuthContext } from "./app-context";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps";
import type { AnalyticsEvent } from "./analytics-tracker";

type ToolWrapperResult = {
    content: Array<{
        text: string;
        type: "text";
    }>;
    // Extra analytics events for this call (e.g. a Jev selection). Tool wrappers are singletons and the tracker is
    // request-scoped, so tools hand events back and the servicesProvider handler sends them, then strips this field.
    events?: AnalyticsEvent[];
};

export type ToolUi = {
    resourceUri: `ui://${string}`;
    name: string;
    description?: string;
    meta?: McpUiResourceMeta;
    html: string;
};

export type ToolWrapper<TSchema extends z.ZodType> = {
    description: string;
    inputSchema: TSchema;
    annotations?: ToolAnnotations;
    // When true, the tool is only registered on the MCP server if the request
    // opts into writes via ?exposeWrite=true (default off). Mirrors how `ui`
    // gates registration behind ?exposeUi. Registration only — `annotations`
    // describes behavior (readOnlyHint/destructiveHint).
    write?: boolean;
    ui?: ToolUi;
    handler: (
        input: z.infer<TSchema> & {
            authContext: AuthContext;
        },
    ) => Promise<ToolWrapperResult>;
};

export function defineToolWrapper<TSchema extends z.ZodType>(wrapper: ToolWrapper<TSchema>): ToolWrapper<TSchema> {
    return wrapper;
}
