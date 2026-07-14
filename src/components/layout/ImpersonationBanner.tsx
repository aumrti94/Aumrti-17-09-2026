import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Loader2 } from "lucide-react";
import { getImpersonationState, endImpersonation, ImpersonationState } from "@/lib/impersonation";
import { useToast } from "@/hooks/use-toast";

// Deliberately NOT dismissable — an admin must never be able to forget
// they're impersonating. Always rendered at the very top of the tenant app
// when sessionStorage carries an active impersonation flag.
export default function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState | null>(null);
  const [ending, setEnding] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    setState(getImpersonationState());
  }, []);

  if (!state) return null;

  const stop = async () => {
    setEnding(true);
    try {
      await endImpersonation();
      toast({ title: `Ended impersonation of ${state.hospitalName}` });
      navigate(`/platform/hospitals/${state.hospitalId}`, { replace: true });
      window.location.reload(); // clears all in-memory tenant-scoped query cache
    } catch (e) {
      toast({ title: "Failed to end impersonation", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setEnding(false);
    }
  };

  return (
    <div className="fixed top-14 left-0 right-0 z-50 flex items-center justify-between gap-3 bg-violet-600 text-white px-4 py-2 text-xs font-medium shadow-md">
      <div className="flex items-center gap-2">
        <Eye size={14} className="shrink-0" />
        <span>
          Viewing as <strong>{state.hospitalName}</strong>
          {state.impersonatedName ? ` (as ${state.impersonatedName}${state.impersonatedRole ? `, ${state.impersonatedRole}` : ""})` : ""} — admin impersonation session
        </span>
      </div>
      <button
        onClick={stop}
        disabled={ending}
        className="shrink-0 flex items-center gap-1.5 bg-white/15 hover:bg-white/25 px-3 py-1 rounded-md transition-colors disabled:opacity-60"
      >
        {ending ? <Loader2 size={12} className="animate-spin" /> : null}
        End Impersonation
      </button>
    </div>
  );
}
