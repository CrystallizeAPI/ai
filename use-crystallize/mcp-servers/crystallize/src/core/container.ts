import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type AwilixContainer, asFunction, createContainer, InjectionMode } from "awilix";
import packageJson from "../../package.json";
import { createFetchCatalogGraphqlSchemaToolWrapper } from "./mcp/tools/fetch-catalog-graphql-schema";
import { createFetchContentModelToolWrapper } from "./mcp/tools/fetch-content-model";
import { createFetchDiscoveryGraphqlSchemaToolWrapper } from "./mcp/tools/fetch-discovery-graphql-schema";
import { createFetchCoreGraphqlSchemaToolWrapper } from "./mcp/tools/fetch-core-graphql-schema";
import { createQueryCatalogueToolWrapper } from "./mcp/tools/query-catalogue";
import { createQueryCoreToolWrapper } from "./mcp/tools/query-core";
import { createQueryDiscoveryToolWrapper } from "./mcp/tools/query-discovery";
import { createBuildMassOperationToolWrapper } from "./mcp/tools/build-mass-operation";
import { createSkillsToolWrapper } from "./mcp/tools/skills";
import { createTenantMatcher } from "./services/tenant-matcher";
import { TenantMatcher } from "../contracts/tenant-matcher";
import { createGraphlSchemaCompacter } from "./services/compact-schema-builder";
import { createGraphqlQueryCorrector } from "./services/graphql-query-corrector";
import { GraphqlQueryCorrector } from "../contracts/graphql-query-corrector";
import { createQueryExecutor } from "./services/query-with-correction";
import { QueryExecutor } from "../contracts/query-executor";

type Container = Services & {
    graphqlQueryCorrector: GraphqlQueryCorrector;
    queryExecutor: QueryExecutor;
    skillsToolWrapper: ReturnType<typeof createSkillsToolWrapper>;
    queryDiscoveryToolWrapper: ReturnType<typeof createQueryDiscoveryToolWrapper>;
    queryCatalogueToolWrapper: ReturnType<typeof createQueryCatalogueToolWrapper>;
    fetchContentModelToolWrapper: ReturnType<typeof createFetchContentModelToolWrapper>;
    fetchCatalogGraphqlSchemaToolWrapper: ReturnType<typeof createFetchCatalogGraphqlSchemaToolWrapper>;
    fetchDiscoveryGraphqlSchemaToolWrapper: ReturnType<typeof createFetchDiscoveryGraphqlSchemaToolWrapper>;
    fetchCoreGraphqlSchemaToolWrapper: ReturnType<typeof createFetchCoreGraphqlSchemaToolWrapper>;
    queryCoreToolWrapper: ReturnType<typeof createQueryCoreToolWrapper>;
    buildMassOperationToolWrapper: ReturnType<typeof createBuildMassOperationToolWrapper>;
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
    "fetch-catalog-graphql-schema": "fetchCatalogGraphqlSchemaToolWrapper",
    "fetch-discovery-graphql-schema": "fetchDiscoveryGraphqlSchemaToolWrapper",
    "query-core": "queryCoreToolWrapper",
    "fetch-core-graphql-schema": "fetchCoreGraphqlSchemaToolWrapper",
    "build-mass-operation": "buildMassOperationToolWrapper",
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
        graphqlSchemaCompacter: asFunction(createGraphlSchemaCompacter).singleton(),
        graphqlQueryCorrector: asFunction(createGraphqlQueryCorrector).singleton(),
        queryExecutor: asFunction(createQueryExecutor).singleton(),
        mcpServer: asFunction(() => {
            return new McpServer({ name: "Crystallize MCP Server", version: packageJson.version });
        }).scoped(),

        // tools
        skillsToolWrapper: asFunction(createSkillsToolWrapper).singleton(),
        queryDiscoveryToolWrapper: asFunction(createQueryDiscoveryToolWrapper).singleton(),
        queryCatalogueToolWrapper: asFunction(createQueryCatalogueToolWrapper).singleton(),
        fetchContentModelToolWrapper: asFunction(createFetchContentModelToolWrapper).singleton(),
        fetchCatalogGraphqlSchemaToolWrapper: asFunction(createFetchCatalogGraphqlSchemaToolWrapper).singleton(),
        fetchDiscoveryGraphqlSchemaToolWrapper: asFunction(createFetchDiscoveryGraphqlSchemaToolWrapper).singleton(),
        fetchCoreGraphqlSchemaToolWrapper: asFunction(createFetchCoreGraphqlSchemaToolWrapper).singleton(),
        queryCoreToolWrapper: asFunction(createQueryCoreToolWrapper).singleton(),
        buildMassOperationToolWrapper: asFunction(createBuildMassOperationToolWrapper).singleton(),
    });
    return container;
};
