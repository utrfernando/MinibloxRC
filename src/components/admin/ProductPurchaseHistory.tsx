import React, { useEffect, useState } from 'react';
import { supabase, formatCurrency, formatDate } from '../../lib/supabase';

type Row = {
  quantity: number; unit_cost: number;
  purchase: {
    id: string; reference: string | null; purchase_date: string; total_cost: number; extra_costs: number | null;
    supplier: { name: string } | null; items: { quantity: number; unit_cost: number }[];
  } | null;
};

/** Read-only: every shipment this product arrived in, filled in automatically from Inventory → Purchases. */
export const ProductPurchaseHistory: React.FC<{ productId: string; currency: string }> = ({ productId, currency }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const money = (n: number) => formatCurrency(n, currency);

  useEffect(() => {
    setRows(null); setFailed(false);
    supabase.from('purchase_items')
      .select('quantity,unit_cost,purchase:purchases(id,reference,purchase_date,total_cost,extra_costs,supplier:suppliers(name),items:purchase_items(quantity,unit_cost))')
      .eq('product_id', productId)
      .then(({ data, error }) => {
        if (error) { setFailed(true); setRows([]); return; }
        const list = ((data || []) as unknown as Row[]).filter(r => r.purchase).sort((a, b) => b.purchase!.purchase_date.localeCompare(a.purchase!.purchase_date));
        setRows(list);
      });
  }, [productId]);

  return (
    <div className="rounded-3xl bg-lavender-50 p-4">
      <p className="text-xs font-extrabold uppercase tracking-wide text-lavender-600 mb-1">Purchase history</p>
      <p className="text-[11px] text-ink-500 mb-3">Where this product came from. Filled in automatically when you record stock under Inventory → Purchases — nothing to type here.</p>
      {rows === null ? <p className="text-xs text-ink-400">Loading…</p>
        : failed ? <p className="text-xs text-red-500 font-semibold">Couldn't load the purchase history.</p>
        : rows.length === 0 ? <p className="text-xs text-ink-500 italic">No purchases recorded for this product yet — its stock was loaded as opening stock (bulk upload).</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[460px]">
              <thead><tr className="text-left text-ink-400"><th className="py-1 pr-2">Invoice no.</th><th className="pr-2">Supplier</th><th className="pr-2">Date</th><th className="pr-2 text-right">Qty</th><th className="pr-2 text-right">Cost each</th><th className="text-right">Landed each</th></tr></thead>
              <tbody className="divide-y divide-lavender-100">
                {rows.map((r, i) => {
                  const p = r.purchase!;
                  const goods = p.items.reduce((s, x) => s + x.quantity * x.unit_cost, 0);
                  const units = p.items.reduce((s, x) => s + x.quantity, 0);
                  const extra = Number(p.extra_costs || 0);
                  // freight/customs shared out by value, the same way it is added to the product's landed cost
                  const share = extra > 0 ? (goods > 0 ? extra * ((r.quantity * r.unit_cost) / goods) : extra * (r.quantity / Math.max(units, 1))) / r.quantity : 0;
                  return (
                    <tr key={i} className="text-ink-700">
                      <td className="py-1.5 pr-2 font-bold">{p.reference || '—'}</td>
                      <td className="pr-2">{p.supplier?.name || '—'}</td>
                      <td className="pr-2 whitespace-nowrap">{formatDate(p.purchase_date)}</td>
                      <td className="pr-2 text-right">{r.quantity}</td>
                      <td className="pr-2 text-right">{money(Number(r.unit_cost))}</td>
                      <td className="text-right font-bold">{money(Number(r.unit_cost) + share)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
};
