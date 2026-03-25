import {
    GraphqlSchemaCompacter,
    GraphqlSchemaCompacterOptions,
    CompactSchemaOptions,
} from "../../contracts/graphql-schema-compacter";

export { type IntrospectionResult };

export const INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind name description
      fields(includeDeprecated: false) {
        name description
        args { name type { ...TypeRef } defaultValue }
        type { ...TypeRef }
      }
      inputFields {
        name type { ...TypeRef } defaultValue
      }
      interfaces { name }
      enumValues(includeDeprecated: false) { name }
      possibleTypes { name }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType {
    kind name
    ofType {
      kind name
      ofType {
        kind name
        ofType {
          kind name
          ofType {
            kind name
            ofType { kind name }
          }
        }
      }
    }
  }
}`;

type IntrospectionType = {
    kind: string;
    name: string;
    description?: string;
    fields?: IntrospectionField[];
    inputFields?: IntrospectionInputValue[];
    interfaces?: { name: string }[];
    enumValues?: { name: string }[];
    possibleTypes?: { name: string }[];
};

type IntrospectionField = {
    name: string;
    description?: string;
    args: IntrospectionInputValue[];
    type: TypeRef;
};

type IntrospectionInputValue = {
    name: string;
    type: TypeRef;
    defaultValue?: string;
};

type TypeRef = {
    kind: string;
    name: string | null;
    ofType: TypeRef | null;
};

type IntrospectionResult = {
    data: {
        __schema: {
            queryType: { name: string } | null;
            mutationType: { name: string } | null;
            types: IntrospectionType[];
        };
    };
};

const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);
const BUILTIN_TYPES = new Set([
    ...BUILTIN_SCALARS,
    "__Schema",
    "__Type",
    "__Field",
    "__InputValue",
    "__EnumValue",
    "__Directive",
    "__DirectiveLocation",
]);

function renderTypeRef(ref: TypeRef): string {
    if (ref.kind === "NON_NULL") {
        return `${renderTypeRef(ref.ofType!)}!`;
    }
    if (ref.kind === "LIST") {
        return `[${renderTypeRef(ref.ofType!)}]`;
    }
    return ref.name ?? "Unknown";
}

function renderArgs(args: IntrospectionInputValue[]): string {
    if (args.length === 0) return "";
    const parts = args.map((a) => {
        const def = a.defaultValue ? ` = ${a.defaultValue}` : "";
        return `${a.name}: ${renderTypeRef(a.type)}${def}`;
    });
    return `(${parts.join(", ")})`;
}

function renderFields(fields: IntrospectionField[]): string {
    return fields
        .map((f) => {
            const args = renderArgs(f.args);
            return `${f.name}${args}:${renderTypeRef(f.type)}`;
        })
        .join(" ");
}

function renderInputFields(fields: IntrospectionInputValue[]): string {
    return fields
        .map((f) => {
            const def = f.defaultValue ? ` = ${f.defaultValue}` : "";
            return `${f.name}:${renderTypeRef(f.type)}${def}`;
        })
        .join(" ");
}

function renderRootFields(fields: IntrospectionField[]): string {
    return fields
        .map((f) => {
            const desc = f.description ? ` # ${f.description.replaceAll("\n", " ").trim()}` : "";
            return `${f.name}${renderArgs(f.args)}: ${renderTypeRef(f.type)}${desc}`;
        })
        .join("\n");
}

/**
 * Extract all type names referenced by a TypeRef (recursing through NON_NULL, LIST wrappers).
 */
function extractTypeNames(ref: TypeRef | null): string[] {
    if (!ref) return [];
    if (ref.name && ref.kind !== "NON_NULL" && ref.kind !== "LIST") {
        return [ref.name];
    }
    return extractTypeNames(ref.ofType);
}

/**
 * Compute reachable types from root query/mutation fields via BFS.
 */
