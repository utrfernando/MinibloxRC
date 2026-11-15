import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { EditPurchaseModal } from '../EditPurchaseModal';
import { Wallet, History, Trash2, Pencil, Phone, Mail, MapPin, User } from 'lucide-react';
import { supabase, formatDate, uploadInvoice, type Purchase, type Supplier } from '../../../lib/supabase';
import { InvoiceControl } from '../InvoiceControl';
import { PARTNERS, type PurchasePayment } from '../../../lib/finance';
import { PaidFromSelect } from './PaidFromSelect';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { Table, Td } from '../ui';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Input, Select, Field } from '../../ui/Input';
import { Badge } from '../../ui/Badge';
import { useConfirm } from '../../../contexts/ConfirmContext';

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
  const [paidFrom, setPaidFrom] = useState('fund');
  const [method, setMethod] = useState('bank');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  React.useEffect(() => { if (purchase) { setFile(null); setAmount(String(owedOn(purchase))); setPaidBy(''); setReference(purchase.reference || ''); } }, [purchase]);
  if (!purchase) return null;
  const owed = owedOn(purchase);

  const save = async () => {
    const a = Number(amount);
    if (!(a > 0)) return error('Enter an amount greater than 0.');
    if (!paidBy) return error('Choose which partner paid this.');
    setSaving(true);
    let receipt: Record<string, string> = {};
    try { if (file) { const up = await uploadInvoice(file, 'payments'); receipt = { receipt_path: up.path, receipt_name: up.name }; } }
    catch (err: any) { setSaving(false); return error(err.message || 'Receipt upload failed'); }
    const { error: e } = await supabase.from('purchase_payments').insert({
      purchase_id: purchase.id, pay_date: date, amount: a, paid_by: paidBy, paid_from: paidFrom, method, reference: reference || null, created_by: user?.id, ...receipt,
    });
    setSaving(false);
    if (e) return error(/receipt_/.test(e.message) ? 'Run migration 0017 in Supabase first (receipt columns are missing).' : /purchase_payments/.test(e.message) ? 'Run migration 0013 in Supabase first (supplier payments table is missing).' : e.message);
    success('Payment recorded'); onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Record supplier payment">
      <p className="text-sm text-ink-600 mb-4"><b>{purchase.supplier?.name || 'Supplier'}</b> · {purchase.reference || 'Purchase'} · total {money(Number(purchase.total_cost))}, still owed <b className="text-red-500">{money(owed)}</b></p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Amount paid now"><Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Payment date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Field label="Done by (who made the payment)"><Select value={paidBy} onChange={e => setPaidBy(e.target.value)}><option value="">Select…</option>{PARTNERS.map(p => <option key={p}>{p}</option>)}</Select></Field>
        <PaidFromSelect value={paidFrom} onChange={setPaidFrom} />
        <Field label="Method"><Select value={method} onChange={e => setMethod(e.target.value)}><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
        <div className="sm:col-span-2"><Field label="Payment receipt / slip (optional)">
          <label className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 px-4 py-3 text-sm cursor-pointer hover:border-mint-400">
            <span className="font-semibold text-ink-700 truncate">{file ? file.name : '📎 Screenshot or PDF of the payment (max 15 MB)'}</span>
            <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => setFile(e.target.files?.[0] || null)} />
          </label></Field></div>
        <div className="sm:col-span-2"><Field label="Invoice / order no." hint="Filled in from the purchase; change it if this payment has its own slip number"><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Invoice no., transfer slip no." /></Field></div>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save payment</Button></div>
    </Modal>
  );
};

