-- =====================================================================
-- 0017: receipts on deposits, supplier payments and refunds
-- Files are stored in the existing private 'invoices' bucket; these columns remember where.
-- Additive only. Run once in Supabase: SQL Editor > New query > paste > Run.
-- =====================================================================
alter table public.partner_transactions add column if not exists receipt_path text;
alter table public.partner_transactions add column if not exists receipt_name text;
alter table public.purchase_payments    add column if not exists receipt_path text;
alter table public.purchase_payments    add column if not exists receipt_name text;
alter table public.order_refunds        add column if not exists receipt_path text;
alter table public.order_refunds        add column if not exists receipt_name text;
