import React, { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import RetailDrugSearch, { type DrugSearchResult } from "./RetailDrugSearch";
import RetailCart, { type CartItem } from "./RetailCart";
import RetailPayment from "./RetailPayment";
import ZReportModal from "./ZReportModal";
import { createPatientRecord, type PatientGender } from "@/lib/patient-records";
import { Button } from "@/components/ui/button";
import { FileBarChart, AlertCircle } from "lucide-react";

interface Props {
  hospitalId: string;
}

interface PatientSearchResult {
  id: string;
  full_name: string;
  uhid: string;
  phone: string | null;
}

const RetailPOS: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerUhid, setCustomerUhid] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountMode, setDiscountMode] = useState<"percent" | "fixed">("percent");
  const [discountFixed, setDiscountFixed] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [showNewPatientForm, setShowNewPatientForm] = useState(false);
  const [newPatientData, setNewPatientData] = useState({ full_name: "", phone: "", age: "", gender: "male" as PatientGender });
  const [showZReport, setShowZReport] = useState(false);

  // When a patient is selected, load today's signed OPD prescription into the cart
  const loadPrescriptionForPatient = useCallback(async (patientId: string) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: rx } = await (supabase as any)
      .from("prescriptions")
      .select("drugs")
      .eq("hospital_id", hospitalId)
      .eq("patient_id", patientId)
      .eq("is_signed", true)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!rx?.drugs?.length) return;

    const loaded: CartItem[] = [];
    const notFound: string[] = [];

    for (const drug of rx.drugs as any[]) {
      const drugName: string = (drug.drug_name || "").trim();
      if (!drugName) continue;

      // Calculate total quantity: dose × frequency_per_day × duration_days
      // Use explicit quantity field only if it's already pre-calculated and > duration
      const FREQ_MAP: Record<string, number> = {
        od: 1, qd: 1, daily: 1, once: 1, hs: 1, sos: 1, prn: 1, stat: 1,
        bd: 2, bid: 2,
        tds: 3, tid: 3,
        qid: 4,
        "5x": 5, "6x": 6,
      };
      const dose = parseFloat(drug.dose || "1") || 1;
      const freqKey = (drug.frequency || "od").toLowerCase().trim();
      const freqPerDay = FREQ_MAP[freqKey] ?? 1;
      const durationDays = parseInt(drug.duration_days || "1", 10) || 1;
      const calculatedQty = Math.ceil(dose * freqPerDay * durationDays);
      // If explicit quantity is set AND larger than duration (so it was intentionally filled), use it
      const explicitQty = parseInt(drug.quantity || "", 10);
      const prescribedQty = (!isNaN(explicitQty) && explicitQty > durationDays) ? explicitQty : calculatedQty;

      // Match drug by name — exact first, then first-word fallback for dose-embedded names
      const searchDrug = async (term: string) =>
        (supabase as any)
          .from("drug_master")
          .select("id, drug_name, generic_name, is_ndps, drug_schedule")
          .eq("hospital_id", hospitalId)
          .eq("is_active", true)
          .ilike("drug_name", `%${term}%`)
          .limit(1)
          .maybeSingle()
          .then(({ data }: any) => data);

      // 1. Full name ("Paracetamol 500mg", "ORS", "Multivitamin")
      let drugMatch = await searchDrug(drugName);

      // 2. First word only — only if first word is ≥4 chars (real drug name, not a unit like "Tab")
      //    e.g. "Paracetamol 500mg" → "Paracetamol", "Amoxicillin 500mg Cap" → "Amoxicillin"
      if (!drugMatch) {
        const firstWord = drugName.split(/[\s,/]+/)[0] || "";
        if (firstWord.length >= 4 && firstWord !== drugName) {
          drugMatch = await searchDrug(firstWord);
        }
      }

      if (!drugMatch) {
        // Drug not in master — show in cart as out-of-stock placeholder
        loaded.push({
          drug_id: `oos-${drugName}`,
          drug_name: drugName,
          generic_name: null,
          batch_id: "",
          batch_number: "—",
          expiry_date: "",
          qty: 0,
          max_qty: 0,
          unit_price: 0,
          mrp: 0,
          gst_percent: 0,
          is_ndps: false,
          drug_schedule: null,
          is_expiring: false,
          item_discount: 0,
          out_of_stock: true,
        });
        continue;
      }

      // Find best available batch (non-expired, in stock, earliest expiry first)
      const { data: batch } = await (supabase as any)
        .from("drug_batches")
        .select("id, batch_number, expiry_date, quantity_available, sale_price, mrp, gst_percent")
        .eq("drug_id", drugMatch.id)
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .gt("quantity_available", 0)
        .gte("expiry_date", new Date().toISOString().slice(0, 10))
        .order("expiry_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!batch) {
        // Drug exists in master but no stock — show in cart as out-of-stock
        loaded.push({
          drug_id: drugMatch.id,
          drug_name: drugMatch.drug_name,
          generic_name: drugMatch.generic_name,
          batch_id: "",
          batch_number: "—",
          expiry_date: "",
          qty: 0,
          max_qty: 0,
          unit_price: 0,
          mrp: 0,
          gst_percent: 0,
          is_ndps: drugMatch.is_ndps,
          drug_schedule: drugMatch.drug_schedule,
          is_expiring: false,
          item_discount: 0,
          out_of_stock: true,
        });
        continue;
      }

      const isExpiring = (new Date(batch.expiry_date).getTime() - Date.now()) < 30 * 24 * 60 * 60 * 1000;
      const isSubstituted = !drugMatch.drug_name.toLowerCase().includes(drugName.split(/[\s,/]+/)[0].toLowerCase());

      loaded.push({
        drug_id: drugMatch.id,
        drug_name: drugMatch.drug_name,
        generic_name: drugMatch.generic_name,
        batch_id: batch.id,
        batch_number: batch.batch_number,
        expiry_date: batch.expiry_date,
        qty: Math.min(prescribedQty, batch.quantity_available),
        max_qty: batch.quantity_available,
        unit_price: batch.sale_price,
        mrp: batch.mrp,
        gst_percent: batch.gst_percent || 0,
        is_ndps: drugMatch.is_ndps,
        drug_schedule: drugMatch.drug_schedule,
        is_expiring: isExpiring,
        item_discount: 0,
        ...(isSubstituted ? { substituted_brand: drugName, substitution_consent: false } : {}),
      });
    }

    if (loaded.length > 0) {
      setItems(prev => {
        // Merge with existing cart — skip drugs already in cart (match by drug_id)
        const existingIds = new Set(prev.map(i => i.drug_id));
        return [...prev, ...loaded.filter(l => !existingIds.has(l.drug_id))];
      });
      const inStock = loaded.filter(l => !l.out_of_stock).length;
      const outOfStock = loaded.filter(l => l.out_of_stock).length;
      toast({
        title: `✓ ${inStock} drug${inStock !== 1 ? "s" : ""} loaded from prescription`,
        description: outOfStock > 0
          ? `${outOfStock} drug${outOfStock !== 1 ? "s" : ""} out of stock — shown in cart`
          : undefined,
      });
    }
  }, [hospitalId, toast]);

  // Search patients by name, phone, or UHID
  useEffect(() => {
    const query = customerPhone.trim() || customerName.trim();
    if (query.length < 2) {
      setSearchResults([]);
      if (!customerId) setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("patients")
          .select("id, full_name, uhid, phone")
          .eq("hospital_id", hospitalId)
          .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%,uhid.ilike.%${query}%`)
          .order("created_at", { ascending: false })
          .limit(6);

        if (!error && data) {
          setSearchResults(data as PatientSearchResult[]);
          // Auto-link if exact phone match with single result
          if (data.length === 1 && customerPhone.length >= 10 && data[0].phone === customerPhone.trim()) {
            setCustomerId(data[0].id);
            setCustomerName(data[0].full_name);
            setCustomerUhid(data[0].uhid);
            loadPrescriptionForPatient(data[0].id);
          }
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [customerPhone, customerName, hospitalId, customerId, loadPrescriptionForPatient]);

  const handleSelectPatient = useCallback((patient: PatientSearchResult) => {
    setCustomerId(patient.id);
    setCustomerName(patient.full_name);
    setCustomerPhone(patient.phone || "");
    setCustomerUhid(patient.uhid);
    setSearchResults([]);
    setShowNewPatientForm(false);
    loadPrescriptionForPatient(patient.id);
  }, [loadPrescriptionForPatient]);

  const handleClearPatient = useCallback(() => {
    setCustomerId(null);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerUhid("");
    setSearchResults([]);
  }, []);

  const handleCreateCustomer = useCallback(async () => {
    try {
      const { calculateDobFromAge } = await import("@/lib/patient-records");
      const patient = await createPatientRecord({
        hospitalId,
        fullName: newPatientData.full_name || "Walk-in Customer",
        phone: newPatientData.phone,
        dob: calculateDobFromAge(parseInt(newPatientData.age, 10) || undefined),
        gender: newPatientData.gender,
      });
      setCustomerId(patient.id);
      setCustomerName(patient.full_name);
      setCustomerPhone(patient.phone || "");
      setCustomerUhid(patient.uhid);
      setShowNewPatientForm(false);
      setNewPatientData({ full_name: "", phone: "", age: "", gender: "male" });
      toast({ title: `✓ Patient registered: ${patient.full_name} (${patient.uhid})` });
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    }
  }, [hospitalId, newPatientData, toast]);

  const handleAddToCart = useCallback((drug: DrugSearchResult) => {
    if (!drug.best_batch) {
      toast({ title: "No stock available", variant: "destructive" });
      return;
    }

    // Check if already in cart
    const existingIdx = items.findIndex(i => i.drug_id === drug.drug_id && i.batch_id === drug.best_batch!.id);
    if (existingIdx >= 0) {
      const updated = [...items];
      if (updated[existingIdx].qty < updated[existingIdx].max_qty) {
        updated[existingIdx].qty += 1;
        setItems(updated);
      }
      return;
    }

    // Schedule H warning
    if (drug.drug_schedule === "H" || drug.drug_schedule === "H1") {
      toast({
        title: `⚠️ ${drug.drug_schedule} Drug`,
        description: "This drug requires a prescription. Ensure customer has one.",
      });
    }

    // NDPS warning
    if (drug.is_ndps) {
      toast({
        title: "🔴 NDPS Drug",
        description: "Prescription mandatory. Record prescriber details.",
        variant: "destructive",
      });
    }

    const newItem: CartItem = {
      drug_id: drug.drug_id,
      drug_name: drug.drug_name,
      generic_name: drug.generic_name,
      batch_id: drug.best_batch.id,
      batch_number: drug.best_batch.batch_number,
      expiry_date: drug.best_batch.expiry_date,
      qty: 1,
      max_qty: drug.best_batch.quantity_available,
      unit_price: drug.best_batch.sale_price,
      mrp: drug.best_batch.mrp,
      gst_percent: drug.best_batch.gst_percent,
      is_ndps: drug.is_ndps,
      drug_schedule: drug.drug_schedule,
      is_expiring: drug.best_batch.is_expiring,
      item_discount: 0,
    };

    setItems(prev => [...prev, newItem]);
  }, [items, toast]);

  const handleUpdateQty = useCallback((idx: number, qty: number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, qty } : item));
  }, []);

  const handleRemoveItem = useCallback((idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleClearAll = useCallback(() => {
    setItems([]);
    setDiscountPercent(0);
    setDiscountFixed(0);
  }, []);

  const handleConsentSubstitution = useCallback((idx: number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, substitution_consent: true } : item));
  }, []);

  const substitutionsPendingConsent = items.filter(i => i.substituted_brand && !i.substitution_consent);

  const handleSaleComplete = useCallback(() => {
    setItems([]);
    setCustomerId(null);
    setCustomerPhone("");
    setCustomerName("");
    setCustomerUhid("");
    setDiscountPercent(0);
    setDiscountFixed(0);
    setDiscountMode("percent");
    setSearchResults([]);
    setShowNewPatientForm(false);
  }, []);

  // Calculations — exclude out-of-stock placeholders
  const billableItems = items.filter(i => !i.out_of_stock);
  const subtotal = billableItems.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const discountAmount = discountMode === "percent"
    ? subtotal * (discountPercent / 100)
    : Math.min(discountFixed, subtotal);
  const afterDiscount = subtotal - discountAmount;
  const gstAmount = billableItems.reduce((s, i) => {
    const itemTotal = i.unit_price * i.qty;
    const ratio = afterDiscount > 0 ? (itemTotal / subtotal) : 0;
    const discounted = itemTotal - (discountAmount * ratio);
    return s + discounted * (i.gst_percent / (100 + i.gst_percent));
  }, 0);
  const netTotal = afterDiscount;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-background">
        <span className="text-sm font-semibold text-foreground">Retail POS</span>
        <Button variant="outline" size="sm" onClick={() => setShowZReport(true)}>
          <FileBarChart className="h-4 w-4 mr-1.5" /> Z-Report
        </Button>
      </div>
      {substitutionsPendingConsent.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200">
          <p className="text-[11px] font-semibold text-amber-800 mb-1.5 flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" /> NMC 2023 — Generic Substitution Consent Required
          </p>
          <div className="space-y-1">
            {items.map((item, idx) => !item.substituted_brand || item.substitution_consent ? null : (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="text-amber-700">Substituting <strong>{item.substituted_brand}</strong> with <strong>{item.drug_name}</strong></span>
                <button onClick={() => handleConsentSubstitution(idx)}
                  className="ml-auto px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-semibold hover:bg-amber-700">
                  Patient Consented ✓
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-row flex-1 overflow-hidden">
      <RetailDrugSearch hospitalId={hospitalId} onAddToCart={handleAddToCart} />
      <RetailCart
        items={items}
        customerId={customerId}
        customerPhone={customerPhone}
        customerName={customerName}
        customerUhid={customerUhid}
        discountPercent={discountPercent}
        discountMode={discountMode}
        discountFixed={discountFixed}
        searching={searching}
        searchResults={searchResults}
        showNewPatientForm={showNewPatientForm}
        newPatientData={newPatientData}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={handleRemoveItem}
        onClearAll={handleClearAll}
        onSetCustomerPhone={setCustomerPhone}
        onSetCustomerName={setCustomerName}
        onSetDiscountPercent={setDiscountPercent}
        onSetDiscountMode={setDiscountMode}
        onSetDiscountFixed={setDiscountFixed}
        onSelectPatient={handleSelectPatient}
        onClearPatient={handleClearPatient}
        onToggleNewPatientForm={() => setShowNewPatientForm(v => !v)}
        onSetNewPatientData={setNewPatientData}
        onCreateCustomer={handleCreateCustomer}
        subtotal={subtotal}
        discountAmount={discountAmount}
        gstAmount={gstAmount}
        netTotal={netTotal}
      />
      <RetailPayment
        hospitalId={hospitalId}
        items={items}
        customerId={customerId}
        subtotal={subtotal}
        discountPercent={discountPercent}
        discountAmount={discountAmount}
        gstAmount={gstAmount}
        netTotal={netTotal}
        customerPhone={customerPhone}
        customerName={customerName}
        onSaleComplete={handleSaleComplete}
      />
      </div>
      <ZReportModal hospitalId={hospitalId} open={showZReport} onClose={() => setShowZReport(false)} />
    </div>
  );
};

export default RetailPOS;
