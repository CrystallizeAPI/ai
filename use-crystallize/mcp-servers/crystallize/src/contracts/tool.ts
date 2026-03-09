import z from "zod";
import { AuthContext } from "./app-context";

type ToolWrapperResult = {
    content: Array<{
        text: string;
        type: "text";
    }>;
};

export type ToolWrapper<TSchema extends z.ZodType> = {
    description: string;
    inputSchema: TSchema;
    handler: (
        input: z.infer<TSchema> & {
            authContext: AuthContext;
        },
    ) => Promise<ToolWrapperResult>;
};

export function defineToolWrapper<TSchema extends z.ZodType>(wrapper: ToolWrapper<TSchema>): ToolWrapper<TSchema> {
    return wrapper;
}
