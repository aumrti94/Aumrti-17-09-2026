import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import PatientPropensitySection from "@/components/crm/PatientPropensitySection";
import ReviewSentimentAnalyser from "@/components/crm/ReviewSentimentAnalyser";
import ReferralPatternAnalyser from "@/components/crm/ReferralPatternAnalyser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Users, Megaphone, Star, UserCheck, BarChart3, Plus, Phone, Mail, MapPin,
  MessageCircle, TrendingUp, Send, Search, Filter, RefreshCw, Eye, Loader2
} from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { format } from "date-fns";

const TIER_COLORS: Record<string, string> = {
  platinum: "bg-purple-100 text-purple-800",
  gold: "bg-yellow-100 text-yellow-800",
  silver: "bg-gray-200 text-gray-700",
  standard: "bg-muted text-muted-foreground",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "bg-green-100 text-green-800",
  neutral: "bg-gray-100 text-gray-700",
  negative: "bg-red-100 text-red-800",
};

const PLATFORM_COLORS = ["#4285F4", "#FF6B35", "#FFB700", "#1877F2", "#94A3B8"];

import AddReferralDoctorModal from "@/components/shared/AddReferralDoctorModal";

// ─────────── Campaign Modal ───────────
const NewCampaignModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; segments: any[]; hospitalId: string }> = ({ open, onClose, onSaved, segments, hospitalId }) => {
  const { toast } = useToast();
  const [form, setForm] = useState({
    campaign_name: "", campaign_type: "whatsapp_blast", target_segment: "",
    start_date: "", end_date: "", budget_inr: "", message_template: "",
  });

  const save = async () => {
    if (!form.campaign_name) { toast({ title: "Campaign name required", variant: "destructive" }); return; }
    const { error } = await supabase.from("marketing_campaigns").insert({
      hospital_id: hospitalId, campaign_name: form.campaign_name, campaign_type: form.campaign_type,
      target_segment: form.target_segment || null, start_date: form.start_date || null,
      end_date: form.end_date || null, budget_inr: form.budget_inr ? Number(form.budget_inr) : null,
      message_template: form.message_template || null, status: "draft",
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Campaign created" }); onSaved(); onClose();
  };

  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Campaign Name *</Label><Input value={form.campaign_name} onChange={e => setForm({ ...form, campaign_name: e.target.value })} /></div>
          <div><Label>Type</Label>
            <Select value={form.campaign_type} onValueChange={v => setForm({ ...form, campaign_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["health_camp","whatsapp_blast","sms","email","social_media","referral_program","corporate","seasonal"].map(t => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Target Segment</Label>
            <Select value={form.target_segment} onValueChange={v => setForm({ ...form, target_segment: v })}>
              <SelectTrigger><SelectValue placeholder="Select segment" /></SelectTrigger>
              <SelectContent>
                {segments.map(s => <SelectItem key={s.id} value={s.segment_name}>{s.segment_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
            <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
          </div>
          <div><Label>Budget ₹</Label><Input type="number" value={form.budget_inr} onChange={e => setForm({ ...form, budget_inr: e.target.value })} /></div>
          <div><Label>Message Template</Label>
            <Textarea value={form.message_template} onChange={e => setForm({ ...form, message_template: e.target.value })} rows={3}
              placeholder="Dear {patient_name}, {hospital_name} invites you..." />
            <p className="text-xs text-muted-foreground mt-1">Variables: {"{patient_name}"} {"{hospital_name}"} {"{phone}"} {"{condition}"}</p>
          </div>
        </div>
        <DialogFooter><Button onClick={save}>Save Campaign</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─────────── Add Review Modal ───────────
const AddReviewModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; hospitalId: string }> = ({ open, onClose, onSaved, hospitalId }) => {
  const { toast } = useToast();
  const [form, setForm] = useState({ platform: "google", reviewer_name: "", rating: "5", review_text: "", review_date: "" });

  const classifySentiment = (text: string): string => {
    const lower = text.toLowerCase();
    const pos = ["excellent", "good", "best", "great", "helpful", "clean", "fast", "professional", "wonderful", "amazing"];
    const neg = ["bad", "worst", "rude", "dirty", "slow", "expensive", "waiting", "unprofessional", "horrible", "terrible"];
    const pScore = pos.filter(w => lower.includes(w)).length;
    const nScore = neg.filter(w => lower.includes(w)).length;
    if (pScore > nScore) return "positive";
    if (nScore > pScore) return "negative";
    return "neutral";
  };

  const save = async () => {
    const sentiment = classifySentiment(form.review_text);
    const { error } = await supabase.from("online_reviews").insert({
      hospital_id: hospitalId, platform: form.platform, reviewer_name: form.reviewer_name || null,
      rating: Number(form.rating), review_text: form.review_text || null,
      review_date: form.review_date || null, sentiment,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Review added" }); onSaved(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Review</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Platform</Label>
            <Select value={form.platform} onValueChange={v => setForm({ ...form, platform: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["google","practo","justdial","facebook","other"].map(p => (
                  <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Reviewer Name</Label><Input value={form.reviewer_name} onChange={e => setForm({ ...form, reviewer_name: e.target.value })} /></div>
          <div><Label>Rating</Label>
            <Select value={form.rating} onValueChange={v => setForm({ ...form, rating: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[5,4,3,2,1].map(r => <SelectItem key={r} value={String(r)}>{"⭐".repeat(r)} ({r})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Review Text</Label><Textarea value={form.review_text} onChange={e => setForm({ ...form, review_text: e.target.value })} rows={3} /></div>
          <div><Label>Date</Label><Input type="date" value={form.review_date} onChange={e => setForm({ ...form, review_date: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ═══════════════ MAIN PAGE ═══════════════
const CRMPage: React.FC = () => {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("referrals");

  // Data
  const [doctors, setDoctors] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [segments, setSegments] = useState<any[]>([]);
  const [acquisitions, setAcquisitions] = useState<any[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<any>(null);

  // Modals
  const [showAddDoctor, setShowAddDoctor] = useState(false);
  const [editDoctor, setEditDoctor] = useState<any>(null);
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [showAddReview, setShowAddReview] = useState(false);

  // Filters
  const [docSearch, setDocSearch] = useState("");
  const [docTierFilter, setDocTierFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");

  // AI response
  const [aiResponse, setAiResponse] = useState("");
  const [respondingReviewId, setRespondingReviewId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const loadAll = async () => {
    const [d, c, r, s, a] = await Promise.all([
      supabase.from("referral_doctors").select("*").eq("hospital_id", hospitalId).order("total_referrals", { ascending: false }),
      supabase.from("marketing_campaigns").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      supabase.from("online_reviews").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      supabase.from("patient_segments").select("*").eq("hospital_id", hospitalId),
      supabase.from("patient_acquisition").select("*").eq("hospital_id", hospitalId),
    ]);
    if (d.data) setDoctors(d.data);
    if (c.data) setCampaigns(c.data);
    if (r.data) setReviews(r.data);
    if (a.data) setAcquisitions(a.data);

    // Ensure default segments exist
    if (!s.data || s.data.length === 0) {
      const defaults = [
        { segment_name: "Chronic Disease Patients", segment_type: "chronic_disease", criteria: { table: "chronic_disease_programs" } },
        { segment_name: "Post-Discharge (30 days)", segment_type: "post_discharge", criteria: { days: 30 } },
        { segment_name: "Birthday This Month", segment_type: "birthday", criteria: { field: "dob", match: "current_month" } },
        { segment_name: "High-Value Patients", segment_type: "high_value", criteria: { min_billing: 50000 } },
        { segment_name: "Inactive Patients (6+ months)", segment_type: "inactive", criteria: { no_visit_months: 6 } },
      ];
      const { data: inserted } = await supabase.from("patient_segments").insert(
        defaults.map(d => ({ ...d, hospital_id: hospitalId }))
      ).select();
      setSegments(inserted || []);
    } else {
      setSegments(s.data);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // ─── KPIs ───
  const activeDoctors = doctors.filter(d => d.is_active).length;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const referralsThisMonth = acquisitions.filter(a => a.source === "referral_doctor" && a.created_at?.startsWith(thisMonth)).length;
  const campaignReach = campaigns.filter(c => c.status === "active").reduce((s, c) => s + (c.reach_count || 0), 0);
  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : "N/A";
  const refRevenue = acquisitions.filter(a => a.source === "referral_doctor" && a.created_at?.startsWith(thisMonth)).reduce((s, a) => s + (a.first_visit_revenue || 0), 0);

  // ─── Filtered doctors ───
  const filteredDoctors = useMemo(() => {
    let list = doctors;
    if (docSearch) list = list.filter(d => d.doctor_name.toLowerCase().includes(docSearch.toLowerCase()) || d.specialty?.toLowerCase().includes(docSearch.toLowerCase()));
    if (docTierFilter !== "all") list = list.filter(d => d.relationship_tier === docTierFilter);
    return list;
  }, [doctors, docSearch, docTierFilter]);

  // ─── AI Review Response ───
  const generateAIResponse = async (review: any) => {
    setRespondingReviewId(review.id);
    setAiLoading(true);
    try {
      const hospitalName = "Aumrti Hospital";
      const result = await callAI({
        featureKey: "voice_scribe",
        hospitalId: hospitalId,
        prompt: `You are the patient relations officer of an Indian hospital.
Write a professional, empathetic response to this ${review.platform} review.
Rating: ${review.rating}/5
Review: "${review.review_text || 'No text'}"
Reviewer: ${review.reviewer_name || 'Anonymous'}
Guidelines:
- Thank the reviewer by name if available
- For positive reviews (4-5): express gratitude
- For negative reviews (1-2): apologize sincerely, invite them to contact us
- Keep under 100 words
- Sign off as: "${hospitalName} Patient Care Team"
- Use warm, professional Indian English`,
        maxTokens: 200,
      });
      if (result.error || !result.text) {
        toast({ title: "AI generation failed", description: result.error || "Empty response", variant: "destructive" });
      } else {
        setAiResponse(result.text);
      }
    } catch {
      toast({ title: "AI generation failed", variant: "destructive" });
    }
    setAiLoading(false);
  };

  const postResponse = async (reviewId: string) => {
    const { error } = await supabase.from("online_reviews").update({
      response_text: aiResponse, responded: true, responded_at: new Date().toISOString(),
    }).eq("id", reviewId);
    if (error) { toast({ title: "Error", variant: "destructive" }); return; }
    toast({ title: "Response saved" });
    setRespondingReviewId(null); setAiResponse("");
    loadAll();
  };

  // ─── Acquisition source data for analytics ───
  const sourceData = useMemo(() => {
    const counts: Record<string, number> = {};
    acquisitions.forEach(a => { counts[a.source] = (counts[a.source] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [acquisitions]);

  const platformBreakdown = useMemo(() => {
    const grouped: Record<string, { count: number; total: number }> = {};
    reviews.forEach(r => {
      if (!grouped[r.platform]) grouped[r.platform] = { count: 0, total: 0 };
      grouped[r.platform].count++;
      grouped[r.platform].total += r.rating;
    });
    return Object.entries(grouped).map(([platform, data]) => ({
      platform: platform.charAt(0).toUpperCase() + platform.slice(1),
      avg: (data.total / data.count).toFixed(1),
      count: data.count,
    }));
  }, [reviews]);

  const formatINR = (n: number) => "₹" + n.toLocaleString("en-IN");

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* HEADER */}
      <div className="flex items-center justify-between px-6 h-[52px] border-b bg-background shrink-0">
        <h1 className="text-base font-bold">📣 CRM & Patient Acquisition</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setEditDoctor(null); setShowAddDoctor(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Referral Doctor
          </Button>
          <Button size="sm" onClick={() => setShowNewCampaign(true)}>
            <Plus className="w-4 h-4 mr-1" /> New Campaign
          </Button>
        </div>
      </div>

      {/* KPI ROW */}
      <div className="grid grid-cols-5 gap-3 px-6 py-3 shrink-0">
        {[
          { label: "Referral Doctors", value: activeDoctors, icon: Users },
          { label: "Referrals This Month", value: referralsThisMonth, icon: UserCheck },
          { label: "Campaign Reach", value: campaignReach, icon: Megaphone },
          { label: "Avg Review Rating", value: avgRating, icon: Star, color: Number(avgRating) >= 4 ? "text-green-600" : Number(avgRating) >= 3 ? "text-yellow-600" : "text-red-600" },
          { label: "Referral Revenue", value: formatINR(refRevenue), icon: TrendingUp },
        ].map((kpi, i) => (
          <Card key={i} className="shadow-sm">
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><kpi.icon className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className={`text-lg font-bold ${kpi.color || ""}`}>{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* TABS */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden px-6">
        <TabsList className="shrink-0 mb-2 w-fit">
          <TabsTrigger value="referrals">👨‍⚕️ Referrals</TabsTrigger>
          <TabsTrigger value="campaigns">📣 Campaigns</TabsTrigger>
          <TabsTrigger value="reviews">⭐ Reviews</TabsTrigger>
          <TabsTrigger value="segments">👥 Segments</TabsTrigger>
          <TabsTrigger value="analytics">📊 Analytics</TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: REFERRALS ═══ */}
        <TabsContent value="referrals" className="flex-1 overflow-hidden mt-0">
          <div className="flex gap-4 h-full">
            {/* LEFT LIST */}
            <div className="w-[320px] shrink-0 flex flex-col border rounded-lg">
              <div className="p-3 border-b space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search doctors..." value={docSearch} onChange={e => setDocSearch(e.target.value)} className="pl-8 h-9" />
                </div>
                <div className="flex gap-1">
                  {["all", "platinum", "gold", "silver"].map(t => (
                    <Button key={t} size="sm" variant={docTierFilter === t ? "default" : "ghost"} className="text-xs h-7 px-2"
                      onClick={() => setDocTierFilter(t)}>
                      {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
              <ScrollArea className="flex-1">
                {filteredDoctors.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">No referral doctors found</p>
                ) : filteredDoctors.map(doc => (
                  <button key={doc.id} onClick={() => setSelectedDoctor(doc)}
                    className={`w-full text-left p-3 border-b hover:bg-accent/50 transition-colors ${selectedDoctor?.id === doc.id ? "bg-accent/30" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{doc.doctor_name}</span>
                      <Badge variant="secondary" className={`text-[10px] ${TIER_COLORS[doc.relationship_tier]}`}>
                        {doc.relationship_tier}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{doc.specialty || "General"}</p>
                    <p className="text-xs text-muted-foreground">{doc.clinic_hospital}</p>
                    <div className="flex gap-3 mt-1 text-xs">
                      <span>Referrals: {doc.total_referrals}</span>
                      <span>Revenue: {formatINR(Number(doc.total_revenue || 0))}</span>
                    </div>
                  </button>
                ))}
              </ScrollArea>
            </div>

            {/* RIGHT DETAIL */}
            <div className="flex-1 border rounded-lg overflow-hidden">
              {selectedDoctor ? (
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-lg font-bold">{selectedDoctor.doctor_name}</h2>
                        <p className="text-sm text-muted-foreground">{selectedDoctor.specialty} · {selectedDoctor.qualification}</p>
                        <p className="text-sm text-muted-foreground">{selectedDoctor.clinic_hospital}</p>
                        <div className="flex gap-3 mt-2 text-sm text-muted-foreground">
                          {selectedDoctor.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{selectedDoctor.phone}</span>}
                          {selectedDoctor.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{selectedDoctor.email}</span>}
                          {selectedDoctor.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{selectedDoctor.city}</span>}
                        </div>
                      </div>
                      <Badge className={TIER_COLORS[selectedDoctor.relationship_tier]}>{selectedDoctor.relationship_tier}</Badge>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: "Total Referrals", value: selectedDoctor.total_referrals },
                        { label: "Total Revenue", value: formatINR(Number(selectedDoctor.total_revenue || 0)) },
                        { label: "Avg / Referral", value: selectedDoctor.total_referrals > 0 ? formatINR(Math.round(Number(selectedDoctor.total_revenue || 0) / selectedDoctor.total_referrals)) : "₹0" },
                        { label: "Last Referral", value: selectedDoctor.last_referral_at ? format(new Date(selectedDoctor.last_referral_at), "dd/MM/yyyy") : "Never" },
                      ].map((m, i) => (
                        <Card key={i}><CardContent className="p-3 text-center">
                          <p className="text-xs text-muted-foreground">{m.label}</p>
                          <p className="text-base font-bold">{m.value}</p>
                        </CardContent></Card>
                      ))}
                    </div>

                    <Separator />

                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => {
                        const msg = `Dear Dr. ${selectedDoctor.doctor_name}, thank you for your referrals to Aumrti Hospital. We appreciate your trust and partnership. — Aumrti Hospital Team`;
                        window.open(`https://wa.me/${selectedDoctor.phone?.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
                      }}>
                        <MessageCircle className="w-4 h-4 mr-1" /> Send Thank-You
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditDoctor(selectedDoctor); setShowAddDoctor(true); }}>
                        Edit Doctor
                      </Button>
                    </div>
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <p>Select a referral doctor to view details</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ═══ TAB 2: CAMPAIGNS ═══ */}
        <TabsContent value="campaigns" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {campaigns.length === 0 ? (
                <p className="text-center text-muted-foreground py-12">No campaigns yet. Click "+ New Campaign" to create one.</p>
              ) : campaigns.map(c => (
                <Card key={c.id} className={c.status === "active" ? "border-green-300 bg-green-50/50" : ""}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.campaign_name}</span>
                        <Badge variant="secondary" className="text-xs">{c.campaign_type.replace(/_/g, " ")}</Badge>
                        <Badge variant={c.status === "active" ? "default" : "secondary"} className="text-xs">{c.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {c.target_segment && `Segment: ${c.target_segment} · `}
                        {c.start_date && `${format(new Date(c.start_date), "dd/MM/yyyy")} — `}
                        {c.end_date && format(new Date(c.end_date), "dd/MM/yyyy")}
                      </p>
                    </div>
                    <div className="flex gap-6 text-center">
                      <div><p className="text-xs text-muted-foreground">Reach</p><p className="font-bold">{c.reach_count}</p></div>
                      <div><p className="text-xs text-muted-foreground">Conversions</p><p className="font-bold">{c.conversion_count}</p></div>
                      <div><p className="text-xs text-muted-foreground">Revenue</p><p className="font-bold">{formatINR(Number(c.revenue_generated || 0))}</p></div>
                      <div><p className="text-xs text-muted-foreground">ROI</p><p className="font-bold">{c.roi_percent ? `${c.roi_percent}%` : "—"}</p></div>
                    </div>
                    {c.status === "draft" && (
                      <Button size="sm" className="ml-4" onClick={async () => {
                        await supabase.from("marketing_campaigns").update({ status: "active" }).eq("id", c.id);
                        toast({ title: "Campaign activated" }); loadAll();
                      }}>▶ Run</Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ═══ TAB 3: REVIEWS ═══ */}
        <TabsContent value="reviews" className="flex-1 overflow-hidden mt-0">
          <div className="flex flex-col h-full gap-3">
            {/* Overview */}
            <div className="flex items-center gap-6 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold">{avgRating}</span>
                <span className="text-yellow-500 text-2xl">⭐</span>
                <span className="text-sm text-muted-foreground">/ 5.0 ({reviews.length} reviews)</span>
              </div>
              <div className="flex gap-4">
                {platformBreakdown.map(p => (
                  <div key={p.platform} className="text-center">
                    <p className="text-xs text-muted-foreground">{p.platform}</p>
                    <p className="font-bold text-sm">⭐{p.avg} <span className="text-xs font-normal text-muted-foreground">({p.count})</span></p>
                  </div>
                ))}
              </div>
              <div className="ml-auto">
                <Button size="sm" variant="outline" onClick={() => setShowAddReview(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add Review
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="space-y-2">
                {reviews.map(r => (
                  <Card key={r.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{r.platform}</Badge>
                            <span className="text-yellow-500">{"⭐".repeat(r.rating)}</span>
                            {r.sentiment && <Badge className={`text-xs ${SENTIMENT_COLORS[r.sentiment]}`}>{r.sentiment}</Badge>}
                            {r.responded && <Badge variant="secondary" className="text-xs">✓ Responded</Badge>}
                          </div>
                          <p className="text-sm mt-1">{r.review_text || <span className="text-muted-foreground italic">No text</span>}</p>
                          <ReviewSentimentAnalyser review={r} onUpdated={loadAll} />
                          <p className="text-sm mt-1">{r.review_text || <span className="text-muted-foreground italic">No text</span>}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {r.reviewer_name || "Anonymous"} · {r.review_date ? format(new Date(r.review_date), "dd/MM/yyyy") : ""}
                          </p>
                          {r.response_text && (
                            <div className="mt-2 p-2 bg-muted/50 rounded text-sm">
                              <p className="text-xs font-medium text-muted-foreground mb-1">Hospital Response:</p>
                              {r.response_text}
                            </div>
                          )}
                          {respondingReviewId === r.id && (
                            <div className="mt-2 space-y-2">
                              <Textarea value={aiResponse} onChange={e => setAiResponse(e.target.value)} rows={3} />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => postResponse(r.id)}>Post Response</Button>
                                <Button size="sm" variant="ghost" onClick={() => { setRespondingReviewId(null); setAiResponse(""); }}>Cancel</Button>
                              </div>
                            </div>
                          )}
                        </div>
                        {!r.responded && respondingReviewId !== r.id && (
                          <Button size="sm" variant="outline" onClick={() => generateAIResponse(r)} disabled={aiLoading}>
                            {aiLoading && respondingReviewId === r.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : "🤖 AI Response"}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {reviews.length === 0 && <p className="text-center text-muted-foreground py-12">No reviews yet</p>}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* ═══ TAB 4: SEGMENTS ═══ */}
        <TabsContent value="segments" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="space-y-4">
              <PatientPropensitySection />
              <div className="grid grid-cols-2 gap-3">
                {segments.map(seg => (
                  <Card key={seg.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">{seg.segment_name}</h3>
                          <Badge variant="secondary" className="text-xs mt-1">{seg.segment_type.replace(/_/g, " ")}</Badge>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold">{seg.patient_count}</p>
                          <p className="text-xs text-muted-foreground">patients</p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => {
                          setShowNewCampaign(true);
                        }}>Create Campaign</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ═══ TAB 5: ANALYTICS ═══ */}
        <TabsContent value="analytics" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="space-y-4">
            <ReferralPatternAnalyser />
            <div className="grid grid-cols-2 gap-4">
              {/* Source Attribution */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Patient Acquisition Sources</CardTitle></CardHeader>
                <CardContent>
                  {sourceData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={sourceData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                          {sourceData.map((_, i) => <Cell key={i} fill={PLATFORM_COLORS[i % PLATFORM_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="text-center text-muted-foreground py-8 text-sm">No acquisition data yet</p>}
                </CardContent>
              </Card>

              {/* Top Referring Doctors */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Top Referring Doctors</CardTitle></CardHeader>
                <CardContent>
                  {doctors.slice(0, 5).length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={doctors.slice(0, 5).map(d => ({ name: d.doctor_name.split(" ").slice(0, 2).join(" "), referrals: d.total_referrals }))}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="referrals" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-center text-muted-foreground py-8 text-sm">No referral data</p>}
                </CardContent>
              </Card>

              {/* Campaign ROI */}
              <Card className="col-span-2">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Campaign ROI</CardTitle></CardHeader>
                <CardContent>
                  <div className="rounded border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium">Campaign</th>
                          <th className="text-right p-2 font-medium">Reach</th>
                          <th className="text-right p-2 font-medium">Conversions</th>
                          <th className="text-right p-2 font-medium">Revenue</th>
                          <th className="text-right p-2 font-medium">Cost</th>
                          <th className="text-right p-2 font-medium">ROI%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map(c => (
                          <tr key={c.id} className="border-t">
                            <td className="p-2">{c.campaign_name}</td>
                            <td className="p-2 text-right">{c.reach_count}</td>
                            <td className="p-2 text-right">{c.conversion_count}</td>
                            <td className="p-2 text-right">{formatINR(Number(c.revenue_generated || 0))}</td>
                            <td className="p-2 text-right">{c.budget_inr ? formatINR(Number(c.budget_inr)) : "—"}</td>
                            <td className="p-2 text-right font-medium">{c.roi_percent ? `${c.roi_percent}%` : "—"}</td>
                          </tr>
                        ))}
                        {campaigns.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No campaigns</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Review Trend */}
              <Card className="col-span-2">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Review Rating Trend</CardTitle></CardHeader>
                <CardContent>
                  {reviews.length > 0 ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={reviews.slice().reverse().map((r, i) => ({ idx: i + 1, rating: r.rating }))}>
                        <XAxis dataKey="idx" tick={{ fontSize: 11 }} />
                        <YAxis domain={[1, 5]} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="rating" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <p className="text-center text-muted-foreground py-8 text-sm">No reviews to chart</p>}
                </CardContent>
              </Card>
            </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* MODALS */}
      <AddReferralDoctorModal open={showAddDoctor} onClose={() => setShowAddDoctor(false)} onSaved={() => loadAll()} hospitalId={hospitalId} editDoc={editDoctor} />
      <NewCampaignModal open={showNewCampaign} onClose={() => setShowNewCampaign(false)} onSaved={loadAll} segments={segments} hospitalId={hospitalId!} />
      <AddReviewModal open={showAddReview} onClose={() => setShowAddReview(false)} onSaved={loadAll} hospitalId={hospitalId!} />
    </div>
  );
};

export default CRMPage;
