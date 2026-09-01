/**
 * Phase 2 — the settings surface, as one machine-readable catalogue.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Phase 2 tests "every settings screen", and "every" has to be defined somewhere a test can
 * read. Three sources in the app already describe the surface and they must agree:
 *
 *   src/App.tsx              50 distinct  path="/settings/*"  routes
 *   src/lib/settingsCatalog  50 distinct  route: "/settings/*" entries (52 cards — two
 *                            routes carry a second alias card: /settings/tv-display is also
 *                            "Self-Service Kiosk", /settings/whatsapp is also "WhatsApp / WATI")
 *   e2e/fixtures/mock-data   50 keys under phase2.entry
 *
 * They agree exactly today, and TC-P2A-002 fails the moment they stop agreeing — that is the
 * whole point. A settings page added without a catalogue entry is unreachable by browsing OR
 * search, which is the bug settingsCatalog.ts was created to prevent in the first place.
 *
 * NOT IN SCOPE: /settings/modules and /settings/product-mode. SETTINGS_PREREQ_MATRIX.md
 * describes them as "removed from the working tree, uncommitted". Verified while authoring
 * this phase: SettingsModulesPage.tsx and SettingsProductModePage.tsx exist in no commit and
 * on no disk path, and neither route is in App.tsx. The catalogue is genuinely 50, not 52.
 */

/** Which CSV section owns this screen's cases. Must match PHASE_MAP.md. */
export type Section = '2B' | '2C' | '2D' | '2E' | '2F' | '2G' | '2H' | '2I';

export interface SettingsScreen {
  /** Route as typed into the address bar. Steps in the CSV name this verbatim. */
  route: string;
  /** Card title in settingsCatalog.ts — also the accessible name the hub test looks for. */
  title: string;
  /** Display group in the hub's browse grid. */
  group: string;
  /**
   * Tier 0 screens are the ones SETTINGS_PREREQ_MATRIX.md says nothing works without.
   * They are configured — and tested — before any Tier 1 screen.
   */
  tier: 0 | 1;
  section: Section;
  /**
   * The table a successful save must land in. `null` means the screen genuinely writes
   * nothing (a viewer or a launcher), NOT that we failed to find its table — those are
   * marked `readOnly` and their cases assert the read path instead.
   *
   * A screen with a table but no row after a green toast is the single most important
   * failure this phase looks for. See docs/qa/README.md step 5.
   */
  table: string | null;
  /** True when the screen has no save at all, so "persisted after reload" does not apply. */
  readOnly?: boolean;
  /** Extra tables the screen touches, verified by the cross-module cases. */
  alsoWrites?: string[];
  /**
   * Set when the screen's save was found to be a no-op during authoring. Every one of these
   * was fixed (see docs/qa/results/PHASE_02_FAILURE_REPORT.md); the note stays so the
   * regression lock explains itself to whoever reads the spec next.
   */
  wasWriteNothing?: string;
}