/** Fix a payment that was entered wrongly: amount, date, who made it, where the money came from, method, reference. */
const EditPaymentModal: React.FC<{ payment: PurchasePayment | null; onClose: () => void; onSaved: () => void }> = ({ payment, onClose, onSaved }) => {
  const { success, error } = useToast();
  const [f, setF] = useState({ amount: '', date: '', paidBy: '', paidFrom: 'fund', method: 'bank', reference: '' });
  const [saving, setSaving] = useState(false);
  React.useEffect(() => {
    if (payment) setF({ amount: String(payment.amount), date: payment.pay_date, paidBy: payment.paid_by || '', paidFrom: payment.paid_from || 'own', method: payment.method || 'bank', reference: payment.reference || '' });
  }, [payment]);
  if (!payment) return null;
  const save = async () => {
    const a = Number(f.amount);
    if (!(a > 0)) return error('Enter an amount greater than 0.');
    if (!f.paidBy) return error('Choose which partner made this payment.');
    setSaving(true);
    const { error: e } = await supabase.from('purchase_payments').update({ amount: a, pay_date: f.date, paid_by: f.paidBy, paid_from: f.paidFrom, method: f.method, reference: f.reference.trim() || null }).eq('id', payment.id);
    setSaving(false);
    if (e) return error(e.message);
    success('Payment updated'); onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Edit payment">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Amount"><Input type="number" min="0" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Done by (who made the payment)"><Select value={f.paidBy} onChange={e => setF({ ...f, paidBy: e.target.value })}><option value="">Select…</option>{PARTNERS.map(p => <option key={p}>{p}</option>)}</Select></Field>
        <PaidFromSelect value={f.paidFrom} onChange={v => setF({ ...f, paidFrom: v })} />
        <Field label="Method"><Select value={f.method} onChange={e => setF({ ...f, method: e.target.value })}><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></Select></Field>
        <Field label="Invoice / slip no."><Input value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-5"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save changes</Button></div>
    </Modal>
  );
};

/** All payments made against one purchase, newest first. A wrong entry can be deleted and re-entered. */
const HistoryModal: React.FC<{ purchase: PurchasePay | null; payments: PurchasePayment[]; money: (n: number) => string; onClose: () => void; onChanged: () => void }> = ({ purchase, payments, money, onClose, onChanged }) => {
  const { error } = useToast();
  const ask = useConfirm();
  const [editing, setEditing] = useState<PurchasePayment | null>(null);
  if (!purchase) return null;
  const list = payments.filter(p => p.purchase_id === purchase.id).sort((a, b) => b.pay_date.localeCompare(a.pay_date));
  const remove = async (p: PurchasePayment) => {
    if (!(await ask({ message: `Delete this ${money(Number(p.amount))} payment? The amount owed will go back up.`, danger: true, confirmLabel: 'Delete' }))) return;
    const { error: e } = await supabase.from('purchase_payments').delete().eq('id', p.id);
    if (e) error(e.message); else { if (p.receipt_path) await supabase.storage.from('invoices').remove([p.receipt_path]); onChanged(); }
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
              <InvoiceControl table="purchase_payments" id={p.id} path={p.receipt_path} name={p.receipt_name} onChanged={onChanged} />
              <button onClick={() => setEditing(p)} className="p-2 rounded-full hover:bg-ink-100 text-ink-500" aria-label="Edit payment"><Pencil size={15} /></button>
              <button onClick={() => remove(p)} className="p-2 rounded-full hover:bg-red-50 text-red-500" aria-label="Delete payment"><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}
      <EditPaymentModal payment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
      <p className="text-xs text-ink-400 font-semibold mt-3">Total {money(Number(purchase.total_cost))} · paid {money(Number(purchase.amount_paid || 0))} · owed {money(owedOn(purchase))}</p>
    </Modal>
  );
};

