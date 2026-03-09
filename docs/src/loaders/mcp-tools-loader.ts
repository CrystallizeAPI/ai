import type { Loader } from "astro/loaders";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

const TOOLS_DIR = join(
  new URL(".", import.meta.url).pathname,
  "../../../use-crystallize/mcp-servers/crystallize/src/core/mcp/tools",
);

const CONTAINER_FILE = join(
  new URL(".", import.meta.url).pathname,
  "../../../use-crystallize/mcp-servers/crystallize/src/core/container.ts",
);

type ZodField = {
  name: string;
  type: string;
  required: boolean;
  description: string;
};

/**
 * Parse the toolRegistry from container.ts to get the canonical tool name -> file mapping.
 */
async function getToolRegistry(): Promise<Map<string, string>> {
  const content = await readFile(CONTAINER_FILE, "utf-8");
  const registryMatch = content.match(
    /export const toolRegistry\s*=\s*\{([\s\S]*?)\}\s*as\s*const/,
  );
  if (!registryMatch) return new Map();

  const mapping = new Map<string, string>();
  // Match entries like: "query-discovery": "queryDiscoveryToolWrapper",
  // or: skills: "skillsToolWrapper",
  const entryRegex = /["']?([^"'\s:]+)["']?\s*:\s*["'](\w+)["']/g;
  let match;
  while ((match = entryRegex.exec(registryMatch[1])) !== null) {
    const toolName = match[1];
    // Convert wrapper name to filename: "queryDiscoveryToolWrapper" -> look for it in imports
    mapping.set(toolName, match[2]);
  }

  // Now resolve wrapper names to filenames from import statements
  const importRegex =
    /import\s*\{[^}]*\}\s*from\s*["']\.\/mcp\/tools\/([^"']+)["']/g;
  const fileToWrapper = new Map<string, string>();
  while ((match = importRegex.exec(content)) !== null) {
    const filename = match[1];
    // Find which wrapper is imported from this file
    const importMatch = content.match(
      new RegExp(
        `import\\s*\\{\\s*(\\w+)\\s*\\}\\s*from\\s*["']\\.\/mcp\\/tools\\/${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      ),
    );
    if (importMatch) {
      fileToWrapper.set(importMatch[1], filename);
    }
  }

  // Build final mapping: tool name -> filename
  const result = new Map<string, string>();
  for (const [toolName, wrapperName] of mapping) {
    // Find the create function that produces this wrapper
    // In container.ts: fetchContentModelToolWrapper: asFunction(createFetchContentModelToolWrapper)
    const createFnMatch = content.match(
      new RegExp(`${wrapperName}:\\s*asFunction\\((\\w+)\\)`),
    );
    if (createFnMatch) {
      const createFn = createFnMatch[1];
      const filename = fileToWrapper.get(createFn);
      if (filename) {
        result.set(toolName, filename);
      }
    }
  }

  return result;
}

/**
 * Extract the description string from a tool source file.
 * Handles multi-line string concatenation with +, and backtick template literals.
 */
function extractDescription(source: string): string {
  const descStart = source.indexOf("description:");
  if (descStart === -1) return "";

  const afterDesc = source.slice(descStart + "description:".length).trimStart();

  // Handle backtick template literals: extract static parts, replace ${...} with "..."
  if (afterDesc[0] === "`") {
    let depth = 0;
    let i = 1;
    let result = "";
    while (i < afterDesc.length) {
      if (afterDesc[i] === "$" && afterDesc[i + 1] === "{") {
        // Skip the template expression, replace with placeholder
        depth = 1;
        i += 2;
        while (i < afterDesc.length && depth > 0) {
          if (afterDesc[i] === "{") depth++;
          else if (afterDesc[i] === "}") depth--;
          i++;
        }
      } else if (afterDesc[i] === "`") {
        break;
      } else {
        result += afterDesc[i];
        i++;
      }
    }
    // Clean up artifacts from stripped template expressions
    return result
      .replace(/Available skills:\s*\./g, "")
      .replace(/Available reference slugs across skills:\s*\./g, "")
      .replace(/Available:\s*\./g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Handle regular string concatenation with +
  const parts: string[] = [];
  let remaining = afterDesc;

  while (true) {
    const quoteChar = remaining[0];
    if (quoteChar !== '"' && quoteChar !== "'") break;

    const endQuote = remaining.indexOf(quoteChar, 1);
    if (endQuote === -1) break;

    parts.push(remaining.slice(1, endQuote));
    remaining = remaining.slice(endQuote + 1).trimStart();

    if (remaining[0] === "+") {
      remaining = remaining.slice(1).trimStart();
    } else {
      break;
    }
  }

  return parts.join("");
}

/**
 * Extract the body of z.object({...}) handling nested braces correctly.
 */
function extractZodObjectBody(source: string): string | null {
  const marker = "inputSchema:";
  const start = source.indexOf(marker);
  if (start === -1) return null;

  const objStart = source.indexOf("{", source.indexOf("z.object(", start));
  if (objStart === -1) return null;

  let depth = 1;
  let i = objStart + 1;
  let inBacktick = false;
  let inDouble = false;
  let inSingle = false;

  while (i < source.length && depth > 0) {
    const ch = source[i];
    const prev = source[i - 1];

    if (inBacktick) {
      if (ch === "`" && prev !== "\\") inBacktick = false;
    } else if (inDouble) {
      if (ch === '"' && prev !== "\\") inDouble = false;
    } else if (inSingle) {
      if (ch === "'" && prev !== "\\") inSingle = false;
    } else {
      if (ch === "`") inBacktick = true;
      else if (ch === '"') inDouble = true;
      else if (ch === "'") inSingle = true;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth > 0) i++;
  }

  return source.slice(objStart + 1, i);
}

/**
 * Strip template literal expressions ${...} from a string, keeping static text.
 */
function stripTemplateExpressions(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < s.length && depth > 0) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") depth--;
        i++;
      }
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}

/**
 * Extract Zod input schema fields from a tool source file.
 */
function extractInputSchema(source: string): ZodField[] {
  const fields: ZodField[] = [];

  const schemaBody = extractZodObjectBody(source);
  if (!schemaBody) return fields;

  // Match each field definition
  // Pattern: fieldName: z.type().optional().describe("..." or `...`)
  const fieldRegex =
    /(\w+):\s*z\b([\s\S]*?)\.describe\(\s*(?:`([\s\S]*?)`|"([\s\S]*?)"|'([\s\S]*?)')\s*,?\s*\)/g;
  let match;
  while ((match = fieldRegex.exec(schemaBody)) !== null) {
    const name = match[1];
    const zodChain = match[2];
    let description = match[3] || match[4] || match[5] || "";

    // Strip template expressions from backtick strings
    if (match[3] !== undefined) {
      description = stripTemplateExpressions(description);
    }

    // Determine type from zod chain
    let type = "string";
    if (zodChain.includes("array(z.string())")) type = "string[]";
    else if (zodChain.includes("boolean")) type = "boolean";
    else if (zodChain.includes("record(")) type = "object";
    else if (zodChain.includes("array(")) type = "array";
    else if (zodChain.includes("number")) type = "number";

    const required = !zodChain.includes(".optional()");

    fields.push({
      name,
      type,
      required,
      description: description
        .replace(/\s*Available:.*$/, "")
        .replace(/\s+/g, " ")
        .trim(),
    });
  }

  return fields;
}

export function mcpToolsLoader(): Loader {
  return {
    name: "mcp-tools-loader",
    load: async ({ store, logger, generateDigest }) => {
      logger.info("Loading MCP tools from source files");
      store.clear();

      const registry = await getToolRegistry();
      if (registry.size === 0) {
        logger.warn("Could not parse tool registry from container.ts");
        // Fallback: read all .ts files from the tools directory
        const files = await readdir(TOOLS_DIR);
        for (const file of files) {
          if (!file.endsWith(".ts")) continue;
          const name = basename(file, ".ts");
          registry.set(name, name);
        }
      }

      for (const [toolName, filename] of registry) {
        const filePath = join(TOOLS_DIR, `${filename}.ts`);
        let source: string;
        try {
          source = await readFile(filePath, "utf-8");
        } catch {
          logger.warn(`Could not read tool file: ${filePath}`);
          continue;
        }

        const description = extractDescription(source);
        const inputSchema = extractInputSchema(source);

        const data = {
          toolName,
          description,
          inputSchema,
        };

        store.set({
          id: toolName,
          data,
          digest: generateDigest(source),
        });

        logger.info(`  Loaded tool: ${toolName}`);
      }
    },
  };
}
