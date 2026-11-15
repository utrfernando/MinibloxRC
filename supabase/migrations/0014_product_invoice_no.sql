-- =====================================================================
-- 0014: supplier invoice / order number on each product
-- Stored with the admin-only cost record (customers never see it).
-- Additive only. Run once in Supabase: SQL Editor > New query > paste > Run.
-- =====================================================================
alter table public.product_costs add column if not exists invoice_no text;
