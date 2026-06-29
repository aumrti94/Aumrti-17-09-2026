import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAumrtiAdmin } from "@/hooks/useAumrtiAdmin";

export default function PlatformGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAumrtiAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAdmin) navigate("/login", { replace: true });
  }, [isAdmin, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <Loader2 className="animate-spin text-slate-400" size={22} />
      </div>
    );
  }

  if (!isAdmin) return null;
  return <>{children}</>;
}
