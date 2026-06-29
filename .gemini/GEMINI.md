# Aumrti HMS — Workspace Rules

## Project Context
This is Aumrti HMS — a React 18 + TypeScript + Vite + Supabase HMS for Indian hospitals.
39 modules, 210 database tables, 511 RLS policies, 15 Edge Functions.
GitHub: yeswanthvarma94/aumrti_hms-main

## Tech Stack (DO NOT DEVIATE)
- Frontend: React 18 + TypeScript + Vite (NOT Next.js)
- UI: shadcn/ui + Radix UI + Tailwind CSS
- State: TanStack Query v5 + Zustand
- Backend: Supabase (PostgreSQL 16 + Edge Functions in Deno)
- Payments: Razorpay (NOT Stripe — Indian payments only)
- WhatsApp: WATI API (sendWhatsApp() from src/lib/whatsapp-send.ts)
- AI: callAI() from src/lib/aiProvider.ts (provider-agnostic)
- Package manager: Bun (NOT npm or yarn — use bun install, bun dev, bun build)

## Critical Patterns (Must Follow)

### Multi-tenancy
- ALWAYS use useHospitalId() hook — NEVER hardcode hospital UUID
- EVERY Supabase query must include .eq('hospital_id', hospitalId)
- EVERY new table needs: hospital_id column + RLS ENABLE + isolation policy

### Supabase Queries
- ALWAYS use .maybeSingle() — NEVER .single() (crashes on missing row)
- Wrap all Supabase calls in try/catch
- Use TanStack Query (useQuery/useMutation) for all data fetching
- QueryKey format: ['entity_name', hospitalId, ...filters]

### Currency & Numbers
- formatCurrency(amount) from '@/lib/currency' — ALWAYS for money display
- Indian number grouping: toLocaleString('en-IN')
- Never display raw floats: 150000.00 must show as ₹1,50,000

### Billing Safety
- Bill numbers: ONLY via generate_bill_number() Supabase RPC
- ALWAYS link bills to encounter_id
- ALWAYS check for unbilled services on IPD discharge

### Clinical Safety
- Drug interactions: ALWAYS call checkDrugSafety() — never skip
- DPDP consent: ALWAYS capture in patient_consents table
- Audit trail: ALWAYS call logNABHEvidence() on clinical actions
- NEWS2: calculate and display on EVERY vitals save in IPD

### Design Laws (Non-negotiable)
1. Zero Scroll — 100vh max, internal scroll zones only
2. 1-2-3 Click — max 3 clicks to any action from dashboard
3. Clarity — min 14px labels, color-coded status, Indian English

## File Locations
- Components: src/components/[module]/ComponentName.tsx
- Pages: src/pages/[module]/PageName.tsx
- Hooks: src/hooks/useHookName.ts
- Lib utils: src/lib/utilityName.ts
- Supabase migrations: supabase/migrations/YYYYMMDDHHMMSS_description.sql
- Edge Functions: supabase/functions/function-name/index.ts

## Module List (Do not create duplicate routes)
M1=OPD, M2=IPD, M3=Pharmacy, M4=Lab, M5=Radiology, M6=Billing,
M7=EMR, M8=Scheduling, M9=HR, M10=Inventory, M11=OT, M12=BloodBank,
M13=CSSD, M14=Analytics, M15=Portal, M16=Emergency, M17=MRD,
M18=Nursing, M19=Insurance, M20=PRO, M21=Telemedicine, M22=Quality,
M23=Housekeeping, M24=Biomedical, M25=CRM, M26=Dietetics,
M27=Physio, M28=Dialysis, M29=Oncology, M30=Mortuary, M31=PharmacyRetail,
M32=HMIS, M33=PMJAY, M34=Packages, M35=Vaccination, M36=Dental,
M37=AYUSH, M38=IVF, M39=Accounts