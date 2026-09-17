/**
 * Phase 3 exit-gate smoke spec.
 *
 * The gate: "A trivial smoke spec runs green **as two different hospitals**, via two
 * `storageState` files." Playwright runs this file twice — once under the `hospital-a`
 * project and once under `hospital-b` — so the same assertions execute against two distinct
 * sessions.
 *
 * It is deliberately thin. Its job is to prove the HARNESS works: the seed ran, the two
 * sessions are genuinely different, the app loads authenticated, and the service-role client
 * can read ground truth. Feature behaviour belongs in later phases.
 *
 * Note the assertions go to the DATABASE, not the DOM (§5 rule 1). Even here, where there is
 * barely anything to assert, "the page rendered" is not the claim being made.
 */
import { expect, test } from "@playwright/test";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_BY_TENANT, type TenantKey } from "./fixtures/constants";
import { serviceClient } from "./fixtures/serviceClient";

/** Which tenant this project is running as, derived from the project name. */
function tenantOf(projectName: string): TenantKey {
  return projectName.endsWith("-b") ? "b" : "a";
}

test.describe("harness smoke", () => {
  test("the seeded tenant exists and is the one this project runs as", async () => {
    // `test.info()` rather than the `async ({}, testInfo)` idiom — the empty destructure is
    // a lint error here and this reads better anyway.
    const tenant = tenantOf(test.info().project.name);
    const expected = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;

    const svc = serviceClient();
    const { data, error } = await svc
      .from("hospitals")
      .select("id, name, is_active")
      .eq("id", expected.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.name).toBe(expected.name);
    expect(data!.is_active).toBe(true);
  });

  test("both tenants exist, so isolation assertions have something to be isolated from", async () => {
    // A suite with one seeded hospital can never prove isolation: "B's row is invisible to A"
    // is satisfied by B's row not existing.
    const svc = serviceClient();
    const { data } = await svc.from("hospitals").select("id").in("id", [HOSPITAL_A.id, HOSPITAL_B.id]);
    expect(data).toHaveLength(2);
  });

  test("the tenant's seeded patients are present with the expected identities", async () => {
    const tenant = tenantOf(test.info().project.name);
    const expected = PATIENTS_BY_TENANT[tenant];

    const svc = serviceClient();
    const { data } = await svc
      .from("patients")
      .select("id, uhid, full_name")
      .eq("hospital_id", tenant === "a" ? HOSPITAL_A.id : HOSPITAL_B.id)
      .order("uhid");

    expect(data).toHaveLength(expected.length);
    expect(data!.map((p) => p.uhid)).toEqual(expected.map((p) => p.uhid).sort());
  });

  test("the app loads authenticated rather than bouncing to login", async ({ page }) => {
    // The one DOM assertion in the file, and it is about the HARNESS: it proves the
    // storageState was accepted. If this fails, every later spec fails too and this is the
    // cheapest place to find out.
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
  });
});
