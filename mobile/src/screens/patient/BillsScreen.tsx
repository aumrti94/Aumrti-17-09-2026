import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, Alert, Linking,
} from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface Bill {
  id: string;
  bill_number: string;
  bill_date: string;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  status: string;
  visit_type: string;
  razorpay_order_id?: string;
  payment_link?: string;
}

const NAVY = '#1A2F5A';

const statusColors: Record<string, string> = {
  paid: '#16a34a',
  partial: '#f97316',
  unpaid: '#ef4444',
  cancelled: '#94a3b8',
};

export default function BillsScreen() {
  const { profile } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadBills = useCallback(async () => {
    if (!profile?.hospital_id) return;
    setLoading(true);

    const { data } = await supabase
      .from('bills')
      .select(`
        id, bill_number, bill_date, total_amount, paid_amount, balance_amount,
        status, visit_type, razorpay_order_id, payment_link
      `)
      .eq('hospital_id', profile.hospital_id)
      .order('bill_date', { ascending: false })
      .limit(30);

    setBills(data || []);
    setLoading(false);
  }, [profile]);

  React.useEffect(() => { loadBills(); }, [loadBills]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadBills();
    setRefreshing(false);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const formatAmount = (a: number) =>
    '₹' + (a || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });

  const openPaymentLink = async (bill: Bill) => {
    const url = bill.payment_link;
    if (!url) {
      Alert.alert('Payment Unavailable', 'Please contact the billing counter to make payment.');
      return;
    }
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Error', 'Cannot open payment link.');
    }
  };

  const totalOutstanding = bills
    .filter(b => b.status !== 'paid' && b.status !== 'cancelled')
    .reduce((sum, b) => sum + (b.balance_amount || 0), 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Bills</Text>
        {totalOutstanding > 0 && (
          <Text style={styles.outstandingBadge}>
            Outstanding: {formatAmount(totalOutstanding)}
          </Text>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={NAVY} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={NAVY} />}
        >
          {bills.length === 0 && (
            <Text style={styles.emptyText}>No bills found.</Text>
          )}
          {bills.map(bill => (
            <View key={bill.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View>
                  <Text style={styles.billNumber}>Bill #{bill.bill_number}</Text>
                  <Text style={styles.billDate}>{formatDate(bill.bill_date)} · {bill.visit_type?.toUpperCase()}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: (statusColors[bill.status] || '#64748b') + '20' }]}>
                  <Text style={[styles.statusText, { color: statusColors[bill.status] || '#64748b' }]}>
                    {bill.status?.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.amountRow}>
                <View style={styles.amountItem}>
                  <Text style={styles.amountLabel}>Total</Text>
                  <Text style={styles.amountValue}>{formatAmount(bill.total_amount)}</Text>
                </View>
                <View style={styles.amountItem}>
                  <Text style={styles.amountLabel}>Paid</Text>
                  <Text style={[styles.amountValue, { color: '#16a34a' }]}>{formatAmount(bill.paid_amount)}</Text>
                </View>
                <View style={styles.amountItem}>
                  <Text style={styles.amountLabel}>Balance</Text>
                  <Text style={[styles.amountValue, { color: bill.balance_amount > 0 ? '#ef4444' : '#16a34a' }]}>
                    {formatAmount(bill.balance_amount)}
                  </Text>
                </View>
              </View>

              {bill.status !== 'paid' && bill.status !== 'cancelled' && bill.balance_amount > 0 && (
                <TouchableOpacity
                  style={styles.payBtn}
                  onPress={() => openPaymentLink(bill)}
                >
                  <Text style={styles.payBtnText}>💳 Pay {formatAmount(bill.balance_amount)}</Text>
                </TouchableOpacity>
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
  outstandingBadge: {
    color: '#fca5a5', fontSize: 13, fontWeight: '600', marginTop: 4,
  },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  billNumber: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  billDate: { fontSize: 12, color: '#64748b', marginTop: 2 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },
  amountRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10 },
  amountItem: { flex: 1, alignItems: 'center' },
  amountLabel: { fontSize: 11, color: '#64748b', marginBottom: 3 },
  amountValue: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  payBtn: {
    marginTop: 12, backgroundColor: NAVY, borderRadius: 8,
    paddingVertical: 12, alignItems: 'center',
  },
  payBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyText: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 15 },
});
