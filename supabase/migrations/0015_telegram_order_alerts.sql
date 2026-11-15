-- =====================================================================
-- 0015: Telegram alert for every new order
--   * alert_settings : bot token + chat id + on/off (admin-only)
--   * tg_send()      : sends a Telegram message from inside the database (pg_net)
--   * trigger on payments (one row per order, created at the end of place_order)
--     builds the message from the order and sends it.
-- The trigger can never block or fail an order: any problem is swallowed.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- =====================================================================
create extension if not exists pg_net;

create table if not exists public.alert_settings (
  id int primary key default 1 check (id = 1),
  telegram_bot_token text,
  telegram_chat_id text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.alert_settings (id) values (1) on conflict (id) do nothing;

alter table public.alert_settings enable row level security;
drop policy if exists "alert_settings_admin" on public.alert_settings;
create policy "alert_settings_admin" on public.alert_settings
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.alert_settings to authenticated;

-- Sends one message. Returns the pg_net request id, or null if alerts are not set up.
create or replace function public.tg_send(p_text text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare s record; rid bigint;
begin
  select * into s from public.alert_settings where id = 1;
  if s is null or not s.enabled or coalesce(btrim(s.telegram_bot_token), '') = '' or coalesce(btrim(s.telegram_chat_id), '') = '' then
    return null;
  end if;
  select net.http_post(
    url := 'https://api.telegram.org/bot' || btrim(s.telegram_bot_token) || '/sendMessage',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chat_id', btrim(s.telegram_chat_id), 'text', left(p_text, 3900), 'disable_web_page_preview', true),
    timeout_milliseconds := 20000   -- default is 5s; a slow first connection was timing out
  ) into rid;
  return rid;
end $$;
revoke all on function public.tg_send(text) from public, anon, authenticated;

-- New order -> message
create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare o record; lines text; n int; msg text;
begin
  select * into o from public.orders where id = new.order_id;
  if o is null then return new; end if;
  select count(*), string_agg('• ' || product_name || ' ×' || quantity, E'\n' order by created_at)
    into n, lines from (select * from public.order_items where order_id = o.id order by created_at limit 10) i;
  msg := E'🛒 New order ' || o.order_number
      || E'\nTotal: Rs. ' || to_char(o.total_amount, 'FM999,999,990.00')
      || ' · ' || case o.payment_method::text when 'cod' then 'Cash on delivery' else 'Bank transfer' end
      || E'\n' || coalesce(lines, '(no items)')
      || E'\nCustomer: ' || o.customer_name || ', ' || o.city
      || E'\nOpen: https://www.minibloxrc.com/admin/orders';
  perform public.tg_send(msg);
  return new;
exception when others then
  return new;   -- an alert problem must never stop an order
end $$;

drop trigger if exists payments_notify_new_order on public.payments;
create trigger payments_notify_new_order after insert on public.payments
  for each row execute function public.notify_new_order();

-- Test button in Store Settings ------------------------------------------------------------
create or replace function public.send_telegram_test()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return public.tg_send(E'✅ Test alert from MinibloxRC.\nIf you can read this, new-order alerts are working.');
end $$;
grant execute on function public.send_telegram_test() to authenticated;

-- What did Telegram answer? (the send is asynchronous)
create or replace function public.telegram_last_status(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, net
as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select status_code, left(content::text, 300) as content, error_msg, timed_out into r from net._http_response where id = p_id;
  if r is null then return jsonb_build_object('done', false); end if;
  return jsonb_build_object('done', true, 'status', r.status_code, 'content', r.content, 'error', r.error_msg, 'timed_out', r.timed_out);
end $$;
grant execute on function public.telegram_last_status(bigint) to authenticated;

-- Only signed-in users can even call the admin helpers (they still check is_admin()).
revoke execute on function public.send_telegram_test() from public, anon;
revoke execute on function public.telegram_last_status(bigint) from public, anon;
grant execute on function public.send_telegram_test() to authenticated;
grant execute on function public.telegram_last_status(bigint) to authenticated;
