import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { database } from '@/lib/watermelon/database';

interface Patient {
  id: string;
  uhid: string;
  full_name: string;
  ward_name: string;
  bed_number: string;
}

const TEAL = '#0E7B7B';
const NAVY = '#1A2F5A';

function computeNEWS2(v: {
  temperature?: number; pulse?: number; bpSystolic?: number;
  spo2?: number; respiratoryRate?: number;
}): number {
  let score = 0;

  const rr = v.respiratoryRate || 0;
  if (rr <= 8) score += 3;
  else if (rr >= 25) score += 3;
  else if (rr >= 21) score += 2;
  else if (rr >= 9 && rr <= 11) score += 1;

  const spo2 = v.spo2 || 100;
  if (spo2 <= 91) score += 3;
  else if (spo2 <= 93) score += 2;
  else if (spo2 <= 95) score += 1;

  const sys = v.bpSystolic || 120;
  if (sys <= 90) score += 3;
  else if (sys <= 100) score += 2;
  else if (sys <= 110) score += 1;
  else if (sys >= 220) score += 3;

  const hr = v.pulse || 70;
  if (hr <= 40) score += 3;
  else if (hr >= 131) score += 3;
  else if (hr >= 111) score += 2;
  else if (hr >= 91) score += 1;
  else if (hr >= 41 && hr <= 50) score += 1;

  const temp = v.temperature || 37;
  if (temp <= 35.0) score += 3;
  else if (temp <= 36.0) score += 1;
  else if (temp >= 39.1) score += 2;
  else if (temp >= 38.1) score += 1;

  return score;
}

