import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatDate, type Order, type Product } from '../../../lib/supabase';
import { Table, Td } from '../ui';
import { type PurchasePay } from './SupplierPanel';

type Item = { product_id: string; quantity: number; unit_cost: number };
type ShipPurchase = PurchasePay & { items?: Item[] };

type Line = { name: string; qty: number; sold: number; revenue: number };
type Ship = {
  p: ShipPurchase; cost: number; units: number; sold: number; left: number;
  revenue: number; soldCost: number; lines: Line[]; tracked: boolean;
};

/**
 * One row per supplier invoice: what it cost (goods + freight), how much has been sold from it, what is left,
 * and how much of the money has come back. Sales are matched to shipments oldest-first (FIFO), after any
 * opening stock that was loaded before purchases were recorded. It is an estimate for judging shipments —
 * the official profit uses the cost saved on each sale.
 */
export const ShipmentsPanel: React.FC<{
  purchases: ShipPurchase[]; orders: Order[]; products: Product[]; money: (n: number) => string;
}> = ({ purchases, orders, products, money }) => {
  const [open, setOpen] = useState<string | null>(null);

  const ships = useMemo<Ship[]>(() => {
    const names = new Map(products.map(p => [p.id, p.name]));
    const stock = new Map(products.map(p => [p.id, Number(p.stock_quantity || 0)]));

    // sales lines per product, oldest first
    type Sale = { qty: number; price: number };
    const sales = new Map<string, Sale[]>();
    [...orders].filter(o => o.status !== 'cancelled' && o.status !== 'returned')
      .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
      .forEach(o => (o.items || []).forEach(i => {
        if (!i.product_id) return;
        const arr = sales.get(i.product_id) || [];
        arr.push({ qty: i.quantity, price: Number(i.unit_price) });
        sales.set(i.product_id, arr);
      }));

    const sorted = [...purchases].sort((a, b) => a.purchase_date.localeCompare(b.purchase_date) || (a.created_at || '').localeCompare(b.created_at || ''));
    const recorded = new Map<string, number>();
    sorted.forEach(p => (p.items || []).forEach(i => recorded.set(i.product_id, (recorded.get(i.product_id) || 0) + i.quantity)));

    // per product: stock that predates recorded purchases (loaded by bulk upload) is consumed first
    const result = new Map<string, Ship>();
    sorted.forEach(p => {
      const items = p.items || [];
      result.set(p.id, { p, cost: Number(p.total_cost) + Number(p.extra_costs || 0), units: items.reduce((s, i) => s + i.quantity, 0), sold: 0, left: 0, revenue: 0, soldCost: 0, lines: [], tracked: items.length > 0 });
    });

    const productIds = new Set<string>(); sorted.forEach(p => (p.items || []).forEach(i => productIds.add(i.product_id)));
    productIds.forEach(pid => {
      const queue = (sales.get(pid) || []).map(s => ({ ...s }));
      const soldTotal = queue.reduce((s, x) => s + x.qty, 0);
      const opening = Math.max(0, soldTotal + (stock.get(pid) || 0) - (recorded.get(pid) || 0));
      const take = (qty: number) => { let got = 0, rev = 0; while (got < qty && queue.length) { const s = queue[0]; const n = Math.min(qty - got, s.qty); got += n; rev += n * s.price; s.qty -= n; if (s.qty <= 0) queue.shift(); } return { got, rev }; };
      take(opening); // opening stock sells first
      sorted.forEach(p => {
        const items = (p.items || []).filter(i => i.product_id === pid);
        if (!items.length) return;
        const goods = (p.items || []).reduce((s, i) => s + i.quantity * i.unit_cost, 0);
        const units = (p.items || []).reduce((s, i) => s + i.quantity, 0);
        const extra = Number(p.extra_costs || 0);
        items.forEach(it => {
          const share = extra > 0 ? (goods > 0 ? extra * ((it.quantity * it.unit_cost) / goods) : extra * (it.quantity / Math.max(units, 1))) / it.quantity : 0;
          const landed = Number(it.unit_cost) + share;
          const { got, rev } = take(it.quantity);
          const r = result.get(p.id)!;
          r.sold += got; r.revenue += rev; r.soldCost += got * landed;
          r.lines.push({ name: names.get(pid) || 'Product', qty: it.quantity, sold: got, revenue: rev });
        });
      });
    });
    result.forEach(r => { r.left = Math.max(0, r.units - r.sold); });
    return [...result.values()].sort((a, b) => b.p.purchase_date.localeCompare(a.p.purchase_date));
  }, [purchases, orders, products]);

  const tracked = ships.filter(s => s.tracked);
  const totals = tracked.reduce((t, s) => ({ cost: t.cost + s.cost, revenue: t.revenue + s.revenue, profit: t.profit + (s.revenue - s.soldCost) }), { cost: 0, revenue: 0, profit: 0 });

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-3 gap-4">
        {[['Spent on shipments', totals.cost, 'text-ink-900'], ['Earned from them so far', totals.revenue, 'text-mint-700'], ['Profit so far (sold items)', totals.profit, totals.profit >= 0 ? 'text-mint-700' : 'text-red-500']].map(([l, v, c]) => (
          <div key={l as string} className="rounded-4xl border border-ink-100 bg-white p-5 shadow-soft">
            <p className="text-xs font-extrabold uppercase tracking-wide text-ink-400">{l as string}</p>
            <p className={`font-display text-2xl font-extrabold mt-2 ${c}`}>{money(v as number)}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-400 font-semibold -mt-2">
        Only shipments recorded with item lines under Inventory → Purchases are matched to sales. Sales count the product price only (not delivery fees). Items sell oldest shipment first; stock loaded before purchases were recorded sells first of all.
      </p>

      <Table head={['', 'Invoice no.', 'Supplier', 'Date', 'Cost (incl. freight)', 'Units', 'Sold', 'Left', 'Earned', 'Profit so far', 'Earned back']}>
        {ships.length === 0 ? <tr><Td className="text-center py-8 text-ink-400">No purchases recorded yet.</Td></tr> : ships.flatMap(s => {
          const profit = s.revenue - s.soldCost;
          const back = s.cost > 0 ? (s.revenue / s.cost) * 100 : 0;
          const rows = [(
            <tr key={s.p.id} className="hover:bg-ink-50/50">
              <Td>{s.tracked && <button onClick={() => setOpen(open === s.p.id ? null : s.p.id)} className="text-ink-400" aria-label="Show products">{open === s.p.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>}</Td>
              <Td className="font-bold text-ink-900">{s.p.reference || <span className="text-red-500">no invoice no.</span>}</Td>
              <Td className="text-ink-700">{s.p.supplier?.name || '—'}</Td>
              <Td className="text-xs text-ink-500 whitespace-nowrap">{formatDate(s.p.purchase_date)}</Td>
              <Td>{money(s.cost)}</Td>
              {s.tracked ? <>
                <Td>{s.units}</Td><Td>{s.sold}</Td><Td>{s.left}</Td>
                <Td>{money(s.revenue)}</Td>
                <Td className={`font-bold ${profit < 0 ? 'text-red-500' : 'text-mint-700'}`}>{money(profit)}</Td>
                <Td><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${back >= 100 ? 'bg-mint-100 text-mint-700' : back > 0 ? 'bg-sunshine-100 text-sunshine-700' : 'bg-ink-100 text-ink-500'}`}>{back.toFixed(0)}%</span></Td>
              </> : <Td className="text-xs italic text-ink-400">no item lines — units not tracked</Td>}
            </tr>
          )];
          if (open === s.p.id) s.lines.forEach((l, i) => rows.push(
            <tr key={`${s.p.id}-${i}`} className="bg-ink-50/40 text-xs">
              <Td>{null}</Td><Td className="text-ink-500 pl-6" >↳ {l.name}</Td><Td>{null}</Td><Td>{null}</Td><Td>{null}</Td>
              <Td>{l.qty}</Td><Td>{l.sold}</Td><Td>{l.qty - l.sold}</Td><Td>{money(l.revenue)}</Td><Td>{null}</Td><Td>{null}</Td>
            </tr>
          ));
          return rows;
        })}
      </Table>
    </div>
  );
};
