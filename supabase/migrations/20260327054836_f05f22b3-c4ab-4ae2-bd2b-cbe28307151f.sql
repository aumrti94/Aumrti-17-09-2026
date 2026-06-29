-- ═══════════════════════════════════════
-- PERFORMANCE INDEXES FOR 150-BED HOSPITAL
-- ═══════════════════════════════════════

-- Patients — most frequently searched
CREATE INDEX IF NOT EXISTS idx_patients_hospital_phone ON patients(hospital_id, phone);
CREATE INDEX IF NOT EXISTS idx_patients_hospital_uhid ON patients(hospital_id, uhid);
CREATE INDEX IF NOT EXISTS idx_patients_name_search ON patients USING gin(to_tsvector('english', full_name));

-- OPD Encounters — daily queries
CREATE INDEX IF NOT EXISTS idx_opd_hospital_date ON opd_encounters(hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opd_doctor_date ON opd_encounters(doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opd_patient ON opd_encounters(patient_id, created_at DESC);

-- IPD Admissions — bed management
CREATE INDEX IF NOT EXISTS idx_admissions_hospital_status ON admissions(hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_admissions_patient ON admissions(patient_id, admitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_admissions_doctor ON admissions(admitting_doctor_id, admitted_at DESC);

-- Beds — live bed board
CREATE INDEX IF NOT EXISTS idx_beds_ward_status ON beds(ward_id, status);
CREATE INDEX IF NOT EXISTS idx_beds_hospital_status ON beds(hospital_id, status);

-- BILLING INDEXES
CREATE INDEX IF NOT EXISTS idx_bills_hospital_date ON bills(hospital_id, bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_bills_patient_status ON bills(patient_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_bills_status_date ON bills(hospital_id, payment_status, bill_date DESC);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_bill_line_items_bill ON bill_line_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_line_items_type ON bill_line_items(hospital_id, item_type);

-- LAB INDEXES
CREATE INDEX IF NOT EXISTS idx_lab_orders_hospital_date ON lab_orders(hospital_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_order ON lab_order_items(lab_order_id);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_status ON lab_order_items(hospital_id, status);

-- PHARMACY INDEXES
CREATE INDEX IF NOT EXISTS idx_drug_batches_drug_expiry ON drug_batches(drug_id, expiry_date ASC);
CREATE INDEX IF NOT EXISTS idx_drug_batches_hospital_active ON drug_batches(hospital_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pharmacy_dispensing_patient ON pharmacy_dispensing(patient_id, dispensed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_dispensing_status ON pharmacy_dispensing(hospital_id, status);

-- OT INDEXES
CREATE INDEX IF NOT EXISTS idx_ot_schedules_date_room ON ot_schedules(hospital_id, scheduled_date, ot_room_id);
CREATE INDEX IF NOT EXISTS idx_ot_schedules_status ON ot_schedules(hospital_id, status, scheduled_date);

-- HR INDEXES
CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_date ON staff_attendance(user_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_duty_roster_user_date ON duty_roster(user_id, roster_date);
CREATE INDEX IF NOT EXISTS idx_duty_roster_hospital_date ON duty_roster(hospital_id, roster_date);

-- INSURANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_insurance_claims_hospital_status ON insurance_claims(hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_insurance_claims_tpa ON insurance_claims(hospital_id, tpa_name, status);

-- ANALYTICS INDEXES (covering indexes for BI queries)
CREATE INDEX IF NOT EXISTS idx_bills_analytics ON bills(hospital_id, bill_date, bill_type, payment_status) INCLUDE (total_amount, paid_amount);
CREATE INDEX IF NOT EXISTS idx_opd_doctor_analytics ON opd_encounters(doctor_id, created_at) INCLUDE (patient_id);

-- INVENTORY INDEXES
CREATE INDEX IF NOT EXISTS idx_inventory_stock_item ON inventory_stock(item_id, quantity_available);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_expiry ON inventory_stock(hospital_id, expiry_date ASC) WHERE expiry_date IS NOT NULL;

-- QUALITY INDEXES (partial index for unacknowledged alerts)
CREATE INDEX IF NOT EXISTS idx_clinical_alerts_hospital_unack ON clinical_alerts(hospital_id, is_acknowledged, created_at DESC) WHERE is_acknowledged = false;

-- NOTIFICATION INDEXES (partial index for pending)
CREATE INDEX IF NOT EXISTS idx_whatsapp_notifications_pending ON whatsapp_notifications(hospital_id, sent_at) WHERE sent_at IS NULL;