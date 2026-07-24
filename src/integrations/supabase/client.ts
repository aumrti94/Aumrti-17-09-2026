import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { shouldBlockRequest, SUBSCRIPTION_BLOCKED_MESSAGE } from '@/lib/subscriptionLock';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

/**
 * Read-only guard for an inactive subscription.
 *
 * Wrapping fetch is the one place that covers every write in the app — there are hundreds
 * of call sites and no shared mutation helper. Reads pass through untouched, so an expired
 * hospital keeps full access to its own records; only writes are refused, and with a
 * readable message rather than a raw PostgREST error. See src/lib/subscriptionLock.ts for
 * what is exempt, and migration ...163 for the authoritative server-side enforcement.
 */
const guardedFetch: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

  if (shouldBlockRequest(url, method)) {
    return Promise.reject(new Error(SUBSCRIPTION_BLOCKED_MESSAGE));
  }
  return fetch(input, init);
};

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  global: { fetch: guardedFetch },
});