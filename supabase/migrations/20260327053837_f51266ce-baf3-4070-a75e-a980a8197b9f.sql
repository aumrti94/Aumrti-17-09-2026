-- RLS Hardening: Fix 5 security gaps identified in audit

-- Step 1: Make ndps_register immutable (NDPS Act compliance)
DROP POLICY IF EXISTS "Users can manage own hospital ndps_register" ON ndps_register;
CREATE POLICY "ndps_insert_only" ON ndps_register
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "ndps_select_only" ON ndps_register
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

-- Step 2: Restrict api_keys to super_admin writes, staff can read
DROP POLICY IF EXISTS "Users can manage own hospital api_keys" ON api_keys;
CREATE POLICY "api_keys_admin_manage" ON api_keys
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id() AND has_role(auth.uid(), 'super_admin'))
  WITH CHECK (hospital_id = get_user_hospital_id() AND has_role(auth.uid(), 'super_admin'));
CREATE POLICY "api_keys_staff_read" ON api_keys
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

-- Step 3: Restrict system_config writes to super_admin
DROP POLICY IF EXISTS "system_config_insert" ON system_config;
DROP POLICY IF EXISTS "system_config_update" ON system_config;
CREATE POLICY "system_config_admin_insert" ON system_config
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_user_hospital_id() AND has_role(auth.uid(), 'super_admin'));
CREATE POLICY "system_config_admin_update" ON system_config
  FOR UPDATE TO authenticated
  USING (hospital_id = get_user_hospital_id() AND has_role(auth.uid(), 'super_admin'))
  WITH CHECK (hospital_id = get_user_hospital_id() AND has_role(auth.uid(), 'super_admin'));

-- Step 4: Make audit tables immutable (INSERT + SELECT only)
DROP POLICY IF EXISTS "Users can manage own hospital alerts" ON clinical_alerts;
CREATE POLICY "clinical_alerts_insert" ON clinical_alerts
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "clinical_alerts_select" ON clinical_alerts
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

DROP POLICY IF EXISTS "Users can manage own hospital audit_records" ON audit_records;
CREATE POLICY "audit_records_insert" ON audit_records
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "audit_records_select" ON audit_records
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

DROP POLICY IF EXISTS "Users can manage own hospital whatsapp_notifications" ON whatsapp_notifications;
CREATE POLICY "whatsapp_notifications_insert" ON whatsapp_notifications
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = get_user_hospital_id());
CREATE POLICY "whatsapp_notifications_select" ON whatsapp_notifications
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

-- Step 5: Tighten patient_portal_sessions anon access
DROP POLICY IF EXISTS "Anon can select portal sessions by token" ON patient_portal_sessions;
DROP POLICY IF EXISTS "Anon can update portal sessions" ON patient_portal_sessions;
CREATE POLICY "anon_select_active_sessions" ON patient_portal_sessions
  FOR SELECT TO anon
  USING (last_active > now() - interval '24 hours');
CREATE POLICY "anon_update_active_sessions" ON patient_portal_sessions
  FOR UPDATE TO anon
  USING (last_active > now() - interval '24 hours')
  WITH CHECK (true);