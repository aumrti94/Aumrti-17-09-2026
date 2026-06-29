import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from "date-fns";
import { RefreshCw, Download, Bot, BarChart2, Calendar, CalendarDays, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import RevenueTab from "@/components/analytics/RevenueTab";
import ClinicalTab from "@/components/analytics/ClinicalTab";
import DoctorsTab from "@/components/analytics/DoctorsTab";
import DepartmentsTab from "@/components/analytics/DepartmentsTab";
import QualityTab from "@/components/analytics/QualityTab";
import AIDigestTab from "@/components/analytics/AIDigestTab";
import CustomReportBuilder from "@/components/analytics/CustomReportBuilder";
import ExportModal from "@/components/analytics/ExportModal";
import ScheduleReportModal from "@/components/analytics/ScheduleReportModal";
import PROMAnalyticsTab from "@/components/analytics/PROMAnalyticsTab";
import ESGTab from "@/components/analytics/ESGTab";
import AIPerformanceDashboard from "@/components/analytics/AIPerformanceDashboard";
import NationalBenchmarkTab from "@/components/analytics/NationalBenchmarkTab";
import type { DateRange } from "@/hooks/useAnalyticsData";

const QUICK_RANGES = [
  { label: "Today", key: "today" },
  { label: "Yesterday", key: "yesterday" },
  { label: "This Week", key: "this_week" },
  { label: "This Month", key: "this_month" },
  { label: "Last Month", key: "last_month" },
] as const;

type QuickRange = typeof QUICK_RANGES[number]["key"] | "custom";

const TABS = [
  { id: "revenue", label: "📊 Revenue" },
  { id: "clinical", label: "🏥 Clinical" },
  { id: "doctors", label: "👨‍⚕️ Doctors" },
  { id: "departments", label: "🏢 Departments" },
  { id: "quality", label: "✅ Quality" },
  { id: "prom", label: "📋 PROM/PREM" },
  { id: "esg",       label: "🌱 ESG" },
  { id: "digest",    label: "🤖 AI Digest" },
  { id: "ai_perf",   label: "📈 AI Performance" },
  { id: "benchmark", label: "🏆 National Benchmarks" },
  { id: "custom",    label: "📋 Custom Report" },
] as const;

function getRange(key: Exclude<QuickRange, "custom">): DateRange {
  const today = new Date();
  switch (key) {
    case "today":
      return { from: format(today, "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") };
    case "yesterday": {
      const y = subDays(today, 1);
      return { from: format(y, "yyyy-MM-dd"), to: format(y, "yyyy-MM-dd") };
    }
    case "this_week":
      return { from: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd") };
    case "this_month":
      return { from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(endOfMonth(today), "yyyy-MM-dd") };
    case "last_month": {
      const lm = subMonths(today, 1);
      return { from: format(startOfMonth(lm), "yyyy-MM-dd"), to: format(endOfMonth(lm), "yyyy-MM-dd") };
    }
  }
}

const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const [quickRange, setQuickRange] = useState<QuickRange>("this_month");
  const [activeTab, setActiveTab] = useState("revenue");
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [exportOpen, setExportOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const range = useMemo(() => {
    if (quickRange === "custom" && customFrom && customTo) {
      return { from: format(customFrom, "yyyy-MM-dd"), to: format(customTo, "yyyy-MM-dd") };
    }
    if (quickRange === "custom") {
      return getRange("this_month");
    }
    return getRange(quickRange);
  }, [quickRange, customFrom, customTo]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = String(query.queryKey[0] || "");
        return key.startsWith("analytics");
      },
    });
    setLastUpdated(new Date());
    toast({ title: "Data refreshed" });
  };

  const timeAgo = useMemo(() => {
    const diffMs = Date.now() - lastUpdated.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    return `${mins}m ago`;
  }, [lastUpdated]);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="min-h-[52px] flex-shrink-0 bg-card border-b border-border px-5 flex items-center justify-between gap-2 flex-wrap py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-foreground">Analytics & BI</h1>
          <span className="text-[11px] text-muted-foreground">Updated {timeAgo}</span>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {QUICK_RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setQuickRange(r.key)}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-medium transition-colors",
                quickRange === r.key
                  ? "bg-sidebar text-white"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {r.label}
            </button>
          ))}

          {/* Custom date range */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setQuickRange("custom")}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-medium transition-colors flex items-center gap-1",
                quickRange === "custom"
                  ? "bg-sidebar text-white"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <CalendarDays size={12} /> Custom
            </button>

            {quickRange === "custom" && (
              <div className="flex items-center gap-1 ml-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] px-2 gap-1">
                      <Calendar size={12} />
                      {customFrom ? format(customFrom, "dd MMM yyyy") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={customFrom}
                      onSelect={setCustomFrom}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-[11px] text-muted-foreground">–</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] px-2 gap-1">
                      <Calendar size={12} />
                      {customTo ? format(customTo, "dd MMM yyyy") : "To"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={customTo}
                      onSelect={setCustomTo}
                      disabled={(date) => customFrom ? date < customFrom : false}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-[11px] gap-1.5" onClick={() => navigate("/analytics/forecasts")}>
            <TrendingUp size={14} /> Forecasts
          </Button>
          <Button size="sm" className="text-[11px] gap-1.5 bg-primary" onClick={() => setActiveTab("digest")}>
            <Bot size={14} /> AI Digest
          </Button>
          <Button size="sm" variant="outline" className="text-[11px] gap-1.5" onClick={() => setExportOpen(true)}>
            <Download size={14} /> Export
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleRefresh}>
            <RefreshCw size={14} />
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="h-[44px] flex-shrink-0 bg-card border-b border-border px-5 flex items-end gap-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 pb-2.5 pt-2 text-[13px] font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-sidebar text-sidebar-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-muted/30">
        {activeTab === "revenue" && <RevenueTab range={range} />}
        {activeTab === "clinical" && <ClinicalTab range={range} />}
        {activeTab === "doctors" && <DoctorsTab range={range} />}
        {activeTab === "departments" && <DepartmentsTab range={range} />}
        {activeTab === "quality" && <QualityTab range={range} />}
        {activeTab === "prom" && <PROMAnalyticsTab />}
        {activeTab === "esg" && <ESGTab />}
        {activeTab === "digest"    && <AIDigestTab />}
        {activeTab === "ai_perf"   && <AIPerformanceDashboard />}
        {activeTab === "benchmark" && <NationalBenchmarkTab />}
        {activeTab === "custom"    && <CustomReportBuilder range={range} />}
      </div>

      {/* Footer */}
      <div className="h-10 flex-shrink-0 bg-muted/50 border-t border-border px-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Data refreshes every 5 minutes</span>
          <button onClick={handleRefresh} className="text-[11px] text-primary hover:underline">Force Refresh</button>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Last updated: {format(lastUpdated, "dd MMM yyyy, h:mm a")}
        </span>
        <div className="flex items-center gap-4">
          <button onClick={() => setActiveTab("custom")} className="text-[11px] text-primary hover:underline flex items-center gap-1">
            <BarChart2 size={11} /> Custom Report
          </button>
          <button onClick={() => setScheduleOpen(true)} className="text-[11px] text-primary hover:underline flex items-center gap-1">
            <Calendar size={11} /> Schedule Reports
          </button>
          <button onClick={() => setExportOpen(true)} className="text-[11px] text-primary hover:underline flex items-center gap-1">
            <Download size={11} /> Export
          </button>
        </div>
      </div>

      {/* Modals */}
      <ExportModal open={exportOpen} onOpenChange={setExportOpen} range={range} activeTab={activeTab} />
      <ScheduleReportModal open={scheduleOpen} onOpenChange={setScheduleOpen} reportName="Full Analytics Report" />
    </div>
  );
};

export default AnalyticsPage;
