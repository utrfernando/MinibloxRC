import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Phone, Mail, MapPin, User, ShoppingBag, Package } from 'lucide-react';
import { supabase, formatCurrency, type Supplier } from '../../lib/supabase';
import { useAdminSub } from '../../lib/adminRoute';
import { useSettings } from '../../contexts/SettingsContext';
import { useToast } from '../../contexts/ToastContext';
import { AdminHeader } from '../../components/admin/ui';
import { SupplierFormModal } from '../../components/admin/SupplierFormModal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useConfirm } from '../../contexts/ConfirmContext';

type PurchaseRow = { supplier_id: string | null; total_cost: number; amount_paid: number | null };

/** All suppliers: contact details, what you bought and owe, and full edit / delete. URL: /admin/suppliers[/<id>|/new] */
const AdminSuppliers: React.FC = () => {
  const { currency } = useSettings();
  const { success, error } = useToast();
  const ask = useConfirm();
  const navigate = useNavigate();
  const sub = useAdminSub();
  const money = (n: number) => formatCurrency(n, currency);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [productCount, setProductCount] = useState<Record<string, number>>({});
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [s, pc, pu] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('product_costs').select('supplier_id'),
      supabase.from('purchases').select('supplier_id,total_cost,amount_paid'),
    ]);
    setSuppliers((s.data || []) as Supplier[]);
    const m: Record<string, number> = {};
    (pc.data || []).forEach((r: any) => { if (r.supplier_id) m[r.supplier_id] = (m[r.supplier_id] || 0) + 1; });
    setProductCount(m);
    setPurchases((pu.data || []) as PurchaseRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const editing = sub && sub !== 'new' ? suppliers.find(s => s.id === sub) || null : null;
  const open = sub === 'new' || !!editing;
  const close = () => navigate('/admin/suppliers');

  const totals = useMemo(() => {
    const t: Record<string, { n: number; bought: number; paid: number }> = {};
    purchases.forEach(p => { if (!p.supplier_id) return; const r = t[p.supplier_id] || { n: 0, bought: 0, paid: 0 }; r.n++; r.bought += Number(p.total_cost); r.paid += Number(p.amount_paid || 0); t[p.supplier_id] = r; });
    return t;
  }, [purchases]);

  const remove = async (s: Supplier) => {
    const t = totals[s.id]; const prods = productCount[s.id] || 0;
    if ((t?.n || 0) > 0 || prods > 0) return error(`${s.name} has ${prods} product(s) and ${t?.n || 0} purchase(s) linked to it, so it can't be deleted. Edit it instead.`);
    if (!(await ask({ message: `Delete supplier "${s.name}"? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return;
    const { error: e } = await supabase.from('suppliers').delete().eq('id', s.id);
    if (e) error(e.message); else { success('Supplier deleted'); load(); }
  };

  return (
    <div>
      <AdminHeader title="Suppliers" subtitle={`${suppliers.length} supplier(s) — contact details, purchases and what you owe`}
        actions={<Button onClick={() => navigate('/admin/suppliers/new')}><Plus size={16} /> Add Supplier</Button>} />

      {loading ? <p className="text-ink-400">Loading…</p> : suppliers.length === 0 ? (
        <p className="rounded-4xl border border-dashed border-ink-200 bg-white p-10 text-center text-ink-500">No suppliers yet. Press <b>Add Supplier</b>.</p>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {suppliers.map(s => {
            const t = totals[s.id] || { n: 0, bought: 0, paid: 0 };
            const owed = Math.max(0, t.bought - t.paid);
            const noContact = !s.contact_person && !s.phone && !s.email && !s.address;
            const line = (icon: React.ReactNode, v: string | null) => v ? <p className="flex items-start gap-2 text-sm text-ink-600">{icon}<span className="break-words">{v}</span></p> : null;
            return (
              <div key={s.id} className="rounded-4xl border border-ink-100 bg-white p-5 shadow-soft flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg font-extrabold text-ink-900">{s.name}</h3>
                  {owed > 0 ? <Badge color="red">Owed {money(owed)}</Badge> : <Badge color="green">Nothing owed</Badge>}
                </div>
                <div className="mt-3 space-y-1 flex-1">
                  {line(<User size={14} className="mt-0.5 text-ink-400 shrink-0" />, s.contact_person)}
                  {line(<Phone size={14} className="mt-0.5 text-ink-400 shrink-0" />, s.phone)}
                  {line(<Mail size={14} className="mt-0.5 text-ink-400 shrink-0" />, s.email)}
                  {line(<MapPin size={14} className="mt-0.5 text-ink-400 shrink-0" />, s.address)}
                  {noContact && <button onClick={() => navigate(`/admin/suppliers/${s.id}`)} className="text-sm font-bold text-red-500 hover:underline">No contact details — add them</button>}
                  {s.notes && <p className="text-xs text-ink-500 bg-ink-50 rounded-2xl px-3 py-2 mt-2 whitespace-pre-line">{s.notes}</p>}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-2xl bg-ink-50 py-2"><dt className="text-ink-400 font-semibold">Products</dt><dd className="font-extrabold text-ink-900">{productCount[s.id] || 0}</dd></div>
                  <div className="rounded-2xl bg-ink-50 py-2"><dt className="text-ink-400 font-semibold">Bought</dt><dd className="font-extrabold text-ink-900">{money(t.bought)}</dd></div>
                  <div className="rounded-2xl bg-ink-50 py-2"><dt className="text-ink-400 font-semibold">Paid</dt><dd className="font-extrabold text-mint-700">{money(t.paid)}</dd></div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => navigate(`/admin/suppliers/${s.id}`)}><Pencil size={14} /> Edit</Button>
                  <Link to="/admin/inventory/purchases" className="inline-flex items-center gap-1 rounded-full border border-mint-300 px-3 py-1.5 text-xs font-extrabold text-mint-700 hover:bg-mint-50"><ShoppingBag size={13} /> Purchases</Link>
                  <Link to="/admin/finance/suppliers" className="inline-flex items-center gap-1 rounded-full border border-ink-200 px-3 py-1.5 text-xs font-extrabold text-ink-600 hover:bg-ink-50"><Package size={13} /> Payments</Link>
                  <button onClick={() => remove(s)} className="ml-auto p-2 rounded-full hover:bg-red-50 text-red-500" aria-label="Delete supplier"><Trash2 size={15} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SupplierFormModal open={open} supplier={editing} onClose={close} onSaved={() => { close(); load(); }} />
    </div>
  );
};

export default AdminSuppliers;
