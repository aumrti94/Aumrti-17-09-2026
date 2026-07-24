/**
 * subscriptionLock — module-level read-only flag consulted by the Supabase client's
 * fetch wrapper (src/integrations/supabase/client.ts).
 *
 * Deliberately React-free: `client.ts` is imported by non-React code and must not pull in
 * hooks. `<SubscriptionLockSync/>` pushes the resolved value in, exactly as
 * `AIEntitlementSync` does for `aiEntitlement.ts`.
 *
 * This is the UX layer — it turns a write into a readable message instead of a raw
 * PostgREST error, and it is trivially bypassable from devtools. The authoritative
 * enforcement is the DB trigger in migration ...163_enforce_subscription_access.sql.
 */

import { SUBSCRIPTION_BLOCKED_MESSAGE } from "./subscriptionAccess";

let locked = false;

export function setSubscriptionLock(value: boolean): void {
  locked = value;
}

export function isSubscriptionLocked(): boolean {
  return locked;
}

export { SUBSCRIPTION_BLOCKED_MESSAGE };

/**
 * Tables that must stay writable while locked, or the hospital can neither pay us,
 * log in, nor reach support — which would make the lock unrecoverable from inside the app.
 */
const WRITABLE_WHILE_LOCKED = new Set([
  "hospital_subscriptions",
  "subscription_events",
  "subscription_invoices",
  "platform_support_tickets",
  "entitlement_fail_open_events",
  "users",
  "audit_log",
  "admin_audit_log",
  "notification_log",
  "notification_queue",
  "email_notifications",
  "sms_notifications",
  "push_notifications",
  "fcm_tokens",
  "user_trusted_devices",
  "user_tour_progress",
  "product_analytics_events",
]);

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * PURE. Should this request be refused?
 *
 * Only PostgREST table writes are refused. Reads (GET/HEAD) always pass — that is what
 * makes this read-only rather than a lockout. `/rest/v1/rpc/*` passes too: many RPCs are
 * pure reads and there is no way to tell from the URL, so RPC writes are left to the DB
 * trigger. Auth and edge functions are never touched.
 */
export function shouldBlockRequest(url: string, method: string): boolean {
  if (!locked) return false;
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;

  const path = url.split("?")[0];
  const idx = path.indexOf("/rest/v1/");
  if (idx === -1) return false; // /auth/v1, /functions/v1, /storage/v1, realtime …

  const table = path.slice(idx + "/rest/v1/".length).split("/")[0];
  if (!table || table === "rpc") return false;

  return !WRITABLE_WHILE_LOCKED.has(table);
}
