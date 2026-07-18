import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  ChevronRight,
  Hospital,
  Palette,
  Globe,
  CreditCard,
  Building2,
  BedDouble,
  Clock,
  Users,
  Lock,
  CalendarDays,
  IndianRupee,
  TestTube,
  Pill,
  FileText,
  ClipboardCheck,
  BookOpen,
  Bell as BellIcon,
  Workflow,
  ShieldCheck,
  ListChecks,
  Settings2,
  MessageSquare,
  PlayCircle,
  CalendarClock,
  Smartphone,
  FileSpreadsheet,
  Landmark,
  HardDrive,
  KeyRound,
  Cpu,
  Tv2,
  Monitor,
  Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface SettingsCard {
  icon: React.ElementType;
  emoji?: string;
  title: string;
  desc: string;
  route: string;
}

interface SettingsGroup {
  label: string;
  emoji: string;
  cards: SettingsCard[];
}

const settingsGroups: SettingsGroup[] = [
  {
    label: "Identity",
    emoji: "🏥",
    cards: [
      { icon: Hospital, title: "Hospital Profile", desc: "Name, address, GSTIN, contact details", route: "/settings/profile" },
      { icon: Palette, title: "Branding", desc: "Logo, colours, fonts, print templates", route: "/settings/branding" },
      { icon: Globe, title: "Language & Region", desc: "Interface language, date format, currency", route: "/settings/language" },
      { icon: CreditCard, title: "Plan & Billing", desc: "Your current plan, usage, invoices", route: "/settings/plan" },
      { icon: MessageSquare, title: "Support", desc: "Raise a ticket, message Aumrti's team", route: "/settings/support" },
      { icon: PlayCircle, title: "Training Videos", desc: "Short how-to videos for every role", route: "/settings/training" },
    ],
  },
  {
    label: "Structure",
    emoji: "🏗️",
    cards: [
      { icon: Building2, title: "Departments", desc: "Manage hospital departments and specialties", route: "/settings/departments" },
      { icon: BedDouble, title: "Wards & Beds", desc: "Configure wards, bed count and categories", route: "/settings/wards" },
      { icon: Clock, title: "Shifts", desc: "Define shift timings and patterns", route: "/settings/shifts" },
      { icon: Landmark, title: "Bank Accounts", desc: "Configure bank accounts for reconciliation", route: "/settings/bank-accounts" },
      { icon: ListChecks, title: "Configurable Dropdowns", desc: "Customise every dropdown in the system — admission types, drug routes, leave types, TPA list, lab categories and more", route: "/settings/config-values" },
    ],
  },
  {
    label: "People & Access",
    emoji: "👥",
    cards: [
      { icon: Users, title: "Staff Members", desc: "Add, edit, deactivate staff accounts", route: "/settings/staff" },
      { icon: Lock, title: "Roles & Permissions", desc: "Define roles, assign module access", route: "/settings/roles" },
      { icon: CalendarDays, title: "Doctor Schedules", desc: "OPD timings, slots, leave blocks", route: "/settings/doctor-schedules" },
      { icon: IndianRupee, title: "Service Rates", desc: "OPD fees, room rates, package pricing", route: "/settings/services" },
      { icon: CreditCard, title: "Payer Masters", desc: "TPAs, corporates, PMJAY, CGHS, ESI, and scheme accounts", route: "/settings/payer-masters" },
    ],
  },
  {
    label: "Clinical",
    emoji: "🩺",
    cards: [
      { icon: TestTube, title: "Lab Test Master", desc: "Manage lab test catalog and panels", route: "/settings/lab-tests" },
      { icon: Pill, title: "Drug Formulary", desc: "Hospital drug list and formulary", route: "/settings/drugs" },
      { icon: FileText, title: "Consent Forms", desc: "Manage consent form templates", route: "/settings/consent-forms" },
      { icon: ClipboardCheck, title: "OT Checklist", desc: "WHO surgical safety checklist config", route: "/settings/ot-checklist" },
      { icon: BookOpen, title: "Clinical Protocols", desc: "Standard treatment protocols", route: "/settings/protocols" },
      { icon: BellIcon, title: "Alert Thresholds", desc: "Vitals and lab critical value alerts", route: "/settings/clinical-thresholds" },
      { icon: FileText, title: "ICD-10 Code Master", desc: "Manage diagnosis code sets for ICD coding", route: "/settings/icd-codes" },
      { icon: Settings2, title: "Radiology Modalities", desc: "Manage modality types and pricing", route: "/settings/radiology" },
      { icon: ClipboardCheck, title: "Day Care Procedures", desc: "Configure approved day care procedure catalog", route: "/settings/day-care-procedures" },
    ],
  },
  {
    label: "Queue Display & Kiosk",
    emoji: "📺",
    cards: [
      { icon: Tv2,     title: "TV Queue Display",   desc: "Multi-doctor queue, SpeechSynthesis announcements, language support, marketing banners", route: "/settings/tv-display" },
      { icon: Monitor, title: "Self-Service Kiosk", desc: "Touch-screen kiosk configuration, device URL, and registration flow settings",           route: "/settings/tv-display" },
    ],
  },
  {
    label: "Workflows",
    emoji: "⚙️",
    cards: [
      { icon: Workflow, title: "Discharge Workflow", desc: "Discharge checklist and approval flow", route: "/settings/discharge-workflow" },
      { icon: ShieldCheck, title: "Approval Rules", desc: "Discount, refund and override approvals", route: "/settings/approvals" },
      { icon: ListChecks, title: "OPD Queue Config", desc: "Token generation and queue rules", route: "/settings/opd-workflow" },
      { icon: IndianRupee, title: "IPD Ancillary Payment", desc: "Pay-before-service vs accrue-to-bill for pharmacy, lab, radiology", route: "/settings/ipd-ancillary-payment" },
      { icon: Settings2, title: "Notification Config", desc: "SMS, email and push notification rules", route: "/settings/notifications" },
      { icon: MessageSquare, title: "WhatsApp Bot", desc: "Automated WhatsApp message config", route: "/settings/whatsapp" },
      { icon: CalendarClock, title: "Scheduled Reports", desc: "Auto-generate and email reports", route: "/settings/report-schedules" },
    ],
  },
  {
    label: "Integrations",
    emoji: "🔌",
    cards: [
      { icon: Cpu, title: "Integrations Console", desc: "Lab analyzers, PACS, WhatsApp multi-provider, Tally ledger mapping", route: "/settings/integrations" },
      { icon: CreditCard, title: "Razorpay Payments", desc: "Payment gateway configuration", route: "/settings/razorpay" },
      { icon: FileSpreadsheet, title: "HMIS / IHIP Portal", desc: "MoHFW portal credentials for report submission", route: "/settings/hmis-portal" },
      { icon: Smartphone, title: "WhatsApp / WATI", desc: "WhatsApp Business API setup", route: "/settings/whatsapp" },
      { icon: FileSpreadsheet, title: "GST / NIC IRP", desc: "e-Invoice config + GSTIN mapping", route: "/settings/gst" },
      { icon: Landmark, title: "ABDM / ABHA", desc: "ABDM HIP/HIU configuration", route: "/settings/abdm" },
      { icon: HardDrive, title: "Backup & Export", desc: "Data export, audit logs", route: "/settings/backup" },
      { icon: KeyRound, title: "API Keys", desc: "Developer API access tokens", route: "/settings/api-keys" },
      { icon: Cpu, title: "Integration Keys", desc: "Payment, WhatsApp & government API keys (AI is configured centrally)", route: "/settings/api-hub" },
      { icon: Cpu, title: "AI Features & Attestation", desc: "Enable/disable AI per feature, DPA compliance, doctor attestation policy", route: "/settings/ai-features" },
      { icon: Languages, title: "AI Language Packs", desc: "Multi-language output for Voice Scribe, Token Display, Discharge Summary — 10+ Indian languages", route: "/settings/ai-languages" },
    ],
  },
  {
    label: "Inventory & Stores",
    emoji: "🏭",
    cards: [
      { icon: Building2, title: "Store Locations", desc: "Central store, ward sub-stores, OT store, ICU store", route: "/settings/inventory" },
    ],
  },
  {
    label: "Audit & Compliance",
    emoji: "🔒",
    cards: [
      { icon: ShieldCheck, title: "Record Retention", desc: "Retention policies per record type — NABH IMS compliance", route: "/settings/record-retention" },
      { icon: ClipboardCheck, title: "Record Access Log", desc: "Who accessed which records — IMS evidence for NABH assessments", route: "/ims/access-logs" },
      { icon: ListChecks, title: "Config Change Log", desc: "Audit trail of all configuration changes — controlled change management", route: "/settings/change-log" },
    ],
  },
  {
    label: "Go-Live & Migration",
    emoji: "🚀",
    cards: [
      { icon: ListChecks, title: "Go-Live Checklist", desc: "Pre-launch readiness verification for pilot hospitals", route: "/admin/go-live" },
      { icon: HardDrive, emoji: "📥", title: "Data Migration", desc: "Import patients, staff, drugs, and services from your old system", route: "/admin/data-migration" },
    ],
  },
];

