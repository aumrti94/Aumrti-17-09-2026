import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from './database';
import { supabase } from '../supabase';

export async function syncWithSupabase(hospitalId: string): Promise<void> {
  await synchronize({
    database,
    pullChanges: async ({ lastPulledAt }) => {
      const since = lastPulledAt ? new Date(lastPulledAt).toISOString() : new Date(0).toISOString();

      const [patientsRes, appointmentsRes, vitalsRes, wardRoundsRes] = await Promise.all([
        supabase.from('patients')
          .select('*')
          .eq('hospital_id', hospitalId)
          .gte('updated_at', since),
        supabase.from('appointments')
          .select('id, patient_id, doctor_id, appointment_date, slot_time, status, reason, updated_at')
          .eq('hospital_id', hospitalId)
          .gte('updated_at', since),
        supabase.from('patient_vitals')
          .select('*')
          .eq('hospital_id', hospitalId)
          .gte('updated_at', since),
        supabase.from('ward_round_notes')
          .select('*')
          .eq('hospital_id', hospitalId)
          .gte('updated_at', since),
      ]);

      const toWatermelonPatient = (p: any) => ({
        id: p.id,
        remote_id: p.id,
        hospital_id: p.hospital_id,
        uhid: p.uhid || '',
        full_name: p.full_name || '',
        date_of_birth: p.date_of_birth || '',
        gender: p.gender || '',
        phone: p.phone || '',
        blood_group: p.blood_group || '',
        is_synced: true,
        synced_at: Date.now(),
      });

      const toWatermelonAppointment = (a: any) => ({
        id: a.id,
        remote_id: a.id,
        hospital_id: hospitalId,
        patient_id: a.patient_id,
        patient_name: '',
        uhid: '',
        doctor_id: a.doctor_id,
        appointment_date: a.appointment_date,
        slot_time: a.slot_time || '',
        status: a.status,
        reason: a.reason || '',
        is_synced: true,
        synced_at: Date.now(),
      });

      return {
        changes: {
          patients: { created: (patientsRes.data || []).map(toWatermelonPatient), updated: [], deleted: [] },
          appointments: { created: (appointmentsRes.data || []).map(toWatermelonAppointment), updated: [], deleted: [] },
          vitals: { created: [], updated: [], deleted: [] },
          ward_rounds: { created: [], updated: [], deleted: [] },
          prescriptions: { created: [], updated: [], deleted: [] },
          mar_entries: { created: [], updated: [], deleted: [] },
        },
        timestamp: Date.now(),
      };
    },
    pushChanges: async ({ changes }) => {
      const unsynced = changes.vitals?.created || [];

      if (unsynced.length > 0) {
        await supabase.from('patient_vitals').insert(
          unsynced.map((v: any) => ({
            hospital_id: hospitalId,
            patient_id: v.patient_id,
            recorded_by: v.recorded_by,
            recorded_at: new Date(v.recorded_at).toISOString(),
            temperature: v.temperature,
            pulse: v.pulse,
            bp_systolic: v.bp_systolic,
            bp_diastolic: v.bp_diastolic,
            spo2: v.spo2,
            respiratory_rate: v.respiratory_rate,
            news2_score: v.news2_score,
          }))
        );
      }

      const unsyncedRounds = changes.ward_rounds?.created || [];
      if (unsyncedRounds.length > 0) {
        await supabase.from('ward_round_notes').insert(
          unsyncedRounds.map((r: any) => ({
            hospital_id: hospitalId,
            patient_id: r.patient_id,
            doctor_id: r.doctor_id,
            rounded_at: new Date(r.rounded_at).toISOString(),
            subjective: r.subjective,
            objective: r.objective,
            assessment: r.assessment,
            plan: r.plan,
          }))
        );
      }

      const unsyncedMAR = changes.mar_entries?.updated || [];
      if (unsyncedMAR.length > 0) {
        await Promise.all(
          unsyncedMAR
            .filter((m: any) => m.remote_id && m.status === 'given')
            .map((m: any) =>
              supabase.from('mar_entries').update({
                administered_at: new Date(m.administered_at).toISOString(),
                administered_by: m.administered_by,
                status: m.status,
              }).eq('id', m.remote_id)
            )
        );
      }
    },
  });
}
