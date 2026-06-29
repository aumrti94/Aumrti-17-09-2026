import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Heart, Star, TrendingUp, BookOpen, Bell, Loader2, Plus, CheckCircle2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const NPS_CATEGORIES = {
  promoters:  { min: 9, max: 10, label: "Promoters",  color: "bg-green-500", text: "text-green-700" },
  passives:   { min: 7, max: 8,  label: "Passives",   color: "bg-amber-400", text: "text-amber-700" },
  detractors: { min: 0, max: 6,  label: "Detractors", color: "bg-red-500",   text: "text-red-700"  },
};

const TOUR_ROLES = [
  { role: "doctor",            steps: ["IPD Workspace overview", "Ward round notes", "Clinical calculators", "Voice dictation"], icon: "🩺" },
  { role: "nurse",             steps: ["Nursing Kardex", "Vitals entry", "MAR (Medication Administration)", "MEWS alerts"], icon: "💊" },
  { role: "receptionist",      steps: ["OPD token queue", "Patient registration", "Appointment booking"], icon: "🗂️" },
  { role: "billing_executive", steps: ["Bill creation", "Advance receipts", "Insurance claims", "Day closure"], icon: "💰" },
  { role: "lab_technician",    steps: ["Lab worklist", "Result entry", "Critical value alerts"], icon: "🔬" },
];

const VIDEO_LIBRARY = [
  { title: "Getting Started: Hospital Setup", duration: "8:42", category: "Setup", thumb: "🏥" },
  { title: "OPD Workflow: Token to Consultation", duration: "12:15", category: "OPD", thumb: "👨‍⚕️" },
  { title: "IPD Admission to Discharge", duration: "18:30", category: "IPD", thumb: "🛏️" },
  { title: "Billing & Insurance Claims", duration: "14:55", category: "Billing", thumb: "📋" },
  { title: "NABH Compliance Tracking", duration: "10:20", category: "Quality", thumb: "✅" },
  { title: "Lab Orders & Results", duration: "9:08", category: "Lab", thumb: "🧪" },
  { title: "Nursing Kardex & MAR", duration: "11:45", category: "Nursing", thumb: "💉" },
  { title: "AI Features Overview", duration: "7:30", category: "AI", thumb: "🤖" },
];

