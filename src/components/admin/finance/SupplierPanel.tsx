import React, { useState } from 'react';
import { Wallet, History, Trash2 } from 'lucide-react';
import { supabase, formatDate, type Purchase } from '../../../lib/supabase';
import { PARTNERS, type PurchasePayment } from '../../../lib/finance';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { Table, Td } from '../ui';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Input, Select, Field } from '../../ui/Input';
import { Badge } from '../../ui/Badge';

export type PurchasePay = Purchase & { amount_paid?: number | null; last_paid_date?: string | null; extra_costs?: number | null };

export const owedOn = (p: PurchasePay) => Math.max(0, Number(p.total_cost) - Number(p.amount_paid || 0));

export const PaymentBadge: React.FC<{ p: PurchasePay }> = ({ p }) => {
  const owed = owedOn(p);
  if (owed <= 0) return <Badge color="green">Paid</Badge>;
  return Number(p.amount_paid || 0) > 0 ? <Badge color="sunshine">Part paid</Badge> : <Badge color="red">Unpaid</Badge>;
};

/** Record one payment to a supplier: how much, when, and which partner paid it from their own pocket. */
export const PaymentModal: React.FC<{ purchase: PurchasePay | null; money: (n: number) => string; onClose: () => void; onSaved: () => void }> = ({ purchase, money, onClose, onSaved }) => {
  const { success, error } = useToast();
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidBy, setPaidBy] = useState('');
  const [method, setMethod] = useState('bank');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  React.useEffect(() => { if (purchase) { setAmount(String(owedOn(purchase))); setPaidBy(''); setReference(''); } }, [purchase]);
  if (!purchase) return null;
  const owed = owedOn(purchase);

  const save = async () => {
    const a = Number(amount);
    if (!(a > 0)) return error('Enter an amount greater than 0.');
    if (!paidBy) return error('Choose which partner paid this.');
    setSaving(true);
    const { error: e } = await supabase.from('purchase_payments').insert({
      purchase_id: purchase.id, pay_date: date, amount: a, paid_by: paidBy, method, reference: reference || null, created_by: user?.id,
    });
    setSaving(false);
    if (e) return error(/purchase_payments/.test(e.message) ? 'Run migration 0013 in Supabase first (supplier payments table is missing).' : e.message);
    success('Payment recorded'); onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Record supplier payment">
      <p className="text-sm text-ink-600 mb-4"><b>{purchase.supplier?.name || 'Supplier'}</b> · {purchase.reference || 'Purchase'} · total {money(Number(purchase.total_cost))}, still owed <b className="text-red-500">{money(owed)}</b></p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Amount paid now"><Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Payment date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Paid by (from own pocket)"><Select value={paidBy} onChange={e => setPaidBy(e.target.value)}><option value="">Select…</option>{PARTNERS.map(p => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Method"><Select value={method} onChange={e => setMethod(e.target.value)}><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
        <div className="sm:col-span-2"><Field label="Reference (optional)"><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Transfer slip no., Alibaba order no." /></Field></div>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save payment</Button></div>
    </Modal>
  );
};

/** All payments made against one purchase, newest first. A wrong entry can be deleted and re-entered. */
const HistoryModal: React.FC<{ purchase: PurchasePay | null; payments: PurchasePayment[]; money: (n: number) => string; onClose: () => void; onChanged: () => void }> = ({ purchase, payments, money, onClose, onChanged }) => {
  const { error } = useToast();
  if (!purchase) return null;
  const list = payments.filter(p => p.purchase_id === purchase.id).sort((a, b) => b.pay_date.localeCompare(a.pay_date));
  const remove = async (p: PurchasePayment) => {
    if (!confirm(`Delete this ${money(Number(p.amount))} payment? The amount owed will go back up.`)) return;
    const { error: e } = await supabase.from('purchase_payments').delete().eq('id', p.id);
    if (e) error(e.message); else onChanged();
  };
  return (
    <Modal open onClose={onClose} title={`Payments — ${purchase.supplier?.name || 'Supplier'} ${purchase.reference || ''}`}>
      {list.length === 0 ? <p className="text-sm text-ink-400 text-center py-6">No payments recorded yet.</p> : (
        <ul className="divide-y divide-ink-100">
          {list.map(p => (
            <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
              <div className="flex-1">
                <p className="font-bold text-ink-900">{money(Number(p.amount))} <span className="font-semibold text-ink-500">· {p.paid_by || 'payer not recorded'}</span></p>
                <p className="text-xs text-ink-400">{formatDate(p.pay_date)} · {p.method || '—'}{p.reference ? ` · ${p.reference}` : ''}{p.note ? ` · ${p.note}` : ''}</p>
              </div>
              <button onClick={() => remove(p)} className="p-2 rounded-full hover:bg-red-50 text-red-500" aria-label="Delete payment"><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-400 font-semibold mt-3">Total {money(Number(purchase.total_cost))} · paid {money(Number(purchase.amount_paid || 0))} · owed {money(owedOn(purchase))}</p>
    </Modal>
  );
};

/** What you still owe suppliers, and every payment made. */
export const SupplierPanel: React.FC<{ purchases: PurchasePay[]; payments: PurchasePayment[]; money: (n: number) => string; reload: () => void }> = ({ purchases, payments, money, reload }) => {
  const [pay, setPay] = useState<PurchasePay | null>(null);
  const [hist, setHist] = useState<PurchasePay | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  const totalOwed = purchases.reduce((s, p) => s + owedOn(p), 0);
  const bySupplier = new Map<string, number>();
  purchases.forEach(p => { const o = owedOn(p); if (o > 0) bySupplier.set(p.supplier?.name || 'No supplier', (bySupplier.get(p.supplier?.name || 'No supplier') || 0) + o); });
  const rows = showPaid ? purchases : purchases.filter(p => owedOn(p) > 0);

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="rounded-4xl border border-ink-100 bg-white p-5 shadow-soft sm:col-span-1">
          <p className="text-xs font-extrabold uppercase tracking-wide text-ink-400">Total owed to suppliers</p>
          <p className={`font-display text-3xl font-extrabold mt-2 ${totalOwed > 0 ? 'text-red-500' : 'text-mint-700'}`}>{money(totalOwed)}</p>
        </div>
        <div className="rounded-4xl border border-ink-100 bg-white p-5 shadow-soft sm:col-span-2">
          <p className="text-xs font-extrabold uppercase tracking-wide text-ink-400 mb-2">By supplier</p>
          {bySupplier.size === 0 ? <p className="text-sm text-ink-400">Nothing owed. 🎉</p> : [...bySupplier.entries()].map(([n, v]) => (
            <div key={n} className="flex justify-between text-sm py-0.5"><span className="font-bold text-ink-800">{n}</span><span className="font-bold text-red-500">{money(v)}</span></div>
          ))}
        </div>
      </div>
      <div className="rounded-3xl bg-mint-50 border border-mint-200 px-4 py-3 text-xs font-semibold text-ink-700">
        <b>One rule for goods you buy to resell:</b> record the shipment under <b>Inventory → Purchases</b> (it adds the stock, tracks what you owe, and each payment here credits the partner who paid). Only use the "Goods for resale" expense category for items you don't track in stock — never both for the same money.
      </div>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl font-extrabold text-ink-900">Purchases</h3>
        <label className="flex items-center gap-2 text-xs font-bold text-ink-500 cursor-pointer"><input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} className="accent-teal-500" /> Show fully paid</label>
      </div>
      <Table head={['Date', 'Supplier', 'Reference', 'Total', 'Paid', 'Owed', 'Status', '']}>
        {rows.length === 0 ? <tr><Td className="text-center py-8 text-ink-400">No outstanding purchases.</Td></tr> : rows.map(p => (
          <tr key={p.id} className="hover:bg-ink-50/50">
            <Td className="text-xs text-ink-500">{formatDate(p.purchase_date)}</Td>
            <Td className="font-bold text-ink-800">{p.supplier?.name || '—'}</Td>
            <Td className="text-ink-600">{p.reference || '—'}</Td>
            <Td>{money(Number(p.total_cost))}{Number(p.extra_costs) > 0 && <span className="block text-[11px] text-ink-400">+ {money(Number(p.extra_costs))} freight/customs</span>}</Td>
            <Td>{money(Number(p.amount_paid || 0))}{p.last_paid_date && <span className="block text-[11px] text-ink-400">{formatDate(p.last_paid_date)}</span>}</Td>
            <Td className="font-bold text-red-500">{money(owedOn(p))}</Td>
            <Td><PaymentBadge p={p} /></Td>
            <Td>
              <div className="flex gap-1">
                {owedOn(p) > 0 && <Button size="sm" variant="secondary" onClick={() => setPay(p)}><Wallet size={14} /> Pay</Button>}
                <Button size="sm" variant="ghost" onClick={() => setHist(p)}><History size={14} /> {payments.filter(x => x.purchase_id === p.id).length}</Button>
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      <PaymentModal purchase={pay} money={money} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload(); }} />
      <HistoryModal purchase={hist ? purchases.find(p => p.id === hist.id) || hist : null} payments={payments} money={money} onClose={() => setHist(null)} onChanged={reload} />
    </div>
  );
};