/** What you still owe suppliers, and every payment made. */
export const SupplierPanel: React.FC<{
  purchases: PurchasePay[]; payments: PurchasePayment[]; suppliers: Supplier[]; productCounts: Record<string, number>; goodsExpenseTotal: number;
  money: (n: number) => string; reload: () => void;
}> = ({ purchases, payments, suppliers, productCounts, goodsExpenseTotal, money, reload }) => {
  const [pay, setPay] = useState<PurchasePay | null>(null);
  const [hist, setHist] = useState<PurchasePay | null>(null);
  const [edit, setEdit] = useState<PurchasePay | null>(null);
  const [showPaid, setShowPaid] = useState(true);
  const totalOwed = purchases.reduce((s, p) => s + owedOn(p), 0);
  const bySupplier = new Map<string, number>();
  purchases.forEach(p => { const o = owedOn(p); if (o > 0) bySupplier.set(p.supplier?.name || 'No supplier', (bySupplier.get(p.supplier?.name || 'No supplier') || 0) + o); });
  const rows = showPaid ? purchases : purchases.filter(p => owedOn(p) > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl font-extrabold text-ink-900">Your suppliers</h3>
        <Link to="/admin/suppliers" className="text-xs font-extrabold text-mint-700 hover:underline">Manage suppliers →</Link>
      </div>
      {suppliers.length === 0 ? (
        <p className="rounded-4xl border border-dashed border-ink-200 bg-white p-6 text-sm text-ink-500 text-center">No suppliers yet. Add them under Inventory &amp; Suppliers.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {suppliers.map(sp => {
            const mine = purchases.filter(p => p.supplier_id === sp.id);
            const bought = mine.reduce((s, p) => s + Number(p.total_cost), 0);
            const paid = mine.reduce((s, p) => s + Number(p.amount_paid || 0), 0);
            const owed = mine.reduce((s, p) => s + owedOn(p), 0);
            const hasContact = sp.contact_person || sp.phone || sp.email || sp.address;
            const line = (icon: React.ReactNode, v: string | null) => v ? <p className="flex items-center gap-2 text-xs text-ink-600">{icon}<span className="break-words">{v}</span></p> : null;
            return (
              <div key={sp.id} className="rounded-4xl border border-ink-100 bg-white p-5 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-display text-lg font-extrabold text-ink-900">{sp.name}</h4>
                    <p className="text-xs font-semibold text-ink-400">{productCounts[sp.id] || 0} product(s) supplied · {mine.length} purchase(s) recorded</p>
                  </div>
                  {owed > 0 ? <Badge color="red">Owed {money(owed)}</Badge> : <Badge color="green">Nothing owed</Badge>}
                </div>
                <Link to={`/admin/suppliers/${sp.id}`} className="mt-1 inline-block text-xs font-extrabold text-mint-700 hover:underline">Edit supplier details →</Link>
                <div className="mt-3 space-y-1">
                  {line(<User size={13} className="text-ink-400" />, sp.contact_person)}
                  {line(<Phone size={13} className="text-ink-400" />, sp.phone)}
                  {line(<Mail size={13} className="text-ink-400" />, sp.email)}
                  {line(<MapPin size={13} className="text-ink-400" />, sp.address)}
                  {!hasContact && <p className="text-xs italic text-ink-400">No contact details yet — add them under Inventory &amp; Suppliers.</p>}
                  {sp.notes && <p className="text-xs text-ink-500 mt-1">{sp.notes}</p>}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-2xl bg-ink-50 py-2"><dt className="text-ink-400 font-semibold">Bought</dt><dd className="font-extrabold text-ink-900">{money(bought)}</dd></div>
                  <div className="rounded-2xl bg-ink-50 py-2"><dt className="text-ink-400 font-semibold">Paid</dt><dd className="font-extrabold text-mint-700">{money(paid)}</dd></div>
                  <div className="rounded-2xl bg-ink-50 py-2"><dt className="text-ink-400 font-semibold">Owed</dt><dd className={`font-extrabold ${owed > 0 ? 'text-red-500' : 'text-ink-900'}`}>{money(owed)}</dd></div>
                </dl>
              </div>
            );
          })}
        </div>
      )}
      {goodsExpenseTotal > 0 && (
        <div className="rounded-3xl bg-sunshine-50 border border-sunshine-200 px-4 py-3 text-xs font-semibold text-ink-700">
          <b>{money(goodsExpenseTotal)}</b> of goods for resale was entered as <i>expenses</i> (not as purchases), so it can't be matched to a supplier here. That's fine for money already spent. New shipments recorded under Inventory → Purchases will appear in the figures above.
        </div>
      )}
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
      <Table head={['Date', 'Supplier', 'Invoice no.', 'Total', 'Paid', 'Owed', 'Status', '']}>
        {rows.length === 0 ? <tr><Td className="text-center py-8 text-ink-400">No outstanding purchases.</Td></tr> : rows.map(p => (
          <tr key={p.id} className="hover:bg-ink-50/50">
            <Td className="text-xs text-ink-500">{formatDate(p.purchase_date)}</Td>
            <Td className="font-bold text-ink-800">{p.supplier?.name || '—'}</Td>
            <Td className="text-ink-600">{p.reference || <button onClick={() => setEdit(p)} className="text-xs font-bold text-red-500 hover:underline">add invoice no.</button>}{p.reference && <button onClick={() => setEdit(p)} className="ml-1 text-[11px] text-ink-400 hover:text-mint-700" aria-label="Edit invoice no.">✎</button>}</Td>
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
      <EditPurchaseModal purchase={edit} suppliers={suppliers} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      <PaymentModal purchase={pay} money={money} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload(); }} />
      <HistoryModal purchase={hist ? purchases.find(p => p.id === hist.id) || hist : null} payments={payments} money={money} onClose={() => setHist(null)} onChanged={reload} />
    </div>
  );
};