export const SETTINGS_SCREENS: SettingsScreen[] = [
  /* ── 2B Identity ────────────────────────────────────────────────────────── */
  { route: '/settings/profile',     title: 'Hospital Profile',       group: 'Identity', tier: 0, section: '2B', table: 'hospitals' },
  { route: '/settings/branding',    title: 'Branding',               group: 'Identity', tier: 0, section: '2B', table: 'hospitals' },
  { route: '/settings/white-label', title: 'White-Label Branding',   group: 'Identity', tier: 1, section: '2B', table: 'hospitals' },
  { route: '/settings/language',    title: 'Language & Region',      group: 'Identity', tier: 1, section: '2B', table: 'hospital_settings',
    wasWriteNothing: 'BUG-P2-004 — toast + fake 500ms spinner, no table at all. Now persists to hospital_settings key "language_region".' },
  { route: '/settings/support',     title: 'Support',                group: 'Identity', tier: 1, section: '2B', table: 'platform_support_tickets' },
  { route: '/settings/training',    title: 'Training Videos',        group: 'Identity', tier: 1, section: '2B', table: null, readOnly: true },

  /* ── 2C Plan & Entitlement ──────────────────────────────────────────────── */
  { route: '/settings/plan',        title: 'Plan & Billing',              group: 'Plan & Modules', tier: 0, section: '2C', table: null, readOnly: true,
    alsoWrites: ['hospital_addons'] },
  { route: '/settings/ai-features', title: 'AI Features & Attestation',   group: 'Plan & Modules', tier: 1, section: '2C', table: 'hospitals' },

  /* ── 2D Structure ───────────────────────────────────────────────────────── */
  { route: '/settings/departments',   title: 'Departments',             group: 'Structure', tier: 0, section: '2D', table: 'departments' },
  { route: '/settings/wards',         title: 'Wards & Beds',            group: 'Structure', tier: 1, section: '2D', table: 'wards', alsoWrites: ['beds'] },
  { route: '/settings/shifts',        title: 'Shifts',                  group: 'Structure', tier: 1, section: '2D', table: 'shift_master',
    wasWriteNothing: 'BUG-P2-002 — toast only, zero supabase calls. Now persists to shift_master.' },
  { route: '/settings/bank-accounts', title: 'Bank Accounts',           group: 'Structure', tier: 1, section: '2D', table: 'bank_accounts' },
  { route: '/settings/config-values', title: 'Configurable Dropdowns',  group: 'Structure', tier: 1, section: '2D', table: 'hospital_config_values' },

  /* ── 2E People & Access ─────────────────────────────────────────────────── */
  { route: '/settings/staff',            title: 'Staff Members',      group: 'People & Access', tier: 0, section: '2E', table: 'users',
    alsoWrites: ['staff_profiles', 'service_master'] },
  { route: '/settings/roles',            title: 'Roles & Permissions', group: 'People & Access', tier: 0, section: '2E', table: 'role_permissions' },
  { route: '/settings/doctor-schedules', title: 'Doctor Schedules',   group: 'People & Access', tier: 1, section: '2E', table: 'doctor_schedules',
    alsoWrites: ['doctor_slots'] },

  /* ── 2F Services, Rates & Money ─────────────────────────────────────────── */
  { route: '/settings/services',      title: 'Service Rates',     group: 'People & Access', tier: 1, section: '2F', table: 'service_master',
    alsoWrites: ['service_rates', 'health_packages'] },
  { route: '/settings/payer-masters', title: 'Payer Masters',     group: 'People & Access', tier: 1, section: '2F', table: 'payer_masters' },
  { route: '/settings/gst',           title: 'GST / NIC IRP',     group: 'Integrations',    tier: 1, section: '2F', table: 'hospitals' },
  { route: '/settings/approvals',     title: 'Approval Rules',    group: 'Workflows',       tier: 1, section: '2F', table: 'hospital_settings' },
  { route: '/settings/razorpay',      title: 'Razorpay Payments', group: 'Integrations',    tier: 1, section: '2F', table: 'api_configurations' },

  /* ── 2G Clinical Masters & Alerts ───────────────────────────────────────── */
  { route: '/settings/lab-tests',           title: 'Lab Test Master',      group: 'Clinical',  tier: 1, section: '2G', table: 'lab_test_master',
    alsoWrites: ['lab_test_groups', 'lab_test_group_items'] },
  { route: '/settings/drugs',               title: 'Drug Formulary',       group: 'Clinical',  tier: 1, section: '2G', table: 'drug_master' },
  { route: '/settings/notifications',       title: 'Notification Config',  group: 'Workflows', tier: 1, section: '2G', table: 'hospital_settings',
    wasWriteNothing: 'BUG-P2-003 — toast behind a fake 500ms setTimeout, zero supabase calls. Now persists to hospital_settings key "notification_config".' },
  { route: '/settings/radiology',           title: 'Radiology Modalities', group: 'Clinical',  tier: 1, section: '2G', table: 'radiology_modalities',
    alsoWrites: ['radiology_study_master', 'pcpndt_settings', 'hospital_pacs_config'] },
  { route: '/settings/icd-codes',           title: 'ICD-10 / ICD-11 Code Master', group: 'Clinical',  tier: 1, section: '2G', table: 'hospital_icd_settings' },
  { route: '/settings/consent-forms',       title: 'Consent Forms',        group: 'Clinical',  tier: 1, section: '2G', table: 'consent_form_templates' },
  { route: '/settings/ot-checklist',        title: 'OT Checklist',         group: 'Clinical',  tier: 1, section: '2G', table: 'ot_checklist_custom_items' },
  { route: '/settings/protocols',           title: 'Clinical Protocols',   group: 'Clinical',  tier: 1, section: '2G', table: 'clinical_protocols',
    wasWriteNothing: 'BUG-P2-005 — toast only, zero supabase calls. Now persists to clinical_protocols.' },
  { route: '/settings/clinical-thresholds', title: 'Alert Thresholds',     group: 'Clinical',  tier: 1, section: '2G', table: 'hospital_settings' },
  { route: '/settings/day-care-procedures', title: 'Day Care Procedures',  group: 'Clinical',  tier: 1, section: '2G', table: 'day_care_procedures' },
  { route: '/settings/templates',           title: 'EMR Templates',        group: 'Clinical',  tier: 1, section: '2G', table: 'emr_template_definitions' },

  /* ── 2H Workflows & Communications ──────────────────────────────────────── */
  { route: '/settings/opd-workflow',           title: 'OPD Queue Config',      group: 'Workflows',          tier: 1, section: '2H', table: 'hospital_settings' },
  { route: '/settings/discharge-workflow',     title: 'Discharge Workflow',    group: 'Workflows',          tier: 1, section: '2H', table: 'hospitals' },
  { route: '/settings/ipd-ancillary-payment',  title: 'IPD Ancillary Payment', group: 'Workflows',          tier: 1, section: '2H', table: 'hospital_settings' },
  { route: '/settings/whatsapp',               title: 'WhatsApp Bot',          group: 'Workflows',          tier: 1, section: '2H', table: 'whatsapp_templates',
    alsoWrites: ['hospitals'] },
  { route: '/settings/report-schedules',       title: 'Scheduled Reports',     group: 'Workflows',          tier: 1, section: '2H', table: 'report_schedules' },
  { route: '/settings/tv-display',             title: 'TV Queue Display',      group: 'Queue Display & Kiosk', tier: 1, section: '2H', table: 'tv_display_settings' },
  { route: '/settings/inventory',              title: 'Store Locations',       group: 'Inventory & Stores', tier: 1, section: '2H', table: 'store_locations' },

  /* ── 2I Integrations, Data & API ────────────────────────────────────────── */
  { route: '/settings/integrations',     title: 'Integrations Console', group: 'Integrations',      tier: 1, section: '2I', table: 'lab_device_connectors',
    alsoWrites: ['pacs_connectors', 'whatsapp_connectors', 'tally_ledger_mapping', 'hospital_settings'] },
  { route: '/settings/hl7',              title: 'HL7 / FHIR Integration', group: 'Integrations',    tier: 1, section: '2I', table: 'config_values' },
  { route: '/settings/abdm',             title: 'ABDM / ABHA',          group: 'Integrations',      tier: 1, section: '2I', table: 'hospital_abdm_config' },
  { route: '/settings/hmis-portal',      title: 'HMIS / IHIP Portal',   group: 'Integrations',      tier: 1, section: '2I', table: 'api_configurations' },
  /* /settings/api-keys is retired and redirects here — key issuance and webhook registration are
     one screen now, so this single entry owns both tables. */
  { route: '/settings/api-portal',       title: 'API Portal',           group: 'Integrations',      tier: 1, section: '2I', table: 'webhook_endpoints',
    alsoWrites: ['api_keys'] },
  { route: '/settings/api-hub',          title: 'Integration Keys',     group: 'Integrations',      tier: 1, section: '2I', table: 'api_configurations' },
  { route: '/settings/ai-languages',     title: 'AI Language Packs',    group: 'Integrations',      tier: 1, section: '2I', table: 'ai_language_settings' },
  { route: '/settings/backup',           title: 'Backup & Export',      group: 'Integrations',      tier: 1, section: '2I', table: null, readOnly: true },
  { route: '/settings/record-retention', title: 'Record Retention',     group: 'Audit & Compliance', tier: 1, section: '2I', table: 'record_retention_policies' },
  { route: '/settings/change-log',       title: 'Config Change Log',    group: 'Audit & Compliance', tier: 1, section: '2I', table: null, readOnly: true },
];

