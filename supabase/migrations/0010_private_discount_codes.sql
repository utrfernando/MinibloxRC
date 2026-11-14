-- =====================================================================
-- 0010: stop discount codes being publicly listable
-- Before: anyone could read the whole discount_codes table through the API
--         and see every active code. Now only admins can read the table, and
--         shoppers check ONE code they typed via validate_discount_code().
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- =====================================================================

-- 1. Remove public read; admins keep full access via discounts_admin_write.
drop policy if exists "discounts_public_read" on public.discount_codes;
revoke select on public.discount_codes from anon;

-- 2. Check a single code the customer typed. Returns only what the cart needs.
create or replace function public.validate_discount_code(p_code text, p_subtotal numeric default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c record;
begin
  select * into c from public.discount_codes where lower(code) = lower(btrim(p_code)) and is_active limit 1;
  if not found then raise exception 'Invalid or expired code.'; end if;
  if c.starts_at is not null and c.starts_at > now() then raise exception 'This code is not active yet.'; end if;
  if c.ends_at is not null and c.ends_at < now() then raise exception 'This code has expired.'; end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then raise exception 'This code has been fully used.'; end if;
  if coalesce(p_subtotal, 0) < c.min_order_amount then
    raise exception 'Minimum order of % required for this code.', c.min_order_amount;
  end if;
  return jsonb_build_object(
    'id', c.id, 'code', c.code, 'description', c.description,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'min_order_amount', c.min_order_amount, 'is_active', true
  );
end $$;

revoke all on function public.validate_discount_code(text, numeric) from public;
grant execute on function public.validate_discount_code(text, numeric) to anon, authenticated;
