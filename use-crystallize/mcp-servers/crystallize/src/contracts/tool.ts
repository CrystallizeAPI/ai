import z from "zod";
import { AuthContext } from "./app-context";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps";

type ToolWrapperResult = {
    content: Array<{
        text: string;
        type: "text";
    }>;
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
    annotions?: ToolAnnotations;
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