function computeReachableTypes(allTypes: IntrospectionType[], rootTypeNames: string[]): Set<string> {
    const typesByName = new Map<string, IntrospectionType>();
    for (const t of allTypes) {
        typesByName.set(t.name, t);
    }

    const reachable = new Set<string>();
    const queue: string[] = [...rootTypeNames];

    while (queue.length > 0) {
        const name = queue.pop()!;
        if (reachable.has(name) || BUILTIN_TYPES.has(name) || name.startsWith("__")) continue;
        reachable.add(name);

        const t = typesByName.get(name);
        if (!t) continue;

        for (const f of t.fields ?? []) {
            for (const ref of extractTypeNames(f.type)) {
                if (!reachable.has(ref)) queue.push(ref);
            }
            for (const a of f.args) {
                for (const ref of extractTypeNames(a.type)) {
                    if (!reachable.has(ref)) queue.push(ref);
                }
            }
        }
        for (const f of t.inputFields ?? []) {
            for (const ref of extractTypeNames(f.type)) {
                if (!reachable.has(ref)) queue.push(ref);
            }
        }
        for (const iface of t.interfaces ?? []) {
            if (!reachable.has(iface.name)) queue.push(iface.name);
        }
        for (const pt of t.possibleTypes ?? []) {
            if (!reachable.has(pt.name)) queue.push(pt.name);
        }
    }

    return reachable;
}

/**
 * Build a set of field names defined on interfaces so implementing types can skip them.
 */
function buildInterfaceFieldSets(typeMap: Map<string, IntrospectionType>): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const [name, t] of typeMap) {
        if (t.kind === "INTERFACE" && t.fields) {
            result.set(name, new Set(t.fields.map((f) => f.name)));
        }
    }
    return result;
}

/**
 * Get the set of field names inherited from interfaces for a given OBJECT type.
 */
function getInheritedFieldNames(t: IntrospectionType, interfaceFieldSets: Map<string, Set<string>>): Set<string> {
    const inherited = new Set<string>();
    for (const iface of t.interfaces ?? []) {
        const fields = interfaceFieldSets.get(iface.name);
        if (fields) {
            for (const f of fields) inherited.add(f);
        }
    }
    return inherited;
}

/**
 * Detect common field groups that appear across multiple types and extract them as aliases.
 * Returns the aliases map and a function to filter fields for a type.
 */
function extractCommonFieldGroups(types: { name: string; fields: IntrospectionField[] }[]): {
    aliases: Map<string, IntrospectionField[]>;
    typeFieldAliases: Map<string, string[]>;
} {
    // Build a frequency map of field signatures (name + type)
    const fieldSigToTypes = new Map<string, Set<string>>();
    const fieldSigToField = new Map<string, IntrospectionField>();
    const typeFieldSigs = new Map<string, Set<string>>();

    for (const t of types) {
        const sigs = new Set<string>();
        for (const f of t.fields) {
            // Only consider simple fields (no args) for grouping
            if (f.args.length > 0) continue;
            const sig = `${f.name}:${renderTypeRef(f.type)}`;
            sigs.add(sig);
            fieldSigToField.set(sig, f);
            if (!fieldSigToTypes.has(sig)) fieldSigToTypes.set(sig, new Set());
            fieldSigToTypes.get(sig)!.add(t.name);
        }
        typeFieldSigs.set(t.name, sigs);
    }

    // Find field sigs that appear in 3+ types
    const commonSigs = [...fieldSigToTypes.entries()].filter(([_, typeSet]) => typeSet.size >= 3).map(([sig]) => sig);

    if (commonSigs.length < 2) {
        return { aliases: new Map(), typeFieldAliases: new Map() };
    }

    // Group common sigs by which types they appear in (find sigs that co-occur)
    // Simple approach: find the largest group of sigs that appear together in the same types
    const sigsByTypeSet = new Map<string, string[]>();
    for (const sig of commonSigs) {
        const typeSet = [...fieldSigToTypes.get(sig)!].sort().join(",");
        if (!sigsByTypeSet.has(typeSet)) sigsByTypeSet.set(typeSet, []);
        sigsByTypeSet.get(typeSet)!.push(sig);
    }

    const aliases = new Map<string, IntrospectionField[]>();
    const typeFieldAliases = new Map<string, string[]>();
    let aliasIndex = 0;

    for (const [typeSetKey, sigs] of sigsByTypeSet) {
        // Only create an alias if it covers 2+ fields across 3+ types
        if (sigs.length < 2) continue;
        const typeNames = typeSetKey.split(",");
        if (typeNames.length < 3) continue;

        const aliasName = `@F${aliasIndex++}`;
        aliases.set(
            aliasName,
            sigs.map((s) => fieldSigToField.get(s)!),
        );

        for (const typeName of typeNames) {
            if (!typeFieldAliases.has(typeName)) typeFieldAliases.set(typeName, []);
            typeFieldAliases.get(typeName)!.push(aliasName);
        }
    }

    return { aliases, typeFieldAliases };
}

