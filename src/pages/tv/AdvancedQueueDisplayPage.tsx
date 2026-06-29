/**
 * AdvancedQueueDisplayPage — full-screen TV queue display.
 *
 * URL: /tv?h=<hospital_id>&dept=<dept_id>
 *
 * Features:
 *  - Multi-doctor "Now Calling" columns + single consolidated view
 *  - Real-time Supabase subscription on opd_tokens + queue_state
 *  - Browser SpeechSynthesis announcements on new call (with audio toggle)
 *  - Marketing banner slider (images or tip cards)
 *  - Multi-language label support (en-IN, hi-IN, ta-IN, te-IN, kn-IN …)
 *  - Configurable call format + language from tv_display_settings table
 *
 * Announcement logic
 * ──────────────────
 * Two paths feed announcements so nothing is missed:
 *
 * 1. FAST PATH — queue_state realtime payload arrives the instant a doctor
 *    presses "Call Next" in TokenQueue. The handler reads the token number
 *    and looks up the doctor name from slotsRef (stale-safe O(n) scan).
 *    window.speechSynthesis.cancel() fires first so rapid calls never overlap.
 *
 * 2. BACKUP PATH — fetchQueue() runs after every opd_tokens UPDATE and after
 *    the queue_state change (UI refresh). It announces any call key that the
 *    realtime handler may have missed (e.g. browser tab was in background).
 *
 * Deduplication uses a Set<string> keyed by "doctorId|tokenString". The set
 * is rebuilt on each fetchQueue(), pruning stale entries automatically. The
 * fast path adds to the set immediately so the backup path skips re-announcing.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Volume2, VolumeX } from "lucide-react";

// ─── Language Map ─────────────────────────────────────────────────────────────

type LangEntry = {
  nowCalling: string; proceedTo: string; next: string;
  departments: string; healthTip: string; token: string;
  /** Announcement text template — {number} and {doctor} are replaced at runtime. */
  callFormat: string;
};

const LANG: Record<string, LangEntry> = {
  "en-IN": { nowCalling: "Now Calling",                  proceedTo: "Please proceed to",              next: "Next Up",         departments: "Departments Open Today",       healthTip: "Health Tip",         token: "Token",    callFormat: "Token {number}, please proceed to Doctor {doctor}" },
  "hi-IN": { nowCalling: "अभी बुलाया जा रहा है",           proceedTo: "कृपया जाएं",                    next: "अगले",            departments: "आज खुले विभाग",               healthTip: "स्वास्थ्य सुझाव",    token: "टोकन",    callFormat: "टोकन {number}, कृपया Doctor {doctor} के पास जाएं" },
  "ta-IN": { nowCalling: "இப்போது அழைக்கிறோம்",            proceedTo: "தயவுசெய்து செல்லுங்கள்",        next: "அடுத்தது",        departments: "இன்று திறந்த பிரிவுகள்",      healthTip: "உடல்நல குறிப்பு",    token: "டோக்கன்", callFormat: "டோக்கன் {number}, Doctor {doctor} அறைக்கு செல்லுங்கள்" },
  "te-IN": { nowCalling: "ఇప్పుడు పిలుస్తున్నారు",          proceedTo: "దయచేసి వెళ్ళండి",              next: "తదుపరి",          departments: "ఈ రోజు తెరిచిన విభాగాలు",    healthTip: "ఆరోగ్య చిట్కా",      token: "టోకెన్",  callFormat: "టోకెన్ {number}, Doctor {doctor} గదికి దయచేసి వెళ్ళండి" },
  "kn-IN": { nowCalling: "ಈಗ ಕರೆ ಮಾಡಲಾಗುತ್ತಿದೆ",           proceedTo: "ದಯವಿಟ್ಟು ಹೋಗಿ",               next: "ಮುಂದೆ",          departments: "ಇಂದು ತೆರೆದ ವಿಭಾಗಗಳು",       healthTip: "ಆರೋಗ್ಯ ಸಲಹೆ",       token: "ಟೋಕನ್",  callFormat: "ಟೋಕನ್ {number}, Doctor {doctor} ಕೊಠಡಿಗೆ ದಯವಿಟ್ಟು ಹೋಗಿ" },
  "ml-IN": { nowCalling: "ഇപ്പോൾ വിളിക്കുന്നു",             proceedTo: "ദയവായി പോകൂ",                  next: "അടുത്തത്",        departments: "ഇന്ന് തുറന്ന വകുപ്പുകൾ",     healthTip: "ആരോഗ്യ നുറുങ്ങ്",   token: "ടോക്കൺ",  callFormat: "ടോക്കൺ {number}, Doctor {doctor} ന്‍റെ അടുക്കൽ ദയവായി പോകൂ" },
  "mr-IN": { nowCalling: "आता बोलावत आहे",                  proceedTo: "कृपया जा",                      next: "पुढे",            departments: "आज उघडलेले विभाग",            healthTip: "आरोग्य टीप",         token: "टोकन",    callFormat: "टोकन {number}, कृपया Doctor {doctor} कडे जा" },
  "bn-IN": { nowCalling: "এখন ডাকছে",                       proceedTo: "অনুগ্রহ করে যান",               next: "পরবর্তী",         departments: "আজ খোলা বিভাগ",              healthTip: "স্বাস্থ্য টিপস",     token: "টোকেন",   callFormat: "টোকেন {number}, Doctor {doctor}-এর কাছে যান" },
};

