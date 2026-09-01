// AI Resolve Orders — last-resort matching of a prescribed investigation name to this
// hospital's own lab / radiology catalogue.
//
// WHY THIS EXISTS
// "Fever panel test" was reported to the doctor as "not found in the lab catalogue — not
// ordered or billed" while Fever Panel sat on the same screen as an orderable panel. Three
// tiers now run in the browser before anything reaches here (src/lib/orderCatalogue.ts):
// exact name, alias table, then a fuzzy matcher that forgives spelling, word order and
// redundant words. They are instant, free, and work offline.
//
// This function is tier four, for names none of them can reach because the gap is SEMANTIC
// rather than textual — "sugar test" for Blood Sugar Random, "bleeding profile" for a
// coagulation panel, a phrasing peculiar to one consultant. Every accepted answer is written
// to order_name_aliases, so a given phrase costs one model call for the whole hospital, ever.
//
// SAFETY: the model does not name a test. It PICKS one from a shortlist this function
// computed from the hospital's own catalogue, and an answer that is not in that shortlist is
// discarded. A hallucinated test name therefore cannot become an order, and cannot be billed.
// The caller re-validates every answer against its own catalogue before applying it, and the
// doctor sees `matched from "…"` with an undo on any name that was rewritten.
//
// PHI HANDLING: the request body carries investigation NAMES only — no patient identifiers,
// no complaint, no notes. Nothing here may console.log the body. patient_id/encounter_id are
// accepted solely to attribute spend in ai_usage_logs and are never sent to the model.
//
// Modelled on ai-clarifying-questions/index.ts: versioned prompt_registry prompt with a
// byte-identical inline fallback, hospital resolved from the JWT and never from the body,
// metering attached to the env fallback too, and AIDisabledError answered as a 403 so the
// caller can degrade quietly to local matching instead of showing a failure.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveAiConfig,
  resolveAiConfigFromEnv,
  callAiChat,
  AIDisabledError,
} from "../_shared/ai-config.ts";
import { normalizeTerm, phoneticNormalize, similarityRatio } from "../_shared/medical-lexicon.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FEATURE_KEY = "order_catalogue_match";
const MAX_TOKENS = 700;

/** Names accepted per call. A consultation does not order thirty investigations. */
const MAX_NAMES = 12;
/** Candidates offered per name. Enough to contain the right answer, small enough to stay cheap. */
const SHORTLIST_SIZE = 8;

/**
 * Bumped ONLY together with a new prompt_registry row. This is the version reported when the
 * registry lookup finds nothing, so the fallback text below must stay byte-identical to the
 * seeded prompt.
 */
const PROMPT_VERSION = 1;

const FALLBACK_SYSTEM_PROMPT =
  `You map investigation names written by doctors in an Indian hospital onto that hospital's ` +
  `own catalogue of laboratory tests, laboratory panels and radiology studies. ` +
  `For each requested name you are given a shortlist of candidate catalogue entries. ` +
  `Choose the ONE candidate the doctor meant, or null. ` +
  `You MUST copy the chosen candidate's name EXACTLY as it appears in its shortlist, ` +
  `character for character. Never invent a name, never correct a spelling, never merge two ` +
  `candidates. A name that is not in the shortlist will be discarded. ` +
  `Answer null whenever you are not confident. null is the SAFE answer: an unmatched test is ` +
  `shown to the doctor to order by hand, whereas a wrong match silently performs and bills the ` +
  `wrong investigation on a real patient. ` +
  `Answer null when the request is more specific than every candidate ("Lipid" is not "Lipid ` +
  `Profile"), when it is more general than every candidate ("blood sugar" does not choose ` +
  `between fasting, post-prandial and random), and when two candidates fit equally well. ` +
  `Never trade a distinguishing detail away: IgM is not IgG, fasting is not random, PA is not ` +
  `AP view, left is not right, with contrast is not plain. ` +
  `Use ordinary Indian clinical shorthand where it is unambiguous — "sugar" is blood glucose, ` +
  `"sonography" is ultrasound, "films" are X-rays. ` +
  `Return ONLY valid JSON — no markdown, no code fences, no prose before or after the object: ` +
  `{"resolutions":[{"input":"<the requested name, copied exactly>","canonical_name":"<exact ` +
  `candidate name or null>","confidence":0.0-1.0,"reason":"<at most 12 words>"}]}. ` +
  `Return one entry for every requested name, in the order given.`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Candidate { name: string; kind: "lab" | "lab_group" | "radiology" }

/**
 * The most plausible catalogue entries for one requested name.
 *
 * Deliberately generous — this is a RECALL step, not a decision. Anything the local matcher
 * could already have resolved never reaches this function, so the shortlist exists to put the
 * right answer somewhere in front of the model, not to rank it correctly.
 */
