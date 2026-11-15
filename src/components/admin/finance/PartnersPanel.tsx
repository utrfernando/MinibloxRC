import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, ArrowDownToLine, ArrowUpFromLine, AlertTriangle } from 'lucide-react';
import { supabase, formatDate, uploadInvoice } from '../../../lib/supabase';
import { InvoiceControl } from '../InvoiceControl';
import { Paperclip } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PARTNERS, computeFund, fromFund, type Expense, type PartnerTx, type PurchasePayment, type Refund } from '../../../lib/finance';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { Table, Td } from '../ui';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Input, Select, Field } from '../../ui/Input';
import { useConfirm } from '../../../contexts/ConfirmContext';

const blank = { tx_date: new Date().toISOString().slice(0, 10), partner: '', kind: 'contribution', amount: '', note: '' };

type Props = {
  txs: PartnerTx[]; expenses: Expense[]; supplierPayments: PurchasePayment[]; refunds: Refund[];
  salesHeld: { byPartner: Record<string, number>; unassignedCount: number; unassignedAmount: number };
  money: (n: number) => string; reload: () => void;
};

/**
 * Each partner's money position. All figures are all-time.
 *   put in   = cash contributions + business expenses they paid + supplier payments they made + refunds they paid
 *   held     = customer money they received on the business's behalf (set on each order)
 *   taken out= withdrawals
 *   balance  = put in − taken out − held   (positive: the business owes them · negative: they hold business money)
 */
