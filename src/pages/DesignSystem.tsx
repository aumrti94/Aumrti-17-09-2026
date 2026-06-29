import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { ArrowLeft, Bell, Check, AlertTriangle, Info, X } from "lucide-react";

const colors = [
  { name: "Primary (Deep Navy)", var: "--primary", hex: "#1A2F5A", class: "bg-primary" },
  { name: "Secondary (Medical Teal)", var: "--secondary", hex: "#0E7B7B", class: "bg-secondary" },
  { name: "Accent (Warm Amber)", var: "--accent", hex: "#F59E0B", class: "bg-accent" },
  { name: "Success (Emerald)", var: "--success", hex: "#10B981", class: "bg-hms-success" },
  { name: "Danger (Red)", var: "--destructive", hex: "#EF4444", class: "bg-destructive" },
  { name: "Background (Soft Blue-Grey)", var: "--background", hex: "#F0F4F8", class: "bg-background border" },
  { name: "Surface (White)", var: "--card", hex: "#FFFFFF", class: "bg-card border" },
  { name: "Text (Near-black)", var: "--foreground", hex: "#1E293B", class: "bg-foreground" },
  { name: "Muted Text", var: "--muted-foreground", hex: "#64748B", class: "bg-muted-foreground" },
];

const DesignSystem = () => {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon" className="active:scale-95 transition-transform">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-foreground">HMS Design System</h1>
            <p className="text-muted-foreground">Component reference for Aumrti v9.0</p>
          </div>
        </div>

        {/* Colour Palette */}
        <section>
          <h2 className="mb-6 text-foreground">Colour Palette</h2>
          <div className="grid grid-cols-3 gap-4">
            {colors.map((c) => (
              <div key={c.var} className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-lg shadow-card shrink-0 ${c.class}`} />
                <div>
                  <p className="font-medium text-sm text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{c.hex}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Typography */}
        <section>
          <h2 className="mb-6 text-foreground">Typography — Inter</h2>
          <Card className="shadow-card">
            <CardContent className="p-6 space-y-4">
              <h1>Heading 1 — 700 weight</h1>
              <h2>Heading 2 — 600 weight</h2>
              <h3>Heading 3 — 600 weight</h3>
              <h4>Heading 4 — 500 weight</h4>
              <p className="text-foreground">Body text — 400 weight, 14px base, 1.6 line-height. Designed for comfortable reading during long hospital shifts.</p>
              <p className="text-muted-foreground text-sm">Muted secondary text — used for labels, timestamps, and helper copy.</p>
              <p className="text-xs text-muted-foreground font-mono">Monospace — patient IDs, UHID codes, timestamps</p>
            </CardContent>
          </Card>
        </section>

        {/* Buttons */}
        <section>
          <h2 className="mb-6 text-foreground">Buttons</h2>
          <Card className="shadow-card">
            <CardContent className="p-6">
              <div className="flex flex-wrap gap-3 items-center">
                <Button className="active:scale-[0.97] transition-transform">Primary</Button>
                <Button variant="secondary" className="active:scale-[0.97] transition-transform">Teal / Secondary</Button>
                <Button variant="outline" className="active:scale-[0.97] transition-transform">Outline</Button>
                <Button variant="ghost" className="active:scale-[0.97] transition-transform">Ghost</Button>
                <Button variant="destructive" className="active:scale-[0.97] transition-transform">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="flex flex-wrap gap-3 items-center mt-4">
                <Button size="sm" className="active:scale-[0.97] transition-transform">Small</Button>
                <Button className="active:scale-[0.97] transition-transform">Default</Button>
                <Button size="lg" className="active:scale-[0.97] transition-transform">Large</Button>
                <Button size="icon" className="active:scale-[0.97] transition-transform"><Bell className="h-5 w-5" /></Button>
              </div>
              <div className="flex flex-wrap gap-3 items-center mt-4">
                <Button disabled>Disabled</Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Badges */}
        <section>
          <h2 className="mb-6 text-foreground">Badges</h2>
          <Card className="shadow-card">
            <CardContent className="p-6 flex flex-wrap gap-3 items-center">
              <Badge>Default</Badge>
              <Badge variant="secondary">Teal</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Critical</Badge>
              <Badge className="bg-hms-success text-white border-transparent">Success</Badge>
              <Badge className="bg-accent text-accent-foreground border-transparent">Amber Alert</Badge>
            </CardContent>
          </Card>
        </section>

        {/* Form Inputs */}
        <section>
          <h2 className="mb-6 text-foreground">Form Inputs</h2>
          <Card className="shadow-card">
            <CardContent className="p-6 grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="patient-name">Patient Name</Label>
                <Input id="patient-name" placeholder="Enter patient full name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="uhid">UHID</Label>
                <Input id="uhid" placeholder="HMS-2026-0001" className="font-mono" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="notes">Clinical Notes</Label>
                <Textarea id="notes" placeholder="Enter clinical observations..." />
              </div>
              <div className="flex items-center gap-3">
                <Checkbox id="consent" />
                <Label htmlFor="consent" className="cursor-pointer">Patient consent obtained</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="urgent" />
                <Label htmlFor="urgent" className="cursor-pointer">Mark as urgent</Label>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Cards */}
        <section>
          <h2 className="mb-6 text-foreground">Cards</h2>
          <div className="grid grid-cols-3 gap-4">
            <Card className="shadow-card hover:shadow-card-hover transition-shadow">
              <CardHeader>
                <CardTitle className="text-lg">Ward A — General</CardTitle>
                <CardDescription>12 of 20 beds occupied</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Badge className="bg-hms-success text-white border-transparent">8 Available</Badge>
                  <Badge variant="destructive">2 Critical</Badge>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-card hover:shadow-card-hover transition-shadow">
              <CardHeader>
                <CardTitle className="text-lg">OPD Tokens</CardTitle>
                <CardDescription>Today's queue status</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-secondary tabular-nums">47</p>
                <p className="text-sm text-muted-foreground">patients seen today</p>
              </CardContent>
            </Card>
            <Card className="shadow-card hover:shadow-card-hover transition-shadow">
              <CardHeader>
                <CardTitle className="text-lg">Lab Reports</CardTitle>
                <CardDescription>Pending approvals</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-accent tabular-nums">13</p>
                <p className="text-sm text-muted-foreground">awaiting review</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Alerts */}
        <section>
          <h2 className="mb-6 text-foreground">Alert States</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-card">
              <Info className="h-5 w-5 text-secondary shrink-0" />
              <p className="text-sm text-foreground">Patient registration completed successfully. UHID: HMS-2026-0384</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-hms-success/30 bg-hms-success/5 p-4">
              <Check className="h-5 w-5 text-hms-success shrink-0" />
              <p className="text-sm text-foreground">Discharge summary approved and sent to billing.</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4">
              <AlertTriangle className="h-5 w-5 text-accent shrink-0" />
              <p className="text-sm text-foreground">Drug interaction warning: Metformin + Contrast Dye. Review required.</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <X className="h-5 w-5 text-destructive shrink-0" />
              <p className="text-sm text-foreground">Critical: ICU Bed #4 ventilator alarm triggered. Immediate attention required.</p>
            </div>
          </div>
        </section>

        {/* Layout Spec */}
        <section>
          <h2 className="mb-6 text-foreground">Layout Specifications</h2>
          <Card className="shadow-card">
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Sidebar</p>
                  <p className="text-muted-foreground">240px fixed left, icon + label nav</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Header</p>
                  <p className="text-muted-foreground">56px fixed top — hospital name, user, notifications</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Content Area</p>
                  <p className="text-muted-foreground font-mono">calc(100vh - 56px), overflow: hidden</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Components</p>
                  <p className="text-muted-foreground">Cards 8px radius, Buttons 6px, Inputs 4px</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Shadow</p>
                  <p className="text-muted-foreground font-mono">0 1px 3px rgba(0,0,0,0.08)</p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Icons</p>
                  <p className="text-muted-foreground">20px nav, 16px inline, 18px badges</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <p className="text-center text-xs text-muted-foreground pb-8">Aumrti v9.0 — Design System Reference</p>
      </div>
    </div>
  );
};

export default DesignSystem;
