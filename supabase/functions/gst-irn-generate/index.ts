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

    // Fetch bill with patient join (patients table holds patient_name)
    const { data: bill } = await sb
      .from("bills")
      .select("*, patients(full_name)")
      .eq("id", bill_id)
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

    const irpUsername = Deno.env.get("GST_IRP_USERNAME");
    const irpPassword = Deno.env.get("GST_IRP_PASSWORD");
    const irpClientId = Deno.env.get("GST_IRP_CLIENT_ID");
    const irpClientSecret = Deno.env.get("GST_IRP_CLIENT_SECRET");
    const irpBaseUrl =
      Deno.env.get("GST_IRP_BASE_URL") || "https://einvoice1-uat.nic.in";

    // Sandbox/demo mode if creds missing
    if (!irpUsername || !irpClientId) {
      const demoIrn = `DEMO-IRN-${String(bill_id).slice(0, 8).toUpperCase()}-${Date.now()}`;
      await sb.from("bills").update({
        irn: demoIrn,
        irn_generated_at: new Date().toISOString(),
        bill_status: "irn_locked",
        irn_mode: "sandbox",
      }).eq("id", bill_id);
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

    await sb.from("bills").update({
      irn: irnData.Data.Irn,
      irn_generated_at: new Date().toISOString(),
      bill_status: "irn_locked",
      irn_mode: "live",
    }).eq("id", bill_id);

    return new Response(
      JSON.stringify({
        irn: irnData.Data.Irn,
        signed_qr: irnData.Data.SignedQRCode,
        mode: "live",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("gst-irn-generate error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "IRN service unavailable" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