const LANG_CODE_MAP: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", ta: "ta-IN", te: "te-IN",
  kn: "kn-IN", ml: "ml-IN", mr: "mr-IN", bn: "bn-IN",
  gu: "en-IN", pa: "en-IN",
};

// Display options for the admin language selector
const LANG_OPTIONS = [
  { code: "en-IN", label: "English",  script: "English"  },
  { code: "hi-IN", label: "Hindi",    script: "हिन्दी"    },
  { code: "ta-IN", label: "Tamil",    script: "தமிழ்"     },
  { code: "te-IN", label: "Telugu",   script: "తెలుగు"    },
  { code: "kn-IN", label: "Kannada",  script: "ಕನ್ನಡ"    },
  { code: "ml-IN", label: "Malay.",   script: "മലയാളം"   },
  { code: "mr-IN", label: "Marathi",  script: "मराठी"    },
  { code: "bn-IN", label: "Bengali",  script: "বাংলা"     },
];

// ─── Defaults ─────────────────────────────────────────────────────────────────

const HEALTH_TIPS = [
  { emoji: "💧", text: "Drink 8 glasses of water daily" },
  { emoji: "🚶", text: "30 minutes of walking boosts heart health" },
  { emoji: "🩺", text: "Annual checkups catch problems early" },
  { emoji: "😴", text: "7–8 hours of sleep strengthens immunity" },
  { emoji: "🥦", text: "Eat 5 servings of fruits & vegetables daily" },
  { emoji: "🧴", text: "Wash hands 20 seconds to prevent infections" },
];

const DEFAULT_SLIDES = HEALTH_TIPS.map((t) => ({ type: "tip", ...t }));

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueSlot {
  doctorId:       string;
  doctorName:     string;
  deptName:       string;
  currentToken:   string | null;
  currentPatient: string | null;
  calledAt:       string | null;
  nextTokens:     string[];
  color:          string;
}

interface DeptStatus { name: string; token: string }
interface TVSettings {
  announcement_language:  string;
  call_format:            string;
  marketing_slides:       any[];
  slide_interval_seconds: number;
  show_marketing_panel:   boolean;
}

const DOCTOR_COLORS = [
  "#0E7B7B","#2563EB","#7C3AED","#D97706","#059669",
  "#DC2626","#0891B2","#65A30D","#C026D3","#EA580C",
];

// ─── Main Component ───────────────────────────────────────────────────────────

const AdvancedQueueDisplayPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const deptFilter     = searchParams.get("dept");
  const isAdminMode    = searchParams.has("admin");
  const { hospitalId } = useHospitalId();

  const [now,             setNow]             = useState(new Date());
  const [hospital,        setHospital]        = useState<any>(null);
  const [slots,           setSlots]           = useState<QueueSlot[]>([]);
  const [deptStats,       setDeptStats]       = useState<DeptStatus[]>([]);
  const [secondaryLocale, setSecondaryLocale] = useState<string | null>(null);
  const [tvSettings, setTVSettings] = useState<TVSettings>({
    announcement_language:  "en-IN",
    call_format:            "Token {number}, please proceed to Doctor {doctor}",
    marketing_slides:       DEFAULT_SLIDES,
    slide_interval_seconds: 8,
    show_marketing_panel:   true,
  });
  const [slideIdx,  setSlideIdx]  = useState(0);
  const [slideFade, setSlideFade] = useState(true);

  // ── Audio toggle — persisted to localStorage ──
  const [audioEnabled, setAudioEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem("tv_audio_enabled") !== "false"; } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem("tv_audio_enabled", audioEnabled ? "true" : "false"); } catch {}
  }, [audioEnabled]);

  // ── Refs ──
  // Set of "doctorId|tokenString" keys for currently-announced calls.
  // Rebuilt on every fetchQueue(); the fast realtime path adds to it immediately.
  const lastCallsRef  = useRef(new Set<string>());
  // Flag so the very first fetchQueue() does not trigger announcements for
  // tokens that were already called before the TV page was opened.
  const isInitial     = useRef(true);
  // Stable pointer to latest slots for use in realtime callbacks without
  // needing to re-subscribe when slots change.
  const slotsRef      = useRef<QueueSlot[]>([]);
  // Latest announce function (updated via ref to avoid re-subscribing channels).
  const announceRef   = useRef<(token: string, doctor: string) => void>(() => {});
  // Best matching SpeechSynthesisVoice for the current language.
  // Populated async via onvoiceschanged (Chrome loads voices lazily).
  const voiceRef      = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => { slotsRef.current = slots; }, [slots]);

  // ── Voice picker ──────────────────────────────────────────────────────────
  // Browser TTS voices load asynchronously in Chrome; onvoiceschanged fires
  // once they are ready. We re-run whenever the announcement language changes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      const code   = tvSettings.announcement_language;
      const prefix = code.split("-")[0];
      voiceRef.current =
        voices.find(v => v.lang === code)              ??
        voices.find(v => v.lang.startsWith(prefix))    ??
        null;
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [tvSettings.announcement_language]);

  const today    = format(new Date(), "yyyy-MM-dd");
  const lang     = LANG[tvSettings.announcement_language] ?? LANG["en-IN"];
  const secLang: LangEntry | null = secondaryLocale ? (LANG[secondaryLocale] ?? null) : null;

  // ── Clock ──
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Slide carousel ──
  const slides = tvSettings.marketing_slides?.length ? tvSettings.marketing_slides : DEFAULT_SLIDES;
  useEffect(() => {
    const ms = (tvSettings.slide_interval_seconds || 8) * 1000;
    const t  = setInterval(() => {
      setSlideFade(false);
      setTimeout(() => { setSlideIdx((i) => (i + 1) % slides.length); setSlideFade(true); }, 350);
    }, ms);
    return () => clearInterval(t);
  }, [slides.length, tvSettings.slide_interval_seconds]);

  // ── TV Settings + AI Language Pack ──
  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any).from("tv_display_settings").select("*").eq("hospital_id", hospitalId).maybeSingle()
      .then(({ data }: any) => {
        setTVSettings((prev) => {
          const next = data ? {
            ...prev,
            announcement_language:  data.announcement_language  ?? prev.announcement_language,
            call_format:            data.call_format            ?? prev.call_format,
            marketing_slides:       data.marketing_slides?.length ? data.marketing_slides : DEFAULT_SLIDES,
            slide_interval_seconds: data.slide_interval_seconds ?? prev.slide_interval_seconds,
            show_marketing_panel:   data.show_marketing_panel   ?? prev.show_marketing_panel,
          } : prev;
          // Admin localStorage override wins over DB value
          try {
            const stored = localStorage.getItem(`tv_lang_${hospitalId}`);
            if (stored && LANG[stored]) return { ...next, announcement_language: stored };
          } catch {}
          return next;
        });
      });

    (supabase as any)
      .from("ai_language_settings")
      .select("language_code, enabled")
      .eq("hospital_id", hospitalId)
      .eq("feature_key", "token_display")
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.enabled && data.language_code && data.language_code !== "en") {
          const locale = LANG_CODE_MAP[data.language_code] ?? null;
          if (locale && locale !== "en-IN" && LANG[locale]) setSecondaryLocale(locale);
        }
      });
  }, [hospitalId]);

  // ── Hospital info ──
  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("hospitals").select("name, address, logo_url, announcement_text")
      .eq("id", hospitalId).maybeSingle()
      .then(({ data }) => setHospital(data));
  }, [hospitalId]);

  // ── Speech synthesis ──────────────────────────────────────────────────────
  // Cancels any in-flight utterance before speaking so rapid calls never overlap.
  // For non-English languages, uses lang.callFormat so the announcement matches
  // the selected script. Falls back to the admin-configured call_format for English.
  const announce = useCallback((token: string, doctor: string) => {
    if (!audioEnabled)             return;
    if (!window.speechSynthesis)   return;

    const currentLang = LANG[tvSettings.announcement_language] ?? LANG["en-IN"];
    const isEnglish   = tvSettings.announcement_language === "en-IN";
    const formatStr   = isEnglish
      ? (tvSettings.call_format || currentLang.callFormat)
      : (currentLang.callFormat || tvSettings.call_format);

    const text = formatStr
      .replace("{number}", token)
      .replace("{doctor}", doctor || "the counter");

    window.speechSynthesis.cancel(); // stop whatever is currently playing

    const u   = new SpeechSynthesisUtterance(text);
    u.lang    = tvSettings.announcement_language;
    u.rate    = 0.9;
    u.pitch   = 1.05;
    if (voiceRef.current) u.voice = voiceRef.current;
    window.speechSynthesis.speak(u);
  }, [audioEnabled, tvSettings.call_format, tvSettings.announcement_language]);

  // Keep announceRef current so the stable realtime callback uses the latest version.
  useEffect(() => { announceRef.current = announce; }, [announce]);

  // ── Language change (admin only) ─────────────────────────────────────────
  const handleLangChange = useCallback((code: string) => {
    setTVSettings(prev => ({ ...prev, announcement_language: code }));
    try { localStorage.setItem(`tv_lang_${hospitalId}`, code); } catch {}
    if (hospitalId) {
      (supabase as any)
        .from("tv_display_settings")
        .upsert(
          { hospital_id: hospitalId, announcement_language: code, updated_at: new Date().toISOString() },
          { onConflict: "hospital_id" }
        )
        .then(() => {});
    }
  }, [hospitalId]);

  // ── Queue fetch ───────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    if (!hospitalId) return;

    let tokQuery = (supabase as any)
      .from("opd_tokens")
      .select("id, token_number, token_prefix, status, doctor_id, department_id, called_at, patients(full_name), users:doctor_id(full_name), departments(name)")
      .eq("hospital_id", hospitalId)
      .eq("visit_date", today)
      .order("created_at", { ascending: true });

    if (deptFilter) tokQuery = tokQuery.eq("department_id", deptFilter);

    const { data: tokens } = await tokQuery;
    if (!tokens) return;

    // Build per-doctor slot map
    const docMap: Record<string, QueueSlot> = {};
    let colorIdx = 0;

    tokens.forEach((t: any) => {
      const dId    = t.doctor_id ?? "__no_doctor__";
      const dName  = t.users?.full_name ?? "General OPD";
      const dept   = t.departments?.name ?? "";
      const tokStr = `${t.token_prefix || "A"}${t.token_number}`;
      const patName = t.patients?.full_name ?? "";
      const masked  = patName.split(" ").map((w: string, i: number) => i === 0 ? w[0] + "." : w).join(" ");

      if (!docMap[dId]) {
        docMap[dId] = {
          doctorId:       dId,
          doctorName:     dName,
          deptName:       dept,
          currentToken:   null,
          currentPatient: null,
          calledAt:       null,
          nextTokens:     [],
          color:          DOCTOR_COLORS[colorIdx++ % DOCTOR_COLORS.length],
        };
      }

      if (t.status === "in_consultation" || t.status === "called") {
        docMap[dId].currentToken   = tokStr;
        docMap[dId].currentPatient = masked;
        docMap[dId].calledAt       = t.called_at;
      } else if (
        (t.status === "waiting" || t.status === "checked_in") &&
        docMap[dId].nextTokens.length < 3
      ) {
        docMap[dId].nextTokens.push(tokStr);
      }
    });

    const newSlots = Object.values(docMap);

    // ── Backup announcement path ──────────────────────────────────────────
    // Catches any call the realtime fast-path may have missed.
    // On the very first fetch we only populate lastCallsRef without announcing,
    // so tokens already called before the page opened stay silent.
    const currentKeys = new Set<string>();
    newSlots.forEach((slot) => {
      if (slot.currentToken) {
        const key = `${slot.doctorId}|${slot.currentToken}`;
        currentKeys.add(key);
        if (!isInitial.current && !lastCallsRef.current.has(key)) {
          // Realtime handler missed this call — announce now
          lastCallsRef.current.add(key);
          announceRef.current(slot.currentToken, slot.doctorName);
        }
      }
    });
    // Replace the tracked set with the current live calls (prunes stale entries)
    lastCallsRef.current = currentKeys;
    isInitial.current    = false;

    setSlots(newSlots);

    // Department status sidebar
    const { data: depts } = await supabase.from("departments")
      .select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).eq("type", "clinical").order("name");

    if (depts) {
      const stats: DeptStatus[] = [];
      for (const d of depts.slice(0, 8)) {
        const { data: tok } = await (supabase as any)
          .from("opd_tokens")
          .select("token_number, token_prefix")
          .eq("hospital_id", hospitalId)
          .eq("visit_date", today)
          .eq("department_id", d.id)
          .in("status", ["in_consultation", "called"])
          .limit(1)
          .maybeSingle();
        stats.push({ name: d.name, token: tok ? `${tok.token_prefix || "A"}${tok.token_number}` : "—" });
      }
      setDeptStats(stats);
    }
  }, [hospitalId, today, deptFilter]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // ── Real-time subscriptions ───────────────────────────────────────────────
  // Both callbacks are stable (use refs) so the subscription effect only runs
  // when hospitalId or deptFilter changes — not on every announce/slot update.
  useEffect(() => {
    if (!hospitalId) return;

    const filter = `hospital_id=eq.${hospitalId}`;

    // opd_tokens UPDATE → refresh UI (backup announcement path runs inside fetchQueue)
    const ch1 = supabase.channel("adv-tv-tokens")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "opd_tokens", filter },
        () => fetchQueue())
      .subscribe();

    // queue_state * → FAST ANNOUNCEMENT PATH + UI refresh
    // queue_state is upserted by TokenQueue the instant "Call Next" is pressed,
    // giving sub-second announcement latency without waiting for fetchQueue.
    const ch2 = supabase.channel("adv-tv-qstate")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_state", filter },
        (payload) => {
          const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as any;
          if (!row?.current_token_number) { fetchQueue(); return; }

          const key = `${row.doctor_id ?? ""}|${row.current_token_number}`;

          if (!lastCallsRef.current.has(key)) {
            // New call — announce immediately before waiting for DB round-trip
            lastCallsRef.current.add(key);
            const slot = slotsRef.current.find((s) => s.doctorId === row.doctor_id);
            announceRef.current(row.current_token_number, slot?.doctorName ?? "");
          }

          // Always refresh UI after queue_state change
          fetchQueue();
        })
      .subscribe();

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
    };
  }, [hospitalId, fetchQueue]);  // fetchQueue is stable (only changes when hospitalId/deptFilter/today changes)

  // ─── Derived display values ───────────────────────────────────────────────

  const announcement  = hospital?.announcement_text || `Welcome to ${hospital?.name ?? "our hospital"}`;
  const currentSlide  = slides[slideIdx % slides.length];
  const showMarketing = tvSettings.show_marketing_panel;

  // Most recently called token across all doctors = hero "Now Calling"
  const topSlot = slots
    .filter((s) => s.currentToken)
    .sort((a, b) => new Date(b.calledAt ?? 0).getTime() - new Date(a.calledAt ?? 0).getTime())[0] ?? null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="h-screen flex flex-col bg-[#0B1120] text-white overflow-hidden select-none"
      style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-8 py-3 gap-4"
        style={{ background: "#060D1A", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Hospital identity */}
        <div className="flex items-center gap-4 min-w-0">
          {hospital?.logo_url && (
            <img src={hospital.logo_url} alt="" className="h-9 brightness-0 invert opacity-90 flex-shrink-0" />
          )}
          <span className="text-lg font-bold text-white/80 truncate">{hospital?.name ?? "OPD Queue"}</span>
        </div>

        {/* Right cluster: lang selector + audio toggle + clock */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {/* ── Language selector (admin mode only) ── */}
          {isAdminMode && (
            <select
              value={tvSettings.announcement_language}
              onChange={e => handleLangChange(e.target.value)}
              title="Announcement language"
              className="rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none cursor-pointer"
              style={{
                background: "rgba(255,255,255,0.08)",
                border:     "1px solid rgba(255,255,255,0.15)",
                color:      "#FFFFFF",
              }}
            >
              {LANG_OPTIONS.map(l => (
                <option key={l.code} value={l.code} style={{ background: "#0B1120", color: "#FFFFFF" }}>
                  {l.label} — {l.script}
                </option>
              ))}
            </select>
          )}

          {/* ── Audio announcement toggle ── */}
          <button
            onClick={() => setAudioEnabled((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all"
            style={{
              background: audioEnabled ? "rgba(14,123,123,0.18)" : "rgba(239,68,68,0.18)",
              border:     `1px solid ${audioEnabled ? "rgba(14,123,123,0.5)" : "rgba(239,68,68,0.5)"}`,
              cursor:     "pointer",
            }}
            title={audioEnabled ? "Announcements on — click to mute" : "Announcements muted — click to enable"}
          >
            {audioEnabled
              ? <Volume2 size={15} color="#0E7B7B" />
              : <VolumeX  size={15} color="#EF4444" />}
            <span
              className="text-xs font-bold tracking-wide"
              style={{ color: audioEnabled ? "#0E7B7B" : "#EF4444" }}
            >
              {audioEnabled ? "Audio ON" : "MUTED"}
            </span>
          </button>

          {/* Clock */}
          <div className="text-right">
            <p className="font-mono font-bold text-2xl text-white">{format(now, "hh:mm:ss a")}</p>
            <p className="text-xs text-white/40">{format(now, "EEEE, d MMMM yyyy")}</p>
          </div>
        </div>
      </div>

      {/* ── Announcement ticker ──────────────────────────────────────────── */}
      <div className="flex-shrink-0 overflow-hidden" style={{ background: "#0E7B7B", height: 40 }}>
        <div className="flex items-center h-full px-6 gap-3">
          <span className="text-sm opacity-70">📢</span>
          <span className="text-sm font-medium text-white/90">{announcement}</span>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Queue Display ──────────────────────────────────────── */}
        <div className={`flex flex-col p-6 gap-5 ${showMarketing ? "w-[62%]" : "w-full"}`}>

          {/* Hero "Now Calling" card */}
          <div
            className="rounded-3xl flex flex-col items-center justify-center text-center py-10 px-8 relative overflow-hidden"
            style={{
              background: topSlot ? `${topSlot.color}18` : "#132035",
              border:     `2px solid ${topSlot?.color ?? "#1A2F5A"}`,
            }}
          >
            <div
              className="absolute inset-0 opacity-5 pointer-events-none"
              style={{ background: `radial-gradient(circle at 50% 50%, ${topSlot?.color ?? "#0E7B7B"} 0%, transparent 70%)` }}
            />

            {/* "Now Calling" label — bilingual */}
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/50 mb-1">{lang.nowCalling}</p>
            {secLang && secLang.nowCalling !== lang.nowCalling && (
              <p className="text-xs font-medium text-white/30 mb-2">{secLang.nowCalling}</p>
            )}

            {/* Token number */}
            <p
              className="font-black leading-none mt-1"
              style={{ fontSize: "clamp(80px, 14vw, 140px)", color: topSlot?.color ?? "#FFFFFF" }}
            >
              {topSlot?.currentToken ?? "—"}
            </p>

            {topSlot && (
              <>
                <p className="text-base text-white/40 mt-3">{lang.proceedTo}</p>
                {secLang && secLang.proceedTo !== lang.proceedTo && (
                  <p className="text-xs text-white/25 -mt-0.5">{secLang.proceedTo}</p>
                )}
                <p className="text-3xl font-bold mt-1.5" style={{ color: topSlot.color }}>
                  Dr. {topSlot.doctorName}
                </p>
                {topSlot.deptName && (
                  <p className="text-base text-white/50 mt-1">{topSlot.deptName}</p>
                )}
              </>
            )}

            {/* Muted indicator — visible reminder that audio is off */}
            {!audioEnabled && (
              <div
                className="absolute top-3 right-3 flex items-center gap-1 rounded-full px-2 py-1"
                style={{ background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)" }}
              >
                <VolumeX size={12} color="#EF4444" />
                <span className="text-[10px] font-bold" style={{ color: "#EF4444" }}>MUTED</span>
              </div>
            )}
          </div>

          {/* Per-doctor queue columns */}
          {slots.length > 0 && (
            <div className={`grid gap-4 flex-1 ${
              slots.length <= 2 ? "grid-cols-2" :
              slots.length <= 3 ? "grid-cols-3" : "grid-cols-4"
            }`}>
              {slots.map((slot) => (
                <div
                  key={slot.doctorId}
                  className="rounded-2xl p-5 flex flex-col gap-3"
                  style={{ background: "#0F1F30", border: `1px solid ${slot.color}30` }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: slot.color }} />
                    <span className="text-xs font-bold truncate" style={{ color: slot.color }}>
                      Dr. {slot.doctorName}
                    </span>
                  </div>
                  <div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wider leading-tight">{lang.nowCalling}</p>
                    {secLang && secLang.nowCalling !== lang.nowCalling && (
                      <p className="text-[9px] text-white/20 leading-tight">{secLang.nowCalling}</p>
                    )}
                    <p
                      className="font-black text-4xl leading-tight mt-0.5"
                      style={{ color: slot.currentToken ? slot.color : "rgba(255,255,255,0.15)" }}
                    >
                      {slot.currentToken ?? "—"}
                    </p>
                  </div>
                  {slot.nextTokens.length > 0 && (
                    <div>
                      <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
                        {lang.next}{secLang && secLang.next !== lang.next ? ` / ${secLang.next}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {slot.nextTokens.map((t) => (
                          <span
                            key={t}
                            className="px-2 py-0.5 rounded-md text-sm font-bold"
                            style={{ background: `${slot.color}20`, color: slot.color }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Marketing / Info panel ────────────────────────────── */}
        {showMarketing && (
          <div
            className="w-[38%] flex flex-col p-6 gap-5"
            style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}
          >
            {/* Department status list */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-3">
                {lang.departments}
                {secLang && secLang.departments !== lang.departments ? ` / ${secLang.departments}` : ""}
              </p>
              <div className="space-y-2">
                {deptStats.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-xl px-4 py-2.5"
                    style={{ background: "#0F1F30" }}
                  >
                    <span className="text-sm text-white/70">{d.name}</span>
                    <span className="text-sm font-bold" style={{ color: d.token !== "—" ? "#34D399" : "rgba(255,255,255,0.25)" }}>
                      {d.token !== "—"
                        ? `${lang.token}${secLang && secLang.token !== lang.token ? ` / ${secLang.token}` : ""} ${d.token}`
                        : "Waiting"}
                    </span>
                  </div>
                ))}
                {deptStats.length === 0 && (
                  <p className="text-white/30 text-sm text-center py-6">No departments active</p>
                )}
              </div>
            </div>

            {/* Slide card */}
            <div
              className="flex-1 rounded-3xl overflow-hidden flex flex-col items-center justify-center p-8 text-center transition-opacity duration-300"
              style={{
                background: "#0F1F30",
                border:     "1px solid rgba(255,255,255,0.08)",
                opacity:    slideFade ? 1 : 0,
              }}
            >
              {currentSlide?.type === "tip" ? (
                <>
                  <span className="text-7xl block mb-5">{currentSlide.emoji}</span>
                  <p className="text-sm font-bold uppercase tracking-wider text-white/40 mb-2">{lang.healthTip}</p>
                  <p className="text-xl font-medium text-white/80 leading-relaxed">{currentSlide.text}</p>
                </>
              ) : currentSlide?.url ? (
                <img src={currentSlide.url} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
              ) : (
                <>
                  <span className="text-7xl block mb-5">{currentSlide?.emoji ?? "🏥"}</span>
                  <p className="text-xl text-white/70">{currentSlide?.text ?? ""}</p>
                </>
              )}
            </div>

            {/* Slide progress dots */}
            <div className="flex justify-center gap-1.5">
              {slides.map((_, i) => (
                <div
                  key={i}
                  className="rounded-full transition-all duration-300"
                  style={{
                    width:      i === slideIdx ? 20 : 6,
                    height:     6,
                    background: i === slideIdx ? "#0E7B7B" : "rgba(255,255,255,0.2)",
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdvancedQueueDisplayPage;
