import { supabase, formatCurrency } from './supabase';

export type Level = 'high' | 'medium' | 'low';
export type AttentionItem = {
  key: string;
  level: Level;
  title: string;
  detail: string;
  count: number;
  to: string;          // where to go to fix it
  action: string;      // short label for the link
};

const blank = (v: unknown) => v == null || String(v).trim() === '';
const names = (list: string[], max = 3) => list.slice(0, max).join(', ') + (list.length > max ? ` +${list.length - max} more` : '');
const PLACEHOLDER_PHONE = /0{3}\s?0{4}/;      // +94 77 000 0000
const DEFAULT_EMAIL = 'hello@miniblox.lk';

/** Looks across your records for anything that still needs entering or fixing. Read-only. */
export async function loadAttention(currency = 'LKR'): Promise<AttentionItem[]> {
  const money = (n: number) => formatCurrency(n, currency);
  const [purchases, expenses, payments, refunds, orders, orderCosts, products, suppliers, settings, alerts] = await Promise.all([
    supabase.from('purchases').select('id,reference,invoice_path,total_cost,amount_paid,supplier:suppliers(name),items:purchase_items(id)'),
    supabase.from('expenses').select('id,description,category,paid_by,invoice_path,reference,amount'),
    supabase.from('purchase_payments').select('id,paid_by,reference'),
    supabase.from('order_refunds').select('id,refunded_by'),
    supabase.from('orders').select('id,order_number,status,payment_status'),
    supabase.from('order_costs').select('order_id,delivery_cost,received_by'),
    supabase.from('products').select('id,name,status,stock_quantity,low_stock_threshold,selling_price,discount_price,costs:product_costs(*),images:product_images(id)'),
    supabase.from('suppliers').select('id,name,contact_person,phone,email'),
    supabase.from('website_settings').select('setting_key,setting_value'),
    supabase.from('alert_settings').select('telegram_bot_token,telegram_chat_id,enabled').eq('id', 1).maybeSingle(),
  ]);

  const out: AttentionItem[] = [];
  const push = (i: AttentionItem) => { if (i.count > 0) out.push(i); };

  // ---- store settings --------------------------------------------------------------------------
  const setting = (k: string) => (settings.data || []).find((s: any) => s.setting_key === k)?.setting_value || {};
  const store: any = setting('store'); const bank: any = setting('bank');
  if (store.checkout_enabled === false) push({ key: 'checkout-off', level: 'high', count: 1, title: 'Checkout is switched OFF', detail: 'Customers cannot place orders right now.', to: '/admin/settings', action: 'Open Store Settings' });
  const badContact = [PLACEHOLDER_PHONE.test(String(store.contact_phone || '')) ? 'phone' : '', PLACEHOLDER_PHONE.test(String(store.whatsapp || '')) ? 'WhatsApp' : '', String(store.contact_email || '') === DEFAULT_EMAIL ? 'email' : ''].filter(Boolean);
  push({ key: 'store-contact', level: 'medium', count: badContact.length, title: 'Store contact details are still placeholders', detail: `Your ${badContact.join(', ')} still show the sample value. Customers, invoices and the chat helper use these.`, to: '/admin/settings', action: 'Fix in Store Settings' });
  const fakeBank = blank(bank.account_number) || /^[xX*#\-\s0]+$/.test(String(bank.account_number));
  push({ key: 'bank-details', level: 'high', count: fakeBank ? 1 : 0, title: blank(bank.account_number) ? 'Bank transfer details are empty' : 'Bank account number is still a placeholder', detail: 'Customers who choose bank transfer are shown these details at checkout — they cannot pay you without real ones.', to: '/admin/settings', action: 'Add bank details' });

  const al: any = alerts.data;
  const alertsOk = !alerts.error && al && al.enabled !== false && !blank(al.telegram_bot_token) && !blank(al.telegram_chat_id);
  push({ key: 'order-alerts', level: 'medium', count: alertsOk ? 0 : 1, title: 'Order alerts on Telegram are not set up', detail: alerts.error ? 'Run migration 0015 in Supabase, then set it up in Store Settings.' : 'Get a phone message the moment a customer orders.', to: '/admin/settings', action: 'Set up alerts' });

  // ---- supplier purchases ----------------------------------------------------------------------
  const pu: any[] = purchases.data || [];
  const noRef = pu.filter(p => blank(p.reference));
  push({ key: 'purchase-no-invoice-no', level: 'medium', count: noRef.length, title: 'Shipments without an invoice number', detail: names(noRef.map(p => `${p.supplier?.name || 'Supplier'} (${money(Number(p.total_cost))})`)), to: '/admin/finance?tab=shipments', action: 'Add invoice numbers' });
  const noFile = pu.filter(p => blank(p.invoice_path));
  push({ key: 'purchase-no-file', level: 'low', count: noFile.length, title: 'Shipments with no invoice file attached', detail: 'Attach the invoice photo or PDF so you can prove each payment.', to: '/admin/inventory', action: 'Attach in Inventory → Purchases' });
  const noItems = pu.filter(p => !(p.items || []).length);
  push({ key: 'purchase-no-items', level: 'low', count: noItems.length, title: 'Shipments with no item lines', detail: 'Units are not tracked for these, so the Shipments report cannot show what sold from them.', to: '/admin/finance?tab=shipments', action: 'Open Shipments' });
  const owed = pu.reduce((s, p) => s + Math.max(0, Number(p.total_cost) - Number(p.amount_paid || 0)), 0);
  push({ key: 'owed-suppliers', level: 'medium', count: owed > 0 ? pu.filter(p => Number(p.total_cost) > Number(p.amount_paid || 0)).length : 0, title: `You still owe suppliers ${money(owed)}`, detail: 'Record each payment, and which partner paid, when you pay.', to: '/admin/finance?tab=suppliers', action: 'Open Suppliers' });

  // ---- who paid / who received -----------------------------------------------------------------
  const exp: any[] = expenses.data || [];
  push({ key: 'expense-no-payer', level: 'high', count: exp.filter(e => blank(e.paid_by)).length, title: 'Expenses with no "Paid by"', detail: 'Nobody is credited for these on the Partners tab.', to: '/admin/finance?tab=expenses', action: 'Open Expenses' });
  push({ key: 'payment-no-payer', level: 'high', count: (payments.data || []).filter((p: any) => blank(p.paid_by)).length, title: 'Supplier payments with no partner chosen', detail: 'Open the shipment payment history and re-enter them with the partner who paid.', to: '/admin/finance?tab=suppliers', action: 'Open Suppliers' });
  push({ key: 'refund-no-payer', level: 'high', count: (refunds.data || []).filter((r: any) => blank(r.refunded_by)).length, title: 'Refunds with no partner chosen', detail: 'Open the order and re-enter the refund.', to: '/admin/orders', action: 'Open Orders' });
  const expNoRef = exp.filter(e => blank(e.reference));
  push({ key: 'expense-no-invoice-no', level: 'medium', count: expNoRef.length, title: 'Expenses with no receipt / invoice number', detail: names(expNoRef.map(e => e.description || e.category)), to: '/admin/finance?tab=expenses', action: 'Add numbers' });
  push({ key: 'payment-no-invoice-no', level: 'medium', count: (payments.data || []).filter((p: any) => blank(p.reference)).length, title: 'Supplier payments with no invoice / slip number', detail: 'Open the shipment, edit its invoice number to fill them in, or add the number when you record the payment.', to: '/admin/finance?tab=suppliers', action: 'Open Suppliers' });
  push({ key: 'expense-no-file', level: 'low', count: exp.filter(e => blank(e.invoice_path)).length, title: 'Expenses with no receipt attached', detail: names(exp.filter(e => blank(e.invoice_path)).map(e => e.description || e.category)), to: '/admin/finance?tab=expenses', action: 'Attach receipts' });

  // ---- orders ----------------------------------------------------------------------------------
  const ord: any[] = orders.data || [];
  const costBy = new Map((orderCosts.data || []).map((c: any) => [c.order_id, c]));
  const live = ord.filter(o => o.status !== 'cancelled' && o.status !== 'returned');
  const paidNoReceiver = live.filter(o => o.payment_status === 'paid' && blank((costBy.get(o.id) as any)?.received_by));
  push({ key: 'order-no-receiver', level: 'high', count: paidNoReceiver.length, title: 'Paid orders with no "money received by"', detail: names(paidNoReceiver.map(o => o.order_number)), to: '/admin/orders', action: 'Open Orders' });
  const deliveredUnpaid = live.filter(o => o.status === 'delivered' && o.payment_status !== 'paid');
  push({ key: 'order-delivered-unpaid', level: 'high', count: deliveredUnpaid.length, title: 'Delivered orders not marked paid', detail: names(deliveredUnpaid.map(o => o.order_number)), to: '/admin/orders', action: 'Open Orders' });
  const noCosts = live.filter(o => (o.status === 'delivered' || o.status === 'shipped') && !costBy.has(o.id));
  push({ key: 'order-no-costs', level: 'low', count: noCosts.length, title: 'Shipped/delivered orders with no delivery cost entered', detail: 'Profit per order is overstated until you enter what delivery cost you.', to: '/admin/orders', action: 'Open Orders' });
  push({ key: 'orders-waiting', level: 'medium', count: live.filter(o => o.status === 'pending').length, title: 'New orders waiting to be confirmed', detail: 'Customers are waiting for a reply.', to: '/admin/orders', action: 'Open Orders' });

  // ---- products --------------------------------------------------------------------------------
  const prods: any[] = (products.data || []).map((p: any) => ({ ...p, c: Array.isArray(p.costs) ? p.costs[0] : p.costs }));
  const published = prods.filter(p => p.status === 'published');
  const noCost = published.filter(p => !Number(p.c?.landed_cost) && !Number(p.c?.supplier_cost));
  push({ key: 'product-no-cost', level: 'high', count: noCost.length, title: 'Published products with no cost price', detail: names(noCost.map(p => p.name)), to: '/admin/products', action: 'Open Products' });
  const price = (p: any) => Number(p.discount_price) > 0 ? Number(p.discount_price) : Number(p.selling_price);
  const thin = published.filter(p => { const cost = Number(p.c?.landed_cost || p.c?.supplier_cost || 0); return cost > 0 && price(p) > 0 && (price(p) - cost) / price(p) < 0.2; });
  push({ key: 'product-thin-margin', level: 'medium', count: thin.length, title: 'Products with under 20% margin', detail: `${names(thin.map(p => p.name))} — delivery and fees may leave almost nothing.`, to: '/admin/products', action: 'Review prices' });
  const soldOut = published.filter(p => Number(p.stock_quantity) <= 0);
  push({ key: 'product-out-of-stock', level: 'high', count: soldOut.length, title: 'Published products out of stock', detail: names(soldOut.map(p => p.name)), to: '/admin/inventory', action: 'Open Inventory' });
  const low = published.filter(p => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.low_stock_threshold ?? 5));
  push({ key: 'product-low-stock', level: 'medium', count: low.length, title: 'Products running low', detail: names(low.map(p => `${p.name} (${p.stock_quantity} left)`)), to: '/admin/inventory', action: 'Open Inventory' });
  const noImg = published.filter(p => !(p.images || []).length);
  push({ key: 'product-no-image', level: 'medium', count: noImg.length, title: 'Published products with no photo', detail: names(noImg.map(p => p.name)), to: '/admin/products', action: 'Open Products' });
  const noInv = prods.filter(p => blank(p.c?.invoice_no));
  push({ key: 'product-no-invoice', level: 'medium', count: noInv.length, title: 'Products with no supplier invoice number', detail: `${names(noInv.map(p => p.name))} — edit a product, or use the invoice_no column in the bulk upload.`, to: '/admin/products', action: 'Open Products' });

  // ---- suppliers -------------------------------------------------------------------------------
  const noContact = (suppliers.data || []).filter((s: any) => blank(s.contact_person) && blank(s.phone) && blank(s.email));
  push({ key: 'supplier-no-contact', level: 'medium', count: noContact.length, title: 'Suppliers with no contact details', detail: names(noContact.map((s: any) => s.name)), to: '/admin/inventory', action: 'Open Suppliers' });

  const rank: Record<Level, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