const highlightMatch = (text: string, query: string) => {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200/80 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
};

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return settingsGroups;
    const q = search.trim().toLowerCase();
    return settingsGroups
      .map((group) => ({
        ...group,
        cards: group.cards.filter(
          (c) => c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.cards.length > 0);
  }, [search]);

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 h-16 flex items-center justify-between px-8 border-b border-border bg-card">
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-xs text-muted-foreground">Configure your hospital system</p>
        </div>
        <div className="relative w-[280px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings..."
            className="pl-9 h-10 bg-muted/50 border-border rounded-[10px] text-sm"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-7">
        {filteredGroups.length === 0 && (
          <div className="text-center py-20">
            <p className="text-sm text-muted-foreground">
              No settings found for "<span className="font-medium text-foreground">{search}</span>"
            </p>
          </div>
        )}

        {filteredGroups.map((group) => (
          <div key={group.label} className="mb-8">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              {group.emoji} {group.label}
            </p>
            <div className="grid grid-cols-4 gap-3.5">
              {group.cards.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.route + card.title}
                    onClick={() => navigate(card.route)}
                    className={cn(
                      "group bg-card border border-border rounded-xl p-[18px] text-left",
                      "cursor-pointer transition-all duration-150",
                      "hover:border-primary hover:shadow-md hover:-translate-y-0.5",
                      "active:scale-[0.98] flex flex-col"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="h-10 w-10 rounded-[10px] bg-muted flex items-center justify-center">
                        <Icon size={20} className="text-foreground" />
                      </div>
                      <ChevronRight
                        size={14}
                        className="text-muted-foreground/40 group-hover:text-primary transition-colors mt-1"
                      />
                    </div>
                    <h3 className="text-sm font-bold text-foreground mt-3">
                      {highlightMatch(card.title, search)}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {highlightMatch(card.desc, search)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SettingsPage;
