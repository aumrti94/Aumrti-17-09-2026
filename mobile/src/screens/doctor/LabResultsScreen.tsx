import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, TouchableOpacity,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface LabOrder {
  id: string;
  order_number: string;
  patient_name: string;
  uhid: string;
  test_name: string;
  status: string;
  ordered_at: string;
  results: LabResult[];
}

interface LabResult {
  test_name: string;
  result_value: string;
  unit: string;
  result_flag: string;
  reference_range: string;
}

const NAVY = '#1A2F5A';

const flagColor = (flag: string) => {
  if (flag === 'H' || flag === 'critical_high') return '#ef4444';
  if (flag === 'L' || flag === 'critical_low') return '#f97316';
  if (flag === 'HH' || flag === 'LL') return '#dc2626';
  return '#16a34a';
};

export default function LabResultsScreen() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const loadResults = useCallback(async () => {
    if (!profile?.hospital_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('lab_orders')
      .select(`
        id, order_number, status, ordered_at,
        patient:patients(full_name, uhid),
        lab_order_tests(
          test_name, result_value, unit, result_flag, reference_range
        )
      `)
      .eq('hospital_id', profile.hospital_id)
      .eq('ordering_doctor_id', profile.id)
      .eq('status', 'resulted')
      .order('ordered_at', { ascending: false })
      .limit(50);

    if (data) {
      setOrders(data.map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        patient_name: o.patient?.full_name || '',
        uhid: o.patient?.uhid || '',
        test_name: (o.lab_order_tests || []).map((t: any) => t.test_name).join(', '),
        status: o.status,
        ordered_at: o.ordered_at,
        results: o.lab_order_tests || [],
      })));
    }
    setLoading(false);
  }, [profile]);

  const filtered = orders.filter(o =>
    o.patient_name.toLowerCase().includes(search.toLowerCase()) ||
    o.uhid.toLowerCase().includes(search.toLowerCase())
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadResults();
    setRefreshing(false);
  };

  React.useEffect(() => { loadResults(); }, [loadResults]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lab Results</Text>
      </View>

      <View style={{ padding: 12 }}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search patient name or UHID..."
          placeholderTextColor="#94a3b8"
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={NAVY} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NAVY} />}
        >
          {filtered.length === 0 && (
            <Text style={styles.emptyText}>No resulted lab orders found.</Text>
          )}
          {filtered.map(order => (
            <View key={order.id} style={styles.orderCard}>
              <View style={styles.orderHeader}>
                <View>
                  <Text style={styles.patientName}>{order.patient_name}</Text>
                  <Text style={styles.patientMeta}>{order.uhid} · #{order.order_number}</Text>
                </View>
                <View style={styles.resultedBadge}>
                  <Text style={styles.resultedText}>Resulted</Text>
                </View>
              </View>

              <View style={styles.divider} />

              {order.results.map((r, i) => (
                <View key={i} style={styles.resultRow}>
                  <Text style={styles.testName}>{r.test_name}</Text>
                  <View style={styles.resultRight}>
                    <Text style={[styles.resultValue, { color: r.result_flag ? flagColor(r.result_flag) : '#1e293b' }]}>
                      {r.result_value} {r.unit}
                      {r.result_flag ? ` (${r.result_flag})` : ''}
                    </Text>
                    <Text style={styles.refRange}>{r.reference_range}</Text>
                  </View>
                </View>
              ))}
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
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  searchInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14,
    color: '#1e293b', backgroundColor: '#fff',
  },
  emptyText: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 15 },
  orderCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  orderHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  patientName: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  patientMeta: { fontSize: 12, color: '#64748b', marginTop: 2 },
  resultedBadge: { backgroundColor: '#d1fae5', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  resultedText: { fontSize: 11, color: '#065f46', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 10 },
  resultRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingVertical: 4,
  },
  testName: { fontSize: 13, color: '#374151', flex: 1 },
  resultRight: { alignItems: 'flex-end', flex: 1 },
  resultValue: { fontSize: 13, fontWeight: '700' },
  refRange: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
});
