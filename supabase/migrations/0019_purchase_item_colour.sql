-- Remember which colour each purchased line was for, so a purchase can be edited later without losing track of stock.
alter table public.purchase_items add column if not exists variant_id uuid references public.product_variants(id) on delete set null;
