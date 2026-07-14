import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Heart, Loader2, Send, Plus, X, Save, Pencil, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { format, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const NPS_CATEGORIES = {
  promoters:  { min: 9, max: 10, label: "Promoters",  color: "bg-green-500", text: "text-green-700" },
  passives:   { min: 7, max: 8,  label: "Passives",   color: "bg-amber-400", text: "text-amber-700" },
  detractors: { min: 0, max: 6,  label: "Detractors", color: "bg-red-500",   text: "text-red-700"  },
};

const TOUR_ROLE_ICONS: Record<string, string> = {
  doctor: "🩺",
  nurse: "💊",
  receptionist: "🗂️",
  billing_executive: "💰",
  lab_technician: "🔬",
};

interface TrainingVideo {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  category: string;
  sort_order: number;
  is_active: boolean;
}

const BLANK_VIDEO: Partial<TrainingVideo> = {
  title: "", description: "", video_url: "", thumbnail_url: "",
  duration_seconds: null, category: "general", sort_order: 0, is_active: true,
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function CustomerSuccessPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("nps");
  const [selectedHospital, setSelectedHospital] = useState("all");
  const [videoSearch, setVideoSearch] = useState("");
  const [showVideoForm, setShowVideoForm] = useState(false);
  const [videoForm, setVideoForm] = useState<Partial<TrainingVideo>>(BLANK_VIDEO);
  const [editVideoId, setEditVideoId] = useState<string | null>(null);
  const [videoFormError, setVideoFormError] = useState<string | null>(null);

  const { data: videos = [], isLoading: videosLoading } = useQuery({
    queryKey: ["platform-training-videos"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("platform_training_videos")
        .select("*")
        .order("sort_order", { ascending: true });
      return (data || []) as TrainingVideo[];
    },
    staleTime: 30_000,
  });

  const vf = (key: keyof TrainingVideo, val: any) => setVideoForm((p) => ({ ...p, [key]: val }));

  const saveVideo = useMutation({
    mutationFn: async () => {
      const payload = {
        title: videoForm.title,
        description: videoForm.description || null,
        video_url: videoForm.video_url,
        thumbnail_url: videoForm.thumbnail_url || null,
        duration_seconds: videoForm.duration_seconds ? Number(videoForm.duration_seconds) : null,
        category: videoForm.category || "general",
        sort_order: Number(videoForm.sort_order) || 0,
      };
      if (editVideoId) {
        const { error } = await (supabase as any).from("platform_training_videos").update(payload).eq("id", editVideoId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("platform_training_videos").insert([payload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setVideoFormError(null);
      sonnerToast.success(editVideoId ? "Video updated" : "Video added");
      setShowVideoForm(false);
      setEditVideoId(null);
      setVideoForm(BLANK_VIDEO);
      qc.invalidateQueries({ queryKey: ["platform-training-videos"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setVideoFormError(m); sonnerToast.error(m); },
  });

  const toggleVideoActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      await (supabase as any).from("platform_training_videos").update({ is_active }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-training-videos"] }),
  });

  const openEditVideo = (v: TrainingVideo) => {
    setVideoForm(v);
    setEditVideoId(v.id);
    setShowVideoForm(true);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["customer-success-data"],
    queryFn: async () => {
      const [hospRes, npsRes, toursRes, tourProgressRes] = await Promise.all([
        (supabase as any).from("hospitals").select("id, name").eq("is_active", true).order("name"),
        (supabase as any).from("nps_responses")
          .select("*, nps_surveys(hospital_id, trigger_day, sent_at, hospitals(name))")
          .order("responded_at", { ascending: false })
          .limit(500),
        (supabase as any).from("platform_onboarding_tours").select("*").eq("is_active", true).order("role"),
        (supabase as any).from("user_tour_progress").select("tour_key, completed_at, dismissed_at"),
      ]);
      return {
        hospitals: hospRes.data || [],
        npsResponses: npsRes.data || [],
        tours: toursRes.data || [],
        tourProgress: tourProgressRes.data || [],
      };
    },
    staleTime: 60 * 1000,
  });

  const hospitals = data?.hospitals || [];
  const npsResponses = data?.npsResponses || [];
  const tours = data?.tours || [];
  const tourProgress = data?.tourProgress || [];

  const tourStats = tours.map((t: any) => {
    const rows = tourProgress.filter((p: any) => p.tour_key === t.tour_key);
    const completed = rows.filter((p: any) => p.completed_at).length;
    const dismissed = rows.filter((p: any) => p.dismissed_at).length;
    return { ...t, started: rows.length, completed, dismissed };
  });

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

  const [sendingNPS, setSendingNPS] = useState<number | null>(null);

  // Real patient-eligibility lookup (discharged trigger_day days ago) + SMS
  // dispatch via nps-survey-dispatch — replaces the old fake 1.5s delay with
  // no DB write. Patients get a link to /survey/:id rather than being asked
  // to reply to the SMS, since an inbound-SMS-reply flow would need a
  // Twilio webhook configured from their console, which isn't reachable here.
  const sendNPSSurvey = async (day: 30 | 90 | 180) => {
    setSendingNPS(day);
    try {
      const { data: result, error } = await supabase.functions.invoke("nps-survey-dispatch", {
        body: { trigger_day: day, hospital_id: selectedHospital === "all" ? undefined : selectedHospital },
      });
      if (error || result?.error) throw new Error(result?.error || error?.message || "Dispatch failed");
      const { eligible, sent, skipped_no_provider, no_phone } = result;
      if (eligible === 0) {
        toast({ title: `No patients discharged ${day} days ago are due a survey right now.` });
      } else if (skipped_no_provider > 0 && sent === 0) {
        toast({
          title: "Eligible patients found, but SMS isn't configured",
          description: `${eligible} patient(s) eligible — set TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER to actually send.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${sent} of ${eligible} eligible patient(s) sent the ${day}-day survey`,
          description: no_phone > 0 ? `${no_phone} had no phone number on file.` : undefined,
        });
      }
    } catch (e) {
      toast({ title: "Dispatch failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSendingNPS(null);
    }
  };

  const filteredVideos = videoSearch
    ? videos.filter(v => v.title.toLowerCase().includes(videoSearch.toLowerCase()) || v.category.toLowerCase().includes(videoSearch.toLowerCase()))
    : videos;

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
                  <Button key={d} size="sm" variant="outline" onClick={() => sendNPSSurvey(d)} disabled={sendingNPS !== null} className="h-7 text-[10px] gap-1">
                    {sendingNPS === d ? <Loader2 size={9} className="animate-spin" /> : <Send size={9} />}
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
                Tours fire automatically the first time a user of that role reaches the relevant page, and are
                skipped for anyone who has already completed or dismissed them. Counts below are across all hospitals.
              </p>

              <div className="space-y-2">
                {tourStats.length === 0 && (
                  <p className="text-[13px] text-muted-foreground text-center py-8">No tours defined.</p>
                )}
                {tourStats.map((t: any) => (
                  <div key={t.tour_key} className="border border-border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[18px]">{TOUR_ROLE_ICONS[t.role] || "📌"}</span>
                        <div>
                          <p className="text-[13px] font-semibold text-foreground">{t.title}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">{t.role.replace(/_/g, " ")}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className="text-foreground font-semibold">{t.started}</span>
                        <span className="text-muted-foreground">started</span>
                        <span className="text-green-600 font-semibold">{t.completed}</span>
                        <span className="text-muted-foreground">completed</span>
                        <span className="text-amber-600 font-semibold">{t.dismissed}</span>
                        <span className="text-muted-foreground">skipped</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(t.steps as { content: string; order: number }[]).slice().sort((a, b) => a.order - b.order).map((s, i) => (
                        <div key={i} className="flex items-center gap-1 text-[11px] bg-muted px-2 py-1 rounded-full">
                          <span className="text-primary font-semibold">{i + 1}.</span>
                          <span className="text-muted-foreground">{s.content}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* ── Video Library ── */}
          <TabsContent value="videos" className="flex-1 overflow-auto p-5 m-0">
            <div className="max-w-3xl space-y-4">
              <div className="flex items-center justify-between">
                <Input
                  value={videoSearch}
                  onChange={e => setVideoSearch(e.target.value)}
                  placeholder="Search videos…"
                  className="h-9 text-[12px] max-w-xs"
                />
                <button
                  onClick={() => { setVideoForm(BLANK_VIDEO); setEditVideoId(null); setShowVideoForm(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors"
                >
                  <Plus size={12} /> Add Video
                </button>
              </div>

              {videosLoading ? (
                <p className="text-[13px] text-muted-foreground text-center py-8">Loading…</p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {filteredVideos.map(v => (
                    <div key={v.id} className={cn("border border-border rounded-xl overflow-hidden", !v.is_active && "opacity-50")}>
                      <div className="h-24 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center relative">
                        {v.thumbnail_url ? (
                          <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[36px]">🎬</span>
                        )}
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                          {formatDuration(v.duration_seconds)}
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[12px] font-semibold text-foreground leading-tight">{v.title}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={() => toggleVideoActive.mutate({ id: v.id, is_active: !v.is_active })} className="text-muted-foreground hover:text-foreground transition-colors">
                              {v.is_active ? <ToggleRight size={16} className="text-emerald-600" /> : <ToggleLeft size={16} />}
                            </button>
                            <button onClick={() => openEditVideo(v)} className="text-muted-foreground hover:text-foreground transition-colors">
                              <Pencil size={13} />
                            </button>
                          </div>
                        </div>
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded mt-1 inline-block">{v.category}</span>
                      </div>
                    </div>
                  ))}
                  {filteredVideos.length === 0 && (
                    <p className="col-span-2 text-[13px] text-muted-foreground text-center py-8">
                      {videos.length === 0 ? "No training videos yet — add the first one above." : `No videos match "${videoSearch}".`}
                    </p>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Add / edit video modal */}
      {showVideoForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[440px] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">{editVideoId ? "Edit Video" : "Add Training Video"}</p>
              <button onClick={() => setShowVideoForm(false)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: "Title", key: "title" as const, type: "text", placeholder: "OPD Workflow: Token to Consultation" },
                { label: "Description (optional)", key: "description" as const, type: "text", placeholder: "" },
                { label: "Video URL (YouTube / Loom embed link)", key: "video_url" as const, type: "text", placeholder: "https://..." },
                { label: "Thumbnail URL (optional)", key: "thumbnail_url" as const, type: "text", placeholder: "" },
                { label: "Duration (seconds)", key: "duration_seconds" as const, type: "number", placeholder: "525" },
                { label: "Sort Order", key: "sort_order" as const, type: "number", placeholder: "0" },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input
                    type={type}
                    value={(videoForm[key] as any) ?? ""}
                    onChange={(e) => vf(key, e.target.value === "" && type === "number" ? null : e.target.value)}
                    placeholder={placeholder}
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground">Category</label>
                <select value={videoForm.category} onChange={(e) => vf("category", e.target.value)}
                  className="w-full mt-1 h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                  <option value="general">General</option>
                  <option value="setup">Setup</option>
                  <option value="opd">OPD</option>
                  <option value="ipd">IPD</option>
                  <option value="billing">Billing</option>
                  <option value="lab">Lab</option>
                  <option value="nursing">Nursing</option>
                  <option value="quality">Quality</option>
                  <option value="ai">AI Features</option>
                </select>
              </div>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <FormError message={videoFormError} />
              <button
                onClick={() => saveVideo.mutate()}
                disabled={saveVideo.isPending || !videoForm.title || !videoForm.video_url}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {saveVideo.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editVideoId ? "Update" : "Add Video"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
