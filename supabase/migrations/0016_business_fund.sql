-- =====================================================================
-- 0016: business fund
-- Partners deposit money into the business fund first (a "contribution" on the Partners tab).
-- Expenses, supplier payments and refunds are then paid FROM the fund; "Paid by" only says
-- which partner made the payment. A payment made from a partner's own pocket still counts as
-- that partner's investment.
--   paid_from = 'fund'  -> comes out of the business fund
--   paid_from = 'own'   -> the partner paid personally (this is what every existing entry is)
-- Additive only. Run once in Supabase: SQL Editor > New query > paste > Run.
-- =====================================================================
alter table public.expenses          add column if not exists paid_from text not null default 'own';
alter table public.purchase_payments add column if not exists paid_from text not null default 'own';
alter table public.order_refunds     add column if not exists paid_from text not null default 'own';

do $$
declare t text;
begin
  foreach t in array array['expenses', 'purchase_payments', 'order_refunds']
  loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_paid_from_check');
    execute format('alter table public.%I add constraint %I check (paid_from in (''own'', ''fund''))', t, t || '_paid_from_check');
  end loop;
end $$;
