-- =====================================================================
-- 0011: restore the Miniblox admin check and close an admin-takeover hole
--
-- WHY: another app (Jeture Tours) shares this Supabase project. Its setup SQL
-- replaced public.is_admin() so it only looks at public.admin_users, which is
-- empty. Result: nobody counts as admin, so admin-only data (expenses, product
-- costs, other users' profiles...) looked "missing" on the admin pages.
--
-- It also left public.claim_super_admin() callable by ANY signed-in user while
-- admin_users is empty - anyone who registered could make themselves admin.
--
-- FIX: is_admin() is true for Miniblox admins (profiles.role = 'admin') OR anyone
-- listed in admin_users (so the other app keeps working), and nobody can run
-- claim_super_admin() from the website any more.
--
-- Previous (broken) definition, for rollback:
--   create or replace function public.is_admin() returns boolean language sql stable
--   security definer set search_path to 'public' as
--   $$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;
--
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- =====================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      or exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- Nobody should be able to promote themselves from the browser.
-- (The owner can still add an admin for the other app with plain SQL:
--  insert into public.admin_users (user_id, email, role) select id, email, 'super_admin' from auth.users where email = '...';)
revoke execute on function public.claim_super_admin() from public, anon, authenticated;
