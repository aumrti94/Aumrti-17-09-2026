import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require authenticated Supabase session — billing staff only
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: { user }, error: authError } = await anonClient.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { bill_id, hospital_id } = await req.json();
    if (!bill_id || !hospital_id) {
      return new Response(
        JSON.stringify({ error: "bill_id and hospital_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // The Authorization header was verified as SOME real user above, but
    // nothing checked that user's own hospital against the request's
    // hospital_id — any billing staff member of any hospital could name
    // another hospital's bill_id/hospital_id, fetch its bill (the lookup
    // below was also unscoped by hospital_id), and generate a live
    // government e-Invoice/IRN under that hospital's GSTIN, locking their
    // bill in the process. Found in the Phase 4 isolation audit — see
    // KNOWN_BUGS.md.
    const { data: staff } = await sb
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!staff || staff.hospital_id !== hospital_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch bill with patient join (patients table holds patient_name)
    const { data: bill } = await sb
      .from("bills")
      .select("*, patients(full_name)")
      .eq("id", bill_id)
      .eq("hospital_id", hospital_id)
      .maybeSingle();
    const { data: hospital } = await sb
      .from("hospitals")
      .select("gstin, name, address, state_code, city, pincode")
      .eq("id", hospital_id)
      .maybeSingle();

    if (!bill || !hospital) {
      return new Response(
        JSON.stringify({ error: "Bill or hospital not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const patientName = (bill as any).patients?.full_name || "Patient";

    // ── Exempt-supply gate ──────────────────────────────────────────────────
    // Most hospital services are GST-exempt (Notif. 12/2017). e-Invoicing is only
    // required for taxable supplies — never generate an IRN for a nil/exempt bill.
    const gstAmount = Number(bill.gst_amount || 0);
    if (gstAmount <= 0) {
      return new Response(
        JSON.stringify({
          skipped: true,
          reason: "exempt_supply",
          message: "Bill has no GST (exempt / nil-rated healthcare supply). e-Invoice/IRN is not required.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Seller state / PIN + intra-state CGST/SGST split ────────────────────
    // Derive the 2-digit state code from the hospital's stored state_code (else
    // the GSTIN prefix). Patient state of supply is not captured, so supplies
    // default to INTRA-state (CGST + SGST) — the safe, near-universal case for a
    // hospital's local patients. This replaces the previous bug that booked the
    // entire tax as IGST and would fail NIC validation for an intra-state supply.
    const gstinPrefix = String(hospital.gstin || "").slice(0, 2);
    const sellerStcd = /^\d{2}$/.test(String(hospital.state_code || ""))
      ? String(hospital.state_code)
      : (/^\d{2}$/.test(gstinPrefix) ? gstinPrefix : "36");
    const sellerPin = /^\d{6}$/.test(String(hospital.pincode || "")) ? Number(hospital.pincode) : 500001;
    const taxable = Number(bill.subtotal ?? bill.taxable_amount ?? (Number(bill.total_amount || 0) - gstAmount));
    const cgstVal = Math.round((gstAmount / 2) * 100) / 100;
    const sgstVal = Math.round((gstAmount - cgstVal) * 100) / 100;
    const gstRate = taxable > 0 ? Math.round((gstAmount / taxable) * 100) : 0;

    // Settings → GST / NIC IRP (SettingsGSTPage.tsx) writes per-hospital credentials to
    // api_configurations (service_key='nic_irp') — each hospital has its own GSTIN and its own
    // NIC IRP registration, so a single global secret can only ever serve one hospital "live"
    // at a time. That screen previously captured these six fields into React state and never
    // referenced them in its save handler at all — a hospital filling them in saw "GST config
    // saved" while nothing reached this function (KNOWN-BUG-144). The Deno env vars remain a
    // fallback for a genuinely single-tenant/ops-managed deployment, not the primary path.
    const { data: irpConfig } = await sb
      .from("api_configurations")
      .select("config")
      .eq("hospital_id", hospital_id)
      .eq("service_key", "nic_irp")
      .eq("is_active", true)
      .maybeSingle();
    const irpCfg = (irpConfig?.config ?? {}) as Record<string, string>;

    const irpUsername = irpCfg.irp_user || Deno.env.get("GST_IRP_USERNAME");
    const irpPassword = irpCfg.irp_password || Deno.env.get("GST_IRP_PASSWORD");
    const irpClientId = irpCfg.irp_client_id || Deno.env.get("GST_IRP_CLIENT_ID");
    const irpClientSecret = irpCfg.irp_client_secret || Deno.env.get("GST_IRP_CLIENT_SECRET");
    const irpBaseUrl =
      irpCfg.irp_base_url || Deno.env.get("GST_IRP_BASE_URL") || "https://einvoice1-uat.nic.in";

    // Sandbox/demo mode if creds missing
    if (!irpUsername || !irpClientId) {
      const demoIrn = `DEMO-IRN-${String(bill_id).slice(0, 8).toUpperCase()}-${Date.now()}`;
      const { error: lockErr } = await sb.from("bills").update({
        irn: demoIrn,
        irn_generated_at: new Date().toISOString(),
        bill_status: "irn_locked",
        irn_mode: "sandbox",
      }).eq("id", bill_id);
      // Was unchecked — bill_status had no 'irn_locked' value in its CHECK constraint until
      // this same pass, so this update has always failed silently, forever, on both the
      // sandbox and live paths (see the fix below): the API told the caller an IRN was
      // generated while the bill's own irn/bill_status columns were never actually written.
      if (lockErr) {
        console.error("gst-irn-generate: failed to lock bill after demo IRN:", lockErr.message);
        return new Response(
          JSON.stringify({ error: "IRN generated but could not be recorded on the bill — contact support before retrying" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          irn: demoIrn,
          mode: "sandbox",
          message:
            "Demo IRN generated. Configure GST IRP credentials in Settings → GST for live IRN.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Live NIC IRP — Step 1: Authenticate
    const authRes = await fetch(`${irpBaseUrl}/eivital/v1.04/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "client_id": irpClientId,
        "client_secret": irpClientSecret || "",
        "gstin": hospital.gstin || "",
      },
      body: JSON.stringify({
        UserName: irpUsername,
        Password: irpPassword,
        AppKey: irpClientId,
        ForceRefreshAccessToken: false,
      }),
    });
    const authData = await authRes.json();
    if (!authData.Data?.AuthToken) {
      return new Response(
        JSON.stringify({ error: "IRP authentication failed", detail: authData }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const authToken = authData.Data.AuthToken;

    // Step 2: Generate IRN
    const billDate = new Date(bill.bill_date || bill.created_at);
    const docDate = `${String(billDate.getDate()).padStart(2, "0")}/${
      String(billDate.getMonth() + 1).padStart(2, "0")
    }/${billDate.getFullYear()}`;

    const invoicePayload = {
      Version: "1.1",
      TranDtls: { TaxSch: "GST", SupTyp: "B2C", RegRev: "N", IgstOnIntra: "N" },
      DocDtls: { Typ: "INV", No: bill.bill_number, Dt: docDate },
      SellerDtls: {
        Gstin: hospital.gstin,
        LglNm: hospital.name,
        Addr1: hospital.address || "",
        Loc: hospital.city || "India",
        Pin: sellerPin,
        Stcd: sellerStcd,
      },
      BuyerDtls: {
        Gstin: "URP",
        LglNm: patientName,
        Pos: sellerStcd,
        Addr1: "NA",
        Loc: hospital.city || "India",
        Pin: sellerPin,
        Stcd: sellerStcd,
      },
      ValDtls: {
        AssVal: taxable,
        CgstVal: cgstVal,
        SgstVal: sgstVal,
        IgstVal: 0,
        TotInvVal: bill.total_amount || 0,
      },
      ItemList: [{
        SlNo: "1",
        PrdDesc: "Healthcare Services",
        IsServc: "Y",
        HsnCd: "9993",
        Qty: 1,
        Unit: "OTH",
        UnitPrice: taxable,
        TotAmt: taxable,
        AssAmt: taxable,
        GstRt: gstRate,
        CgstAmt: cgstVal,
        SgstAmt: sgstVal,
        IgstAmt: 0,
        TotItemVal: bill.total_amount || 0,
      }],
    };

    const irnRes = await fetch(`${irpBaseUrl}/eivital/v1.04/Invoice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "user_name": irpUsername,
        "authtoken": authToken,
        "gstin": hospital.gstin || "",
      },
      body: JSON.stringify(invoicePayload),
    });
    const irnData = await irnRes.json();

    if (!irnData.Data?.Irn) {
      return new Response(
        JSON.stringify({ error: "IRN generation failed", detail: irnData }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: lockErr } = await sb.from("bills").update({
      irn: irnData.Data.Irn,
      irn_generated_at: new Date().toISOString(),
      bill_status: "irn_locked",
      irn_mode: "live",
    }).eq("id", bill_id);
    if (lockErr) {
      // The government IRN has already been minted at this point and cannot be un-minted —
      // this is now a real, government-registered e-Invoice that this system failed to record.
      // Never re-attempt IRN generation for this bill_id without investigating first.
      console.error("gst-irn-generate: LIVE IRN minted but failed to record on bill:", lockErr.message, "irn:", irnData.Data.Irn);
      return new Response(
        JSON.stringify({
          error: "IRN was generated with the government IRP but could not be recorded on the bill — contact support immediately, do not retry",
          irn: irnData.Data.Irn,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        irn: irnData.Data.Irn,
        signed_qr: irnData.Data.SignedQRCode,
        mode: "live",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("gst-irn-generate error:", err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ error: "IRN service unavailable" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
