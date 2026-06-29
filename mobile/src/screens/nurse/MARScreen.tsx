import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { database } from '@/lib/watermelon/database';

interface MAREntry {
  id: string;
  patient_name: string;
  uhid: string;
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  scheduled_time: string;
  status: 'pending' | 'given' | 'held' | 'missed';
  is_overdue: boolean;
}

const TEAL = '#0E7B7B';

const statusColors: Record<string, string> = {
  given: '#16a34a',
  held: '#f97316',
  missed: '#ef4444',
  pending: '#3b82f6',
};

export default function MARScreen() {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<MAREntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);

  const loadMAR = useCallback(async () => {
    if (!profile?.hospital_id) return;
    setLoading(true);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const { data } = await supabase
      .from('mar_entries')
      .select(`
        id, drug_name, dose, route, frequency, scheduled_time, status, administered_at,
        prescription:prescriptions(drug_name, dose, route, frequency),
        patient:patients(full_name, uhid)
      `)
      .eq('hospital_id', profile.hospital_id)
      .gte('scheduled_time', todayStart)
      .lt('scheduled_time', todayEnd)
      .order('scheduled_time', { ascending: true });

    if (data) {
      setEntries(data.map((e: any) => ({
        id: e.id,
        patient_name: e.patient?.full_name || '',
        uhid: e.patient?.uhid || '',
        drug_name: e.drug_name || e.prescription?.drug_name || '',
        dose: e.dose || e.prescription?.dose || '',
        route: e.route || e.prescription?.route || '',
        frequency: e.frequency || e.prescription?.frequency || '',
        scheduled_time: e.scheduled_time,
        status: e.status,
        is_overdue: e.status === 'pending' && new Date(e.scheduled_time) < now,
      })));
    }
    setLoading(false);
  }, [profile]);

  React.useEffect(() => { loadMAR(); }, [loadMAR]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMAR();
    setRefreshing(false);
  };

  const markGiven = async (entry: MAREntry) => {
    if (entry.status !== 'pending') return;
    setMarking(entry.id);
    try {
      await database.write(async () => {
        const collection = database.get('mar_entries');
        await collection.create((record: any) => {
          record.remote_id = entry.id;
          record.hospital_id = profile!.hospital_id;
          record.patient_id = '';
          record.prescription_id = '';
          record.drug_name = entry.drug_name;
          record.dose = entry.dose;
          record.scheduled_time = new Date(entry.scheduled_time).getTime();
          record.administered_at = Date.now();
          record.administered_by = profile!.id;
          record.status = 'given';
          record.is_synced = false;
          record.synced_at = 0;
        });
      });

      setEntries(prev => prev.map(e =>
        e.id === entry.id ? { ...e, status: 'given' as const, is_overdue: false } : e
      ));
    } catch {
      Alert.alert('Error', 'Could not mark medication as given.');
    } finally {
      setMarking(null);
    }
  };

  const markHeld = async (entry: MAREntry) => {
    setMarking(entry.id);
    try {
      await supabase
        .from('mar_entries')
        .update({ status: 'held', reason_held: 'Held by nurse on mobile', updated_at: new Date().toISOString() })
        .eq('id', entry.id);
      setEntries(prev => prev.map(e =>
        e.id === entry.id ? { ...e, status: 'held' as const } : e
      ));
    } catch {
      Alert.alert('Error', 'Could not hold medication.');
    } finally {
      setMarking(null);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const pending = entries.filter(e => e.status === 'pending');
  const overdues = pending.filter(e => e.is_overdue);
  const upcoming = pending.filter(e => !e.is_overdue);
  const completed = entries.filter(e => e.status !== 'pending');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Medication Administration</Text>
        <Text style={styles.headerSub}>
          {overdues.length} overdue · {upcoming.length} upcoming · {completed.filter(e => e.status === 'given').length} given today
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={TEAL} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />}
        >
          {overdues.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>⚠️ Overdue ({overdues.length})</Text>
              {overdues.map(e => <MARCard key={e.id} entry={e} onGiven={markGiven} onHeld={markHeld} marking={marking} formatTime={formatTime} />)}
            </>
          )}
          {upcoming.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>⏰ Upcoming</Text>
              {upcoming.map(e => <MARCard key={e.id} entry={e} onGiven={markGiven} onHeld={markHeld} marking={marking} formatTime={formatTime} />)}
            </>
          )}
          {completed.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>✅ Completed Today</Text>
              {completed.map(e => <MARCard key={e.id} entry={e} onGiven={markGiven} onHeld={markHeld} marking={marking} formatTime={formatTime} />)}
            </>
          )}
          {entries.length === 0 && (
            <Text style={styles.emptyText}>No medication tasks scheduled for today.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function MARCard({ entry, onGiven, onHeld, marking, formatTime }: {
  entry: MAREntry;
  onGiven: (e: MAREntry) => void;
  onHeld: (e: MAREntry) => void;
  marking: string | null;
  formatTime: (iso: string) => string;
}) {
  return (
    <View style={[cardStyles.card, entry.is_overdue && cardStyles.overdueCard]}>
      <View style={cardStyles.topRow}>
        <Text style={cardStyles.patientName}>{entry.patient_name}</Text>
        <View style={[cardStyles.statusBadge, { backgroundColor: statusColors[entry.status] + '20' }]}>
          <Text style={[cardStyles.statusText, { color: statusColors[entry.status] }]}>
            {entry.status.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={cardStyles.uhid}>{entry.uhid}</Text>
      <Text style={cardStyles.drug}>{entry.drug_name} — {entry.dose} {entry.route}</Text>
      <Text style={cardStyles.time}>
        {entry.frequency} · Scheduled: {formatTime(entry.scheduled_time)}
        {entry.is_overdue ? ' ⚠️ OVERDUE' : ''}
      </Text>
      {entry.status === 'pending' && (
        <View style={cardStyles.actions}>
          <TouchableOpacity
            style={cardStyles.givenBtn}
            onPress={() => onGiven(entry)}
            disabled={marking === entry.id}
          >
            {marking === entry.id
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={cardStyles.givenBtnText}>✓ Administered</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity style={cardStyles.holdBtn} onPress={() => onHeld(entry)}>
            <Text style={cardStyles.holdBtnText}>Hold</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  header: {
    backgroundColor: TEAL,
    paddingTop: 60, paddingBottom: 16, paddingHorizontal: 16,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerSub: { color: '#ccfbf1', fontSize: 12, marginTop: 2 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 8, marginBottom: 4 },
  emptyText: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 15 },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  overdueCard: { borderLeftWidth: 4, borderLeftColor: '#ef4444' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  patientName: { fontSize: 15, fontWeight: '700', color: '#1e293b', flex: 1 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },
  uhid: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  drug: { fontSize: 14, fontWeight: '600', color: '#0f172a', marginTop: 6 },
  time: { fontSize: 12, color: '#64748b', marginTop: 3 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  givenBtn: {
    flex: 1, backgroundColor: '#16a34a', borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
  },
  givenBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  holdBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center',
  },
  holdBtnText: { fontSize: 14, color: '#64748b', fontWeight: '500' },
});
