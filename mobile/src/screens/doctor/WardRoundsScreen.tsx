import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { database } from '@/lib/watermelon/database';
import { syncWithSupabase } from '@/lib/watermelon/sync';

interface IPDPatient {
  id: string;
  uhid: string;
  full_name: string;
  ward_name: string;
  bed_number: string;
  admission_date: string;
  diagnosis: string;
  latest_news2?: number;
}

const NAVY = '#1A2F5A';
const TEAL = '#0E7B7B';

export default function WardRoundsScreen() {
  const { profile } = useAuth();
  const [patients, setPatients] = useState<IPDPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<IPDPatient | null>(null);
  const [soap, setSoap] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadPatients = useCallback(async () => {
    if (!profile?.hospital_id) return;
    const { data } = await supabase
      .from('ipd_admissions')
      .select(`
        id, admission_date, diagnosis,
        patient:patients(id, uhid, full_name),
        bed:beds(bed_number, ward:wards(name))
      `)
      .eq('hospital_id', profile.hospital_id)
      .eq('status', 'admitted')
      .eq('attending_doctor_id', profile.id)
      .order('admission_date', { ascending: true });

    if (data) {
      setPatients(data.map((a: any) => ({
        id: a.patient?.id,
        uhid: a.patient?.uhid,
        full_name: a.patient?.full_name,
        ward_name: a.bed?.ward?.name || '—',
        bed_number: a.bed?.bed_number || '—',
        admission_date: a.admission_date,
        diagnosis: a.diagnosis || '',
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

  const handleSync = async () => {
    if (!profile?.hospital_id) return;
    setSyncing(true);
    try {
      await syncWithSupabase(profile.hospital_id);
      Alert.alert('Sync Complete', 'All offline records uploaded successfully.');
    } catch {
      Alert.alert('Sync Failed', 'Check your connection and try again.');
    } finally {
      setSyncing(false);
    }
  };

  const saveRoundNote = async () => {
    if (!selectedPatient || !profile) return;
    setSaving(true);
    try {
      await database.write(async () => {
        const collection = database.get('ward_rounds');
        await collection.create((record: any) => {
          record.remote_id = '';
          record.hospital_id = profile.hospital_id;
          record.patient_id = selectedPatient.id;
          record.doctor_id = profile.id;
          record.rounded_at = Date.now();
          record.subjective = soap.subjective;
          record.objective = soap.objective;
          record.assessment = soap.assessment;
          record.plan = soap.plan;
          record.is_synced = false;
          record.synced_at = 0;
        });
      });
      Alert.alert('Saved', 'Ward round note saved locally. Tap Sync to upload.');
      setSelectedPatient(null);
      setSoap({ subjective: '', objective: '', assessment: '', plan: '' });
    } catch {
      Alert.alert('Error', 'Could not save note.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={NAVY} />
      </View>
    );
  }

  if (selectedPatient) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <TouchableOpacity onPress={() => setSelectedPatient(null)} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.patientName}>{selectedPatient.full_name}</Text>
        <Text style={styles.patientMeta}>
          {selectedPatient.uhid} · {selectedPatient.ward_name} · Bed {selectedPatient.bed_number}
        </Text>
        <Text style={styles.diagnosisLabel}>Diagnosis: {selectedPatient.diagnosis || 'Not recorded'}</Text>

        <Text style={styles.soapLabel}>Subjective (S)</Text>
        <TextInput
          style={styles.soapInput}
          value={soap.subjective}
          onChangeText={t => setSoap(prev => ({ ...prev, subjective: t }))}
          placeholder="Patient complaints, symptoms, history..."
          multiline
          numberOfLines={3}
        />
        <Text style={styles.soapLabel}>Objective (O)</Text>
        <TextInput
          style={styles.soapInput}
          value={soap.objective}
          onChangeText={t => setSoap(prev => ({ ...prev, objective: t }))}
          placeholder="Vitals, examination findings, labs..."
          multiline
          numberOfLines={3}
        />
        <Text style={styles.soapLabel}>Assessment (A)</Text>
        <TextInput
          style={styles.soapInput}
          value={soap.assessment}
          onChangeText={t => setSoap(prev => ({ ...prev, assessment: t }))}
          placeholder="Clinical impression and diagnosis..."
          multiline
          numberOfLines={3}
        />
        <Text style={styles.soapLabel}>Plan (P)</Text>
        <TextInput
          style={styles.soapInput}
          value={soap.plan}
          onChangeText={t => setSoap(prev => ({ ...prev, plan: t }))}
          placeholder="Treatment plan, medications, investigations, disposition..."
          multiline
          numberOfLines={4}
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.disabled]}
          onPress={saveRoundNote}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Round Note (Offline)</Text>}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Ward Patients</Text>
        <TouchableOpacity onPress={handleSync} style={styles.syncBtn} disabled={syncing}>
          {syncing ? <ActivityIndicator size="small" color={TEAL} /> : <Text style={styles.syncText}>⬆️ Sync</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 12, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NAVY} />}
      >
        {patients.length === 0 && (
          <Text style={styles.emptyText}>No admitted patients assigned to you today.</Text>
        )}
        {patients.map(p => (
          <TouchableOpacity key={p.id} style={styles.patientCard} onPress={() => setSelectedPatient(p)}>
            <View style={styles.patientCardLeft}>
              <Text style={styles.cardName}>{p.full_name}</Text>
              <Text style={styles.cardMeta}>{p.uhid} · {p.ward_name} · Bed {p.bed_number}</Text>
              <Text style={styles.cardDx} numberOfLines={1}>{p.diagnosis || 'No diagnosis recorded'}</Text>
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
    backgroundColor: NAVY,
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  syncBtn: { padding: 8 },
  syncText: { color: '#7dd3fc', fontSize: 14, fontWeight: '600' },
  patientCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  patientCardLeft: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  cardMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  cardDx: { fontSize: 12, color: '#0E7B7B', marginTop: 4 },
  chevron: { fontSize: 22, color: '#94a3b8' },
  emptyText: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 15 },
  backBtn: { marginBottom: 16 },
  backText: { color: NAVY, fontSize: 15, fontWeight: '600' },
  patientName: { fontSize: 22, fontWeight: '700', color: '#1e293b' },
  patientMeta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  diagnosisLabel: { fontSize: 13, color: TEAL, marginTop: 8, marginBottom: 16, fontWeight: '500' },
  soapLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6, marginTop: 12 },
  soapInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#1e293b',
    backgroundColor: '#f8fafc',
    textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: NAVY,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 40,
  },
  disabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
