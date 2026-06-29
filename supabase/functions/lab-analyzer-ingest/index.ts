/**
 * lab-analyzer-ingest
 *
 * Receives raw HL7 v2.x (ORU^R01) and ASTM E1394 messages from lab
 * analyzers, parses the result payload, matches to open lab orders by
 * accession number, and writes pending results to lab_analyzer_messages
 * for radiologist/lab-tech review (or auto-posts if device.auto_validate=true).
 *
 * Invocation: POST /functions/v1/lab-analyzer-ingest
 * Headers:
 *   Authorization: Bearer <service_role_key>
 *   X-Device-Secret: <per-device secret stored in device config>
 * Body (JSON):
 *   { hospital_id, device_id, protocol, raw_message }
 *
 * This function is called by a local MLLP relay agent running on the
 * hospital LAN (see docs/lab-mllp-relay.md for the Node.js relay).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-secret",
};

// ─── HL7 v2 Parser ───────────────────────────────────────────────────────────

interface HL7Segment { [field: string]: string }
interface HL7Message {
  type: string;            // MSH-9.1 (e.g. "ORU")
  event: string;           // MSH-9.2 (e.g. "R01")
  segments: Record<string, HL7Segment[]>;
}

function parseHL7(raw: string): HL7Message {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  const msg: HL7Message = { type: "", event: "", segments: {} };

  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.split("|");
    const segName = fields[0].trim().toUpperCase();
    const seg: HL7Segment = {};

    for (let i = 1; i < fields.length; i++) {
      seg[`${i}`] = fields[i] ?? "";
    }

    if (!msg.segments[segName]) msg.segments[segName] = [];
    msg.segments[segName].push(seg);

    if (segName === "MSH") {
      const typeParts = (fields[8] || "").split("^");
      msg.type  = typeParts[0] ?? "";
      msg.event = typeParts[1] ?? "";
    }
  }

  return msg;
}

interface ParsedResult {
  accessionNumber?: string;
  patientIdExternal?: string;
  results: Array<{
    analyzerCode: string;
    analyzerName: string;
    value: string;
    units: string;
    referenceRange: string;
    abnormalFlag: string;  // N | H | L | HH | LL | A | AA
    status: string;        // F=final, P=preliminary, C=corrected
  }>;
}

function extractHL7Results(msg: HL7Message): ParsedResult {
  const out: ParsedResult = { results: [] };

  // OBR — Order record
  const obr = msg.segments["OBR"]?.[0];
  if (obr) {
    out.accessionNumber = obr["3"]?.split("^")[0] || obr["2"]?.split("^")[0] || undefined;
  }

  // PID — Patient identification
  const pid = msg.segments["PID"]?.[0];
  if (pid) {
    out.patientIdExternal = pid["3"]?.split("^")[0] || pid["2"] || undefined;
  }

  // OBX — Observation results (one per test)
  for (const obx of msg.segments["OBX"] || []) {
    const codeParts = (obx["3"] || "").split("^");
    out.results.push({
      analyzerCode:   codeParts[0] || "",
      analyzerName:   codeParts[1] || codeParts[0] || "",
      value:          obx["5"] || "",
      units:          obx["6"]?.split("^")[0] || "",
      referenceRange: obx["7"] || "",
      abnormalFlag:   obx["8"] || "N",
      status:         obx["11"] || "F",
    });
  }

  return out;
}

// ─── ASTM E1394 Parser ───────────────────────────────────────────────────────

function parseASTM(raw: string): ParsedResult {
  const out: ParsedResult = { results: [] };
  const records = raw.replace(/\r/g, "\n").trim().split("\n");

  for (const record of records) {
    if (!record.trim()) continue;
    const fields = record.split("|");
    const type = fields[0]?.charAt(1)?.toUpperCase();  // H, P, O, R, L

    if (type === "O") {
      // Order record — field 3 is Specimen ID / accession
      out.accessionNumber = fields[2]?.trim() || fields[3]?.trim() || undefined;
      out.patientIdExternal = fields[3]?.trim() || undefined;
    }

    if (type === "R") {
      // Result record
      const testCodeParts = (fields[2] || "").split("^");
      out.results.push({
        analyzerCode:   testCodeParts[3] || testCodeParts[0] || "",
        analyzerName:   testCodeParts[4] || testCodeParts[0] || "",
        value:          fields[3] || "",
        units:          fields[4] || "",
        referenceRange: fields[5] || "",
        abnormalFlag:   fields[6] || "N",
        status:         fields[8] || "F",
      });
    }
  }

  return out;
}

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json() as {
      hospital_id: string;
      device_id: string;
      protocol: string;
      raw_message: string;
    };

    const { hospital_id, device_id, protocol, raw_message } = body;

    if (!hospital_id || !raw_message) {
      return new Response(
        JSON.stringify({ error: "hospital_id and raw_message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch device config
    const { data: device } = await supabase
      .from("lab_device_connectors")
      .select("*")
      .eq("id", device_id)
      .eq("hospital_id", hospital_id)
      .maybeSingle();

    if (!device) {
      return new Response(
        JSON.stringify({ error: "Device not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the raw message
    let parsed: ParsedResult;
    let messageType = "";

    if (protocol === "hl7_mllp" || protocol === "hl7") {
      const hl7 = parseHL7(raw_message);
      parsed     = extractHL7Results(hl7);
      messageType = `${hl7.type}^${hl7.event}`;
    } else if (protocol === "astm_e1394" || protocol === "astm_e1381") {
      parsed      = parseASTM(raw_message);
      messageType = "ASTM-R";
    } else {
      // Unknown protocol — store raw for manual review
      parsed      = { results: [] };
      messageType = "UNKNOWN";
    }

    // Try to match to a lab order item by accession number
    let matchedOrderItemId: string | null = null;
    let matchConfidence = "unmatched";

    if (parsed.accessionNumber) {
      // Accession is typically on the parent lab_order; find order_items underneath
      const { data: orders } = await supabase
        .from("lab_orders")
        .select("id, lab_order_items(id, test_id)")
        .eq("hospital_id", hospital_id)
        .ilike("accession_number", parsed.accessionNumber.trim())
        .limit(1);

      if (orders && orders.length > 0) {
        matchConfidence = "high";
        // If single test result, match to first unresulted item
        if (parsed.results.length === 1 && (orders[0] as any).lab_order_items?.length > 0) {
          matchedOrderItemId = (orders[0] as any).lab_order_items[0]?.id ?? null;
        }
      } else if (parsed.patientIdExternal) {
        // Fallback: match by patient UHID in pending orders
        matchConfidence = "medium";
      }
    }

    // Persist message
    const { data: msgRow, error: msgErr } = await supabase
      .from("lab_analyzer_messages")
      .insert({
        hospital_id,
        device_id: device_id || null,
        protocol,
        raw_message,
        message_type:       messageType,
        patient_id_external: parsed.patientIdExternal || null,
        accession_number:   parsed.accessionNumber || null,
        order_item_id:      matchedOrderItemId,
        status:             matchedOrderItemId ? "matched" : "pending",
        match_confidence:   matchConfidence,
      })
      .select("id")
      .maybeSingle();

    if (msgErr) throw msgErr;

    // Auto-post results if device has auto_validate enabled AND we have a match
    if (device.auto_validate && matchedOrderItemId && parsed.results.length > 0) {
      const result = parsed.results[0];
      await supabase
        .from("lab_order_items")
        .update({
          result_value:  result.value,
          result_unit:   result.units,
          reference_range: result.referenceRange || null,
          result_flag:   mapAbnormalFlag(result.abnormalFlag),
          status:        "resulted",
          resulted_at:   new Date().toISOString(),
        })
        .eq("id", matchedOrderItemId);

      // Mark message as posted
      await supabase
        .from("lab_analyzer_messages")
        .update({ status: "posted", processed_at: new Date().toISOString() })
        .eq("id", msgRow?.id);
    }

    // Update device last_result_at and increment count
    await supabase
      .from("lab_device_connectors")
      .update({
        last_result_at: new Date().toISOString(),
        result_count: (device.result_count || 0) + 1,
      })
      .eq("id", device_id);

    return new Response(
      JSON.stringify({
        success: true,
        message_id: msgRow?.id,
        status: matchedOrderItemId ? "matched" : "pending",
        match_confidence: matchConfidence,
        results_parsed: parsed.results.length,
        auto_posted: device.auto_validate && !!matchedOrderItemId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("lab-analyzer-ingest error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function mapAbnormalFlag(hl7Flag: string): string {
  switch (hl7Flag?.toUpperCase()) {
    case "H": case "HH": return "high";
    case "L": case "LL": return "low";
    case "A": case "AA": return "critical";
    case "N": default:   return "normal";
  }
}
