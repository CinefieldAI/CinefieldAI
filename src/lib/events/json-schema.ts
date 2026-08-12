/**
 * Cinefield strict JSON Schema subset (Phase 6R.15).
 *
 * No network, no I/O, no dependency — pure validation, safe to import
 * anywhere a domain event is built, published, or consumed.
 *
 * WHY A SUBSET RATHER THAN A JSON SCHEMA LIBRARY
 * A full validator brings a dependency whose own keyword coverage,
 * draft dialect and error shape then become part of Cinefield's event
 * contract. The events here are flat records of identifiers, enums,
 * timestamps and numbers — a deliberately small keyword set covers all of
 * them, and keeping it in-repo means the contract is reviewable in one file.
 *
 * THE CRITICAL DESIGN RULE: UNKNOWN KEYWORDS ARE A HARD ERROR
 * A subset validator that silently IGNORES a keyword it does not implement
 * is worse than no validator: a schema author writes `"minItems": 1`,
 * believes it is enforced, and it never is. So `compileSchema` throws on any
 * keyword outside the supported set. A schema either validates exactly what
 * it says, or it refuses to exist. That is also why `additionalProperties`
 * must be explicitly `false` on every object — an event payload with room
 * for undeclared fields is how secrets end up on the bus.
 *
 * SUPPORTED: type, const, enum, properties, required, additionalProperties,
 * items, minimum, maximum, minLength, maxLength, pattern, format
 *            (date-time | uuid), description (ignored, documentation only).
 * NOT SUPPORTED (and therefore rejected, never ignored): $ref, allOf, anyOf,
 * oneOf, not, if/then/else, patternProperties, dependencies, minItems,
 * maxItems, uniqueItems, multipleOf, and every other keyword.
 */

export type JsonSchemaType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  const?: unknown;
  enum?: readonly unknown[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: false;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: "date-time" | "uuid";
  description?: string;
}

const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "description",
]);

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Structurally validates a schema itself, throwing on anything this
 * validator would not enforce. Call it once, at registry construction, so a
 * malformed schema is a startup failure rather than a silent gap that only
 * shows up as an unvalidated event in production.
 */
export function compileSchema(schema: JsonSchema, path = "#"): JsonSchema {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error(`json-schema: ${path} must be an object`);
  }

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(
        `json-schema: ${path} uses unsupported keyword "${keyword}" — ` +
          `it would NOT be enforced, so the schema is rejected rather than silently weakened`
      );
    }
  }

  const declaredTypes = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];

  if (declaredTypes.includes("object")) {
    if (schema.additionalProperties !== false) {
      throw new Error(
        `json-schema: ${path} is an object and must set "additionalProperties": false — ` +
          `an open event payload is how undeclared data reaches the event bus`
      );
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      compileSchema(child, `${path}/properties/${key}`);
    }
    for (const name of schema.required ?? []) {
      if (!(name in (schema.properties ?? {}))) {
        throw new Error(`json-schema: ${path} requires "${name}" but never declares it`);
      }
    }
  }

  if (schema.items) compileSchema(schema.items, `${path}/items`);
  if (schema.pattern !== undefined) new RegExp(schema.pattern); // throws on a bad pattern

  return schema;
}

function typeMatches(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
  }
}

/**
 * Validates a value, returning every violation rather than the first — a
 * producer fixing an event wants the whole list, not one round-trip per
 * field. Paths are JSON-pointer-ish and carry no VALUES, only locations, so
 * a validation error can be logged without leaking payload contents.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = ""): string[] {
  const errors: string[] = [];
  const at = path || "(root)";

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${at}: expected ${types.join(" | ")}`);
      // Every further check assumes the type held; reporting them too would
      // be noise derived from one root cause.
      return errors;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: does not match the required constant`);
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${at}: not one of the permitted values`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: shorter than minLength`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: longer than maxLength`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: does not match pattern`);
    }
    if (schema.format === "uuid" && !UUID_PATTERN.test(value)) {
      errors.push(`${at}: not a uuid`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${at}: not a date-time`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above maximum`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => {
      errors.push(...validateAgainstSchema(entry, schema.items!, `${path}/${index}`));
    });
  }

  if (typeMatches(value, "object") && (schema.properties || schema.required)) {
    const record = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (record[name] === undefined) errors.push(`${path}/${name}: required`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (record[key] !== undefined) {
        errors.push(...validateAgainstSchema(record[key], child, `${path}/${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in (schema.properties ?? {}))) {
          errors.push(`${path}/${key}: not declared by the schema`);
        }
      }
    }
  }

  return errors;
}