/**
 * The two catalogue cards that point at a route another card already owns.
 *
 * Not a bug — one route legitimately serves two jobs, and a hospital searching "kiosk" should
 * land on the TV display page. Recorded because TC-P2A-003 counts cards against routes and
 * would otherwise read 52 ≠ 50 as a defect.
 */
export const ALIAS_CARDS = [
  { title: 'Self-Service Kiosk', route: '/settings/tv-display', primary: 'TV Queue Display' },
  { title: 'WhatsApp / WATI',    route: '/settings/whatsapp',   primary: 'WhatsApp Bot' },
] as const;

/**
 * Settings-adjacent routes that appear on the hub but live outside /settings/*.
 * Phase 1 (1I) owns go-live; data migration and the IMS access log belong to Phase 11.
 * Listed so the hub parity test does not flag them as strays.
 */
export const NON_SETTINGS_HUB_ROUTES = [
  '/admin/go-live',
  '/admin/data-migration',
  '/ims/access-logs',
] as const;

export const SETTINGS_ROUTES: string[] = SETTINGS_SCREENS.map(s => s.route);

export function screenFor(route: string): SettingsScreen {
  const found = SETTINGS_SCREENS.find(s => s.route === route);
  if (!found) {
    throw new Error(
      `No SettingsScreen registered for "${route}". Add it to SETTINGS_SCREENS — a settings ` +
      `route with no entry here is a route Phase 2 does not test.`,
    );
  }
  return found;
}

export function screensInSection(section: Section): SettingsScreen[] {
  return SETTINGS_SCREENS.filter(s => s.section === section);
}

/** Tier 0 first — the order SETTINGS_PREREQ_MATRIX.md says to configure in. */
export function screensByTier(tier: 0 | 1): SettingsScreen[] {
  return SETTINGS_SCREENS.filter(s => s.tier === tier);
}

/** Screens that must land a database row. Drives the "green toast is not a save" battery. */
export function writingScreens(): SettingsScreen[] {
  return SETTINGS_SCREENS.filter(s => !s.readOnly && s.table !== null);
}
