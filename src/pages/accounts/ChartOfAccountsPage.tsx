import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { EntityList } from "@/components/shared/EntityList";
import { Plus, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function ChartOfAccountsPage() {
  const { hospitalId } = useHospitalId();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["chart_of_accounts", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("code");
      if (error) throw error;
      return data;
    },
    enabled: !!hospitalId,
  });

  const filteredAccounts = React.useMemo(() => {
    if (!accounts) return [];
    if (!searchTerm) return accounts;
    const lower = searchTerm.toLowerCase();
    return accounts.filter(
      (a) =>
        a.code?.toLowerCase().includes(lower) ||
        a.name?.toLowerCase().includes(lower) ||
        a.account_type?.toLowerCase().includes(lower)
    );
  }, [accounts, searchTerm]);

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Account Name" },
    { key: "account_type", header: "Type", render: (item: any) => <span className="capitalize">{item.account_type}</span> },
    { key: "account_subtype", header: "Subtype", render: (item: any) => <span className="capitalize">{item.account_subtype}</span> },
    {
      key: "is_active",
      header: "Status",
      render: (item: any) => (
        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
            item.is_active ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
          }`}
        >
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/accounts")}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">Chart of Accounts</h1>
          <p className="text-sm text-muted-foreground">Manage all financial ledger accounts</p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <EntityList
          title="Accounts Ledger"
          data={filteredAccounts}
          columns={columns}
          isLoading={isLoading}
          searchPlaceholder="Search by code or name..."
          onSearch={setSearchTerm}
          onAdd={() => {
            console.log("Add new account clicked");
          }}
        />
      </div>
    </div>
  );
}
