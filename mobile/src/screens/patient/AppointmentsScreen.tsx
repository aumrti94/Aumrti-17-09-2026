import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, Linking, Alert,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface Appointment {
  id: string;
  appointment_date: string;
  slot_time: string;
  doctor_name: string;
  department: string;
  status: string;
  reason: string;
  token_number: number;
  is_today: boolean;
  is_upcoming: boolean;
}

const NAVY = '#1A2F5A';

const statusColors: Record<string, string> = {
  scheduled: '#3b82f6',
  confirmed: '#16a34a',
  completed: '#64748b',
  cancelled: '#ef4444',
  no_show: '#f97316',
};

export default function AppointmentsScreen() {
  const { profile } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const loadAppointments = useCallback(async () => {
    if (!profile?.hospital_id) return;
    setLoading(true);

    const { data } = await supabase
      .from('appointments')
      .select(`
        id, appointment_date, slot_time, status, reason, token_number,
        doctor:users(full_name),
        department:departments(name)
      `)
      .eq('hospital_id', profile.hospital_id)
      .order('appointment_date', { ascending: false })
      .limit(60);

    if (data) {
      const today = new Date().toISOString().split('T')[0];
      setAppointments(data.map((a: any) => ({
        id: a.id,
        appointment_date: a.appointment_date,
        slot_time: a.slot_time || '',
        doctor_name: a.doctor?.full_name || '—',
        department: a.department?.name || '—',
        status: a.status,
        reason: a.reason || '',
        token_number: a.token_number,
        is_today: a.appointment_date === today,
        is_upcoming: a.appointment_date >= today && !['completed', 'cancelled'].includes(a.status),
      })));
    }
    setLoading(false);
  }, [profile]);

  React.useEffect(() => { loadAppointments(); }, [loadAppointments]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAppointments();
    setRefreshing(false);
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  const filtered = tab === 'upcoming'
    ? appointments.filter(a => a.is_upcoming || a.is_today)
    : appointments.filter(a => !a.is_upcoming && !a.is_today);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Appointments</Text>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, tab === 'upcoming' && styles.tabActive]}
          onPress={() => setTab('upcoming')}
        >
          <Text style={[styles.tabText, tab === 'upcoming' && styles.tabTextActive]}>Upcoming</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'past' && styles.tabActive]}
          onPress={() => setTab('past')}
        >
          <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>Past</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={NAVY} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NAVY} />}
        >
          {filtered.length === 0 && (
            <Text style={styles.emptyText}>
              {tab === 'upcoming' ? 'No upcoming appointments.' : 'No past appointments.'}
            </Text>
          )}
          {filtered.map(a => (
            <View key={a.id} style={[styles.card, a.is_today && styles.todayCard]}>
              {a.is_today && (
                <View style={styles.todayBadge}>
                  <Text style={styles.todayBadgeText}>TODAY</Text>
                </View>
              )}
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.doctorName}>{a.doctor_name}</Text>
                  <Text style={styles.dept}>{a.department}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: (statusColors[a.status] || '#64748b') + '20' }]}>
                  <Text style={[styles.statusText, { color: statusColors[a.status] || '#64748b' }]}>
                    {a.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailIcon}>📅</Text>
                <Text style={styles.detailText}>{formatDate(a.appointment_date)}{a.slot_time ? ` · ${a.slot_time}` : ''}</Text>
              </View>

              {a.token_number > 0 && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailIcon}>🎫</Text>
                  <Text style={styles.detailText}>Token #{a.token_number}</Text>
                </View>
              )}

              {a.reason && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailIcon}>📋</Text>
                  <Text style={styles.detailText} numberOfLines={2}>{a.reason}</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  header: {
    backgroundColor: NAVY,
    paddingTop: 60, paddingBottom: 16, paddingHorizontal: 16,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  tabRow: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: NAVY },
  tabText: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  tabTextActive: { color: NAVY, fontWeight: '700' },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  todayCard: { borderLeftWidth: 4, borderLeftColor: NAVY },
  todayBadge: {
    alignSelf: 'flex-start', backgroundColor: NAVY + '15', borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 2, marginBottom: 8,
  },
  todayBadgeText: { fontSize: 10, fontWeight: '700', color: NAVY },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  doctorName: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  dept: { fontSize: 12, color: '#64748b', marginTop: 2 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  detailIcon: { fontSize: 13 },
  detailText: { fontSize: 13, color: '#374151', flex: 1 },
  emptyText: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 15 },
});
