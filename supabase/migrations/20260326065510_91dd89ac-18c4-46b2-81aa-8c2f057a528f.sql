CREATE INDEX IF NOT EXISTS idx_bills_hospital_date ON bills(hospital_id, bill_date);
CREATE INDEX IF NOT EXISTS idx_opd_hospital_date ON opd_encounters(hospital_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admissions_hospital_admitted ON admissions(hospital_id, admitted_at);
CREATE INDEX IF NOT EXISTS idx_ed_visits_hospital_arrival ON ed_visits(hospital_id, arrival_time);
CREATE INDEX IF NOT EXISTS idx_bill_payments_hospital_date ON bill_payments(hospital_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_hospital_status ON lab_order_items(hospital_id, status);