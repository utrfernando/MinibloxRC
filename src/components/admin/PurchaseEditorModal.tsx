import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase, formatCurrency, type Product, type Purchase, type Supplier } from '../../lib/supabase';
import { PARTNERS, IMPORT_CATEGORY, FUND_PAYER, type PurchasePayment } from '../../lib/finance';
import { PaidFromSelect } from './finance/PaidFromSelect';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input, Select, Textarea, Field } from '../ui/Input';

type Row = { product_id: string; variant_id: string; quantity: string; unit_cost: string };
type PayRow = { id?: string; amount: string; date: string; paid_by: string; paid_from: string; method: string };
type Freight = { id: string; amount: number; paid_by: string | null; paid_from: string | null } | null;
const keyOf = (r: { product_id: string; variant_id?: string | null }) => `${r.product_id}|${r.variant_id || ''}`;

/** Edit a recorded purchase: the same form as "Record Purchase", filled in. Everything can be changed. */
export const PurchaseEditorModal: React.FC<{
  purchase: Purchase | null; payments: PurchasePayment[]; products: Product[]; suppliers: Supplier[];
  currency: string; userId: string | null; onClose: () => void; onSaved: () => void;
}> = ({ purchase, payments, products, suppliers, currency, userId, onClose, onSaved }) => {
  const { success, error } = useToast();
  const ask = useConfirm();
  const [reference, setReference] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [pays, setPays] = useState<PayRow[]>([]);
  const [importCost, setImportCost] = useState('');
  const [importPaidBy, setImportPaidBy] = useState('');
  const [freight, setFreight] = useState<Freight>(null);
  const [manualTotal, setManualTotal] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!purchase) return;
    setReference(purchase.reference || ''); setSupplierId(purchase.supplier_id || ''); setDate(purchase.purchase_date); setNotes(purchase.notes || '');
    setManualTotal(String(purchase.total_cost ?? ''));
    setRows((purchase.items || []).map((it: any) => ({ product_id: it.product_id, variant_id: it.variant_id || '', quantity: String(it.quantity), unit_cost: String(it.unit_cost) })));
    setPays(payments.filter(x => x.purchase_id === purchase.id).map(x => ({ id: x.id, amount: String(x.amount), date: x.pay_date, paid_by: x.paid_by || '', paid_from: x.paid_from || 'own', method: x.method || 'bank' })));
    const extra = Number((purchase as any).extra_costs || 0);
    setImportCost(extra ? String(extra) : ''); setImportPaidBy(''); setFreight(null);
    // the freight expense that was saved with this purchase
    if (purchase.reference) {
      supabase.from('expenses').select('id,amount,paid_by,paid_from').eq('category', IMPORT_CATEGORY).eq('reference', purchase.reference).limit(1).then(({ data }) => {
        const f = (data || [])[0] as any;
        if (f) { setFreight(f); setImportPaidBy(f.paid_by || ''); if (!extra) setImportCost(String(f.amount)); }
      });
    }
  }, [purchase, payments]);

  if (!purchase) return null;
  const prodOf = (id: string) => products.find(p => p.id === id);
  const hasLines = rows.some(r => r.product_id);
  const total = hasLines ? rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0), 0) : (Number(manualTotal) || 0);
  const extra = Math.max(0, Number(importCost) || 0);
  const paidTotal = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((x, j) => j === i ? { ...x, ...patch } : x));
  const setPay = (i: number, patch: Partial<PayRow>) => setPays(pays.map((x, j) => j === i ? { ...x, ...patch } : x));

  const save = async () => {
    const ref = reference.trim();
    if (!ref) return error('Enter the supplier invoice / order number.');
    const clean = rows.filter(r => r.product_id);
    if (!clean.length && (purchase.items?.length || 0) > 0 && !(await ask({ message: 'Remove every item from this purchase? Their stock will be taken back out.', danger: true, confirmLabel: 'Remove items' }))) return;
    for (const r of clean) {
      if (!(parseInt(r.quantity, 10) > 0)) return error('Every item needs a quantity above 0.');
      if ((prodOf(r.product_id)?.variants?.length || 0) > 0 && !r.variant_id) return error(`Choose the colour for ${prodOf(r.product_id)?.name}.`);
    }
    for (const p of pays) {
      if (!(Number(p.amount) > 0)) return error('Every payment needs an amount above 0 (or remove the row).');
      if (!p.paid_by) return error('Choose which partner made each payment.');
    }
    if (paidTotal > total + 0.009) return error(`The payments add up to more than the purchase total (${formatCurrency(total, currency)}).`);
    if (extra > 0 && !importPaidBy) return error('Choose which partner paid the freight / customs.');

    const oldQ = new Map<string, number>(), newQ = new Map<string, number>();
    for (const it of (purchase.items || []) as any[]) oldQ.set(keyOf(it), (oldQ.get(keyOf(it)) || 0) + it.quantity);
    for (const r of clean) newQ.set(keyOf(r), (newQ.get(keyOf(r)) || 0) + parseInt(r.quantity, 10));

    setSaving(true);
    // check stock first: taking back stock that was already sold would go below zero
    const plan: { pid: string; vid: string; delta: number; cur: number }[] = [];
    for (const k of Array.from(new Set([...oldQ.keys(), ...newQ.keys()]))) {
      const delta = (newQ.get(k) || 0) - (oldQ.get(k) || 0);
      if (!delta) continue;
      const [pid, vid] = k.split('|');
      const q = vid ? await supabase.from('product_variants').select('stock_quantity').eq('id', vid).maybeSingle() : await supabase.from('products').select('stock_quantity').eq('id', pid).maybeSingle();
      const cur = (q.data as any)?.stock_quantity ?? 0;
      if (cur + delta < 0) { setSaving(false); return error(`Not enough ${prodOf(pid)?.name || 'stock'} left to take ${-delta} off — some has already been sold or adjusted.`); }
      plan.push({ pid, vid, delta, cur });
    }

    // 1) the purchase itself
    const { error: pe } = await supabase.from('purchases').update({ reference: ref, supplier_id: supplierId || null, purchase_date: date, notes: notes.trim() || null, total_cost: total, extra_costs: extra }).eq('id', purchase.id);
    if (pe) { setSaving(false); return error(pe.message); }

    // 2) items + stock
    await supabase.from('purchase_items').delete().eq('purchase_id', purchase.id);
    const { error: ie } = clean.length === 0 ? { error: null } : await supabase.from('purchase_items').insert(clean.map(r => ({ purchase_id: purchase.id, product_id: r.product_id, variant_id: r.variant_id || null, quantity: parseInt(r.quantity, 10), unit_cost: Number(r.unit_cost) || 0 })));
    if (ie) error('Items could not be saved: ' + ie.message);
    for (const p of plan) {
      if (p.vid) await supabase.from('product_variants').update({ stock_quantity: p.cur + p.delta }).eq('id', p.vid);
      else await supabase.from('products').update({ stock_quantity: p.cur + p.delta }).eq('id', p.pid);
      await supabase.from('inventory_transactions').insert({ product_id: p.pid, quantity_change: p.delta, reason: 'correction', reference_type: 'purchase', reference_id: purchase.id, notes: `Purchase ${ref} edited`, created_by: userId });
    }

    // 3) payments: remove, update, add
    const keepIds = pays.filter(p => p.id).map(p => p.id!);
    const gone = payments.filter(x => x.purchase_id === purchase.id && !keepIds.includes(x.id));
    if (gone.length) {
      await supabase.from('purchase_payments').delete().in('id', gone.map(g => g.id));
      const files = gone.map(g => g.receipt_path).filter(Boolean) as string[];
      if (files.length) await supabase.storage.from('invoices').remove(files);
    }
    for (const p of pays) {
      const row = { amount: Number(p.amount), pay_date: p.date, paid_by: p.paid_by, paid_from: p.paid_from, method: p.method, reference: ref };
      const { error: xe } = p.id ? await supabase.from('purchase_payments').update(row).eq('id', p.id) : await supabase.from('purchase_payments').insert({ ...row, purchase_id: purchase.id, created_by: userId });
      if (xe) error('A payment could not be saved: ' + xe.message);
    }

    // 4) freight / customs expense
    const freightFrom = importPaidBy === FUND_PAYER ? 'fund'
      : freight && freight.paid_by !== FUND_PAYER ? (freight.paid_from || 'own')
      : (pays[0]?.paid_from && pays[0].paid_from !== 'fund' ? pays[0].paid_from : 'own');
    const fRow = { expense_date: date, category: IMPORT_CATEGORY, description: `Freight/customs for ${ref}`, amount: extra, paid_by: importPaidBy, paid_from: freightFrom, reference: ref };
    if (extra > 0) {
      const { error: fe } = freight
        ? await supabase.from('expenses').update(fRow).eq('id', freight.id)
        : await supabase.from('expenses').insert({ ...fRow, payment_method: pays[0]?.method || 'bank', created_by: userId });
      if (fe) error('The freight expense could not be saved: ' + fe.message);
    } else if (freight) {
      await supabase.from('expenses').delete().eq('id', freight.id);
    }

    setSaving(false); success('Purchase updated'); onSaved();
  };

  return (
    <Modal open onClose={onClose} title={`Edit purchase — ${purchase.reference || ''}`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Invoice / order no. *" hint="Also updated on its payments"><Input value={reference} onChange={e => setReference(e.target.value)} /></Field>
          <Field label="Supplier"><Select value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        </div>

        <div className="space-y-2 sm:overflow-x-auto"><div className="sm:min-w-[520px] space-y-3 sm:space-y-2">
          <div className="hidden sm:grid grid-cols-[1fr_9rem_5.5rem_7rem_2.25rem] gap-2 text-xs font-extrabold uppercase text-ink-400 px-1"><span>Product</span><span>Colour</span><span>Qty</span><span>Unit cost</span><span /></div>
          {rows.map((r, i) => {
            const p = prodOf(r.product_id);
            return (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_9rem_5.5rem_7rem_2.25rem] gap-2 rounded-2xl bg-ink-50/60 p-2 sm:bg-transparent sm:p-0">
                <Select className="col-span-2 sm:col-span-1" aria-label="Product" value={r.product_id} onChange={e => setRow(i, { product_id: e.target.value, variant_id: '' })}>
                  <option value="">Select…</option>{products.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
                {(p?.variants?.length || 0) > 0
                  ? <Select className="col-span-2 sm:col-span-1" aria-label="Colour" value={r.variant_id} onChange={e => setRow(i, { variant_id: e.target.value })}><option value="">Colour…</option>{p!.variants!.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
                  : <span className="hidden sm:block" />}
                <Input type="number" min={1} aria-label="Quantity" placeholder="Qty" value={r.quantity} onChange={e => setRow(i, { quantity: e.target.value })} />
                <Input type="number" step="0.01" aria-label="Unit cost" placeholder="Unit cost" value={r.unit_cost} onChange={e => setRow(i, { unit_cost: e.target.value })} />
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove item" className="col-span-2 sm:col-span-1 justify-self-end rounded-full p-2 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
              </div>
            );
          })}
          {!hasLines && <Field label="Total amount of this purchase" hint="No items are listed for this purchase, so type its total. Or add item rows below to count stock."><Input type="number" min="0" step="0.01" value={manualTotal} onChange={e => setManualTotal(e.target.value)} /></Field>}
          <Button variant="secondary" size="sm" onClick={() => setRows([...rows, { product_id: '', variant_id: '', quantity: '1', unit_cost: '0' }])}><Plus size={14} /> Add Row</Button>
        </div></div>

        <div className="rounded-3xl bg-cream-100 p-4 space-y-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-ink-500">Payments to the supplier</p>
          {pays.length === 0 && <p className="text-xs text-ink-400">No payment recorded yet.</p>}
          {pays.map((p, i) => (
            <div key={p.id || 'new' + i} className="grid grid-cols-2 sm:grid-cols-[7rem_9rem_1fr_1fr_7rem_2.25rem] items-end gap-2 rounded-2xl bg-white/70 p-2">
              <Field label="Amount"><Input type="number" min="0" step="0.01" value={p.amount} onChange={e => setPay(i, { amount: e.target.value })} /></Field>
              <Field label="Date"><Input type="date" value={p.date} onChange={e => setPay(i, { date: e.target.value })} /></Field>
              <Field label="Done by"><Select value={p.paid_by} onChange={e => setPay(i, { paid_by: e.target.value })}><option value="">Select…</option>{PARTNERS.map(x => <option key={x}>{x}</option>)}</Select></Field>
              <PaidFromSelect value={p.paid_from} onChange={v => setPay(i, { paid_from: v })} />
              <Field label="Method"><Select value={p.method} onChange={e => setPay(i, { method: e.target.value })}><option value="bank">Bank</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
              <button type="button" onClick={() => setPays(pays.filter((_, j) => j !== i))} aria-label="Remove payment" className="col-span-2 sm:col-span-1 justify-self-end rounded-full p-2 text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setPays([...pays, { amount: '', date, paid_by: '', paid_from: 'fund', method: 'bank' }])}><Plus size={14} /> Add payment</Button>
          <p className="text-xs font-semibold text-ink-500">Paid {formatCurrency(paidTotal, currency)} of {formatCurrency(total, currency)}. Receipts are attached from the purchase card.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-3xl bg-cream-100 p-4">
          <Field label="Freight + customs for this shipment" hint="Set to 0 or empty to remove"><Input type="number" min="0" step="0.01" value={importCost} onChange={e => setImportCost(e.target.value)} placeholder="0.00" /></Field>
          <Field label="Freight done by"><Select value={importPaidBy} onChange={e => setImportPaidBy(e.target.value)}><option value="">Select…</option>{PARTNERS.map(p => <option key={p}>{p}</option>)}<option value={FUND_PAYER}>Business fund</option></Select></Field>
          <p className="text-xs font-semibold text-ink-500 self-end pb-2">Choose <b>Business fund</b> to pay it out of the fund. Saved as an &ldquo;{IMPORT_CATEGORY}&rdquo; expense. Product average costs are not recalculated when you edit.</p>
        </div>

        <Field label="Notes"><Textarea value={notes} onChange={e => setNotes(e.target.value)} className="min-h-[60px]" /></Field>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-extrabold text-ink-900">Goods: {formatCurrency(total, currency)}{extra > 0 && <span className="ml-2 text-xs font-bold text-ink-500">+ {formatCurrency(extra, currency)} freight = {formatCurrency(total + extra, currency)} landed</span>}</p>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save changes</Button></div>
        </div>
      </div>
    </Modal>
  );
};
