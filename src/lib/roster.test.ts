import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { getOnDutyStaff, getOnDutyByRole } from "./roster";

function chain(data: unknown) {
  const result = { data } as any;
  const proxy: any = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === "then") return Promise.resolve(result).then.bind(Promise.resolve(result));
      return vi.fn().mockReturnValue(proxy);
    },
  });
  return proxy;
}

beforeEach(() => mockFrom.mockReset());

describe("getOnDutyStaff — cross-module roster visibility", () => {
  it("returns an empty list without querying when hospitalId or date is missing", async () => {
    expect(await getOnDutyStaff("", "2026-08-24")).toEqual([]);
    expect(await getOnDutyStaff("h1", "")).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("maps the joined roster/user/shift row shape into the flat OnDutyStaff shape", async () => {
    mockFrom.mockReturnValue(
      chain([
        {
          user_id: "u1",
          u: { full_name: "Nurse Rao", role: "nurse" },
          s: { shift_name: "Morning", shift_code: "M", start_time: "07:00", end_time: "15:00" },
        },
      ]),
    );
    const result = await getOnDutyStaff("h1", "2026-08-24");
    expect(result).toEqual([
      {
        user_id: "u1",
        full_name: "Nurse Rao",
        role: "nurse",
        shift_name: "Morning",
        shift_code: "M",
        start_time: "07:00",
        end_time: "15:00",
      },
    ]);
  });

  it("defaults a missing joined user/shift row to empty/null rather than throwing", async () => {
    mockFrom.mockReturnValue(chain([{ user_id: "u1", u: null, s: null }]));
    const result = await getOnDutyStaff("h1", "2026-08-24");
    expect(result[0]).toEqual({
      user_id: "u1",
      full_name: "",
      role: "",
      shift_name: null,
      shift_code: null,
      start_time: null,
      end_time: null,
    });
  });

  it("returns an empty list when the query returns no rows", async () => {
    mockFrom.mockReturnValue(chain(null));
    expect(await getOnDutyStaff("h1", "2026-08-24")).toEqual([]);
  });
});

describe("getOnDutyByRole — role-filtered convenience wrapper", () => {
  it("filters the on-duty list to only the requested role", async () => {
    mockFrom.mockReturnValue(
      chain([
        { user_id: "u1", u: { full_name: "Nurse Rao", role: "nurse" }, s: null },
        { user_id: "u2", u: { full_name: "Dr Iyer", role: "doctor" }, s: null },
      ]),
    );
    const result = await getOnDutyByRole("h1", "2026-08-24", "nurse");
    expect(result).toHaveLength(1);
    expect(result[0].full_name).toBe("Nurse Rao");
  });
});
