-- =====================================================================
-- 0013: track who handles the money
--   * purchase_payments : every payment to a supplier, with WHO paid
--   * order_costs       : + received_by / received_at (who got the customer's money)
--   * order_refunds     : money given back to customers, with who paid it
--   * purchases.extra_costs : freight/customs spread into landed cost
--   * order_item_costs  : each item's cost saved at the moment it was sold
-- Additive only - nothing existing is changed or removed.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- =====================================================================

-- 1. Supplier payment history ------------------------------------------
create table if not exists public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  pay_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  paid_by text,                      -- partner who paid from their own pocket
  method text,                       -- cash / bank / card / other
  reference text,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchase_payments_purchase on public.purchase_payments(purchase_id);
create index if not exists idx_purchase_payments_date on public.purchase_payments(pay_date desc);

-- purchases.amount_paid / last_paid_date are now kept in sync automatically
create or replace function public.sync_purchase_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.purchase_id, old.purchase_id);
begin
  update public.purchases p set
    amount_paid = coalesce((select sum(amount) from public.purchase_payments where purchase_id = pid), 0),
    last_paid_date = (select max(pay_date) from public.purchase_payments where purchase_id = pid)
  where p.id = pid;
  return null;
end $$;

drop trigger if exists purchase_payments_sync on public.purchase_payments;
create trigger purchase_payments_sync after insert or update or delete on public.purchase_payments
  for each row execute function public.sync_purchase_paid();

-- keep any amount already recorded as a payment line (payer unknown)
insert into public.purchase_payments (purchase_id, pay_date, amount, note)
select p.id, coalesce(p.last_paid_date, p.purchase_date), p.amount_paid, 'Opening balance (before payment history existed)'
from public.purchases p
where p.amount_paid > 0 and not exists (select 1 from public.purchase_payments x where x.purchase_id = p.id);

-- 2. Who received the customer's money ----------------------------------
alter table public.order_costs add column if not exists received_by text;
alter table public.order_costs add column if not exists received_at date;

-- 3. Refunds --------------------------------------------------------------
create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  refund_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  refunded_by text,                  -- partner who handed the money back
  method text,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_refunds_order on public.order_refunds(order_id);

-- 3b. Import costs (freight, customs) spread into landed cost ---------------
alter table public.purchases add column if not exists extra_costs numeric(14,2) not null default 0;

-- 3c. Cost of each item at the moment it was sold ---------------------------
-- Kept in an admin-only table (order_items is readable by customers).
create table if not exists public.order_item_costs (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  unit_cost numeric(12,2) not null default 0
);

create or replace function public.snapshot_order_item_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.product_id is not null then
    insert into public.order_item_costs (order_item_id, unit_cost)
    select new.id, coalesce(nullif(c.landed_cost, 0), c.supplier_cost, 0)
    from public.product_costs c where c.product_id = new.product_id
    on conflict (order_item_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists order_items_cost_snapshot on public.order_items;
create trigger order_items_cost_snapshot after insert on public.order_items
  for each row execute function public.snapshot_order_item_cost();

-- existing order lines get today's cost as their best-known cost
insert into public.order_item_costs (order_item_id, unit_cost)
select i.id, coalesce(nullif(c.landed_cost, 0), c.supplier_cost, 0)
from public.order_items i join public.product_costs c on c.product_id = i.product_id
on conflict (order_item_id) do nothing;

-- 4. Admin-only access ----------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['purchase_payments', 'order_refunds', 'order_item_costs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_admin" on public.%I', t, t);
    execute format('create policy "%s_admin" on public.%I for all using (public.is_admin()) with check (public.is_admin())', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 5. Closed months stay closed, and every change is logged -----------------
drop trigger if exists purchase_payments_month_lock on public.purchase_payments;
create trigger purchase_payments_month_lock before insert or update or delete on public.purchase_payments
  for each row execute function public.enforce_month_lock('pay_date');
drop trigger if exists order_refunds_month_lock on public.order_refunds;
create trigger order_refunds_month_lock before insert or update or delete on public.order_refunds
  for each row execute function public.enforce_month_lock('refund_date');

do $$
declare t text;
begin
  foreach t in array array['purchase_payments', 'order_refunds']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_finance_change()', t || '_audit', t);
  end loop;
end $$;
