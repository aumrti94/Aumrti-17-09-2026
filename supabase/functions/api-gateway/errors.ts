/**
 * The single error shape for the whole public API.
 *
 * Stripe-style rather than RFC 9457 problem+json because it is the vocabulary Indian healthcare
 * integrators already have — the same people wiring Razorpay into the hospital are wiring this.
 *
 * See docs/api/API_DESIGN_STANDARD.md §4.
 */

export type ErrorType =
  | "authentication_error"
  | "permission_error"
  | "invalid_request_error"
  | "rate_limit_error"
  | "api_error";

const STATUS_FOR: Record<ErrorType, number> = {
  authentication_error: 401,
  permission_error: 403,
  invalid_request_error: 400,
  rate_limit_error: 429,
  api_error: 500,
};

export interface ApiErrorInit {
  type: ErrorType;
  code: string;
  message: string;
  param?: string;
  /** Overrides the default status for the type — e.g. 404 or 409 on invalid_request_error. */
  status?: number;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly type: ErrorType;
  readonly code: string;
  readonly param?: string;
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.type = init.type;
    this.code = init.code;
    this.param = init.param;
    this.status = init.status ?? STATUS_FOR[init.type];
    this.headers = init.headers ?? {};
  }
}

/** Every response carries these, success or failure. */
export function baseHeaders(requestId: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-Request-Id": requestId,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, content-type, idempotency-key, aumrti-version",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  };
}

export function errorResponse(err: unknown, requestId: string): Response {
  const apiErr = err instanceof ApiError
    ? err
    : new ApiError({
        type: "api_error",
        code: "internal_error",
        // The real cause goes to our logs, never to the caller: an unhandled Postgres message can
        // carry column names, constraint names and occasionally row values.
        message: "Something went wrong on our side. Quote the request id when reporting this.",
      });

  if (!(err instanceof ApiError)) {
    console.error(`[${requestId}] unhandled:`, err instanceof Error ? err.stack : err);
  }

  return new Response(
    JSON.stringify({
      error: {
        type: apiErr.type,
        code: apiErr.code,
        message: apiErr.message,
        ...(apiErr.param ? { param: apiErr.param } : {}),
        request_id: requestId,
      },
    }),
    { status: apiErr.status, headers: { ...baseHeaders(requestId), ...apiErr.headers } },
  );
}

export function jsonResponse(
  body: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...baseHeaders(requestId), ...extraHeaders },
  });
}

/** `req_` + 24 hex chars. Echoed in X-Request-Id and stored in api_request_log. */
export function newRequestId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "req_" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
