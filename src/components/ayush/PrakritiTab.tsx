import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Search, Save, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { callAI } from "@/lib/aiProvider";

const QUESTIONS = [
  { q: "Body frame", v: "Thin / lean", p: "Medium / muscular", k: "Heavy / stout" },
  { q: "Body weight", v: "Low, hard to gain", p: "Moderate, manageable", k: "Heavy, hard to lose" },
  { q: "Skin texture", v: "Dry / rough", p: "Oily / soft / warm", k: "Thick / smooth / cool" },
  { q: "Skin colour", v: "Darkish / tans easily", p: "Fair / reddish / freckles", k: "Pale / whitish" },
  { q: "Hair quality", v: "Dry / frizzy / thin", p: "Fine / early greying", k: "Thick / oily / lustrous" },
  { q: "Face shape", v: "Long / angular", p: "Heart-shaped / pointed chin", k: "Round / full" },
  { q: "Eyes", v: "Small / dry / restless", p: "Sharp / penetrating", k: "Large / calm / moist" },
  { q: "Appetite", v: "Variable / irregular", p: "Strong / frequent hunger", k: "Slow / steady" },
  { q: "Digestion", v: "Irregular / bloating", p: "Quick / acidic tendency", k: "Slow but steady" },
  { q: "Thirst", v: "Variable", p: "Excessive", k: "Scanty" },
  { q: "Bowel habits", v: "Dry / constipated", p: "Loose / frequent", k: "Regular / heavy" },
  { q: "Sweat", v: "Scanty", p: "Profuse / strong odour", k: "Moderate / cool" },
  { q: "Sleep quality", v: "Light / interrupted", p: "Moderate / sound", k: "Heavy / prolonged" },
  { q: "Dreams", v: "Flying / running / fearful", p: "Fire / anger / vivid", k: "Water / romantic / calm" },
  { q: "Stamina", v: "Low endurance, tires fast", p: "Good, overheats quickly", k: "Excellent, slow to start" },
  { q: "Walking pace", v: "Fast / restless", p: "Purposeful / determined", k: "Slow / steady" },
  { q: "Voice quality", v: "Weak / hoarse", p: "Sharp / clear", k: "Deep / melodious" },
  { q: "Speech pattern", v: "Fast / talkative / tangential", p: "Sharp / argumentative", k: "Slow / measured / few words" },
  { q: "Mental activity", v: "Restless / many ideas", p: "Focused / logical", k: "Calm / steady / contemplative" },
  { q: "Memory", v: "Quick to learn, forget fast", p: "Sharp and precise", k: "Slow to learn, never forgets" },
  { q: "Emotional nature", v: "Anxious / fearful", p: "Irritable / ambitious", k: "Calm / attached" },
  { q: "Under stress", v: "Worry / anxiety", p: "Anger / frustration", k: "Withdrawal / depression" },
  { q: "Spending habit", v: "Impulsive / poor saving", p: "Planned / moderate", k: "Thrifty / saves well" },
  { q: "Creativity", v: "Very creative / artistic", p: "Inventive / technical", k: "Steady / methodical" },
  { q: "Tolerance to cold", v: "Dislikes cold, prefers warmth", p: "Prefers cold, dislikes heat", k: "Tolerates cold well" },
  { q: "Pulse character", v: "Irregular, snake-like", p: "Bounding, frog-like", k: "Steady, swan-like" },
  { q: "Joint health", v: "Cracking / dry joints", p: "Loose / flexible", k: "Large / well-lubricated" },
  { q: "Nail quality", v: "Brittle / ridged", p: "Soft / pink", k: "Thick / white / strong" },
  { q: "Social nature", v: "Makes friends fast, changes often", p: "Selective / competitive", k: "Loyal / long-lasting bonds" },
  { q: "Faith / belief", v: "Changeable", p: "Fanatic / determined", k: "Steady / devotional" },
];

