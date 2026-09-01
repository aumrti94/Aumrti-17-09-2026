/**
 * OpenAPI 3.1 spec construction, derived entirely from the route registry.
 *
 * Deliberately shared rather than duplicated: the gateway serves this at /v1/openapi.json at
 * runtime, and scripts/generate-openapi.mjs writes the same output to docs/api/openapi.json for
 * the published documentation. Two implementations would drift, which is the exact failure this
 * whole approach exists to prevent — so there is one, and both consumers import it.
 *
 * Contract: docs/api/API_DESIGN_STANDARD.md
 */

import { ROUTES, type RouteDef } from "./routes.ts";
import { API_BASE_URL, DOCS_URL } from "../_shared/brand.ts";

/**
 * Column name → JSON Schema.
 *
 * Naming convention is the only signal available: the registry lists columns, not their Postgres
 * types. It is a heuristic and it is documentation-only — nothing validates against it — so a
 * wrong guess costs a slightly misleading type in the docs, never a rejected request.
 */
function schemaForColumn(name: string): Record<string, unknown> {
  if (name === "id" || /_id$/.test(name)) return { type: "string", format: "uuid" };
  if (/_at$/.test(name)) return { type: "string", format: "date-time" };
  if (/^(dob|.*_date)$/.test(name)) return { type: "string", format: "date" };
  if (/^(is_|has_)|_applicable$/.test(name)) return { type: "boolean" };
  if (/(amount|fee|percent|_due|_payable|numeric)$/.test(name)) return { type: "number" };
  if (name === "drugs" || name === "chronic_conditions") return { type: "array", items: {} };
  return { type: "string", nullable: true };
}

function resourceSchema(route: RouteDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const col of route.select) properties[col] = schemaForColumn(col);

  if (route.phi && route.phiFields?.length) {
    properties.redacted_fields = {
      type: "array",
      items: { type: "string" },
      description:
        "Present when the key lacks the read:patients scope. Names the fields withheld, so a " +
        "null here is distinguishable from a genuinely empty value.",
    };
  }
  return { type: "object", properties };
}

function operationFor(route: RouteDef, schemaName: string): Record<string, any> {
  const isCollection = !route.path.includes("{id}");

  const op: Record<string, any> = {
    summary: route.description,
    operationId: `${route.method.toLowerCase()}${route.path.replace(/[/{}]/g, "_")}`.replace(/_+/g, "_"),
    tags: [route.module],
    security: [{ ApiKeyAuth: [route.scope] }],
    description:
      `Requires the \`${route.scope}\` scope.` +
      (route.phi
        ? `\n\n**Returns patient-identifiable data.** Purpose: ${route.phiPurpose}` +
          (route.phiFields?.length
            ? "\n\nThese fields are withheld unless the key also holds `read:patients`: " +
              route.phiFields.map(f => `\`${f}\``).join(", ") + "."
            : "")
        : ""),
    parameters: [] as Record<string, unknown>[],
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: isCollection
              ? {
                  type: "object",
                  properties: {
                    data: { type: "array", items: { $ref: `#/components/schemas/${schemaName}` } },
                    has_more: { type: "boolean" },
                    next_cursor: { type: "string", nullable: true },
                  },
                }
              : { $ref: `#/components/schemas/${schemaName}` },
          },
        },
      },
      400: { $ref: "#/components/responses/InvalidRequest" },
      401: { $ref: "#/components/responses/Unauthenticated" },
      403: { $ref: "#/components/responses/Forbidden" },
      429: { $ref: "#/components/responses/RateLimited" },
    },
  };

  for (const m of route.path.matchAll(/\{(\w+)\}/g)) {
    op.parameters.push({
      name: m[1], in: "path", required: true, schema: { type: "string", format: "uuid" },
    });
    op.responses[404] = { $ref: "#/components/responses/NotFound" };
  }

  if (isCollection && route.method === "GET") {
    op.parameters.push(
      {
        name: "limit", in: "query", required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        description: "Page size. Values above 100 are clamped, not rejected.",
      },
      {
        name: "starting_after", in: "query", required: false, schema: { type: "string" },
        description: "Cursor from a previous response's next_cursor. Pass it verbatim.",
      },
    );
    for (const f of route.filters ?? []) {
      op.parameters.push({
        name: f.param, in: "query", required: false,
        schema: { type: "string" }, description: f.description,
      });
    }
  }

  if (route.write) {
    const props: Record<string, unknown> = {};
    for (const field of route.write.writable) props[field] = schemaForColumn(field);

    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: props,
            required: route.write.required ?? [],
            // Unknown fields are rejected by the gateway, not ignored — the schema says so too.
            additionalProperties: false,
          },
        },
      },
    };

    if (route.method === "POST") {
      op.responses[201] = op.responses[200];
      delete op.responses[200];
      op.parameters.push({
        name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" },
        description:
          "Send a unique value per distinct request. A retry with the same key returns the " +
          "original response instead of acting twice. Reusing a key with a different body is a 409.",
      });
      op.responses[409] = {
        description:
          "Conflict — the record already exists, or an Idempotency-Key was reused with a different body.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      };
    }
  }

  return op;
}