export async function fetchIntrospection(url: string, headers?: Record<string, string>): Promise<IntrospectionResult> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ query: INTROSPECTION_QUERY }),
    });

    if (!response.ok) {
        throw new Error(`Introspection failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as IntrospectionResult;
}

export function compactSchemaFromIntrospection(result: IntrospectionResult, options?: CompactSchemaOptions): string {
    const operations = options?.operations ?? "both";
    const rootFieldFilter = options?.rootFieldFilter;
    const schema = result.data.__schema;

    const includeQueries = operations === "queries" || operations === "both";
    const includeMutations = operations === "mutations" || operations === "both";

    const queryTypeName = includeQueries ? schema.queryType?.name : undefined;
    const mutationTypeName = includeMutations ? schema.mutationType?.name : undefined;
    const rootNames = new Set([queryTypeName, mutationTypeName].filter(Boolean));

    // Optionally filter root fields by name
    const filterRootFields = (fields: IntrospectionField[]): IntrospectionField[] => {
        if (!rootFieldFilter) return fields;
        return fields.filter((f) => rootFieldFilter.has(f.name));
    };

    // Reachability: only include types reachable from root queries/mutations
    const rootTypeNames: string[] = [];
    for (const name of rootNames) {
        const rootType = schema.types.find((t) => t.name === name);
        if (rootType?.fields) {
            for (const f of filterRootFields(rootType.fields)) {
                rootTypeNames.push(...extractTypeNames(f.type));
                for (const a of f.args) {
                    rootTypeNames.push(...extractTypeNames(a.type));
                }
            }
        }
    }
    const reachable = computeReachableTypes(schema.types, rootTypeNames);

    const typeMap = new Map<string, IntrospectionType>();
    for (const t of schema.types) {
        if (t.name.startsWith("__") || BUILTIN_TYPES.has(t.name) || rootNames.has(t.name)) continue;
        if (!reachable.has(t.name)) continue;
        typeMap.set(t.name, t);
    }

    // Build interface field sets for deduplication
    const interfaceFieldSets = buildInterfaceFieldSets(typeMap);

    const sections: string[] = [];

    // Queries
    if (queryTypeName) {
        const queryType = schema.types.find((t) => t.name === queryTypeName);
        if (queryType?.fields?.length) {
            const fields = filterRootFields(queryType.fields);
            if (fields.length) {
                sections.push(`# Queries\n${renderRootFields(fields)}`);
            }
        }
    }

    // Mutations
    if (mutationTypeName) {
        const mutationType = schema.types.find((t) => t.name === mutationTypeName);
        if (mutationType?.fields?.length) {
            const fields = filterRootFields(mutationType.fields);
            if (fields.length) {
                sections.push(`# Mutations\n${renderRootFields(fields)}`);
            }
        }
    }

    // Collect object types for common field extraction
    const objectEntries: { name: string; fields: IntrospectionField[]; implements?: string[] }[] = [];
    const interfaceTypes: string[] = [];
    const unionTypes: string[] = [];
    const enumTypes: string[] = [];
    const inputTypes: string[] = [];
    const scalarTypes: string[] = [];

    for (const [name, t] of typeMap) {
        switch (t.kind) {
            case "OBJECT":
                if (t.fields?.length) {
                    const inherited = getInheritedFieldNames(t, interfaceFieldSets);
                    const ownFields = inherited.size > 0 ? t.fields.filter((f) => !inherited.has(f.name)) : t.fields;
                    const implements_ = t.interfaces?.length ? t.interfaces.map((i) => i.name) : undefined;
                    objectEntries.push({ name, fields: ownFields, implements: implements_ });
                }
                break;
            case "INTERFACE":
                if (t.fields?.length) {
                    objectEntries.push({ name, fields: t.fields });
                    interfaceTypes.push(`${name}: ${t.possibleTypes?.map((p) => p.name).join(" | ") ?? ""}`);
                }
                break;
            case "UNION":
                unionTypes.push(`${name}: ${t.possibleTypes?.map((p) => p.name).join(" | ") ?? ""}`);
                break;
            case "ENUM":
                if (t.enumValues?.length) {
                    enumTypes.push(`${name}: ${t.enumValues.map((e) => e.name).join(" | ")}`);
                }
                break;
            case "INPUT_OBJECT":
                if (t.inputFields?.length) {
                    inputTypes.push(`${name}: ${renderInputFields(t.inputFields)}`);
                }
                break;
            case "SCALAR":
                scalarTypes.push(name);
                break;
        }
    }

    // Extract common field groups
    const { aliases, typeFieldAliases } = extractCommonFieldGroups(objectEntries);

    // Render aliases section
    if (aliases.size > 0) {
        const aliasLines: string[] = [];
        for (const [alias, fields] of aliases) {
            aliasLines.push(`${alias} = ${renderFields(fields)}`);
        }
        sections.push(`# Field Groups\n${aliasLines.join("\n")}`);
    }

    // Render object types with alias references and interface inheritance
    const objectTypes: string[] = [];
    for (const entry of objectEntries) {
        const parts: string[] = [];
        // Show implements
        if (entry.implements?.length) {
            parts.push(`[${entry.implements.join(", ")}]`);
        }
        // Show field group aliases
        const entryAliases = typeFieldAliases.get(entry.name);
        if (entryAliases?.length) {
            parts.push(entryAliases.join(" "));
        }
        // Render remaining fields (exclude those covered by aliases)
        const aliasedFieldNames = new Set<string>();
        if (entryAliases) {
            for (const alias of entryAliases) {
                const aliasFields = aliases.get(alias);
                if (aliasFields) {
                    for (const f of aliasFields) aliasedFieldNames.add(f.name);
                }
            }
        }
        const remainingFields = entry.fields.filter((f) => !aliasedFieldNames.has(f.name));
        if (remainingFields.length > 0) {
            parts.push(renderFields(remainingFields));
        }

        if (parts.length > 0) {
            objectTypes.push(`${entry.name}: ${parts.join(" ")}`);
        }
    }

    if (objectTypes.length) sections.push(`# Types\n${objectTypes.join("\n")}`);
    if (interfaceTypes.length) sections.push(`# Interfaces\n${interfaceTypes.join("\n")}`);
    if (unionTypes.length) sections.push(`# Unions\n${unionTypes.join("\n")}`);
    if (enumTypes.length) sections.push(`# Enums\n${enumTypes.join("\n")}`);
    if (inputTypes.length) sections.push(`# Inputs\n${inputTypes.join("\n")}`);
    if (scalarTypes.length) sections.push(`# Scalars\n${scalarTypes.join(" ")}`);

    return sections.join("\n\n");
}

export const createGraphlSchemaCompacter =
    (): GraphqlSchemaCompacter =>
    async (url: string, options?: GraphqlSchemaCompacterOptions): Promise<string> => {
        const result = await fetchIntrospection(url, options?.headers);
        return compactSchemaFromIntrospection(result, { operations: options?.operations });
    };
