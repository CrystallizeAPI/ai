import z from "zod";

/**
 * Maximum allowed GraphQL query length in characters (10 KB).
 * Prevents oversized queries from being forwarded to upstream APIs.
 */
const MAX_QUERY_LENGTH = 10_000;

/**
 * Maximum allowed JSON-serialized size for GraphQL variables (50 KB).
 */
const MAX_VARIABLES_SIZE = 50_000;

/**
 * Maximum nesting depth for GraphQL variables objects.
 */
const MAX_VARIABLES_DEPTH = 10;

/**
 * Tenant identifier must be alphanumeric with hyphens only.
 * This prevents path traversal and URL injection via tenant parameter.
 */
const TENANT_IDENTIFIER_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/**
 * Zod schema for a validated tenant identifier.
 */
export const tenantSchema = z
    .string()
    .min(2)
    .max(128)
    .regex(TENANT_IDENTIFIER_REGEX, "Tenant identifier must be lowercase alphanumeric with hyphens only")
    .describe("The tenant identifier");

/**
 * Zod schema for a GraphQL query string with size limit.
 */
export const querySchema = z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH, `Query must not exceed ${MAX_QUERY_LENGTH} characters`)
    .describe("The GraphQL query to execute");

/**
 * Zod schema for a read-only GraphQL query string with size limit.
 */
export const readOnlyQuerySchema = z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH, `Query must not exceed ${MAX_QUERY_LENGTH} characters`)
    .describe("The GraphQL query to execute (mutations are not allowed)");

/**
 * Check the depth of a nested value. Returns true if within limit.
 */
function checkDepth(value: unknown, maxDepth: number, currentDepth: number = 0): boolean {
    if (currentDepth > maxDepth) return false;
    if (value === null || value === undefined || typeof value !== "object") return true;
    if (Array.isArray(value)) {
        return value.every((item) => checkDepth(item, maxDepth, currentDepth + 1));
    }
    return Object.values(value as Record<string, unknown>).every((v) => checkDepth(v, maxDepth, currentDepth + 1));
}

/**
 * Zod schema for GraphQL variables with size and depth constraints.
 */
export const variablesSchema = z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional GraphQL variables")
    .refine(
        (vars) => {
            if (!vars) return true;
            const serialized = JSON.stringify(vars);
            return serialized.length <= MAX_VARIABLES_SIZE;
        },
        { message: `Variables must not exceed ${MAX_VARIABLES_SIZE} characters when serialized` },
    )
    .refine(
        (vars) => {
            if (!vars) return true;
            return checkDepth(vars, MAX_VARIABLES_DEPTH);
        },
        { message: `Variables must not be nested more than ${MAX_VARIABLES_DEPTH} levels deep` },
    );

/**
 * Build an API URL with a properly encoded tenant identifier.
 */
export function buildApiUrl(base: string, tenant: string, path: string): string {
    return `${base}/${encodeURIComponent(tenant)}${path}`;
}

/**
 * Build an API URL with @ prefix (for Core and Shop APIs).
 */
export function buildAtApiUrl(base: string, tenant: string, path: string): string {
    return `${base}/@${encodeURIComponent(tenant)}${path}`;
}

/**
 * Strip potentially sensitive information from upstream API error messages.
 * Removes internal paths, stack traces, and overly verbose technical details.
 */
export function sanitizeErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);

    // Remove file paths (Unix and Windows)
    let sanitized = raw.replace(/(?:\/[\w.-]+){3,}/g, "[path]");
    sanitized = sanitized.replace(/[A-Z]:\\(?:[\w.-]+\\){2,}/g, "[path]");

    // Remove stack traces
    sanitized = sanitized.replace(/\s+at\s+.+:\d+:\d+/g, "");
    sanitized = sanitized.replace(/Error:?\s*\n\s+at\s+/g, "Error: ");

    // Truncate overly long error messages
    if (sanitized.length > 2000) {
        sanitized = sanitized.substring(0, 2000) + "... (truncated)";
    }

    return sanitized;
}
