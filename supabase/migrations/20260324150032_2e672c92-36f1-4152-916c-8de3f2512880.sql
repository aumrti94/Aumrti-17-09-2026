
INSERT INTO public.staff_profiles (hospital_id, user_id, designation, registration_number, department_id, is_active)
SELECT u.hospital_id, u.id, u.role::text, u.registration_number, u.department_id, u.is_active
FROM users u
LEFT JOIN staff_profiles sp ON sp.user_id = u.id
WHERE sp.id IS NULL AND u.is_active = true;