export function buildOpenApiSpec(routes: RouteDef[] = ROUTES): Record<string, any> {
  const paths: Record<string, any> = {};
  const schemas: Record<string, any> = {};

  for (const route of routes) {
    // Detail routes project more columns than list routes, so they are genuinely different
    // objects and must not share a schema name.
    const base = route.table.split("_").map(s => s[0].toUpperCase() + s.slice(1)).join("");
    const schemaName = route.path.includes("{id}") ? `${base}Detail` : base;
    if (!schemas[schemaName]) schemas[schemaName] = resourceSchema(route);

    if (!paths[route.path]) paths[route.path] = {};
    paths[route.path][route.method.toLowerCase()] = operationFor(route, schemaName);
  }

  schemas.Error = {
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["authentication_error", "permission_error", "invalid_request_error",
                   "rate_limit_error", "api_error"],
          },
          code: { type: "string" },
          message: { type: "string" },
          param: { type: "string" },
          request_id: { type: "string", description: "Quote this when reporting a problem." },
        },
      },
    },
  };

  const errorResponse = (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Aumrti HMS API",
      version: "1.0.0",
      description:
        "The public API for Aumrti hospital management.\n\n" +
        "Every request carries `Authorization: Bearer sk_live_…` (or `sk_test_…` for sandbox). " +
        "**The tenant is taken from the key** — no endpoint accepts a hospital identifier, so a " +
        "key can only ever reach its own hospital's data.\n\n" +
        "Lists are cursor-paginated, never offset: offset paging silently skips rows when the " +
        "underlying set changes mid-walk, which in a live OPD is constant.\n\n" +
        "This document is generated from the gateway's route registry and cannot drift from " +
        "actual behaviour. Do not edit it by hand.",
      contact: { name: "Aumrti Support", url: `${DOCS_URL}/api` },
    },
    servers: [{ url: API_BASE_URL, description: "Production" }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "http", scheme: "bearer",
          description:
            "An Aumrti API key issued from Settings → API Portal. Shown once at creation and " +
            "not recoverable — only a SHA-256 digest is stored. If it is lost, revoke and reissue.",
        },
      },
      schemas,
      responses: {
        InvalidRequest: errorResponse("The request was malformed, or a hospital rule refused it."),
        Unauthenticated: errorResponse("The API key is missing, malformed, revoked or expired."),
        Forbidden: errorResponse("The key lacks the required scope, or API access is not in the hospital's plan."),
        NotFound: errorResponse(
          "No such resource. A resource belonging to another hospital is indistinguishable from " +
          "one that does not exist.",
        ),
        RateLimited: errorResponse("Rate limit exceeded. Check the Retry-After header."),
      },
    },
    tags: [...new Set(routes.map(r => r.module))].sort().map(m => ({ name: m })),
    paths,
  };
}
