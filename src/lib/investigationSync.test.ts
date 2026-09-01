import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * syncLabOrders must produce ONE lab order holding every prescribed test.
 *
 * It used to call create_lab_order_with_items INSIDE the per-test loop with p_items hardcoded
 * to a single-element array, so an 11-test prescription became 11 lab_orders headers — 11
 * accessions, 11 samples, 11 cards in the lab worklist each reading "1/1 done", and a
 * collection run that drew blood 11 times from one patient at one sitting. The RPC has always
 * taken p_items as an array; only the caller was wrong.
 *
 * These tests pin the SHAPE of the RPC call, because the defect was invisible from the return
 * value alone — it reported "created: 11" either way.
 */

const { mockRpc, mockFrom } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
}));
vi.mock("@/lib/nabh-evidence", () => ({ logNABHEvidence: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/pcpndt", () => ({
  requiresPcpndtFormF: () => false,
  buildFormFRow: () => ({}),
  ageFromDob: () => 0,
}));

import { syncLabOrders } from "./investigationSync";

/** Minimal PostgREST-ish chain: every filter returns itself, awaiting yields { data }. */
function chain(data: unknown) {
  const result = { data, error: null } as any;
  const asPromise = Promise.resolve(result);
  const proxy: any = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === "then") return asPromise.then.bind(asPromise);
      if (prop === "catch") return asPromise.catch.bind(asPromise);
      if (prop === "maybeSingle") return vi.fn().mockResolvedValue(result);
      return vi.fn().mockReturnValue(proxy);
    },
  });
  return proxy;
}

const MASTER = [
  { id: "t-hb",    test_name: "Haemoglobin",  sample_type: "blood", unit: "g/dL", normal_min: 13, normal_max: 17 },
  { id: "t-crp",   test_name: "CRP",          sample_type: "blood", unit: "mg/L", normal_min: 0,  normal_max: 5 },
  { id: "t-urine", test_name: "Urine Routine", sample_type: "urine", unit: null,  normal_min: null, normal_max: null },
];

function setup(opts?: { existingTests?: unknown[] }) {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockRpc.mockResolvedValue({ data: "new-order-id", error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === "lab_test_master") return chain(MASTER);
    if (table === "lab_orders") return chain(opts?.existingTests ?? []);
    return chain([]);
  });
}

const BASE = { hospitalId: "h1", patientId: "p1", orderedBy: "doc-1", encounterId: "enc-1" };

beforeEach(() => setup());

