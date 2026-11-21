import React, { useEffect, useMemo, useState } from 'react';
import { Search, Eye, CheckCircle2, Printer, MessageCircle } from 'lucide-react';
import { printOrderInvoice, whatsappLink, PARTNERS, type Refund } from '../../lib/finance';
import { InvoiceControl } from '../../components/admin/InvoiceControl';
import { useNavigate } from 'react-router-dom';
import { useAdminSub } from '../../lib/adminRoute';
import { supabase, openReceipt, formatCurrency, formatDate, ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, type Order, type OrderStatus } from '../../lib/supabase';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { AdminHeader, Table, Td } from '../../components/admin/ui';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { useConfirm } from '../../contexts/ConfirmContext';

const STATUS_OPTIONS: OrderStatus[] = ['pending','confirmed','processing','packed','shipped','delivered','cancelled','returned'];

const AdminOrders: React.FC = () => {
  const { currency } = useSettings();
  const { authUserId } = useAuth();
  const { success, error } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<Order | null>(null);
  const navigate = useNavigate();
  const orderId = useAdminSub();            // /admin/orders/<order id>
  const closeOrder = () => navigate('/admin/orders');

  const load = async () => {
    setLoading(true);
    let query = supabase.from('orders').select('*, items:order_items(*), payments:payments(*)').order('placed_at', { ascending: false });
    if (statusFilter) query = query.eq('status', statusFilter);
    if (from) query = query.gte('placed_at', from);
    if (to) query = query.lte('placed_at', to + 'T23:59:59');
    const { data } = await query;
    const list = (data || []) as Order[];
    const ids = [...new Set(list.map(o => o.user_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id,full_name,email,phone').in('id', ids);
      const map = new Map((profs || []).map((p: any) => [p.id, p]));
      list.forEach(o => { (o as any).user = o.user_id ? map.get(o.user_id) : null; });
    }
    setOrders(list);
    setLoading(false);
  };
  useEffect(() => { load(); }, [statusFilter, from, to]);

  const filtered = useMemo(() => {
    if (!q) return orders;
    const s = q.toLowerCase();
    return orders.filter(o => o.order_number.toLowerCase().includes(s) || o.customer_name.toLowerCase().includes(s) || o.phone.includes(s) || o.email.toLowerCase().includes(s));
  }, [orders, q]);

  const openOrder = (o: Order) => navigate(`/admin/orders/${o.id}`);
  useEffect(() => {
    if (!orderId) { setSelected(null); return; }
    supabase.from('orders').select('*, items:order_items(*), payments:payments(*)').eq('id', orderId).maybeSingle()
      .then(({ data }) => setSelected((data as Order) || null));
  }, [orderId]);

  const updateStatus = async (o: Order, status: OrderStatus) => {
    const patch: any = { status };
    if (status === 'confirmed') patch.confirmed_at = new Date().toISOString();
    if (status === 'delivered') patch.delivered_at = new Date().toISOString();
    const { error: e } = await supabase.from('orders').update(patch).eq('id', o.id);
    if (e) { error(e.message); return; }

    // restock on cancel/return
    if ((status === 'cancelled' || status === 'returned') && o.items?.length) {
      for (const item of o.items) {
        if (!item.product_id) continue;
        if (item.variant_id) {
          const { data: v } = await supabase.from('product_variants').select('stock_quantity').eq('id', item.variant_id).maybeSingle();
          if (v) {
            await supabase.from('product_variants').update({ stock_quantity: v.stock_quantity + item.quantity }).eq('id', item.variant_id);
            await supabase.from('inventory_transactions').insert({ product_id: item.product_id, quantity_change: item.quantity, reason: 'return', reference_type: 'order', reference_id: o.id, notes: `Order ${o.order_number} ${status} (${item.variant_name || 'colour'})`, created_by: authUserId });
            continue;
          }
        }
        const { data: prod } = await supabase.from('products').select('stock_quantity').eq('id', item.product_id).single();
        if (prod) {
          await supabase.from('products').update({ stock_quantity: prod.stock_quantity + item.quantity }).eq('id', item.product_id);
          await supabase.from('inventory_transactions').insert({ product_id: item.product_id, quantity_change: item.quantity, reason: status === 'cancelled' ? 'return' : 'return', reference_type: 'order', reference_id: o.id, notes: `Order ${o.order_number} ${status}`, created_by: authUserId });
        }
      }
    }
    success(`Order marked ${ORDER_STATUS_LABELS[status]}`);
    closeOrder(); load();
  };

  const verifyPayment = async (o: Order) => {
    const payment = o.payments?.[0];
    if (!payment) return;
    const { error: e } = await supabase.from('payments').update({ status: 'paid', verified_by: authUserId, verified_at: new Date().toISOString(), paid_at: new Date().toISOString() }).eq('id', payment.id);
    if (!e) {
      await supabase.from('orders').update({ payment_status: 'paid' }).eq('id', o.id);
      success('Payment verified'); closeOrder(); load();
    } else error(e.message);
  };

  // Cash on delivery has no slip to verify: mark it paid when the cash is in hand (or undo a mistake).
  const setPaid = async (o: Order, paid: boolean) => {
    const now = new Date().toISOString();
    const { error: e } = await supabase.from('orders').update({ payment_status: paid ? 'paid' : 'pending' }).eq('id', o.id);
    if (e) { error(e.message); return; }
    const payment = o.payments?.[0];
    if (payment) await supabase.from('payments').update(paid ? { status: 'paid', paid_at: now, verified_by: authUserId, verified_at: now } : { status: 'pending', paid_at: null }).eq('id', payment.id);
    success(paid ? 'Marked as paid' : 'Marked as not paid'); closeOrder(); load();
  };

  return (
    <div>
      <AdminHeader title="Orders" subtitle={`${filtered.length} order(s)`} />

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search order #, name, phone, email…" className="!pl-10" />
        </div>
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="!w-44">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
        </Select>
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="!w-40" title="From date" />
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="!w-40" title="To date" />
      </div>

      {/* phones: one card per order */}
      <div className="md:hidden space-y-3">
        {loading ? <p className="py-8 text-center text-ink-400">Loading…</p> : filtered.length === 0 ? <p className="py-8 text-center text-ink-400">No orders found</p> : filtered.map(o => (
          <button key={o.id} onClick={() => openOrder(o)} className="block w-full rounded-3xl border border-ink-100 bg-white p-4 text-left shadow-soft active:bg-ink-50">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-extrabold text-ink-900">{o.order_number}</p>
                <p className="text-xs font-semibold text-ink-400">{formatDate(o.placed_at)} · {o.payment_method === 'cod' ? 'Cash on delivery' : 'Bank transfer'}</p>
              </div>
              <p className="font-extrabold text-ink-900">{formatCurrency(Number(o.total_amount), currency)}</p>
            </div>
            <p className="mt-1.5 text-sm text-ink-700">{o.customer_name} · {o.phone} · {o.items?.length || 0} item(s)</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className={ORDER_STATUS_STYLES[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
              <Badge color={o.payment_status === 'paid' ? 'green' : o.payment_status === 'pending' ? 'sunshine' : 'red'}>{o.payment_status}</Badge>
              <span className="ml-auto text-xs font-extrabold text-mint-700">Open →</span>
            </div>
          </button>
        ))}
      </div>
      <div className="hidden md:block">
      <Table head={['Order', 'Customer', 'Items', 'Total', 'Payment', 'Status', 'Placed', '']}>
        {loading ? <tr><Td className="text-center py-8 text-ink-400">Loading…</Td></tr> :
        filtered.length === 0 ? <tr><Td className="text-center py-8 text-ink-400">No orders found</Td></tr> :
        filtered.map(o => (
          <tr key={o.id} className="hover:bg-ink-50/50">
            <Td><p className="font-bold text-ink-900">{o.order_number}</p><p className="text-xs text-ink-400 capitalize">{o.payment_method === 'cod' ? 'COD' : 'Bank Transfer'}</p></Td>
            <Td><p className="font-semibold text-ink-900">{o.customer_name}</p><p className="text-xs text-ink-400">{o.phone}</p></Td>
            <Td className="text-ink-600">{o.items?.length || 0}</Td>
            <Td className="font-bold text-ink-900">{formatCurrency(Number(o.total_amount), currency)}</Td>
            <Td><Badge color={o.payment_status === 'paid' ? 'green' : o.payment_status === 'pending' ? 'sunshine' : 'red'}>{o.payment_status}</Badge></Td>
            <Td><Badge className={ORDER_STATUS_STYLES[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></Td>
            <Td className="text-ink-500 text-xs whitespace-nowrap">{formatDate(o.placed_at)}</Td>
            <Td><Button variant="secondary" size="sm" onClick={() => openOrder(o)}><Eye size={14} /> View</Button></Td>
          </tr>
        ))}
      </Table>
      </div>

      <OrderModal order={selected} onClose={closeOrder} onStatus={updateStatus} onVerify={verifyPayment} onSetPaid={setPaid} />
    </div>
  );
};

// ------------------------------------------------------------------
const OrderModal: React.FC<{ order: Order | null; onClose: () => void; onStatus: (o: Order, s: OrderStatus) => void; onVerify: (o: Order) => void; onSetPaid: (o: Order, paid: boolean) => void }> = ({ order, onClose, onStatus, onVerify, onSetPaid }) => {
  const { currency, settings } = useSettings();
  const { success, error } = useToast();
  const ask = useConfirm();
  const [tracking, setTracking] = useState('');
  const [delivery, setDelivery] = useState('');
  const [fee, setFee] = useState('');
  const [costsReady, setCostsReady] = useState(true);
  const [receivedBy, setReceivedBy] = useState('');
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [rf, setRf] = useState({ amount: '', by: '', reason: '', from: 'fund' });
  const [editRefund, setEditRefund] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => { setTracking(order?.tracking_number || ''); }, [order]);
  useEffect(() => {
    setDelivery(''); setFee(''); setReceivedBy(''); setReceivedAt(null); setRefunds([]); setEditRefund(null); setRf({ amount: '', by: '', reason: '', from: 'fund' });
    if (!order) return;
    supabase.from('order_costs').select('*').eq('order_id', order.id).maybeSingle().then(({ data, error: e }) => {
      setCostsReady(!e);
      if (data) { setDelivery(String(data.delivery_cost ?? '')); setFee(String(data.payment_fee ?? '')); setReceivedBy(data.received_by || ''); setReceivedAt(data.received_at || null); }
    });
    loadRefunds(order.id);
  }, [order?.id]);

  const loadRefunds = async (id: string) => {
    const { data } = await supabase.from('order_refunds').select('*').eq('order_id', id).order('refund_date', { ascending: false });
    setRefunds((data || []) as Refund[]);
  };

  const addRefund = async () => {
    if (!order) return;
    const amount = Number(rf.amount);
    if (!(amount > 0)) return error('Enter the refund amount.');
    if (!rf.by) return error('Choose which partner handed the money back.');
    const { error: e } = editRefund
      ? await supabase.from('order_refunds').update({ amount, refunded_by: rf.by, paid_from: rf.from, reason: rf.reason || null }).eq('id', editRefund)
      : await supabase.from('order_refunds').insert({ order_id: order.id, amount, refunded_by: rf.by, paid_from: rf.from, reason: rf.reason || null, created_by: user?.id });
    if (e) return error(/order_refunds/.test(e.message) ? 'Run migration 0013 in Supabase first (refunds table is missing).' : e.message);
    success(editRefund ? 'Refund updated' : 'Refund recorded'); setEditRefund(null); setRf({ amount: '', by: '', reason: '', from: 'fund' }); loadRefunds(order.id);
  };
  const removeRefund = async (r: Refund) => {
    if (!(await ask({ message: 'Delete this refund entry?', danger: true, confirmLabel: 'Delete' }))) return;
    if (r.receipt_path) await supabase.storage.from('invoices').remove([r.receipt_path]);
    const { error: e } = await supabase.from('order_refunds').delete().eq('id', r.id);
    if (e) error(e.message); else if (order) loadRefunds(order.id);
  };

  const saveCosts = async () => {
    if (!order) return;
    const at = receivedBy ? (receivedAt || new Date().toISOString().slice(0, 10)) : null;
    const { error: e } = await supabase.from('order_costs').upsert({
      order_id: order.id, delivery_cost: Number(delivery) || 0, payment_fee: Number(fee) || 0,
      received_by: receivedBy || null, received_at: at, updated_at: new Date().toISOString(),
    }, { onConflict: 'order_id' });
    if (e) error(/received_/.test(e.message) ? 'Run migration 0013 in Supabase first.' : e.message);
    else { setReceivedAt(at); success('Saved'); }
  };

  if (!order) return null;
  const payment = order.payments?.[0];

  const saveTracking = async () => {
    const { error: e } = await supabase.from('orders').update({ tracking_number: tracking || null }).eq('id', order.id);
    if (e) error(e.message); else success('Tracking number saved');
  };

  return (
    <Modal open={!!order} onClose={onClose} title={`Order ${order.order_number}`} wide>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-5">
          <div>
            <p className="text-xs font-extrabold uppercase text-ink-400 mb-2">Items</p>
            {order.items?.map(i => (
              <div key={i.id} className="flex justify-between py-2 border-b border-ink-50 text-sm">
                <span className="text-ink-700">{i.product_name} <span className="text-ink-400">×{i.quantity}</span></span>
                <span className="font-bold">{formatCurrency(i.line_total, currency)}</span>
              </div>
            ))}
            <div className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between text-ink-600"><span>Subtotal</span><span>{formatCurrency(order.subtotal, currency)}</span></div>
              <div className="flex justify-between text-ink-600"><span>Discount</span><span>−{formatCurrency(order.discount_amount, currency)}</span></div>
              <div className="flex justify-between text-ink-600"><span>Delivery</span><span>{formatCurrency(order.delivery_fee, currency)}</span></div>
              <div className="flex justify-between font-extrabold text-base pt-1"><span>Total</span><span>{formatCurrency(order.total_amount, currency)}</span></div>
            </div>
          </div>

          <div>
            <p className="text-xs font-extrabold uppercase text-ink-400 mb-2">Customer & Delivery</p>
            <p className="font-bold text-ink-900">{order.customer_name} · {order.phone}</p>
            <p className="text-sm text-ink-600">{order.email}</p>
            <p className="text-sm text-ink-600 mt-1">{order.address_line}, {order.city}, {order.district} {order.postal_code}</p>
            {order.delivery_instructions && <p className="text-xs text-ink-400 italic mt-1">"{order.delivery_instructions}"</p>}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-extrabold uppercase text-ink-400 mb-2">Status</p>
            <Select value={order.status} onChange={e => onStatus(order, e.target.value as OrderStatus)} className="!w-full font-bold">
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
            </Select>
          </div>

          <div>
            <p className="text-xs font-extrabold uppercase text-ink-400 mb-2">Tracking Number</p>
            <div className="flex gap-2">
              <Input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="e.g. LK123456" className="!py-2 text-sm" />
              <Button size="sm" variant="secondary" onClick={saveTracking}>Save</Button>
            </div>
          </div>

          <div className="rounded-3xl bg-cream-100 p-4">
            <p className="text-xs font-extrabold uppercase text-ink-400 mb-2">Payment</p>
            <p className="text-sm font-bold capitalize">{order.payment_method === 'cod' ? 'Cash on Delivery' : 'Bank Transfer'}</p>
            <Badge color={order.payment_status === 'paid' ? 'green' : 'sunshine'} className="mt-1">{order.payment_status}</Badge>
            {payment?.proof_url && (
              <button type="button" onClick={() => openReceipt(payment.proof_url!)} className="block mt-2 text-xs font-bold text-mint-600 hover:underline">View receipt ↗</button>
            )}
            {payment && payment.status !== 'paid' && order.payment_method === 'bank_transfer' && (
              <Button size="sm" className="mt-3 w-full" onClick={() => onVerify(order)}><CheckCircle2 size={15} /> Verify Payment</Button>
            )}
            {order.payment_status !== 'paid' && order.payment_method === 'cod' && (
              <Button size="sm" className="mt-3 w-full" onClick={() => onSetPaid(order, true)}><CheckCircle2 size={15} /> Mark as paid (cash received)</Button>
            )}
            {order.payment_status === 'paid' && (
              <button type="button" onClick={async () => { if ((await ask({ message: 'Mark this order as NOT paid?', danger: true, confirmLabel: 'Mark not paid' }))) onSetPaid(order, false); }} className="block mt-2 text-[11px] font-bold text-ink-400 hover:text-red-500">Mark as not paid (undo)</button>
            )}
          </div>

          <div className="rounded-3xl bg-cream-100 p-4">
            <p className="text-xs font-extrabold uppercase text-ink-400 mb-1">Our costs & money for this order</p>
            <p className="text-[11px] text-ink-400 mb-2">Used for profit reports. Don't also add the same cost under Finance &gt; Expenses.</p>
            {costsReady ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[11px] font-bold text-ink-500">Delivery cost</label><Input type="number" min="0" step="0.01" value={delivery} onChange={e => setDelivery(e.target.value)} className="!py-2 text-sm" /></div>
                  <div><label className="text-[11px] font-bold text-ink-500">Payment fee</label><Input type="number" min="0" step="0.01" value={fee} onChange={e => setFee(e.target.value)} className="!py-2 text-sm" /></div>
                </div>
                <div className="mt-2">
                  <label className="text-[11px] font-bold text-ink-500">Money received by (who got the customer's payment)</label>
                  <Select value={receivedBy} onChange={e => setReceivedBy(e.target.value)} className="!py-2 text-sm">
                    <option value="">Not received / not set</option>{PARTNERS.map(p => <option key={p}>{p}</option>)}
                  </Select>
                </div>
                <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={saveCosts}>Save</Button>
              </>
            ) : <p className="text-xs text-red-500 font-semibold">Run migration 0013 in Supabase to track order costs and who received the money.</p>}
          </div>

          <div className="rounded-3xl bg-cream-100 p-4">
            <p className="text-xs font-extrabold uppercase text-ink-400 mb-1">Refunds</p>
            {refunds.length === 0 && <p className="text-[11px] text-ink-400 mb-2">None. Record money handed back to the customer here.</p>}
            {refunds.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-xs py-1">
                <span className="text-ink-700"><b>{formatCurrency(Number(r.amount), currency)}</b> by {r.refunded_by || '—'}{r.reason ? ` · ${r.reason}` : ''}</span>
                <span className="flex items-center gap-2"><button onClick={() => { setEditRefund(r.id); setRf({ amount: String(r.amount), by: r.refunded_by || '', reason: r.reason || '', from: r.paid_from || 'own' }); }} className="font-bold text-mint-700 hover:underline">Edit</button><InvoiceControl table="order_refunds" id={r.id} path={r.receipt_path} name={r.receipt_name} onChanged={() => order && loadRefunds(order.id)} /><button onClick={() => removeRefund(r)} className="text-red-500 font-bold hover:underline">Delete</button></span>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Input type="number" min="0" step="0.01" placeholder="Amount" value={rf.amount} onChange={e => setRf({ ...rf, amount: e.target.value })} className="!py-2 text-sm" />
              <Select value={rf.by} onChange={e => setRf({ ...rf, by: e.target.value })} className="!py-2 text-sm"><option value="">Done by…</option>{PARTNERS.map(p => <option key={p}>{p}</option>)}</Select>
            </div>
            <Select value={rf.from} onChange={e => setRf({ ...rf, from: e.target.value })} className="!py-2 text-sm mt-2"><option value="fund">From the business fund</option><option value="own">From own pocket</option></Select>
            <Input placeholder="Reason (optional)" value={rf.reason} onChange={e => setRf({ ...rf, reason: e.target.value })} className="!py-2 text-sm mt-2" />
            <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={addRefund}>{editRefund ? 'Save changes' : 'Add refund'}</Button>
            {editRefund && <button onClick={() => { setEditRefund(null); setRf({ amount: '', by: '', reason: '', from: 'fund' }); }} className="mt-1 w-full text-xs font-bold text-ink-400 hover:text-ink-700">Cancel editing</button>}
            <p className="text-[11px] text-ink-400 mt-2">If you also mark the order Cancelled/Returned, it is already removed from sales — the refund then only moves cash, not profit.</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => printOrderInvoice(order, settings.store || {}, currency)}><Printer size={14} /> Invoice / PDF</Button>
            <a href={whatsappLink(order, settings.store || {}, currency)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-full border border-mint-300 px-3 text-xs font-extrabold text-mint-700 hover:bg-mint-50"><MessageCircle size={14} /> WhatsApp</a>
          </div>

          {order.notes && <p className="text-xs text-ink-400 italic">Note: {order.notes}</p>}
        </div>
      </div>
    </Modal>
  );
};

export default AdminOrders;
