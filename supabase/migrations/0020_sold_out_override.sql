-- The owner can mark a product as "Out of stock" for customers even when stock is on the shelf.
alter table public.products add column if not exists sold_out_override boolean not null default false;

-- place_order: also refuse products the owner has marked as out of stock
create or replace function public.place_order(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_item jsonb;
  v_product record;
  v_var record;
  v_vid uuid;
  v_qty int;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_delivery numeric := 0;
  v_total numeric;
  v_discount_id uuid := nullif(payload->>'discount_code_id','')::uuid;
  v_code record;
  v_free_threshold numeric := 1500;
  v_delivery_fee numeric := 250;
  v_payment_method public.payment_method := (payload->>'payment_method')::public.payment_method;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  select coalesce((setting_value->>'delivery_fee')::numeric, 250) into v_delivery_fee
    from public.website_settings where setting_key = 'store';
  select coalesce((setting_value->>'free_delivery_threshold')::numeric, 1500) into v_free_threshold
    from public.website_settings where setting_key = 'store';
  v_delivery_fee := coalesce(v_delivery_fee, 250);
  v_free_threshold := coalesce(v_free_threshold, 1500);

  -- validate items & stock, compute subtotal
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_qty := (v_item->>'quantity')::int;
    v_vid := nullif(v_item->>'variant_id','')::uuid;
    select id, name, sku, stock_quantity, selling_price, sold_out_override,
           coalesce(discount_price, selling_price) as price
      into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid
        and status = 'published';
    if not found then
      raise exception 'Product % is unavailable', v_item->>'product_id';
    end if;
    if v_product.sold_out_override then
      raise exception '% is currently out of stock', v_product.name;
    end if;
    if v_vid is null and exists (select 1 from public.product_variants where product_id = v_product.id) then
      raise exception 'Please choose a colour for %', v_product.name;
    end if;
    if v_vid is not null then
      select * into v_var from public.product_variants where id = v_vid and product_id = v_product.id;
      if not found then raise exception 'That colour of % is no longer available', v_product.name; end if;
      if v_var.stock_quantity < v_qty then
        raise exception 'Insufficient stock for % - % (available: %)', v_product.name, v_var.name, v_var.stock_quantity;
      end if;
    elsif v_product.stock_quantity < v_qty then
      raise exception 'Insufficient stock for % (available: %)', v_product.name, v_product.stock_quantity;
    end if;
    v_subtotal := v_subtotal + v_product.price * v_qty;
  end loop;

  -- discount code
  if v_discount_id is not null then
    select * into v_code from public.discount_codes where id = v_discount_id and is_active;
    if found and (v_code.starts_at is null or v_code.starts_at <= now())
       and (v_code.ends_at is null or v_code.ends_at >= now())
       and (v_code.max_uses is null or v_code.used_count < v_code.max_uses)
       and v_subtotal >= v_code.min_order_amount then
      if v_code.discount_type = 'percent' then
        v_discount := round(v_subtotal * v_code.discount_value / 100, 2);
      else
        v_discount := least(v_code.discount_value, v_subtotal);
      end if;
    end if;
  end if;

  if v_subtotal - v_discount >= v_free_threshold then
    v_delivery := 0;
  else
    v_delivery := v_delivery_fee;
  end if;
  v_total := v_subtotal - v_discount + v_delivery;

  insert into public.orders (
    order_number, user_id, customer_name, email, phone,
    address_line, city, district, postal_code, delivery_instructions,
    status, payment_method, payment_status,
    subtotal, discount_amount, delivery_fee, total_amount,
    discount_code_id, notes
  ) values (
    public.generate_order_number(), v_user,
    payload->>'customer_name', payload->>'email', payload->>'phone',
    payload->>'address_line', payload->>'city', payload->>'district',
    payload->>'postal_code', payload->>'delivery_instructions',
    'pending', v_payment_method, 'pending',
    v_subtotal, v_discount, v_delivery, v_total,
    v_discount_id, payload->>'notes'
  ) returning id into v_order_id;

  -- order items + stock decrement + inventory log
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_qty := (v_item->>'quantity')::int;
    v_vid := nullif(v_item->>'variant_id','')::uuid;
    select id, name, sku, coalesce(discount_price, selling_price) as price
      into v_product
      from public.products
      where id = (v_item->>'product_id')::uuid;

    if v_vid is not null then
      select * into v_var from public.product_variants where id = v_vid;
      insert into public.order_items (order_id, product_id, product_name, sku, unit_price, quantity, line_total, variant_id, variant_name)
      values (v_order_id, v_product.id, v_product.name || ' - ' || v_var.name, v_product.sku, v_product.price, v_qty, v_product.price * v_qty, v_var.id, v_var.name);
      -- the trigger on product_variants keeps products.stock_quantity in step
      update public.product_variants set stock_quantity = stock_quantity - v_qty where id = v_var.id;
      insert into public.inventory_transactions (product_id, quantity_change, reason, reference_type, reference_id, notes)
      values (v_product.id, -v_qty, 'sale', 'order', v_order_id, 'Order ' || (payload->>'order_number_hint') || ' (' || v_var.name || ')');
    else
      insert into public.order_items (order_id, product_id, product_name, sku, unit_price, quantity, line_total)
      values (v_order_id, v_product.id, v_product.name, v_product.sku, v_product.price, v_qty, v_product.price * v_qty);
      update public.products set stock_quantity = stock_quantity - v_qty where id = v_product.id;
      insert into public.inventory_transactions (product_id, quantity_change, reason, reference_type, reference_id, notes)
      values (v_product.id, -v_qty, 'sale', 'order', v_order_id, 'Order ' || (payload->>'order_number_hint'));
    end if;
  end loop;

  insert into public.payments (order_id, method, amount, status)
  values (v_order_id, v_payment_method, v_total, 'pending');

  if v_discount_id is not null and v_discount > 0 then
    update public.discount_codes set used_count = used_count + 1 where id = v_discount_id;
  end if;

  return v_order_id;
end $$;

grant execute on function public.place_order(jsonb) to authenticated;
