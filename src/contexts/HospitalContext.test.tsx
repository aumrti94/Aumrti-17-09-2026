import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HospitalProvider } from "@/contexts/HospitalContext";
import { useHospitalContext } from "@/hooks/useHospitalContext";

// Settings › Staff Members writes `users.is_active`. This is the actual runtime gate:
// deactivating a staff member must sign them out and clear their session identity, not
// just hide a UI toggle. See CLAUDE.md's own comment trail on this exact regression.

let mockUsersRow: any = { id: "app-user-1", hospital_id: "hosp-a", role: "nurse", full_name: "Test Nurse", is_active: true };
let mockSession: any = { user: { id: "auth-uid-1" } };
const signOutMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: mockSession } })),
      getUser: vi.fn(() => Promise.resolve({ data: { user: mockSession?.user ?? null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: (...args: any[]) => signOutMock(...args),
    },
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() => {
          if (table === "users") return Promise.resolve({ data: mockUsersRow, error: null });
          if (table === "role_permissions") return Promise.resolve({ data: { permissions: {} }, error: null });
          if (table === "hospital_subscriptions") return Promise.resolve({ data: null, error: null });
          if (table === "user_permission_overrides") return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: null, error: null });
        }),
        insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
      // hospital_module_entitlements / hospital_addons resolve via bare .eq() (no maybeSingle)
      if (table === "hospital_module_entitlements" || table === "hospital_addons") {
        chain.eq = vi.fn(() => Promise.resolve({ data: [], error: null }));
      }
      return chain;
    }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

function Probe() {
  const ctx = useHospitalContext();
  if (ctx.loading) return <div>loading</div>;
  if (!ctx.hospitalId) return <div>signed-out</div>;
  return <div>role:{ctx.role}</div>;
}

beforeEach(() => {
  signOutMock.mockClear();
  sessionStorage.clear();
  mockSession = { user: { id: "auth-uid-1" } };
});

describe("HospitalProvider — is_active deactivation gate (Settings › Staff Members)", () => {
  it("an active staff member resolves their identity normally", async () => {
    mockUsersRow = { id: "app-user-1", hospital_id: "hosp-a", role: "nurse", full_name: "Test Nurse", is_active: true };
    render(<HospitalProvider><Probe /></HospitalProvider>);
    await waitFor(() => expect(screen.getByText("role:nurse")).toBeInTheDocument());
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("a deactivated staff member (is_active: false) is signed out and never resolves an identity", async () => {
    mockUsersRow = { id: "app-user-1", hospital_id: "hosp-a", role: "nurse", full_name: "Test Nurse", is_active: false };
    render(<HospitalProvider><Probe /></HospitalProvider>);
    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    expect(screen.queryByText(/^role:/)).not.toBeInTheDocument();
  });

  it("toggling the same user from active to inactive changes the resolved outcome — the setting genuinely drives behaviour", async () => {
    mockUsersRow = { id: "app-user-1", hospital_id: "hosp-a", role: "doctor", full_name: "Dr A", is_active: true };
    const { unmount } = render(<HospitalProvider><Probe /></HospitalProvider>);
    await waitFor(() => expect(screen.getByText("role:doctor")).toBeInTheDocument());
    unmount();

    mockUsersRow = { ...mockUsersRow, is_active: false };
    render(<HospitalProvider><Probe /></HospitalProvider>);
    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
  });
});