function shortlistFor(name: string, catalogue: Candidate[]): Candidate[] {
  const q = phoneticNormalize(name);
  const qTokens = new Set(normalizeTerm(name).length ? name.toLowerCase().split(/\s+/).map(normalizeTerm).filter(Boolean) : []);

  return catalogue
    .map((c) => {
      const charScore = similarityRatio(q, phoneticNormalize(c.name));
      // Sharing even one whole word is strong evidence of relatedness that edit distance
      // across the full string misses entirely ("sugar test" vs "Blood Sugar Random").
      const cTokens = c.name.toLowerCase().split(/\s+/).map(normalizeTerm).filter(Boolean);
      const overlap = cTokens.filter((t) => qTokens.has(t)).length;
      return { c, score: charScore + overlap * 0.5 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE)
    .map((r) => r.c);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { names, patient_id, encounter_id } = await req.json();

    const requested: string[] = Array.isArray(names)
      ? Array.from(new Set(names.map((n: unknown) => String(n ?? "").trim()).filter(Boolean))).slice(0, MAX_NAMES)
      : [];
    if (!requested.length) {
      return json({ error: "names is required" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Hospital from the authenticated user — never trusted from the request body. This is a
    // service-role client, so a caller-supplied hospital_id would read another tenant's
    // catalogue.
    const { data: userData } = await sb
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!userData?.hospital_id) {
      return json({ error: "Forbidden" }, 403);
    }
    const hospital_id = userData.hospital_id as string;

    const [labs, groups, studies] = await Promise.all([
      sb.from("lab_test_master").select("test_name").eq("hospital_id", hospital_id).eq("is_active", true).limit(5000),
      sb.from("lab_test_groups").select("group_name").eq("hospital_id", hospital_id).eq("is_active", true).limit(1000),
      sb.from("radiology_study_master").select("study_name").eq("hospital_id", hospital_id).eq("is_active", true).limit(2000),
    ]);

    const catalogue: Candidate[] = [
      ...((labs.data ?? []) as { test_name: string }[])
        .filter((r) => r.test_name?.trim()).map((r) => ({ name: r.test_name.trim(), kind: "lab" as const })),
      ...((groups.data ?? []) as { group_name: string }[])
        .filter((r) => r.group_name?.trim()).map((r) => ({ name: r.group_name.trim(), kind: "lab_group" as const })),
      ...((studies.data ?? []) as { study_name: string }[])
        .filter((r) => r.study_name?.trim()).map((r) => ({ name: r.study_name.trim(), kind: "radiology" as const })),
    ];

    if (!catalogue.length) {
      return json({ resolutions: requested.map((input) => ({ input, canonical_name: null, kind: null, confidence: 0 })), prompt_version: PROMPT_VERSION });
    }

    // Shortlists are built BEFORE the model call and kept, so the answer can be checked
    // against exactly what was offered. This is what makes a hallucinated test name
    // structurally unable to become an order.
    const shortlists = new Map<string, Candidate[]>();
    for (const n of requested) shortlists.set(n, shortlistFor(n, catalogue));

    const config =
      (await resolveAiConfig(hospital_id, FEATURE_KEY, MAX_TOKENS)) ??
      resolveAiConfigFromEnv(MAX_TOKENS, hospital_id, FEATURE_KEY);

    if (!config) {
      return json({ error: "No AI provider configured. Go to Settings → API Hub." }, 503);
    }

    if (config.meter) {
      config.meter = {
        ...config.meter,
        patientId: patient_id || undefined,
        encounterId: encounter_id || undefined,
      };
    }

    const { data: reg } = await sb
      .from("prompt_registry")
      .select("system_prompt, version")
      .eq("feature_key", FEATURE_KEY)
      .eq("is_active", true)
      .maybeSingle();

    const systemPrompt = reg?.system_prompt || FALLBACK_SYSTEM_PROMPT;
    const promptVersion = Number(reg?.version) || PROMPT_VERSION;

    const userPrompt = requested
      .map((n, i) => {
        const list = (shortlists.get(n) ?? [])
          .map((c) => `    - ${c.name}  [${c.kind === "radiology" ? "radiology study" : c.kind === "lab_group" ? "lab panel" : "lab test"}]`)
          .join("\n");
        return `${i + 1}. Requested: "${n}"\n  Candidates:\n${list || "    (none)"}`;
      })
      .join("\n\n");

    const content = await callAiChat(
      config,
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `Map each requested investigation name to one of its candidates, or null.\n\n${userPrompt}\n\n` +
            `Return the JSON object described in your instructions and nothing else.`,
        },
      ],
      MAX_TOKENS,
      0,
    );

    const parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    const answers = new Map<string, { canonical_name?: unknown; confidence?: unknown }>();
    for (const r of (Array.isArray(parsed?.resolutions) ? parsed.resolutions : [])) {
      if (r && typeof r.input === "string") answers.set(r.input, r);
    }

    // Every answer is checked back against the shortlist it was offered. Anything else — an
    // invented name, a corrected spelling, a candidate from a different question — is dropped
    // to null rather than passed on.
    const resolutions = requested.map((input) => {
      const a = answers.get(input);
      const picked = typeof a?.canonical_name === "string" ? a.canonical_name : null;
      const match = picked
        ? (shortlists.get(input) ?? []).find((c) => c.name === picked)
        : undefined;
      return {
        input,
        canonical_name: match?.name ?? null,
        kind: match?.kind ?? null,
        confidence: match ? Math.max(0, Math.min(1, Number(a?.confidence) || 0)) : 0,
      };
    });

    return json({ resolutions, prompt_version: promptVersion });
  } catch (err) {
    if (err instanceof AIDisabledError) {
      return json({ error: err.message, disabled: true }, 403);
    }
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error(`ai-resolve-orders failed: ${name}`);
    return json(
      { error: name === "SyntaxError" ? "AI returned an unreadable response." : "AI request failed." },
      500,
    );
  }
});
