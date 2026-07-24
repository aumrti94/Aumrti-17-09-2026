import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolvePostAuthRoute } from "@/lib/postAuthRoute";
import { Mail, Phone, Linkedin, Facebook, Instagram, Twitter } from "lucide-react";
import AumrtiLogo from "@/components/brand/AumrtiLogo";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";


const trustPills = [
  "NABH Ready",
  "PMJAY / CGHS",
  "ABDM / ABHA",
  "GST e-Invoice",
  "DPDP Act",
  "NDPS Compliant",
];

const kpiCards = [
  { label: "Total Patients", value: "1,247", change: "+12 today", changeColor: "text-[hsl(160,84%,39%)]" },
  { label: "Beds Occupied", value: "84 / 120", change: "70% occupancy", changeColor: "text-muted-foreground" },
  { label: "OPD Tokens", value: "38", change: "Active today", changeColor: "text-muted-foreground" },
  { label: "Revenue MTD", value: "₹18.4L", change: "+8.2% vs last month", changeColor: "text-[hsl(160,84%,39%)]" },
  { label: "Doctors on Duty", value: "14", change: "3 on leave", changeColor: "text-muted-foreground" },
  { label: "Critical Alerts", value: "2", change: "Requires attention", changeColor: "text-destructive", valueColor: "text-destructive" },
];

