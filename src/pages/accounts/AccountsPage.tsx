import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, BookOpen, Receipt, ArrowLeftRight, Landmark, FileText, Plus, Download, Target } from "lucide-react";
import AccountsDashboardTab from "@/components/accounts/AccountsDashboardTab";
import LedgerTab from "@/components/accounts/LedgerTab";
import ExpensesTab from "@/components/accounts/ExpensesTab";
import JournalTab from "@/components/accounts/JournalTab";
import BankTab from "@/components/accounts/BankTab";
import ReportsTab from "@/components/accounts/ReportsTab";
import RecordExpenseModal from "@/components/accounts/RecordExpenseModal";

const PERIODS = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
];

const AccountsPage: React.FC = () => {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("this_month");
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (data) { setHospitalId(data.hospital_id); setUserId(data.id); }
    })();
  }, []);

  const getDateRange = () => {
    const now = new Date();
    let start: Date, end: Date;
    switch (period) {
      case "last_month":
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case "this_quarter":
        const q = Math.floor(now.getMonth() / 3) * 3;
        start = new Date(now.getFullYear(), q, 1);
        end = now;
        break;
      case "this_year":
        start = new Date(now.getFullYear(), 3 >= now.getMonth() ? -9 : 3, 1); // April FY start
        end = now;
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
    }
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
  };

  const dateRange = getDateRange();

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <h1 className="text-base font-bold text-foreground">Financial Accounts</h1>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/accounts/cost-centres")}>
            <Target className="h-4 w-4 mr-1" /> Cost Centres
          </Button>
          <Button size="sm" onClick={() => setShowExpenseModal(true)}>
            <Plus className="h-4 w-4 mr-1" /> Record Expense
          </Button>
          <Button size="sm" variant="outline">
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="dashboard" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="h-11 flex-shrink-0 rounded-none border-b border-border bg-card px-5 justify-start gap-1">
          <TabsTrigger value="dashboard" className="text-xs gap-1.5"><BarChart3 size={14} /> Dashboard</TabsTrigger>
          <TabsTrigger value="ledger" className="text-xs gap-1.5"><BookOpen size={14} /> Ledger</TabsTrigger>
          <TabsTrigger value="expenses" className="text-xs gap-1.5"><Receipt size={14} /> Expenses</TabsTrigger>
          <TabsTrigger value="journal" className="text-xs gap-1.5"><ArrowLeftRight size={14} /> Journal</TabsTrigger>
          <TabsTrigger value="bank" className="text-xs gap-1.5"><Landmark size={14} /> Bank</TabsTrigger>
          <TabsTrigger value="reports" className="text-xs gap-1.5"><FileText size={14} /> Reports</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto">
          <TabsContent value="dashboard" className="m-0 h-full">
            <AccountsDashboardTab hospitalId={hospitalId} dateRange={dateRange} />
          </TabsContent>
          <TabsContent value="ledger" className="m-0 h-full">
            <LedgerTab hospitalId={hospitalId} dateRange={dateRange} />
          </TabsContent>
          <TabsContent value="expenses" className="m-0 h-full">
            <ExpensesTab hospitalId={hospitalId} dateRange={dateRange} userId={userId} />
          </TabsContent>
          <TabsContent value="journal" className="m-0 h-full">
            <JournalTab hospitalId={hospitalId} dateRange={dateRange} />
          </TabsContent>
          <TabsContent value="bank" className="m-0 h-full">
            <BankTab hospitalId={hospitalId} />
          </TabsContent>
          <TabsContent value="reports" className="m-0 h-full">
            <ReportsTab hospitalId={hospitalId} dateRange={dateRange} />
          </TabsContent>
        </div>
      </Tabs>

      {showExpenseModal && hospitalId && userId && (
        <RecordExpenseModal
          hospitalId={hospitalId}
          userId={userId}
          onClose={() => setShowExpenseModal(false)}
        />
      )}
    </div>
  );
};

export default AccountsPage;