export default function PrakritiTab() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [existingAssessment, setExistingAssessment] = useState<any>(null);
  const [responses, setResponses] = useState<Record<number, "v" | "p" | "k">>({});
  const [saving, setSaving] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [loadingAI, setLoadingAI] = useState(false);
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [loadingPatients, setLoadingPatients] = useState(false);

  useEffect(() => {
    const loadHospitalContext = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("users")
        .select("hospital_id")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Hospital context error:", error.message);
        return;
      }

      setHospitalId(data?.hospital_id ?? null);
    };

    loadHospitalContext();
  }, []);

  useEffect(() => {
    const searchPatients = async () => {
      if (search.length < 2 || !hospitalId) {
        setPatients([]);
        return;
      }

      setLoadingPatients(true);
      const { data, error } = await supabase
        .from("patients")
        .select("id, full_name, uhid, phone, dob, gender")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .or(`full_name.ilike.%${search}%,uhid.ilike.%${search}%,phone.ilike.%${search}%`)
        .limit(20);

      if (error) {
        console.error("Patient search error:", error.message);
        setPatients([]);
        setLoadingPatients(false);
        return;
      }

      setPatients(data ?? []);
      setLoadingPatients(false);
    };

    if (!hospitalId && search.length >= 2) {
      setPatients([]);
      return;
    }

    searchPatients();
  }, [search, hospitalId]);


  const loadExisting = useCallback(async () => {
    if (!selectedPatient || !hospitalId) return;

    const { data, error } = await supabase.from("prakriti_assessments").select("*")
      .eq("hospital_id", hospitalId)
      .eq("patient_id", selectedPatient.id)
      .order("assessed_at", { ascending: false }).limit(1);

    if (error) {
      console.error("Assessment load error:", error.message);
      setExistingAssessment(null);
      setAiSummary("");
      setResponses({});
      return;
    }

    if (data && data.length > 0) {
      setExistingAssessment(data[0]);
      setAiSummary(data[0].prakriti_summary || "");
    } else {
      setExistingAssessment(null);
      setAiSummary("");
    }
    setResponses({});
  }, [selectedPatient, hospitalId]);

  useEffect(() => {
    if (selectedPatient) loadExisting();
  }, [loadExisting, selectedPatient]);

  const vataScore = Object.values(responses).filter((r) => r === "v").length;
  const pittaScore = Object.values(responses).filter((r) => r === "p").length;
  const kaphaScore = Object.values(responses).filter((r) => r === "k").length;
  const totalAnswered = Object.keys(responses).length;

  const getDominantDosha = () => {
    const scores = [
      { dosha: "vata", score: vataScore },
      { dosha: "pitta", score: pittaScore },
      { dosha: "kapha", score: kaphaScore },
    ].sort((a, b) => b.score - a.score);

    if (Math.abs(scores[0].score - scores[1].score) <= 3 && Math.abs(scores[1].score - scores[2].score) <= 3) return "tridosha";
    if (Math.abs(scores[0].score - scores[1].score) <= 3) return `${scores[0].dosha}_${scores[1].dosha}`;
    return scores[0].dosha;
  };

  const generateAISummary = async () => {
    if (totalAnswered < 20) { toast.error("Answer at least 20 questions"); return; }
    setLoadingAI(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: userRow, error: userError } = await supabase.from("users").select("hospital_id").eq("auth_user_id", userData?.user?.id || "").maybeSingle();
      if (userError || !userRow?.hospital_id) throw new Error("Hospital not found");
      const dominant = getDominantDosha();
      const prompt = `Patient Prakriti Assessment: Vata=${vataScore}/30, Pitta=${pittaScore}/30, Kapha=${kaphaScore}/30. Dominant dosha: ${dominant}. Generate a concise Prakriti summary (3-4 sentences) covering: personality traits, health tendencies, and dietary/lifestyle recommendations based on Ayurvedic principles.`;
      const result = await callAI({ featureKey: "prakriti_analysis", hospitalId: userRow.hospital_id, prompt, maxTokens: 300 });
      if (result.error || !result.text) throw new Error(result.error || "AI returned empty response");
      setAiSummary(result.text);
    } catch {
      setAiSummary(`Patient is predominantly ${getDominantDosha().replace("_", "-")} constitution. Vata: ${vataScore}, Pitta: ${pittaScore}, Kapha: ${kaphaScore}.`);
    } finally {
      setLoadingAI(false);
    }
  };

  const saveAssessment = async () => {
    if (!selectedPatient) { toast.error("Select a patient"); return; }
    if (totalAnswered < 20) { toast.error("Answer at least 20 questions"); return; }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: userRow, error: userError } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", userData?.user?.id || "").maybeSingle();
      if (userError || !userRow) { toast.error("User not found"); return; }

      const { error } = await supabase.from("prakriti_assessments").insert({
        hospital_id: userRow.hospital_id,
        patient_id: selectedPatient.id,
        assessed_by: userRow.id,
        responses,
        vata_score: vataScore,
        pitta_score: pittaScore,
        kapha_score: kaphaScore,
        dominant_dosha: getDominantDosha(),
        prakriti_summary: aiSummary || null,
      });
      if (error) throw error;
      toast.success("Prakriti assessment saved");
      loadExisting();
    } catch (e: any) {
      toast.error(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const DOSHA_COLORS: Record<string, string> = { vata: "text-blue-600", pitta: "text-red-600", kapha: "text-green-600" };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="w-[280px] border-r flex flex-col bg-muted/20">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search patient..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingPatients && <p className="px-3 py-2 text-xs text-muted-foreground">Searching patients...</p>}
          {!loadingPatients && search.length >= 2 && patients.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No patients found</p>
          )}
          {patients.map((p) => (
            <button
              key={p.id}
              className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-accent/50 ${selectedPatient?.id === p.id ? "bg-accent" : ""}`}
              onClick={() => setSelectedPatient(p)}
            >
              <p className="font-medium truncate">{p.full_name}</p>
              <p className="text-xs text-muted-foreground">{p.uhid}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-4">
        {!selectedPatient ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">Select a patient</div>
        ) : existingAssessment && totalAnswered === 0 ? (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Existing Prakriti Assessment</CardTitle>
                <p className="text-xs text-muted-foreground">Assessed on {new Date(existingAssessment.assessed_at).toLocaleDateString("en-IN")}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-center">
                  <Badge className="text-lg px-4 py-1">{existingAssessment.dominant_dosha.replace("_", "-").toUpperCase()}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Vata", score: existingAssessment.vata_score, color: "bg-blue-500" },
                    { label: "Pitta", score: existingAssessment.pitta_score, color: "bg-red-500" },
                    { label: "Kapha", score: existingAssessment.kapha_score, color: "bg-green-500" },
                  ].map(({ label, score, color }) => (
                    <div key={label} className="text-center">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-2xl font-bold font-mono">{score}/30</p>
                      <Progress value={(score / 30) * 100} className={`h-2 mt-1 [&>div]:${color}`} />
                    </div>
                  ))}
                </div>
                {existingAssessment.prakriti_summary && (
                  <p className="text-sm bg-muted/50 p-3 rounded">{existingAssessment.prakriti_summary}</p>
                )}
                <Button variant="outline" onClick={() => { setExistingAssessment(null); setResponses({}); }}>Re-assess Prakriti</Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Prakriti Questionnaire ({totalAnswered}/30)</h2>
              <div className="flex gap-2 text-xs">
                <Badge variant="outline" className="text-blue-600">V: {vataScore}</Badge>
                <Badge variant="outline" className="text-red-600">P: {pittaScore}</Badge>
                <Badge variant="outline" className="text-green-600">K: {kaphaScore}</Badge>
              </div>
            </div>

            <div className="border rounded-md overflow-hidden">
              <div className="grid grid-cols-4 bg-muted px-3 py-2 text-xs font-medium">
                <div>Question</div>
                <div className="text-center text-blue-600">Vata</div>
                <div className="text-center text-red-600">Pitta</div>
                <div className="text-center text-green-600">Kapha</div>
              </div>
              {QUESTIONS.map((q, idx) => (
                <div key={idx} className={`grid grid-cols-4 px-3 py-1.5 text-xs border-t ${responses[idx] ? "bg-accent/30" : ""}`}>
                  <div className="font-medium self-center">{q.q}</div>
                  {(["v", "p", "k"] as const).map((opt) => (
                    <button
                      key={opt}
                      className={`text-center px-1 py-1 rounded transition ${
                        responses[idx] === opt
                          ? opt === "v" ? "bg-blue-100 text-blue-700 font-medium" : opt === "p" ? "bg-red-100 text-red-700 font-medium" : "bg-green-100 text-green-700 font-medium"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => setResponses({ ...responses, [idx]: opt })}
                    >
                      {opt === "v" ? q.v : opt === "p" ? q.p : q.k}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {totalAnswered >= 20 && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">Your Prakriti</p>
                    <Badge className="text-lg px-4 py-1 mt-1">{getDominantDosha().replace("_", "-").toUpperCase()}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Vata", score: vataScore, color: "bg-blue-500" },
                      { label: "Pitta", score: pittaScore, color: "bg-red-500" },
                      { label: "Kapha", score: kaphaScore, color: "bg-green-500" },
                    ].map(({ label, score, color }) => (
                      <div key={label} className="text-center">
                        <p className="text-sm font-medium">{label}: {score}/30</p>
                        <Progress value={(score / 30) * 100} className={`h-2 mt-1 [&>div]:${color}`} />
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={generateAISummary} disabled={loadingAI}>
                    <Sparkles className="h-3 w-3 mr-1" /> {loadingAI ? "Generating..." : "Generate AI Summary"}
                  </Button>
                  {aiSummary && <p className="text-sm bg-muted/50 p-3 rounded">{aiSummary}</p>}
                </CardContent>
              </Card>
            )}

            <div className="flex justify-end pb-4">
              <Button onClick={saveAssessment} disabled={saving || totalAnswered < 20}>
                <Save className="h-4 w-4 mr-1" /> {saving ? "Saving..." : "Save Prakriti Assessment"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
