/**
 * The guard that stands between a seed script and production.
 *
 * D5, enforcement mechanism 1: "The seed script refuses to run unless `SUPABASE_PROJECT_REF`
 * matches the test project allowlist — a guard against a seed or truncate ever pointing at
 * production."
 *
 * This file exists because the seed TRUNCATES and rewrites tenant data. Pointed at the wrong
 * database, it is not a failed test — it is a hospital losing patient records. So the guard
 * fails CLOSED: anything it cannot positively recognise as a local test container is refused,
 * and there is deliberately no environment variable that can switch it off.
 */

/** Local Supabase, as started by `supabase start`. The only host the seed may write to. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1", "host.docker.internal"]);

/** Ports `supabase start` binds. 54321 is the API gateway; 54322 is Postgres. */
const LOCAL_PORTS = new Set(["54321", "54322", "54323", ""]);

/**
 * Project refs the seed is allowed to target.
 *
 * Empty by design. A cloud staging ref is added here ONLY alongside a written sign-off, and
 * adding one is a deliberate act with a reviewer — not a convenience. Phase 8 is where that
 * conversation happens; until then no cloud project is seedable at all.
 */
export const ALLOWED_PROJECT_REFS: readonly string[] = [];

export class UnsafeSeedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSeedTargetError";
  }
}

function hostOf(url: string): { host: string; port: string } {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: parsed.port };
}

/**
 * Throw unless `url` is unmistakably a local test container.
 *
 * Checks the URL rather than trusting a flag, because the URL is what the client actually
 * connects to — a `NODE_ENV=test` that disagrees with `SUPABASE_URL` is exactly how this
 * goes wrong.
 */
export function assertLocalTarget(url: string | undefined, projectRef?: string | undefined): void {
  if (!url) {
    throw new UnsafeSeedTargetError(
      "No Supabase URL supplied. The seed refuses to guess a target — set SUPABASE_URL to your local container (http://127.0.0.1:54321).",
    );
  }

  let host: string;
  let port: string;
  try {
    ({ host, port } = hostOf(url));
  } catch {
    throw new UnsafeSeedTargetError(`Supabase URL is not a valid URL: ${url}`);
  }

  const isLocalHost = LOCAL_HOSTS.has(host);
  const isAllowedRef = !!projectRef && ALLOWED_PROJECT_REFS.includes(projectRef);

  if (!isLocalHost && !isAllowedRef) {
    throw new UnsafeSeedTargetError(
      [
        `REFUSING TO SEED. Target host "${host}" is not a local Supabase container and`,
        projectRef
          ? `project ref "${projectRef}" is not in the allowlist.`
          : "no SUPABASE_PROJECT_REF was supplied to check against the allowlist.",
        "",
        "This script truncates and rewrites tenant data. Run it against `supabase start`",
        "(http://127.0.0.1:54321) only. Adding a cloud ref to ALLOWED_PROJECT_REFS in",
        "e2e/fixtures/guard.ts is a reviewed decision, not a workaround.",
      ].join("\n"),
    );
  }

  if (isLocalHost && !LOCAL_PORTS.has(port)) {
    throw new UnsafeSeedTargetError(
      `Target is localhost but port ${port} is not one \`supabase start\` binds (54321/54322/54323). Refusing in case this is a tunnel to a remote database.`,
    );
  }
}

/**
 * True when the URL is a local container. For callers that want to branch rather than throw.
 */
export function isLocalTarget(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { host, port } = hostOf(url);
    return LOCAL_HOSTS.has(host) && LOCAL_PORTS.has(port);
  } catch {
    return false;
  }
}
