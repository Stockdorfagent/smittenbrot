import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

function getStripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-05-27.dahlia',
  });
}

export async function POST(req: NextRequest) {
  try {
    const { from_date, to_date } = await req.json();

    if (!from_date) {
      return NextResponse.json({ error: 'from_date is required' }, { status: 400 });
    }

    const fromTimestamp = Math.floor(new Date(from_date).getTime() / 1000);
    const toTimestamp = to_date
      ? Math.floor(new Date(to_date + 'T23:59:59').getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    // Fetch all balance transactions in the date range
    let allTransactions: any[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: any = {
        limit: 100,
        created: { gte: fromTimestamp, lte: toTimestamp },
      };
      if (startingAfter) params.starting_after = startingAfter;

      const batch = await getStripeClient().balanceTransactions.list(params);
      allTransactions = allTransactions.concat(batch.data);
      hasMore = batch.has_more;
      if (batch.data.length > 0) {
        startingAfter = batch.data[batch.data.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    // Group by date
    const dailyMap: Record<string, { gross: number; fee: number; count: number; types: Record<string, number> }> = {};
    let totalGross = 0;
    let totalFee = 0;

    for (const t of allTransactions) {
      const date = new Date(t.created * 1000).toISOString().split('T')[0];
      if (!dailyMap[date]) dailyMap[date] = { gross: 0, fee: 0, count: 0, types: {} };

      dailyMap[date].gross += t.amount;
      dailyMap[date].fee += t.fee;
      dailyMap[date].count++;
      dailyMap[date].types[t.type] = (dailyMap[date].types[t.type] || 0) + 1;

      totalGross += t.amount;
      totalFee += t.fee;
    }

    // Build CSV
    const lines = [
      'Datum;Transaktionen;Brutto (€);Gebühren (€);Netto (€);Typen',
    ];

    const sortedDates = Object.keys(dailyMap).sort();
    for (const date of sortedDates) {
      const d = dailyMap[date];
      const grossFmt = (d.gross / 100).toFixed(2).replace('.', ',');
      const feeFmt = (d.fee / 100).toFixed(2).replace('.', ',');
      const netFmt = ((d.gross - d.fee) / 100).toFixed(2).replace('.', ',');
      const typeSummary = Object.entries(d.types)
        .map(([t, n]) => `${t}: ${n}`)
        .join('; ');
      lines.push([date, d.count, grossFmt, feeFmt, netFmt, typeSummary].join(';'));
    }

    // Summary line
    const totalGrossFmt = (totalGross / 100).toFixed(2).replace('.', ',');
    const totalFeeFmt = (totalFee / 100).toFixed(2).replace('.', ',');
    const totalNetFmt = ((totalGross - totalFee) / 100).toFixed(2).replace('.', ',');
    lines.push([
      'GESAMT',
      allTransactions.length,
      totalGrossFmt,
      totalFeeFmt,
      totalNetFmt,
      '',
    ].join(';'));

    const csvContent = '\uFEFF' + lines.join('\r\n');

    return NextResponse.json({
      csv: csvContent,
      filename: `stripe-gebuehren-${from_date}-${to_date || 'bis'}.csv`,
      summary: {
        transactions: allTransactions.length,
        total_gross_cents: totalGross,
        total_fee_cents: totalFee,
        total_net_cents: totalGross - totalFee,
        days: sortedDates.length,
      },
    });
  } catch (err: any) {
    console.error('Stripe fee export error:', err);
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 });
  }
}