export const PartnersPanel: React.FC<Props> = ({ txs, expenses, supplierPayments, refunds, salesHeld, money, reload }) => {
  const { success, error } = useToast();
  const ask = useConfirm();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const openNew = () => { setEditId(null); setForm(blank); setFile(null); setOpen(true); };
  const [sp, setSp] = useSearchParams();
  // "+ New → Deposit / withdrawal" arrives as ?new=entry
  useEffect(() => { if (sp.get('new') === 'entry') { openNew(); sp.delete('new'); setSp(sp, { replace: true }); } }, [sp]);
  const openEdit = (t: PartnerTx) => {
    setEditId(t.id); setFile(null);
    setForm({ tx_date: t.tx_date, partner: t.partner, kind: t.kind, amount: String(t.amount), note: t.note || '' });
    setOpen(true);
  };

  const stats = useMemo(() => PARTNERS.map(p => {
    const contributed = txs.filter(t => t.partner === p && t.kind === 'contribution').reduce((s, t) => s + Number(t.amount), 0);
    const withdrawn = txs.filter(t => t.partner === p && t.kind === 'withdrawal').reduce((s, t) => s + Number(t.amount), 0);
    // only payments made from the partner's OWN pocket count as their investment; fund payments come out of the deposits
    const spent = expenses.filter(e => e.paid_by === p && !fromFund(e)).reduce((s, e) => s + Number(e.amount), 0);
    const suppliers = supplierPayments.filter(x => x.paid_by === p && !fromFund(x)).reduce((s, x) => s + Number(x.amount), 0);
    const refunded = refunds.filter(r => r.refunded_by === p && !fromFund(r)).reduce((s, r) => s + Number(r.amount), 0);
    const handled = expenses.filter(e => e.paid_by === p && fromFund(e)).reduce((s, e) => s + Number(e.amount), 0)
      + supplierPayments.filter(x => x.paid_by === p && fromFund(x)).reduce((s, x) => s + Number(x.amount), 0)
      + refunds.filter(r => r.refunded_by === p && fromFund(r)).reduce((s, r) => s + Number(r.amount), 0);
    const held = salesHeld.byPartner[p] || 0;
    const putIn = contributed + spent + suppliers + refunded;
    return { p, contributed, withdrawn, spent, suppliers, refunded, handled, held, putIn, net: putIn - withdrawn, balance: putIn - withdrawn - held };
  }), [txs, expenses, supplierPayments, refunds, salesHeld]);
  const fund = useMemo(() => computeFund(txs, expenses, supplierPayments, refunds), [txs, expenses, supplierPayments, refunds]);
  const totalNet = stats.reduce((s, x) => s + Math.max(0, x.net), 0);

  const missingPayer = expenses.filter(e => !e.paid_by).length + supplierPayments.filter(x => !x.paid_by).length + refunds.filter(r => !r.refunded_by).length;

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.partner) return error('Choose the partner.');
    if (!(amount > 0)) return error('Enter an amount greater than 0.');
    setSaving(true);
    if (editId) {
      const { error: e } = await supabase.from('partner_transactions').update({ tx_date: form.tx_date, partner: form.partner, kind: form.kind, amount, note: form.note || null }).eq('id', editId);
      setSaving(false);
      if (e) return error(e.message);
      success('Entry updated'); setOpen(false); setForm(blank); setEditId(null); reload();
      return;
    }
    let receipt: Record<string, string> = {};
    try { if (file) { const up = await uploadInvoice(file, 'deposits'); receipt = { receipt_path: up.path, receipt_name: up.name }; } }
    catch (err: any) { setSaving(false); return error(err.message || 'Receipt upload failed'); }
    const { error: e } = await supabase.from('partner_transactions').insert({ ...form, amount, note: form.note || null, created_by: user?.id, ...receipt });
    setSaving(false);
    if (e) return error(/receipt_/.test(e.message) ? 'Run migration 0017 in Supabase first (receipt columns are missing).' : e.message);
    success('Recorded'); setOpen(false); setForm(blank); setFile(null); reload();
  };
  const remove = async (t: PartnerTx) => {
    if (!(await ask({ message: `Delete this ${money(Number(t.amount))} ${t.kind}?`, danger: true, confirmLabel: 'Delete' }))) return;
    const { error: e } = await supabase.from('partner_transactions').delete().eq('id', t.id);
    if (e) error(e.message); else { if (t.receipt_path) await supabase.storage.from('invoices').remove([t.receipt_path]); reload(); }
  };

  const row = (label: string, value: string, tone = 'text-ink-900') => (
    <div className="flex justify-between"><dt className="text-ink-500">{label}</dt><dd className={`font-bold ${tone}`}>{value}</dd></div>
  );

  return (
    <div className="space-y-6">
      {(missingPayer > 0 || salesHeld.unassignedCount > 0) && (
        <div className="rounded-3xl bg-sunshine-50 border border-sunshine-200 p-4 text-sm text-ink-800 flex gap-3">
          <AlertTriangle className="shrink-0 text-sunshine-600" size={18} />
          <div className="space-y-1">
            {missingPayer > 0 && <p><b>{missingPayer}</b> expense/payment/refund entr{missingPayer === 1 ? 'y has' : 'ies have'} no partner chosen, so nobody is credited for {missingPayer === 1 ? 'it' : 'them'}.</p>}
            {salesHeld.unassignedCount > 0 && <p><b>{salesHeld.unassignedCount}</b> paid order(s) worth <b>{money(salesHeld.unassignedAmount)}</b> have no "money received by" set — open the order and choose who received the money.</p>}
          </div>
        </div>
      )}

      <div className={`rounded-4xl border-2 p-5 shadow-soft ${fund.balance >= 0 ? 'border-mint-200 bg-mint-50' : 'border-red-200 bg-red-50'}`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide text-ink-500">Business fund — money available for expenses</p>
            <p className={`font-display text-3xl font-extrabold ${fund.balance >= 0 ? 'text-mint-700' : 'text-red-500'}`}>{money(fund.balance)}</p>
          </div>
          <dl className="grid grid-cols-3 gap-4 text-center text-xs">
            <div><dt className="font-semibold text-ink-500">Deposited</dt><dd className="font-extrabold text-ink-900">{money(fund.deposits)}</dd></div>
            <div><dt className="font-semibold text-ink-500">Paid out</dt><dd className="font-extrabold text-ink-900">−{money(fund.spent)}</dd></div>
            <div><dt className="font-semibold text-ink-500">Withdrawn</dt><dd className="font-extrabold text-ink-900">−{money(fund.withdrawals)}</dd></div>
          </dl>
        </div>
        <p className="mt-2 text-xs font-semibold text-ink-500">{fund.balance < 0 ? 'The fund has paid out more than was deposited — add a deposit below (or mark those payments as "Own pocket").' : 'How it works: a partner deposits money here (Add entry → Put money in). Expenses, supplier payments and refunds are then paid from the fund. The partner who makes each payment is recorded, but it is not counted as their own money.'}</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {stats.map(s => (
          <div key={s.p} className="rounded-4xl border border-ink-100 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-xl font-extrabold text-ink-900">{s.p}</h3>
              <span className="rounded-full bg-lavender-50 text-lavender-600 px-3 py-1 text-xs font-extrabold">{totalNet > 0 ? Math.round((Math.max(0, s.net) / totalNet) * 100) : 0}% of money invested</span>
            </div>
            <dl className="space-y-1.5 text-sm">
              {row('Deposited into the fund (contributions)', money(s.contributed))}
              {row('Expenses paid from own pocket', money(s.spent))}
              {row('Supplier payments from own pocket', money(s.suppliers))}
              {row('Refunds from own pocket', money(s.refunded))}
              {row('Taken out (withdrawals)', `−${money(s.withdrawn)}`, 'text-red-500')}
              {s.handled > 0 && <p className="text-[11px] font-semibold text-ink-400">Also handled {money(s.handled)} of payments from the business fund (not counted as their money).</p>}
              <div className="flex justify-between border-t border-ink-100 pt-2 mt-2"><dt className="font-extrabold text-ink-800">Net invested</dt><dd className="font-extrabold text-mint-700">{money(s.net)}</dd></div>
              {row('Customer money they hold for the business', `−${money(s.held)}`, 'text-red-500')}
              <div className="flex justify-between border-t border-ink-100 pt-2 mt-2">
                <dt className="font-extrabold text-ink-800">{s.balance >= 0 ? 'Business owes them' : 'They hold business money'}</dt>
                <dd className={`font-extrabold ${s.balance >= 0 ? 'text-mint-700' : 'text-sunshine-700'}`}>{money(Math.abs(s.balance))}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-400 font-semibold -mt-3">
        Net invested = money they put in − what they took out. "Customer money held" comes from the <i>Money received by</i> field on each paid order. When you pay a partner back or share profit, record it below as a withdrawal; the balance then goes down.
      </p>

      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl font-extrabold text-ink-900">Contributions & withdrawals</h3>
        <Button onClick={openNew}><Plus size={16} /> Add entry</Button>
      </div>
      <Table head={['Date', 'Partner', 'Type', 'Note', 'Receipt', 'Amount', '']}>
        {txs.length === 0 ? <tr><Td className="text-center py-8 text-ink-400">No entries yet.</Td></tr> : txs.map(t => (
          <tr key={t.id} className="hover:bg-ink-50/50">
            <Td className="text-xs text-ink-500">{formatDate(t.tx_date)}</Td>
            <Td className="font-bold text-ink-800">{t.partner}</Td>
            <Td>{t.kind === 'contribution'
              ? <span className="inline-flex items-center gap-1 text-xs font-extrabold text-mint-700"><ArrowDownToLine size={13} /> Put in</span>
              : <span className="inline-flex items-center gap-1 text-xs font-extrabold text-red-500"><ArrowUpFromLine size={13} /> Taken out</span>}</Td>
            <Td className="text-ink-600">{t.note || '—'}</Td>
            <Td><InvoiceControl table="partner_transactions" id={t.id} path={t.receipt_path} name={t.receipt_name} onChanged={reload} /></Td>
            <Td className="font-bold text-ink-900">{money(Number(t.amount))}</Td>
            <Td><div className="flex"><button onClick={() => openEdit(t)} className="p-2 rounded-full hover:bg-ink-100 text-ink-500" aria-label="Edit"><Pencil size={15} /></button><button onClick={() => remove(t)} className="p-2 rounded-full hover:bg-red-50 text-red-500" aria-label="Delete"><Trash2 size={15} /></button></div></Td>
          </tr>
        ))}
      </Table>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Edit partner entry' : 'Add partner entry'}>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Date"><Input type="date" value={form.tx_date} onChange={e => setForm({ ...form, tx_date: e.target.value })} /></Field>
          <Field label="Amount"><Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Partner"><Select value={form.partner} onChange={e => setForm({ ...form, partner: e.target.value })}><option value="">Select…</option>{PARTNERS.map(p => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="Type"><Select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="contribution">Put money in (contribution)</option><option value="withdrawal">Took money out / paid back / profit share</option></Select></Field>
          {!editId && (<div className="sm:col-span-2"><Field label="Receipt / bank slip (optional)">
            <label className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 px-4 py-3 text-sm cursor-pointer hover:border-mint-400">
              <Paperclip size={16} className="text-mint-600" /><span className="font-semibold text-ink-700 truncate">{file ? file.name : 'Photo or PDF of the transfer slip (max 15 MB)'}</span>
              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => setFile(e.target.files?.[0] || null)} />
            </label></Field></div>)}
          <div className="sm:col-span-2"><Field label="Note"><Input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="e.g. Paid Davide back for stock, profit share for March" /></Field></div>
        </div>
        <p className="mt-3 text-xs font-semibold text-ink-500">Don't add a contribution for money a partner already paid straight to a supplier or for an expense — that is counted automatically.</p>
        <div className="flex justify-end gap-2 mt-5"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} onClick={save}>{editId ? 'Save changes' : 'Save'}</Button></div>
      </Modal>
    </div>
  );
};
