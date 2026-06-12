import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Vorgemerkt',
  processing: 'In Bearbeitung',
  grace_period_open: 'Änderbar bis 22:00',
  locked_for_production: 'In Produktion',
  fulfilled: 'Abgeholt',
  refunded: 'Rückerstattet',
  cancelled: 'Storniert',
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Ausstehend',
  paid: 'Bezahlt',
  failed: 'Fehlgeschlagen',
  refunded: 'Rückerstattet',
};

interface InvoiceData {
  order: Record<string, unknown>;
  seller: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
}

function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    loadInvoice();
  }, [id]);

  async function loadInvoice() {
    try {
      // Try to get full invoice via RPC
      const { data } = await supabase.rpc('get_order_invoice', { p_order_id: id });
      if (data) {
        setInvoice(data as unknown as InvoiceData);
      } else {
        // Fallback: fetch order directly
        const { data: orderData } = await supabase
          .from('orders')
          .select('*, items:order_items(*, product:products(*)), pickup_location:pickup_locations(*)')
          .eq('id', id)
          .single();
        if (orderData) {
          const { data: sellerData } = await supabase
            .from('seller_info')
            .select('*')
            .limit(1)
            .single();
          setInvoice({
            order: orderData as unknown as Record<string, unknown>,
            seller: (sellerData ?? {}) as Record<string, unknown>,
            items: ((orderData as unknown as Record<string, unknown>).items ?? []) as Array<Record<string, unknown>>,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load order:', err);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><Text style={styles.loadingText}>Lädt...</Text></View>
      </SafeAreaView>
    );
  }

  if (!invoice) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Bestellung nicht gefunden</Text>
        </View>
      </SafeAreaView>
    );
  }

  const ord = invoice.order;
  const seller = invoice.seller;
  const items = invoice.items;
  const totalGross = (ord.total_cents as number) ?? (ord.total_gross as number) ?? 0;
  const totalNet = (ord.total_net as number) ?? Math.round(totalGross / 1.07);
  const totalVat = (ord.total_vat as number) ?? (totalGross - totalNet);
  const invoiceNumber = (ord.invoice_number as string) ?? (id ?? '').substring(0, 8).toUpperCase();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Receipt Header */}
        <View style={styles.receiptHeader}>
          <Text style={styles.receiptTitle}>Rechnung</Text>
          <Text style={styles.invoiceNumber}>{invoiceNumber}</Text>
        </View>

        {/* Seller Info */}
        {seller && seller.name ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Verkäufer</Text>
            <Text style={styles.bodyText}>{seller.name as string}</Text>
            {(seller.address_line1 as string) && (
              <Text style={styles.bodyText}>{seller.address_line1 as string}</Text>
            )}
            {(seller.postal_code as string || seller.city as string) && (
              <Text style={styles.bodyText}>
                {seller.postal_code as string ?? ''} {seller.city as string ?? ''}
              </Text>
            )}
            {(seller.tax_id as string) && (
              <Text style={styles.metaText}>Steuer-Nr.: {seller.tax_id as string}</Text>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Smittenbrot</Text>
            <Text style={styles.bodyText}>Stockdorf bei München</Text>
          </View>
        )}

        {/* Customer Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Kunde</Text>
          {(ord.customer_name as string) && (
            <Text style={styles.bodyText}>{ord.customer_name as string}</Text>
          )}
          {(ord.customer_email as string) && (
            <Text style={styles.bodyText}>{ord.customer_email as string}</Text>
          )}
        </View>

        {/* Order Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bestellung</Text>
          <DetailRow label="Status" value={STATUS_LABELS[(ord.status as string)] ?? (ord.status as string)} />
          <DetailRow
            label="Abholdatum"
            value={new Date((ord.fulfillment_date as string) + 'T12:00:00').toLocaleDateString('de-DE', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          />
          <DetailRow label="Bestellt am" value={new Date(ord.created_at as string).toLocaleDateString('de-DE')} />
          <DetailRow label="Zahlung" value={PAYMENT_LABELS[(ord.payment_status as string)] ?? (ord.payment_status as string)} />
        </View>

        {/* Items Table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Artikel</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, { flex: 2 }]}>Produkt</Text>
            <Text style={[styles.tableHeaderText, { flex: 0.6, textAlign: 'center' }]}>Menge</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Netto</Text>
            <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Brutto</Text>
          </View>
          {items.map((item, i) => {
            const qty = (item.quantity as number) ?? 1;
            const gross = (item.unit_price_gross as number) ?? 0;
            const net = (item.unit_price_net as number) ?? Math.round(gross / 1.07);
            return (
              <View key={i} style={styles.itemRow}>
                <Text style={[styles.itemCell, { flex: 2 }]} numberOfLines={1}>
                  {item.product_name as string}
                </Text>
                <Text style={[styles.itemCell, { flex: 0.6, textAlign: 'center' }]}>{qty}×</Text>
                <Text style={[styles.itemCell, { flex: 1, textAlign: 'right' }]}>
                  {formatPrice(net * qty)}€
                </Text>
                <Text style={[styles.itemCell, { flex: 1, textAlign: 'right', fontWeight: '600' }]}>
                  {formatPrice(gross * qty)}€
                </Text>
              </View>
            );
          })}
          <View style={styles.divider} />
          <View style={styles.totals}>
            <TotalRow label="Nettobetrag" value={formatPrice(totalNet) + '€'} />
            <TotalRow label="MwSt. 7%" value={formatPrice(totalVat) + '€'} />
            <TotalRow label="Gesamt (brutto)" value={formatPrice(totalGross) + '€'} bold />
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          Smittenbrot · Zahlung erfolgt über Stripe{'\n'}
          Es gilt die 7% ermäßigte Mehrwertsteuer auf Lebensmittel.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={[styles.totalRow, bold && styles.totalRowBold]}>
      <Text style={[styles.totalLabel, bold && styles.totalLabelBold]}>{label}</Text>
      <Text style={[styles.totalValue, bold && styles.totalValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: theme.fontSize.md, color: theme.colors.textLight },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  
  receiptHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  receiptTitle: {
    fontSize: theme.fontSize.xxl,
    fontWeight: '700',
    color: theme.colors.primary,
    fontFamily: undefined,
  },
  invoiceNumber: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  
  section: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
  },
  bodyText: {
    fontSize: theme.fontSize.md,
    color: theme.colors.text,
    lineHeight: 22,
  },
  metaText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  detailLabel: { fontSize: theme.fontSize.sm, color: theme.colors.textLight },
  detailValue: { fontSize: theme.fontSize.sm, color: theme.colors.text, fontWeight: '500' },
  
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.primary,
  },
  tableHeaderText: {
    fontSize: theme.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.primary,
    textTransform: 'uppercase',
  },
  
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  itemCell: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
  
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.sm,
  },
  
  totals: {
    marginTop: theme.spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalRowBold: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.primary,
    marginTop: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
  },
  totalLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
  },
  totalLabelBold: {
    fontSize: theme.fontSize.md,
    fontWeight: '700',
    color: theme.colors.text,
  },
  totalValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text,
  },
  totalValueBold: {
    fontSize: theme.fontSize.md,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  
  footer: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textLight,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: theme.spacing.lg,
  },
});
