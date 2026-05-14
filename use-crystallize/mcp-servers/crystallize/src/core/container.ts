import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asFunction, createContainer, InferCradleFromContainer, InjectionMode } from "awilix";
import packageJson from "../../package.json";
import { createFetchCatalogGraphqlSchemaToolWrapper } from "./mcp/tools/fetch-catalog-graphql-schema";
import { createFetchContentModelToolWrapper } from "./mcp/tools/fetch-content-model";
import { createFetchDiscoveryGraphqlSchemaToolWrapper } from "./mcp/tools/fetch-discovery-graphql-schema";
import { createFetchCoreGraphqlSchemaToolWrapper } from "./mcp/tools/fetch-core-graphql-schema";
import { createQueryCatalogueToolWrapper } from "./mcp/tools/query-catalogue";
import { createQueryCoreToolWrapper } from "./mcp/tools/query-core";
import { createQueryDiscoveryToolWrapper } from "./mcp/tools/query-discovery";
import { createBuildMassOperationToolWrapper } from "./mcp/tools/build-mass-operation";
import { createQueryShopCartToolWrapper } from "./mcp/tools/query-shop-cart";
import { createFetchShopCartGraphqlSchemaToolWrapper } from "./mcp/tools/fetch-shop-cart-graphql-schema";
import { createProductOverviewToolWrapper } from "./mcp/tools/product-overview";
import { createSkillsToolWrapper } from "./mcp/tools/skills";
import { createTenantOverviewToolWrapper } from "./mcp/tools/tenant-overview";
import { createTenantMatcher } from "./services/tenant-matcher";
import { TenantMatcher } from "../contracts/tenant-matcher";
import { createGraphlSchemaCompacter } from "./services/compact-schema-builder";
import { createGraphqlQueryCorrector } from "./services/graphql-query-corrector";
import { createQueryExecutor } from "./services/query-with-correction";
import { createAuthContextResolver } from "./services/auth-context-helpers";
import { createCoreSchemaDomainSplitter } from "./services/core-schema-domain-splitter";

export type Services = {
    mcpServer: McpServer;
    tenantMatcher: TenantMatcher;
};

const build = () =>
    createContainer({
        injectionMode: InjectionMode.PROXY,
        strict: true,
    }).register({
        // services
        authContextResolver: asFunction(createAuthContextResolver).singleton(),
        tenantMatcher: asFunction(createTenantMatcher).singleton(),
        graphqlSchemaCompacter: asFunction(createGraphlSchemaCompacter).singleton(),
        coreSchemaDomainSplitter: asFunction(createCoreSchemaDomainSplitter).singleton(),
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
        queryShopCartToolWrapper: asFunction(createQueryShopCartToolWrapper).singleton(),
        fetchShopCartGraphqlSchemaToolWrapper: asFunction(createFetchShopCartGraphqlSchemaToolWrapper).singleton(),
        tenantOverviewToolWrapper: asFunction(createTenantOverviewToolWrapper).singleton(),
        productOverviewToolWrapper: asFunction(createProductOverviewToolWrapper).singleton(),
    });

let container: ReturnType<typeof build> | null = null;
export const buildContainer = (_env: CloudflareBindings) => (container ??= build());
type Container = InferCradleFromContainer<ReturnType<typeof build>>;

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
    "query-shop-cart": "queryShopCartToolWrapper",
    "fetch-shop-cart-graphql-schema": "fetchShopCartGraphqlSchemaToolWrapper",
    "tenant-overview": "tenantOverviewToolWrapper",
    "product-overview": "productOverviewToolWrapper",
} as const satisfies Record<string, keyof Container>;
