-- =====================================================================
-- 0012: remove the Jeture Tours app from this Supabase project
-- PERMANENT. A copy of the data was saved first in
--   backups/jeture-tours-data-2026-11-15.json  (on the owner's computer)
--
-- Removes only objects that Miniblox does not use:
--   tables : admin_users, bookings, media, messages, package_features,
--            package_images, packages, site_settings, team_members,
--            testimonials, vehicles
--   funcs  : add_admin, admin_exists, claim_super_admin, is_super_admin
--   storage: the access rules of the empty 'media' bucket
-- Miniblox tables, products, orders, expenses, users and storage are untouched.
-- =====================================================================

-- 1. Miniblox's admin check goes back to profiles only (no admin_users any more).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 2. Tour tables (their policies, triggers and indexes go with them).
drop table if exists public.package_features cascade;
drop table if exists public.package_images cascade;
drop table if exists public.packages cascade;
drop table if exists public.vehicles cascade;
drop table if exists public.testimonials cascade;
drop table if exists public.team_members cascade;
drop table if exists public.bookings cascade;
drop table if exists public.messages cascade;
drop table if exists public.media cascade;
drop table if exists public.site_settings cascade;
drop table if exists public.admin_users cascade;

-- 3. Tour helper functions.
drop function if exists public.add_admin(text, text);
drop function if exists public.admin_exists();
drop function if exists public.claim_super_admin();
drop function if exists public.is_super_admin();

-- 4. Tour storage access rules. (The empty 'media' bucket itself can't be deleted
--    with SQL - Supabase blocks it. Remove it in Dashboard > Storage if you like.)
drop policy if exists "media bucket admin delete" on storage.objects;
drop policy if exists "media bucket admin insert" on storage.objects;
drop policy if exists "media bucket admin update" on storage.objects;
drop policy if exists "media bucket public read" on storage.objects;