export default function VitalsEntryScreen() {
  const { profile } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [saving, setSaving] = useState(false);
  const [vitals, setVitals] = useState({
    temperature: '', pulse: '', bpSystolic: '', bpDiastolic: '',
    spo2: '', respiratoryRate: '',
  });

  const news2 = computeNEWS2({
    temperature: Number(vitals.temperature) || undefined,
    pulse: Number(vitals.pulse) || undefined,
    bpSystolic: Number(vitals.bpSystolic) || undefined,
    spo2: Number(vitals.spo2) || undefined,
    respiratoryRate: Number(vitals.respiratoryRate) || undefined,
  });

  const news2Color = news2 >= 7 ? '#ef4444' : news2 >= 5 ? '#f97316' : news2 >= 3 ? '#eab308' : '#16a34a';

  const loadPatients = useCallback(async () => {
    if (!profile?.hospital_id) return;
    const { data } = await supabase
      .from('ipd_admissions')
      .select(`
        patient:patients(id, uhid, full_name),
        bed:beds(bed_number, ward:wards(name))
      `)
      .eq('hospital_id', profile.hospital_id)
      .eq('status', 'admitted')
      .order('admission_date', { ascending: true });

    if (data) {
      setPatients(data.map((a: any) => ({
        id: a.patient?.id,
        uhid: a.patient?.uhid || '',
        full_name: a.patient?.full_name || '',
        ward_name: a.bed?.ward?.name || '',
        bed_number: a.bed?.bed_number || '',
      })));
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPatients();
    setRefreshing(false);
  };

  const saveVitals = async () => {
    if (!selectedPatient || !profile) return;
    const hasAny = Object.values(vitals).some(v => v.trim().length > 0);
    if (!hasAny) {
      Alert.alert('No Vitals', 'Enter at least one vital sign.');
      return;
    }
    setSaving(true);
    try {
      await database.write(async () => {
        const collection = database.get('vitals');
        await collection.create((record: any) => {
          record.remote_id = '';
          record.hospital_id = profile.hospital_id;
          record.patient_id = selectedPatient.id;
          record.recorded_by = profile.id;
          record.recorded_at = Date.now();
          record.temperature = vitals.temperature ? Number(vitals.temperature) : undefined;
          record.pulse = vitals.pulse ? Number(vitals.pulse) : undefined;
          record.bp_systolic = vitals.bpSystolic ? Number(vitals.bpSystolic) : undefined;
          record.bp_diastolic = vitals.bpDiastolic ? Number(vitals.bpDiastolic) : undefined;
          record.spo2 = vitals.spo2 ? Number(vitals.spo2) : undefined;
          record.respiratory_rate = vitals.respiratoryRate ? Number(vitals.respiratoryRate) : undefined;
          record.news2_score = news2;
          record.is_synced = false;
          record.synced_at = 0;
        });
      });

      if (news2 >= 7) {
        supabase.from('clinical_alerts').insert({
          hospital_id: profile.hospital_id,
          patient_id: selectedPatient.id,
          alert_type: 'high_news2',
          severity: 'critical',
          alert_message: `NEWS2 score ${news2} for ${selectedPatient.full_name} (${selectedPatient.uhid}) — Bed ${selectedPatient.bed_number}`,
        } as any).catch(() => {});
      }

      Alert.alert('Saved', `Vitals for ${selectedPatient.full_name} saved. NEWS2 = ${news2}`);
      setVitals({ temperature: '', pulse: '', bpSystolic: '', bpDiastolic: '', spo2: '', respiratoryRate: '' });
      setSelectedPatient(null);
    } catch {
      Alert.alert('Error', 'Could not save vitals.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={TEAL} /></View>;
  }

  if (selectedPatient) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <TouchableOpacity onPress={() => setSelectedPatient(null)} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.patientName}>{selectedPatient.full_name}</Text>
        <Text style={styles.patientMeta}>{selectedPatient.uhid} · {selectedPatient.ward_name} · Bed {selectedPatient.bed_number}</Text>

        {[
          { key: 'temperature', label: 'Temperature (°C)', placeholder: '37.0', keyboardType: 'decimal-pad' },
          { key: 'pulse', label: 'Pulse (bpm)', placeholder: '72', keyboardType: 'numeric' },
          { key: 'bpSystolic', label: 'BP Systolic (mmHg)', placeholder: '120', keyboardType: 'numeric' },
          { key: 'bpDiastolic', label: 'BP Diastolic (mmHg)', placeholder: '80', keyboardType: 'numeric' },
          { key: 'spo2', label: 'SpO₂ (%)', placeholder: '98', keyboardType: 'numeric' },
          { key: 'respiratoryRate', label: 'Respiratory Rate (/min)', placeholder: '16', keyboardType: 'numeric' },
        ].map(field => (
          <View key={field.key}>
            <Text style={styles.label}>{field.label}</Text>
            <TextInput
              style={styles.input}
              value={(vitals as any)[field.key]}
              onChangeText={t => setVitals(prev => ({ ...prev, [field.key]: t }))}
              placeholder={field.placeholder}
              keyboardType={field.keyboardType as any}
              placeholderTextColor="#94a3b8"
            />
          </View>
        ))}

        <View style={[styles.news2Box, { borderColor: news2Color }]}>
          <Text style={styles.news2Label}>Live NEWS2 Score</Text>
          <Text style={[styles.news2Score, { color: news2Color }]}>{news2}</Text>
          <Text style={[styles.news2Risk, { color: news2Color }]}>
            {news2 >= 7 ? '🔴 Urgent — Escalate Immediately' :
              news2 >= 5 ? '🟠 High Risk — Increase Monitoring' :
                news2 >= 3 ? '🟡 Medium Risk' : '🟢 Low Risk'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.disabled]}
          onPress={saveVitals}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Vitals (Offline)</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vitals Entry</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 12, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />}
      >
        {patients.length === 0 && <Text style={styles.emptyText}>No admitted patients found.</Text>}
        {patients.map(p => (
          <TouchableOpacity key={p.id} style={styles.patientCard} onPress={() => setSelectedPatient(p)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>{p.full_name}</Text>
              <Text style={styles.cardMeta}>{p.uhid} · {p.ward_name} · Bed {p.bed_number}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: TEAL,
    paddingTop: 60, paddingBottom: 16, paddingHorizontal: 16,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  patientCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardName: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  cardMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  chevron: { fontSize: 22, color: '#94a3b8' },
  emptyText: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 15 },
  backBtn: { marginBottom: 16 },
  backText: { color: TEAL, fontSize: 15, fontWeight: '600' },
  patientName: { fontSize: 22, fontWeight: '700', color: '#1e293b' },
  patientMeta: { fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    color: '#1e293b', backgroundColor: '#fff',
  },
  news2Box: {
    marginTop: 20, padding: 16, borderRadius: 12, borderWidth: 2,
    backgroundColor: '#f8fafc', alignItems: 'center',
  },
  news2Label: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  news2Score: { fontSize: 48, fontWeight: '800' },
  news2Risk: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  saveBtn: {
    backgroundColor: TEAL, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', marginTop: 24, marginBottom: 40,
  },
  disabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