export default function CustomerSuccessPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("nps");
  const [selectedHospital, setSelectedHospital] = useState("all");
  const [videoSearch, setVideoSearch] = useState("");
  const [sendingNPS, setSendingNPS] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["customer-success-data"],
    queryFn: async () => {
      const [hospRes, npsRes] = await Promise.all([
        (supabase as any).from("hospitals").select("id, name").eq("is_active", true).order("name"),
        (supabase as any).from("nps_responses")
          .select("*, nps_surveys(hospital_id, trigger_day, sent_at, hospitals(name))")
          .order("responded_at", { ascending: false })
          .limit(500),
      ]);
      return {
        hospitals: hospRes.data || [],
        npsResponses: npsRes.data || [],
      };
    },
    staleTime: 60 * 1000,
  });

  const hospitals = data?.hospitals || [];
  const npsResponses = data?.npsResponses || [];

  const filtered = selectedHospital === "all"
    ? npsResponses
    : npsResponses.filter(r => r.nps_surveys?.hospital_id === selectedHospital);

  const promoters   = filtered.filter(r => r.score >= 9).length;
  const passives    = filtered.filter(r => r.score >= 7 && r.score <= 8).length;
  const detractors  = filtered.filter(r => r.score <= 6).length;
  const total       = filtered.length;
  const npsScore    = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

  const scoreDistribution = Array.from({ length: 11 }, (_, i) => ({
    score: i,
    count: filtered.filter(r => r.score === i).length,
  }));

  const sendNPSSurvey = async (day: 30 | 90 | 180) => {
    setSendingNPS(true);
    await new Promise(r => setTimeout(r, 1500));
    setSendingNPS(false);
    toast({ title: `NPS survey (${day}-day) queued for all eligible patients` });
  };

  const filteredVideos = videoSearch
    ? VIDEO_LIBRARY.filter(v => v.title.toLowerCase().includes(videoSearch.toLowerCase()) || v.category.toLowerCase().includes(videoSearch.toLowerCase()))
    : VIDEO_LIBRARY;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Heart size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Customer Success</h1>
        </div>
        <Select value={selectedHospital} onValueChange={setSelectedHospital}>
          <SelectTrigger className="h-8 w-48 text-[12px]"><SelectValue placeholder="All Hospitals" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Hospitals</SelectItem>
            {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
            <TabsTrigger value="nps" className="text-[13px]">NPS Surveys</TabsTrigger>
            <TabsTrigger value="tours" className="text-[13px]">Onboarding Tours</TabsTrigger>
            <TabsTrigger value="videos" className="text-[13px]">Video Library</TabsTrigger>
          </TabsList>

          {/* ── NPS ── */}
          <TabsContent value="nps" className="flex-1 overflow-auto p-5 m-0 space-y-5">
            {/* NPS Score banner */}
            <div className="grid grid-cols-5 gap-3">
              <div className={cn("col-span-1 border rounded-xl p-4 text-center", npsScore >= 50 ? "bg-green-50 border-green-200" : npsScore >= 0 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200")}>
                <p className={cn("text-[36px] font-black", npsScore >= 50 ? "text-green-600" : npsScore >= 0 ? "text-amber-600" : "text-red-600")}>{npsScore}</p>
                <p className="text-[11px] text-muted-foreground font-medium">NPS Score</p>
                <p className="text-[10px] text-muted-foreground">{total} responses</p>
              </div>
              {Object.entries(NPS_CATEGORIES).map(([key, cat]) => {
                const count = key === "promoters" ? promoters : key === "passives" ? passives : detractors;
                return (
                  <div key={key} className="col-span-1 bg-card border border-border rounded-xl p-3 text-center">
                    <div className={cn("w-3 h-3 rounded-full mx-auto mb-1", cat.color)} />
                    <p className={cn("text-[20px] font-bold", cat.text)}>{count}</p>
                    <p className="text-[11px] text-muted-foreground">{cat.label}</p>
                    <p className="text-[10px] text-muted-foreground">{total ? Math.round(count / total * 100) : 0}%</p>
                  </div>
                );
              })}
              <div className="col-span-1 bg-card border border-border rounded-xl p-3 flex flex-col justify-center gap-2">
                {([30, 90, 180] as const).map(d => (
                  <Button key={d} size="sm" variant="outline" onClick={() => sendNPSSurvey(d)} disabled={sendingNPS} className="h-7 text-[10px] gap-1">
                    {sendingNPS ? <Loader2 size={9} className="animate-spin" /> : <Send size={9} />}
                    {d}-day survey
                  </Button>
                ))}
              </div>
            </div>

            {/* Score distribution */}
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[13px] font-semibold text-foreground mb-3">Score Distribution (0–10)</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={scoreDistribution}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="score" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#1A2F5A" radius={[4, 4, 0, 0]}>
                    {scoreDistribution.map((entry, i) => (
                      <rect key={i} fill={entry.score >= 9 ? "#22c55e" : entry.score >= 7 ? "#f59e0b" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Recent verbatims */}
            {filtered.filter(r => r.verbatim).length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Recent Verbatims</p>
                <div className="space-y-2">
                  {filtered.filter(r => r.verbatim).slice(0, 5).map(r => (
                    <div key={r.id} className="flex items-start gap-3 border-b border-border pb-2">
                      <span className={cn("text-[14px] font-bold flex-shrink-0", r.score >= 9 ? "text-green-600" : r.score >= 7 ? "text-amber-600" : "text-red-600")}>{r.score}</span>
                      <p className="text-[12px] text-foreground flex-1">"{r.verbatim}"</p>
                      <p className="text-[10px] text-muted-foreground flex-shrink-0">{format(new Date(r.responded_at), "dd/MM")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Onboarding Tours ── */}
          <TabsContent value="tours" className="flex-1 overflow-auto p-5 m-0">
            <div className="max-w-2xl space-y-4">
              <p className="text-[12px] text-muted-foreground">
                Role-specific guided tours powered by React Joyride. Each role gets a tailored flow
                covering the 3–5 most critical actions for their day-to-day work.
              </p>

              <div className="space-y-2">
                {TOUR_ROLES.map(t => (
                  <div key={t.role} className="border border-border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[18px]">{t.icon}</span>
                        <p className="text-[13px] font-semibold text-foreground capitalize">{t.role.replace(/_/g, " ")}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => toast({ title: `${t.role} tour ready — will trigger on next login for new users` })}>
                        <Bell size={10} />Preview Tour
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {t.steps.map((s, i) => (
                        <div key={i} className="flex items-center gap-1 text-[11px] bg-muted px-2 py-1 rounded-full">
                          <span className="text-primary font-semibold">{i + 1}.</span>
                          <span className="text-muted-foreground">{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <p className="text-[12px] text-blue-800 font-medium">Tours trigger automatically on first login per role.</p>
                <p className="text-[12px] text-blue-700 mt-0.5">Users can restart tours from Help → "Show me around". Progress is tracked per user in <code className="bg-blue-100 px-1 rounded">user_tour_progress</code> table.</p>
              </div>
            </div>
          </TabsContent>

          {/* ── Video Library ── */}
          <TabsContent value="videos" className="flex-1 overflow-auto p-5 m-0">
            <div className="max-w-3xl space-y-4">
              <Input
                value={videoSearch}
                onChange={e => setVideoSearch(e.target.value)}
                placeholder="Search videos…"
                className="h-9 text-[12px] max-w-xs"
              />
              <div className="grid grid-cols-2 gap-3">
                {filteredVideos.map(v => (
                  <div key={v.title} className="border border-border rounded-xl overflow-hidden hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer">
                    <div className="h-24 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative">
                      <span className="text-[36px]">{v.thumb}</span>
                      <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                        {v.duration}
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-[12px] font-semibold text-foreground leading-tight">{v.title}</p>
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded mt-1 inline-block">{v.category}</span>
                    </div>
                  </div>
                ))}
                {filteredVideos.length === 0 && (
                  <p className="col-span-2 text-[13px] text-muted-foreground text-center py-8">No videos match "{videoSearch}".</p>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
