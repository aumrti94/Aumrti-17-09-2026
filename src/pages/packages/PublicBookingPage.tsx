import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HeartPulse, CheckCircle2, Loader2, IndianRupee, CalendarDays, User } from "lucide-react";
import { toast } from "sonner";

declare global {
  interface Window { Razorpay: any }
}

type Step = "select_package" | "patient_details" | "payment" | "confirmed";

interface Package {
  id: string; package_name: string; description: string; price: number;
  duration_minutes: number; hospital_id: string;
}

interface Hospital { id: string; name: string; city: string; }

export default function PublicBookingPage() {
  const [step, setStep] = useState<Step>("select_package");
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<string>("");
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", dob: "", gender: "other", scheduled_date: "" });
  const [bookingRef, setBookingRef] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    supabase.from("hospitals").select("id, name, city").eq("is_active", true).order("name")
      .then(({ data }) => setHospitals(data || []));
  }, []);

  useEffect(() => {
    if (!selectedHospital) { setPackages([]); return; }
    setLoadingPackages(true);
    supabase.from("health_packages").select("id, package_name, description, price, duration_minutes, hospital_id")
      .eq("hospital_id", selectedHospital).eq("is_active", true).order("price")
      .then(({ data }) => { setPackages(data || []); setLoadingPackages(false); });
  }, [selectedHospital]);

  const loadRazorpay = () => new Promise<boolean>((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  const handlePay = async () => {
    if (!selectedPackage || !form.full_name || !form.phone || !form.scheduled_date) {
      toast.error("Please fill all required fields"); return;
    }
    setPaying(true);
    try {
      const loaded = await loadRazorpay();
      if (!loaded) throw new Error("Could not load payment gateway");

      const { data: orderData, error: orderErr } = await supabase.functions.invoke("create-razorpay-order", {
        body: { hospitalId: selectedPackage.hospital_id, packageId: selectedPackage.id, amount: selectedPackage.price, notes: { patient_name: form.full_name, phone: form.phone } },
      });

      if (orderErr || !orderData?.order_id) throw new Error(orderErr?.message || "Could not create payment order");

      const rzp = new window.Razorpay({
        key: orderData.key_id,
        amount: orderData.amount,
        currency: orderData.currency,
        name: hospitals.find((h) => h.id === selectedPackage.hospital_id)?.name || "Hospital",
        description: selectedPackage.package_name,
        order_id: orderData.order_id,
        prefill: { name: form.full_name, contact: form.phone, email: form.email },
        theme: { color: "#1e3a5f" },
        handler: async (response: any) => {
          await confirmBooking(response.razorpay_payment_id);
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.open();
    } catch (err: any) {
      toast.error(err.message || "Payment failed");
      setPaying(false);
    }
  };

  const confirmBooking = async (paymentId?: string) => {
    if (!selectedPackage) return;
    try {
      // Find or create patient
      let patientId: string | null = null;
      const { data: existing } = await (supabase as any).from("patients").select("id")
        .eq("hospital_id", selectedPackage.hospital_id).eq("phone", form.phone).limit(1).maybeSingle();

      if (existing) {
        patientId = existing.id;
      } else {
        const { data: newPat } = await (supabase as any).from("patients").insert({
          hospital_id: selectedPackage.hospital_id,
          full_name: form.full_name,
          phone: form.phone,
          email: form.email || null,
          dob: form.dob || null,
          gender: form.gender,
          uhid: `PKG-${Date.now().toString(36).toUpperCase()}`,
        }).select("id").maybeSingle();
        patientId = newPat?.id || null;
      }

      if (!patientId) throw new Error("Could not register patient");

      // Create booking
      const { data: booking } = await (supabase as any).from("package_bookings").insert({
        patient_id: patientId,
        package_id: selectedPackage.id,
        hospital_id: selectedPackage.hospital_id,
        scheduled_date: form.scheduled_date,
        status: "booked",
        booking_source: "public",
        payment_reference: paymentId || null,
      }).select("id").maybeSingle();

      const ref = `BK-${(booking?.id || Date.now().toString()).slice(0, 8).toUpperCase()}`;
      setBookingRef(ref);
      setStep("confirmed");
      setPaying(false);
    } catch (err: any) {
      toast.error("Booking failed: " + err.message);
      setPaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b shadow-sm px-6 py-4 flex items-center gap-3">
        <HeartPulse className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-lg font-bold text-foreground">Book a Health Package</h1>
          <p className="text-xs text-muted-foreground">Comprehensive executive health checkups</p>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl space-y-6">

          {/* Steps indicator */}
          {step !== "confirmed" && (
            <div className="flex items-center gap-2 text-xs font-medium">
              {["select_package", "patient_details", "payment"].map((s, i) => (
                <React.Fragment key={s}>
                  <span className={`px-3 py-1 rounded-full ${step === s ? "bg-primary text-white" : ["select_package","patient_details","payment"].indexOf(step) > i ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {i + 1}. {s === "select_package" ? "Choose Package" : s === "patient_details" ? "Your Details" : "Payment"}
                  </span>
                  {i < 2 && <div className="flex-1 h-px bg-border" />}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Step 1: Select Package */}
          {step === "select_package" && (
            <Card>
              <CardContent className="p-6 space-y-5">
                <div>
                  <Label>Select Hospital *</Label>
                  <Select value={selectedHospital} onValueChange={setSelectedHospital}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a hospital" /></SelectTrigger>
                    <SelectContent>
                      {hospitals.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}{h.city ? ` — ${h.city}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {selectedHospital && (
                  <div>
                    <Label className="mb-2 block">Select Package *</Label>
                    {loadingPackages ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading packages…</div>
                    ) : packages.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No packages available for this hospital</p>
                    ) : (
                      <div className="space-y-3">
                        {packages.map((pkg) => (
                          <div key={pkg.id} onClick={() => setSelectedPackage(pkg)}
                            className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${selectedPackage?.id === pkg.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="font-semibold text-foreground">{pkg.package_name}</p>
                                {pkg.description && <p className="text-sm text-muted-foreground mt-0.5">{pkg.description}</p>}
                                {pkg.duration_minutes && <p className="text-xs text-muted-foreground mt-1">Duration: {pkg.duration_minutes} min</p>}
                              </div>
                              <Badge className="text-base font-bold px-3 py-1 bg-primary/10 text-primary border-0">
                                <IndianRupee className="h-3.5 w-3.5 mr-0.5" />{pkg.price.toLocaleString("en-IN")}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <Button className="w-full" disabled={!selectedPackage} onClick={() => setStep("patient_details")}>
                  Continue →
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Patient Details */}
          {step === "patient_details" && (
            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2 p-3 bg-primary/5 rounded-lg">
                  <HeartPulse className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium">{selectedPackage?.package_name}</span>
                  <Badge className="ml-auto bg-primary/10 text-primary border-0">
                    ₹{selectedPackage?.price.toLocaleString("en-IN")}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label>Full Name *</Label>
                    <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="As per ID" className="mt-1" />
                  </div>
                  <div>
                    <Label>Phone Number *</Label>
                    <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile" className="mt-1" />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="optional" className="mt-1" />
                  </div>
                  <div>
                    <Label>Date of Birth</Label>
                    <Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label>Gender</Label>
                    <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>Preferred Date *</Label>
                    <Input type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })}
                      min={new Date().toISOString().split("T")[0]} className="mt-1" />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("select_package")}>← Back</Button>
                  <Button className="flex-1" disabled={!form.full_name || !form.phone || !form.scheduled_date}
                    onClick={() => setStep("payment")}>
                    Continue to Payment →
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 3: Payment */}
          {step === "payment" && (
            <Card>
              <CardContent className="p-6 space-y-5">
                <h3 className="font-semibold">Order Summary</h3>
                <div className="bg-muted/40 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Package</span><span className="font-medium">{selectedPackage?.package_name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Patient</span><span>{form.full_name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Date</span><span>{new Date(form.scheduled_date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1"><User className="h-3.5 w-3.5" /> Phone</span><span>{form.phone}</span></div>
                  <div className="border-t border-border mt-2 pt-2 flex justify-between font-bold text-base">
                    <span>Total</span>
                    <span className="text-primary">₹{selectedPackage?.price.toLocaleString("en-IN")}</span>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                  Secure payment via Razorpay. UPI, Cards, Net Banking all accepted.
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep("patient_details")} disabled={paying}>← Back</Button>
                  <Button className="flex-1 gap-2" onClick={handlePay} disabled={paying}>
                    {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <IndianRupee className="h-4 w-4" />}
                    {paying ? "Processing…" : `Pay ₹${selectedPackage?.price.toLocaleString("en-IN")}`}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 4: Confirmed */}
          {step === "confirmed" && (
            <Card>
              <CardContent className="p-8 text-center space-y-4">
                <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto" />
                <h2 className="text-xl font-bold text-foreground">Booking Confirmed!</h2>
                <p className="text-muted-foreground text-sm">Your health package has been booked successfully.</p>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-left space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Booking Reference</span><span className="font-bold font-mono text-emerald-700">{bookingRef}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Package</span><span>{selectedPackage?.package_name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{form.scheduled_date}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Patient</span><span>{form.full_name}</span></div>
                </div>
                <p className="text-xs text-muted-foreground">A confirmation will be sent to {form.phone}. Please arrive 15 minutes before your scheduled time.</p>
                <Button variant="outline" onClick={() => { setStep("select_package"); setSelectedPackage(null); setForm({ full_name: "", phone: "", email: "", dob: "", gender: "other", scheduled_date: "" }); }}>
                  Book Another Package
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