const floatingBadges = [
  { text: "🤖 AI Voice Scribe Active", bg: "bg-[#EEF2FF]", color: "text-[#4F46E5]" },
  { text: "📱 WhatsApp Live", bg: "bg-[#DCFCE7]", color: "text-[#15803D]" },
  { text: "⚡ Zero Revenue Leakage", bg: "bg-[#FEF3C7]", color: "text-[#92400E]" },
];

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [demoOpen, setDemoOpen] = useState(false);

  const [checking, setChecking] = useState(true);

  const { data: publicSettings } = useQuery({
    queryKey: ["public-platform-settings"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_public_platform_settings");
      if (error) throw error;
      return data as any;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        navigate(await resolvePostAuthRoute(), { replace: true });
      } else {
        setChecking(false);
      }
    });
  }, [navigate]);

  if (checking) return null;

  return (
    <div className="h-screen w-screen overflow-hidden bg-background flex flex-col">
      {/* Top Nav */}
      <nav className="h-16 shrink-0 bg-card border-b border-border flex items-center justify-between px-6 md:px-12">
        <div className="flex items-center gap-3">
          <AumrtiLogo variant="mark" className="h-11 w-11" />
          {/* Wordmark stacked over its tagline. AUMRTI uses the same Inter bold as the
              hero headline, in the brand teal, so the name carries the most weight. */}
          <div className="flex flex-col justify-center leading-none">
            <span className="text-xl font-bold tracking-tight text-secondary">AUMRTI</span>
            <span className="hidden sm:block mt-1.5 font-mono text-sm font-bold tracking-tight text-[#0F172A] whitespace-nowrap">
              AI-Native Hospital Operating System
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {publicSettings && (
            <div className="hidden lg:flex items-center gap-4 mr-2 text-sm text-muted-foreground border-r border-border pr-5">
              {publicSettings.contact_email && (
                <a href={`mailto:${publicSettings.contact_email}`} className="flex items-center gap-1.5 hover:text-foreground transition-colors" title="Email us">
                  <Mail size={14} /> <span className="hidden xl:inline">{publicSettings.contact_email}</span>
                </a>
              )}
              {publicSettings.contact_phone && (
                <a href={`tel:${publicSettings.contact_phone}`} className="flex items-center gap-1.5 hover:text-foreground transition-colors" title="Call us">
                  <Phone size={14} /> <span className="hidden xl:inline">{publicSettings.contact_phone}</span>
                </a>
              )}
              <div className="flex items-center gap-2">
                {publicSettings.social_linkedin && (
                  <a href={publicSettings.social_linkedin} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors"><Linkedin size={14} /></a>
                )}
                {publicSettings.social_facebook && (
                  <a href={publicSettings.social_facebook} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors"><Facebook size={14} /></a>
                )}
                {publicSettings.social_instagram && (
                  <a href={publicSettings.social_instagram} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors"><Instagram size={14} /></a>
                )}
                {publicSettings.social_x && (
                  <a href={publicSettings.social_x} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors"><Twitter size={14} /></a>
                )}
              </div>
            </div>
          )}

          {publicSettings?.demo_button_enabled && publicSettings?.demo_button_url && (
            <a
              href={publicSettings.demo_button_url}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:block text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors px-2"
            >
              Demo
            </a>
          )}
          <button
            onClick={() => navigate("/pricing")}
            className="hidden sm:block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-2"
          >
            Pricing
          </button>
          <button
            onClick={() => navigate("/login")}
            className="border-[1.5px] border-primary text-primary bg-transparent px-5 py-2 rounded-md text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors active:scale-[0.97]"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate("/register")}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm font-medium hover:bg-[hsl(220,54%,16%)] transition-colors active:scale-[0.97]"
          >
            Register Your Hospital
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Half */}
        <div className="flex-1 flex flex-col justify-center px-6 md:px-12 lg:px-12 py-8 lg:py-16">
          {/* Trust Badge */}

          {/* Headline */}
          <h1 className="text-4xl md:text-[48px] font-bold text-[#0F172A] leading-[1.15] tracking-tight">
            Run Your Entire Hospital{" "}
            <br className="hidden sm:block" />
            From <span className="text-secondary">One Screen</span>
          </h1>

          {/* Sub-headline */}
          <p className="mt-4 text-base text-muted-foreground leading-[1.7] max-w-lg">
            39 modules. AI Voice Scribe. WhatsApp-native.
            <br />
            ABDM ready. GST e-Invoice. NABH compliant.
            <br />
            Live in under 30 minutes.
          </p>

          {/* CTA Buttons */}
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={() => navigate("/register")}
              className="bg-primary text-primary-foreground px-7 py-3 rounded-lg text-[15px] font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors active:scale-[0.97]"
            >
              Start Free Trial →
            </button>
            <button
              onClick={() => setDemoOpen(true)}
              className="border-[1.5px] border-primary text-primary bg-transparent px-6 py-3 rounded-lg text-[15px] font-medium hover:bg-primary hover:text-primary-foreground transition-colors active:scale-[0.97]"
            >
              Watch 2-Min Demo
            </button>
          </div>

          {/* Price anchor — a prospect who cannot find a price does not shortlist
              you. Links to the full calculator rather than expanding the hero,
              which is deliberately single-viewport. */}
          <button
            onClick={() => navigate("/pricing")}
            className="mt-4 self-start text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            From <span className="font-semibold text-foreground">₹2,499/month</span> · unlimited staff logins
            <span className="text-primary ml-1.5">See pricing →</span>
          </button>

          {/* Compliance Trust Bar */}
          <div className="mt-10 flex flex-wrap gap-2">
            {trustPills.map((pill) => (
              <span
                key={pill}
                className="bg-muted text-[hsl(215,19%,35%)] text-[11px] px-2.5 py-1 rounded-full border border-border"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>

        {/* Right Half */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-5">
          <div className="bg-[hsl(214,24%,93%)] rounded-2xl w-full h-full flex items-center justify-center p-8">
            {/* Dashboard Mockup Card */}
            <div className="bg-card rounded-xl p-5 shadow-[0_4px_24px_rgba(0,0,0,0.08)] w-full max-w-[480px]">
              {/* Card Header */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-[13px] font-bold text-primary">HMS Dashboard</span>
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-destructive" />
                  <span className="w-2.5 h-2.5 rounded-full bg-accent" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[hsl(160,84%,39%)]" />
                </div>
              </div>

              {/* Mini KPI Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {kpiCards.map((kpi) => (
                  <div key={kpi.label} className="bg-[hsl(210,33%,98%)] rounded-lg p-3">
                    <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
                    <p className={`text-xl font-bold mt-0.5 ${kpi.valueColor || "text-foreground"}`}>
                      {kpi.value}
                    </p>
                    <p className={`text-[10px] mt-0.5 ${kpi.changeColor}`}>{kpi.change}</p>
                  </div>
                ))}
              </div>

              {/* Floating Badges */}
              <div className="flex flex-wrap gap-2 mt-4">
                {floatingBadges.map((badge) => (
                  <span
                    key={badge.text}
                    className={`${badge.bg} ${badge.color} text-[10px] px-2.5 py-1 rounded-full`}
                  >
                    {badge.text}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Modal */}
      <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Product Demo</DialogTitle>
          </DialogHeader>
          <div className="aspect-video bg-muted rounded-lg flex flex-col items-center justify-center gap-4 p-6">
            <div className="bg-card rounded-xl border border-border p-4 shadow-sm w-full max-w-sm">
              <div className="flex items-center gap-2 mb-3">
                <AumrtiLogo variant="mark" className="h-5 w-5" />
                <span className="text-xs font-bold text-primary">Aumrti HMS Dashboard</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[{ l: "OPD", v: "38" }, { l: "IPD", v: "84" }, { l: "Revenue", v: "₹18L" }].map(k => (
                  <div key={k.l} className="bg-muted rounded-lg p-2">
                    <p className="text-[10px] text-muted-foreground">{k.l}</p>
                    <p className="text-sm font-bold text-foreground">{k.v}</p>
                  </div>
                ))}
              </div>
            </div>
            <a
              href="mailto:demo@aumrti.com?subject=Request%20for%20Aumrti%20HMS%20Demo"
              className="bg-primary text-primary-foreground px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors active:scale-[0.97]"
            >
              Request a Live Demo →
            </a>
          </div>
        </DialogContent>
      </Dialog>

      {/* Login Modal */}

    </div>
  );
};

export default LandingPage;
