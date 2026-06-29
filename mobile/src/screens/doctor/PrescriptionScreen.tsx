import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, FlatList,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { database } from '@/lib/watermelon/database';

interface PatientSearchResult {
  id: string;
  uhid: string;
  full_name: string;
}

const ROUTES = ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhaled', 'Sublingual'];
const FREQUENCIES = ['OD', 'BD', 'TDS', 'QID', 'SOS', 'Stat', 'Nocte'];

const NAVY = '#1A2F5A';

export default function PrescriptionScreen() {
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [drugName, setDrugName] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('Oral');
  const [frequency, setFrequency] = useState('OD');
  const [durationDays, setDurationDays] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);

  const searchPatients = useCallback(async (q: string) => {
    setSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    const { data } = await supabase
      .from('patients')
      .select('id, uhid, full_name')
      .eq('hospital_id', profile?.hospital_id)
      .or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%`)
      .limit(10);
    setSearchResults(data || []);
  }, [profile]);

  const savePrescription = async () => {
    if (!selectedPatient || !drugName.trim() || !dose.trim()) {
      Alert.alert('Missing Fields', 'Please select a patient and enter drug name and dose.');
      return;
    }
    setSaving(true);
    try {
      await database.write(async () => {
        const collection = database.get('prescriptions');
        await collection.create((record: any) => {
          record.remote_id = '';
          record.hospital_id = profile!.hospital_id;
          record.patient_id = selectedPatient.id;
          record.prescribed_by = profile!.id;
          record.prescribed_at = Date.now();
          record.drug_name = drugName.trim();
          record.dose = dose.trim();
          record.frequency = frequency;
          record.route = route;
          record.duration_days = durationDays ? Number(durationDays) : 0;
          record.instructions = instructions.trim();
          record.is_synced = false;
          record.synced_at = 0;
        });
      });
      Alert.alert('Saved', `Prescription for ${selectedPatient.full_name} saved offline. Sync to upload.`);
      setDrugName('');
      setDose('');
      setDurationDays('');
      setInstructions('');
    } catch {
      Alert.alert('Error', 'Could not save prescription.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>E-Prescribe</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Patient search */}
        <Text style={styles.label}>Patient</Text>
        {selectedPatient ? (
          <View style={styles.selectedPatient}>
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedName}>{selectedPatient.full_name}</Text>
              <Text style={styles.selectedMeta}>{selectedPatient.uhid}</Text>
            </View>
            <TouchableOpacity onPress={() => { setSelectedPatient(null); setSearchResults([]); }}>
              <Text style={styles.changeBtn}>Change</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={search}
              onChangeText={searchPatients}
              placeholder="Search by name or UHID..."
              placeholderTextColor="#94a3b8"
            />
            {searchResults.map(p => (
              <TouchableOpacity
                key={p.id}
                style={styles.searchResult}
                onPress={() => { setSelectedPatient(p); setSearch(''); setSearchResults([]); }}
              >
                <Text style={styles.resultName}>{p.full_name}</Text>
                <Text style={styles.resultMeta}>{p.uhid}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        <Text style={styles.label}>Drug Name</Text>
        <TextInput
          style={styles.input}
          value={drugName}
          onChangeText={setDrugName}
          placeholder="e.g. Paracetamol 500mg"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Dose</Text>
        <TextInput
          style={styles.input}
          value={dose}
          onChangeText={setDose}
          placeholder="e.g. 500mg, 1 tab"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Route</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {ROUTES.map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, route === r && styles.chipActive]}
              onPress={() => setRoute(r)}
            >
              <Text style={[styles.chipText, route === r && styles.chipTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.label}>Frequency</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {FREQUENCIES.map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, frequency === f && styles.chipActive]}
              onPress={() => setFrequency(f)}
            >
              <Text style={[styles.chipText, frequency === f && styles.chipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.label}>Duration (days)</Text>
        <TextInput
          style={styles.input}
          value={durationDays}
          onChangeText={setDurationDays}
          placeholder="e.g. 5"
          keyboardType="numeric"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Instructions</Text>
        <TextInput
          style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Take after food, avoid alcohol..."
          multiline
          placeholderTextColor="#94a3b8"
        />

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.disabled]}
          onPress={savePrescription}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Prescription</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  header: {
    backgroundColor: NAVY,
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 14 },
  input: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    color: '#1e293b', backgroundColor: '#fff',
  },
  selectedPatient: {
    borderWidth: 1, borderColor: '#0E7B7B', borderRadius: 8, padding: 12,
    backgroundColor: '#f0fdfa', flexDirection: 'row', alignItems: 'center',
  },
  selectedName: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  selectedMeta: { fontSize: 12, color: '#64748b' },
  changeBtn: { color: NAVY, fontSize: 13, fontWeight: '600' },
  searchResult: {
    backgroundColor: '#fff', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  resultName: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  resultMeta: { fontSize: 12, color: '#64748b' },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#e2e8f0', marginRight: 8,
  },
  chipActive: { backgroundColor: NAVY },
  chipText: { fontSize: 13, color: '#475569' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  saveBtn: {
    backgroundColor: NAVY, borderRadius: 10,
    paddingVertical: 14, alignItems: 'center', marginTop: 24, marginBottom: 40,
  },
  disabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