describe("syncLabOrders — one order per prescription", () => {
  it("creates exactly ONE order for three tests, with all three as items", async () => {
    const res = await syncLabOrders({
      ...BASE,
      items: [{ test_name: "Haemoglobin" }, { test_name: "CRP" }, { test_name: "Urine Routine" }],
    });

    expect(
      mockRpc,
      "The order-creating RPC ran more than once — that is one lab order per test again.",
    ).toHaveBeenCalledTimes(1);

    const args = mockRpc.mock.calls[0][1];
    expect(args.p_items).toHaveLength(3);
    expect(args.p_items.map((i: any) => i.test_id)).toEqual(["t-hb", "t-crp", "t-urine"]);

    expect(res.created).toBe(3);
    expect(res.orderIds).toEqual(["new-order-id"]);
  });

  it("draws one sample per specimen type, not one per test", async () => {
    await syncLabOrders({
      ...BASE,
      // Two blood tests + one urine → two collections, not three.
      items: [{ test_name: "Haemoglobin" }, { test_name: "CRP" }, { test_name: "Urine Routine" }],
    });

    const args = mockRpc.mock.calls[0][1];
    expect(
      args.p_samples.map((s: any) => s.sample_type).sort(),
      "A patient must not be stuck once per test when one draw covers several.",
    ).toEqual(["blood", "urine"]);
    expect(args.p_samples.every((s: any) => typeof s.barcode === "string" && s.barcode.length > 0)).toBe(true);
  });

  it("takes the most urgent priority across the tests", async () => {
    await syncLabOrders({
      ...BASE,
      items: [
        { test_name: "Haemoglobin", urgency: "routine" },
        { test_name: "CRP", urgency: "stat" },
      ],
    });
    expect(
      mockRpc.mock.calls[0][1].p_priority,
      "A STAT test must not be slowed to routine because it shared a prescription with one.",
    ).toBe("stat");
  });

  it("keeps every clinical indication rather than dropping all but the first", async () => {
    await syncLabOrders({
      ...BASE,
      items: [
        { test_name: "CRP", clinical_indication: "sepsis workup" },
        { test_name: "Haemoglobin", clinical_indication: "anaemia" },
      ],
    });
    const notes = mockRpc.mock.calls[0][1].p_clinical_notes as string;
    expect(notes).toContain("sepsis workup");
    expect(notes).toContain("anaemia");
  });

  it("creates the order as unbilled — the counter bills it, not this function", async () => {
    await syncLabOrders({ ...BASE, items: [{ test_name: "CRP" }] });
    expect(
      mockRpc.mock.calls[0][1].p_billing_status,
      "Creating the order already billed is what let the lab draw blood before anyone paid.",
    ).toBe("unbilled");
  });

  it("carries the encounter link and the prescriber onto the single order", async () => {
    await syncLabOrders({ ...BASE, items: [{ test_name: "CRP" }] });
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_encounter_id).toBe("enc-1");
    expect(args.p_admission_id).toBeNull();
    expect(args.p_ordered_by).toBe("doc-1");
  });

  it("reports unmatched tests and still orders the matched ones on one order", async () => {
    const res = await syncLabOrders({
      ...BASE,
      items: [{ test_name: "CRP" }, { test_name: "Not A Real Test" }],
    });
    expect(res.unmatched).toEqual(["Not A Real Test"]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1].p_items).toHaveLength(1);
    expect(res.created).toBe(1);
  });

  it("does not call the RPC at all when nothing is orderable", async () => {
    const res = await syncLabOrders({ ...BASE, items: [{ test_name: "Not A Real Test" }] });
    expect(
      mockRpc,
      "The RPC raises on an empty p_items, so a re-completed consultation must not call it.",
    ).not.toHaveBeenCalled();
    expect(res).toEqual({ created: 0, unmatched: ["Not A Real Test"], orderIds: [] });
  });

  it("skips tests already ordered for this encounter", async () => {
    setup({
      existingTests: [{ id: "old", lab_order_items: [{ test_id: "t-crp", lab_test_master: { test_name: "CRP" } }] }],
    });

    const res = await syncLabOrders({
      ...BASE,
      items: [{ test_name: "CRP" }, { test_name: "Haemoglobin" }],
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1].p_items.map((i: any) => i.test_id)).toEqual(["t-hb"]);
    expect(res.created).toBe(1);
  });

  // The reported defect, at the layer that actually creates the order. The Rx & Orders tab
  // rewrites a name to its canonical spelling before it gets here, but a prescription saved
  // before that existed — or written by any path that bypasses the tab — still arrives as raw
  // free text, and this is the last place anything can recognise it.
  it("resolves a name that only DIFFERS by a redundant word, instead of dropping it", async () => {
    const res = await syncLabOrders({
      ...BASE,
      items: [{ test_name: "CRP test" }, { test_name: "urine routine test" }],
    });

    expect(res.unmatched, "A test the hospital offers was reported as not in the catalogue.").toEqual([]);
    expect(mockRpc.mock.calls[0][1].p_items.map((i: any) => i.test_id)).toEqual(["t-crp", "t-urine"]);
    expect(res.created).toBe(2);
  });

  it("still refuses a name that is genuinely not in the catalogue", async () => {
    // The fuzzy tier must not turn "no match" into "closest match" — that orders and bills a
    // test nobody asked for.
    const res = await syncLabOrders({ ...BASE, items: [{ test_name: "Genome Sequencing" }] });
    expect(res.unmatched).toEqual(["Genome Sequencing"]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not order the same test twice when the two spellings differ", async () => {
    const res = await syncLabOrders({
      ...BASE,
      items: [{ test_name: "CRP" }, { test_name: "CRP test" }],
    });
    expect(mockRpc.mock.calls[0][1].p_items).toHaveLength(1);
    expect(res.created).toBe(1);
  });

  it("reports every test as unordered when the RPC fails, so the caller cannot believe they reached the lab", async () => {
    setup();
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const res = await syncLabOrders({ ...BASE, items: [{ test_name: "CRP" }, { test_name: "Haemoglobin" }] });
    expect(res.orderIds).toEqual([]);
    expect(res.created).toBe(0);
    expect(res.unmatched.sort()).toEqual(["CRP", "Haemoglobin"]);
  });
});
