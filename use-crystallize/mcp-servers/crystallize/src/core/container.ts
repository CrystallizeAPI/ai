import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AwilixContainer, asFunction, createContainer, InjectionMode } from "awilix";
import packageJson from "../../package.json";
import { createFetchContentModelToolWrapper } from "./mcp/tools/fetch-content-model";
import { createQueryCatalogueToolWrapper } from "./mcp/tools/query-catalogue";
import { createQueryDiscoveryToolWrapper } from "./mcp/tools/query-discovery";
import { createSkillsToolWrapper } from "./mcp/tools/skills";
import { createTenantMatcher } from "./services/tenant-matcher";
import { TenantMatcher } from "../contracts/tenant-matcher";

type Container = Services & {
    skillsToolWrapper: ReturnType<typeof createSkillsToolWrapper>;
    queryDiscoveryToolWrapper: ReturnType<typeof createQueryDiscoveryToolWrapper>;
    queryCatalogueToolWrapper: ReturnType<typeof createQueryCatalogueToolWrapper>;
    fetchContentModelToolWrapper: ReturnType<typeof createFetchContentModelToolWrapper>;
};

export type Services = {
    mcpServer: McpServer;
    tenantMatcher: TenantMatcher;
};

export const toolRegistry = {
    skills: "skillsToolWrapper",
    "query-discovery": "queryDiscoveryToolWrapper",
    "query-catalogue": "queryCatalogueToolWrapper",
    "fetch-content-model": "fetchContentModelToolWrapper",
} as const satisfies Record<string, keyof Container>;

let container: AwilixContainer<Container> | null = null;
export const buildContainer = (_env: CloudflareBindings): AwilixContainer<Container> => {
    if (container) {
        return container;
    }
    container = createContainer<Container>({
        injectionMode: InjectionMode.PROXY,
        strict: true,
    });

    container.register({
        // services
        tenantMatcher: asFunction(createTenantMatcher).singleton(),

        mcpServer: asFunction(() => {
            return new McpServer({ name: "Crystallize MCP Server", version: packageJson.version });
        }).scoped(),

        // tools
        skillsToolWrapper: asFunction(createSkillsToolWrapper).singleton(),
        queryDiscoveryToolWrapper: asFunction(createQueryDiscoveryToolWrapper).singleton(),
        queryCatalogueToolWrapper: asFunction(createQueryCatalogueToolWrapper).singleton(),
        fetchContentModelToolWrapper: asFunction(createFetchContentModelToolWrapper).singleton(),
    });
    return container;
};
