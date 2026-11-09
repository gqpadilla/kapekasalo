-- Kasalo Kape business logic. The browser never decides a price, a discount or a payment status:
-- every money figure is computed here from the products table.

-- ============ Pricing ============
-- p_items: [{ product_id, choices: { <option key>: <choice index> }, qty }] or [{ plan_id, qty }]
-- Mirrors the product page: unit = (price + sum of add-ons) * pack multiplier.
-- Kasalo Bundle: pesos off per drink (coffee/coolers) paired with a pastry line unit, as in bundlesIn() in cart.js.
create function public.price_items(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  it jsonb; p public.products; pl public.plans; g jsonb; ch jsonb;
  idx int; addv int; multv int; labels text[]; unit int; q int;
  lines jsonb := '[]'; subtotal int := 0; drinks int := 0; pastries int := 0; off int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your bag is empty';
  end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Too many lines in one order'; end if;

  for it in select value from jsonb_array_elements(p_items) loop
    q := (it ->> 'qty')::int;
    if q is null or q < 1 or q > 50 then raise exception 'Quantity must be between 1 and 50'; end if;

    if it ? 'plan_id' then
      select * into pl from public.plans where id = it ->> 'plan_id' and active;
      if not found then raise exception 'Unknown plan %', it ->> 'plan_id'; end if;
      lines := lines || jsonb_build_object('plan_id', pl.id, 'name', 'The Fix · ' || pl.name || ' plan', 'cat', null,
        'variant', pl.billing_text, 'choices', '{}'::jsonb, 'unit_price', pl.total, 'pack_mult', 1, 'qty', q, 'line_total', pl.total * q);
      subtotal := subtotal + pl.total * q;
      continue;
    end if;

    select * into p from public.products where id = it ->> 'product_id' and active;
    if not found then raise exception 'Unknown product %', it ->> 'product_id'; end if;
    if not p.in_stock then raise exception '% is sold out', p.name; end if;

    addv := 0; multv := 1; labels := '{}';
    for g in select value from jsonb_array_elements(p.options) loop
      idx := coalesce((it -> 'choices' ->> (g ->> 'key'))::int, 0);
      if idx < 0 or idx >= jsonb_array_length(g -> 'choices') then raise exception 'Invalid % choice for %', g ->> 'label', p.name; end if;
      ch := g -> 'choices' -> idx;
      addv := addv + coalesce((ch ->> 'add')::int, 0);
      multv := multv * coalesce((ch ->> 'mult')::int, 1);
      labels := labels || (ch ->> 'label');
    end loop;

    unit := (p.price + addv) * multv;
    lines := lines || jsonb_build_object('product_id', p.id, 'name', p.name, 'cat', p.cat,
      'variant', array_to_string(labels, ' · '), 'choices', coalesce(it -> 'choices', '{}'::jsonb),
      'unit_price', unit, 'pack_mult', multv, 'qty', q, 'line_total', unit * q);
    subtotal := subtotal + unit * q;
    if p.cat = 'pastries' then pastries := pastries + q; else drinks := drinks + q; end if;
  end loop;

  select value into off from public.promotions
   where kind = 'bundle' and active
     and (starts_on is null or starts_on <= current_date) and (ends_on is null or ends_on >= current_date)
   order by id limit 1;
  off := coalesce(off, 0);

  return jsonb_build_object('lines', lines, 'subtotal', subtotal,
    'bundles', least(drinks, pastries), 'bundle_discount', least(drinks, pastries) * off);
end $$;

-- Creates an order and its lines. Internal: called by place_order and pos_sale.
-- Senior Citizen / PWD (POS only): the bill is made VAT-exempt, then 20% off.
-- shortcut: applies to the whole bill (one senior/PWD diner); split bills per diner if the café needs it.
create function public.create_order(p_channel text, p_customer uuid, p_items jsonb, p_senior boolean, p_senior_id text, p_shift bigint)
returns public.orders
language plpgsql security definer set search_path = '' as $$
declare
  priced jsonb := public.price_items(p_items);
  vat_rate numeric := coalesce((select (value #>> '{}')::numeric from public.settings where key = 'vat_rate'), 0.12);
  base int; exempt numeric; senior_off int := 0; o public.orders;
begin
  base := (priced ->> 'subtotal')::int - (priced ->> 'bundle_discount')::int;
  if p_senior then
    if coalesce(trim(p_senior_id), '') = '' then raise exception 'Senior Citizen / PWD ID number is required'; end if;
    exempt := round(base / (1 + vat_rate), 2);
    senior_off := base - round(exempt * 0.8)::int;
  end if;

  insert into public.orders (channel, customer_id, subtotal, bundle_discount, senior_discount, senior_id, total,
                             vatable_sales, vat, vat_exempt, shift_id, created_by)
  values (p_channel, p_customer, (priced ->> 'subtotal')::int, (priced ->> 'bundle_discount')::int, senior_off,
          case when p_senior then trim(p_senior_id) end, base - senior_off,
          -- non-VAT café (vat_rate 0): no VAT breakdown at all, Senior/PWD is a plain 20% off
          case when p_senior or vat_rate = 0 then 0 else round(base / (1 + vat_rate), 2) end,
          case when p_senior or vat_rate = 0 then 0 else base - round(base / (1 + vat_rate), 2) end,
          case when p_senior and vat_rate > 0 then exempt else 0 end,
          p_shift, auth.uid())
  returning * into o;

  insert into public.order_items (order_id, product_id, plan_id, name, cat, variant, choices, unit_price, pack_mult, qty, line_total)
  select o.id, l ->> 'product_id', l ->> 'plan_id', l ->> 'name', l ->> 'cat', l ->> 'variant', l -> 'choices',
         (l ->> 'unit_price')::int, (l ->> 'pack_mult')::int, (l ->> 'qty')::int, (l ->> 'line_total')::int
    from jsonb_array_elements(priced -> 'lines') l;
  return o;
end $$;

create function public.order_json(o public.orders) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(o) || jsonb_build_object('order_label', 'KK-' || lpad(o.order_no::text, 4, '0'),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id = o.id), '[]'));
$$;

-- ============ Stock ============
-- Applies a ledger row to the running stock total.
create function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.ingredients set stock = stock + new.change where id = new.ingredient_id;
  return new;
end $$;
create trigger apply after insert on public.stock_movements for each row execute function public.apply_stock_movement();

-- p_sign = -1 deducts a sale, +1 puts a refunded order back.
create function public.move_stock_for_order(p_order uuid, p_sign int) returns void
language sql security definer set search_path = '' as $$
  insert into public.stock_movements (ingredient_id, change, reason, order_id, created_by)
  select r.ingredient_id, p_sign * sum(r.qty * i.qty * i.pack_mult), case when p_sign < 0 then 'sale' else 'refund' end, p_order, auth.uid()
    from public.order_items i join public.recipes r on r.product_id = i.product_id
   where i.order_id = p_order
   group by r.ingredient_id;
$$;

-- Marks an order paid: receipt number, stock, loyalty points, subscriptions. Idempotent.
create function public.finalize_paid(p_order uuid, p_method text) returns public.orders
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  update public.orders set status = 'paid', payment_method = p_method, paid_at = now(), receipt_no = nextval('public.receipt_seq')
   where id = p_order and status = 'pending_payment'
  returning * into o;
  if not found then select * into o from public.orders where id = p_order; return o; end if;

  perform public.move_stock_for_order(o.id, -1);
  if o.customer_id is not null then
    update public.profiles set loyalty_points = loyalty_points + o.total / 50 where id = o.customer_id;   -- 1 point per ₱50
    insert into public.subscriptions (customer_id, plan_id, order_id, next_ship_at, ends_at)
    select o.customer_id, i.plan_id, o.id, current_date + 3, current_date + (pl.months * interval '1 month')::interval
      from public.order_items i join public.plans pl on pl.id = i.plan_id
     where i.order_id = o.id;
  end if;
  return o;
end $$;

-- ============ Customer-facing ============
-- Logged-in customers order on their account; guests give a name and email instead.
-- The returned access_token lets a guest open their receipt (receipt.html?order=<id>&t=<token>).
create function public.place_order(p_items jsonb, p_guest_name text default null, p_guest_email text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; email text := lower(trim(p_guest_email));
begin
  if auth.uid() is null then
    if coalesce(trim(p_guest_name), '') = '' or email is null or email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Enter your name and a valid email to check out as a guest';
    end if;
    if exists (select 1 from jsonb_array_elements(p_items) e where e ? 'plan_id') then
      raise exception 'Log in to subscribe to The Fix';
    end if;
  end if;
  o := public.create_order('online', auth.uid(), p_items, false, null, null);
  if auth.uid() is null then
    update public.orders set guest_name = trim(p_guest_name), guest_email = email where id = o.id returning * into o;
  end if;
  return public.order_json(o) || jsonb_build_object('access_token', o.access_token);
end $$;

-- One order for the receipt and status pages: the owner, an admin, or anyone holding the guest link.
create function public.get_order(p_order uuid, p_token uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  -- coalesce: a guest order has no customer_id, and NULL = uid would otherwise slip past "not (...)"
  if not found or not coalesce(o.customer_id = auth.uid() or public.is_admin() or o.access_token = p_token, false) then
    raise exception 'Order not found';
  end if;
  return public.order_json(o) || jsonb_build_object(
    'buyer', coalesce((select coalesce(full_name, email) from public.profiles where id = o.customer_id), o.guest_name, 'Walk-in customer'));
end $$;

-- Lets the cart show server-calculated totals before checkout (no order is created).
create function public.quote_order(p_items jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$ select public.price_items(p_items); $$;

create function public.cancel_my_order(p_order uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  update public.orders set status = 'cancelled', void_reason = 'Cancelled by customer'
   where id = p_order and customer_id = auth.uid() and status = 'pending_payment'
  returning * into o;
  if not found then raise exception 'Only unpaid orders can be cancelled'; end if;
  return public.order_json(o);
end $$;

create function public.update_my_subscription(p_id bigint, p_status text, p_grind text default null, p_address text default null)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions;
begin
  if p_status not in ('active', 'paused', 'cancelled') then raise exception 'Invalid status'; end if;
  update public.subscriptions
     set status = p_status, grind = coalesce(p_grind, grind), address = coalesce(p_address, address)
   where id = p_id and customer_id = auth.uid() and status <> 'cancelled'
  returning * into s;
  if not found then raise exception 'Subscription not found'; end if;
  return s;
end $$;

-- ============ Payments (called by the PayMongo webhook with the service role only) ============
create function public.record_paymongo_payment(p_order uuid, p_session text, p_method text, p_amount int, p_raw jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Unknown order'; end if;
  if p_amount <> o.total then
    -- returned, not raised, so the 'failed' mark is kept
    update public.payments set status = 'failed', raw = p_raw where provider_ref = p_session;
    perform public.write_audit('PAYMENT_MISMATCH', 'orders', o.id::text, null,
      jsonb_build_object('paid', p_amount, 'expected', o.total, 'session', p_session));
    return jsonb_build_object('error', format('Paid amount %s does not match order total %s', p_amount, o.total));
  end if;
  update public.payments set status = 'paid', method = p_method, raw = p_raw where provider_ref = p_session;
  o := public.finalize_paid(p_order, p_method);
  return public.order_json(o);
end $$;

-- ============ Admin: orders and POS ============
create function public.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
end $$;

create function public.pos_sale(p_items jsonb, p_method text, p_cash_tendered int default null,
                                p_senior boolean default false, p_senior_id text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare shift_id bigint; o public.orders;
begin
  perform public.require_admin();
  if p_method not in ('cash', 'card', 'qrph', 'gcash', 'maya') then raise exception 'Invalid payment method'; end if;
  select id into shift_id from public.shifts where closed_at is null;
  if shift_id is null then raise exception 'Open the register (start a shift) before selling'; end if;

  o := public.create_order('pos', null, p_items, p_senior, p_senior_id, shift_id);
  if p_method = 'cash' then
    if p_cash_tendered is null or p_cash_tendered < o.total then raise exception 'Cash received is less than the total'; end if;
    update public.orders set cash_tendered = p_cash_tendered, change_due = p_cash_tendered - o.total where id = o.id;
    insert into public.payments (order_id, provider, method, status, amount) values (o.id, 'cash', 'cash', 'paid', o.total);
    o := public.finalize_paid(o.id, 'cash');
  end if;
  -- card / QRPh / e-wallets stay pending until the PayMongo webhook confirms them
  return public.order_json(o);
end $$;

create function public.set_order_status(p_order uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; allowed text[];
begin
  perform public.require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Unknown order'; end if;
  allowed := case o.status when 'paid' then array['preparing', 'ready', 'completed']
                           when 'preparing' then array['ready', 'completed']
                           when 'ready' then array['completed']
                           else array[]::text[] end;
  if not p_status = any (allowed) then raise exception 'Cannot move an order from % to %', o.status, p_status; end if;
  update public.orders set status = p_status where id = p_order returning * into o;
  return public.order_json(o);
end $$;

-- Unpaid orders are cancelled; paid ones are refunded and their ingredients returned to stock.
-- shortcut: card/QRPh refunds still have to be issued in the PayMongo dashboard; this records them.
create function public.void_order(p_order uuid, p_reason text, p_restock boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform public.require_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to void an order'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Unknown order'; end if;
  if o.status in ('cancelled', 'refunded') then raise exception 'Order is already %', o.status; end if;

  if o.status = 'pending_payment' then
    update public.orders set status = 'cancelled', void_reason = p_reason where id = p_order returning * into o;
  else
    update public.orders set status = 'refunded', void_reason = p_reason where id = p_order returning * into o;
    update public.payments set status = 'refunded' where order_id = p_order and status = 'paid';
    if p_restock then perform public.move_stock_for_order(p_order, 1); end if;
    if o.customer_id is not null then
      update public.profiles set loyalty_points = greatest(0, loyalty_points - o.total / 50) where id = o.customer_id;
    end if;
  end if;
  return public.order_json(o);
end $$;

-- ============ Admin: shifts ============
create function public.open_shift(p_opening_cash int) returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare s public.shifts;
begin
  perform public.require_admin();
  if exists (select 1 from public.shifts where closed_at is null) then raise exception 'A shift is already open'; end if;
  insert into public.shifts (opened_by, opening_cash) values (auth.uid(), p_opening_cash) returning * into s;
  return s;
end $$;

-- Closes the open shift and returns its Z-report.
create function public.close_shift(p_counted_cash int, p_notes text default null) returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare s public.shifts; z jsonb; cash_in int; cash_out int;
begin
  perform public.require_admin();
  select * into s from public.shifts where closed_at is null for update;
  if not found then raise exception 'No shift is open'; end if;

  select coalesce(sum(total) filter (where payment_method = 'cash' and status not in ('pending_payment', 'cancelled')), 0),
         coalesce(sum(total) filter (where payment_method = 'cash' and status = 'refunded'), 0)
    into cash_in, cash_out
    from public.orders where shift_id = s.id;

  select jsonb_build_object(
      'orders', count(*) filter (where status not in ('pending_payment', 'cancelled', 'refunded')),
      'gross_sales', coalesce(sum(subtotal) filter (where status not in ('pending_payment', 'cancelled', 'refunded')), 0),
      'bundle_discounts', coalesce(sum(bundle_discount) filter (where status not in ('pending_payment', 'cancelled', 'refunded')), 0),
      'senior_pwd_discounts', coalesce(sum(senior_discount) filter (where status not in ('pending_payment', 'cancelled', 'refunded')), 0),
      'net_sales', coalesce(sum(total) filter (where status not in ('pending_payment', 'cancelled', 'refunded')), 0),
      'vatable_sales', coalesce(sum(vatable_sales) filter (where status not in ('pending_payment', 'cancelled', 'refunded')), 0),
      'vat', coalesce(sum(vat) filter (where status not in ('pending_payment', 'cancelled', 'refunded')), 0),
      'vat_exempt', coalesce(sum(vat_exempt) filter (where status not in ('pending_payment', 'cancelled', 'refunded')), 0),
      'refunds', coalesce(sum(total) filter (where status = 'refunded'), 0),
      'voids', count(*) filter (where status = 'cancelled'),
      'by_method', coalesce((select jsonb_object_agg(m, amt) from (
          select payment_method m, sum(total) amt from public.orders
           where shift_id = s.id and status not in ('pending_payment', 'cancelled', 'refunded') group by payment_method) x), '{}'),
      'first_receipt', min(receipt_no), 'last_receipt', max(receipt_no))
    into z from public.orders where shift_id = s.id;

  update public.shifts
     set closed_at = now(), closed_by = auth.uid(), counted_cash = p_counted_cash, notes = p_notes,
         expected_cash = s.opening_cash + cash_in - cash_out,
         z_report = z || jsonb_build_object('opening_cash', s.opening_cash, 'expected_cash', s.opening_cash + cash_in - cash_out,
                                            'counted_cash', p_counted_cash, 'over_short', p_counted_cash - (s.opening_cash + cash_in - cash_out))
   where id = s.id returning * into s;
  return s;
end $$;

-- ============ Admin: inventory and purchasing ============
-- 'count': p_value is what was physically counted; 'waste' / 'adjust': p_value is the change (waste is taken out).
create function public.adjust_stock(p_ingredient bigint, p_reason text, p_value numeric, p_note text default null)
returns public.ingredients
language plpgsql security definer set search_path = '' as $$
declare ing public.ingredients; delta numeric;
begin
  perform public.require_admin();
  select * into ing from public.ingredients where id = p_ingredient for update;
  if not found then raise exception 'Unknown ingredient'; end if;
  delta := case p_reason when 'count' then p_value - ing.stock
                         when 'waste' then -abs(p_value)
                         when 'adjust' then p_value
                         else null end;
  if delta is null then raise exception 'Reason must be count, waste or adjust'; end if;
  if p_reason <> 'count' and coalesce(trim(p_note), '') = '' then raise exception 'Add a note for waste and adjustments'; end if;
  insert into public.stock_movements (ingredient_id, change, reason, note, created_by)
  values (p_ingredient, delta, p_reason, p_note, auth.uid());
  select * into ing from public.ingredients where id = p_ingredient;
  return ing;
end $$;

-- Receiving adds stock, updates the average unit cost and records the cost as an expense.
create function public.receive_purchase_order(p_po bigint) returns public.purchase_orders
language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; it record; cost numeric := 0;
begin
  perform public.require_admin();
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'Unknown purchase order'; end if;
  if po.status not in ('draft', 'ordered') then raise exception 'Purchase order is already %', po.status; end if;

  for it in select poi.*, i.stock, i.cost_per_unit from public.purchase_order_items poi
              join public.ingredients i on i.id = poi.ingredient_id where poi.po_id = p_po loop
    update public.ingredients
       set cost_per_unit = case when it.stock + it.qty > 0
                                then (greatest(it.stock, 0) * it.cost_per_unit + it.qty * it.unit_cost) / (greatest(it.stock, 0) + it.qty)
                                else it.unit_cost end
     where id = it.ingredient_id;
    insert into public.stock_movements (ingredient_id, change, reason, po_id, created_by)
    values (it.ingredient_id, it.qty, 'purchase', p_po, auth.uid());
    cost := cost + it.qty * it.unit_cost;
  end loop;
  if cost = 0 then raise exception 'Purchase order has no items'; end if;

  update public.purchase_orders set status = 'received', received_at = now() where id = p_po returning * into po;
  insert into public.expenses (category, amount, note, created_by)
  values ('ingredients', round(cost)::int, 'Purchase order #' || p_po, auth.uid());
  return po;
end $$;

-- ============ Admin: users ============
create function public.set_user_role(p_user uuid, p_role text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare pr public.profiles;
begin
  perform public.require_admin();
  if p_role not in ('customer', 'admin') then raise exception 'Invalid role'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You cannot remove your own admin access'; end if;
  update public.profiles set role = p_role where id = p_user returning * into pr;
  if not found then raise exception 'Unknown user'; end if;
  return pr;
end $$;

-- ============ Admin: analytics ============
-- Sales report for a date range (Manila dates, inclusive).
create function public.sales_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.require_admin();
  with sold as (
    select o.*, (o.created_at at time zone 'Asia/Manila') as local_at from public.orders o
     where o.status in ('paid', 'preparing', 'ready', 'completed')
       and (o.created_at at time zone 'Asia/Manila')::date between p_from and p_to
  ), lines as (
    select i.*, coalesce((select sum(r.qty * g.cost_per_unit) from public.recipes r join public.ingredients g on g.id = r.ingredient_id
                           where r.product_id = i.product_id), 0) * i.pack_mult * i.qty as food_cost
      from public.order_items i join sold s on s.id = i.order_id
  )
  select jsonb_build_object(
    'orders', (select count(*) from sold),
    'net_sales', (select coalesce(sum(total), 0) from sold),
    'average_order', (select coalesce(round(avg(total)), 0) from sold),
    'bundle_discounts', (select coalesce(sum(bundle_discount), 0) from sold),
    'senior_pwd_discounts', (select coalesce(sum(senior_discount), 0) from sold),
    'vat', (select coalesce(sum(vat), 0) from sold),
    'food_cost', (select coalesce(round(sum(food_cost)), 0) from lines),
    'expenses', (select coalesce(sum(amount), 0) from public.expenses where spent_on between p_from and p_to),
    'refunds', (select coalesce(sum(total), 0) from public.orders where status = 'refunded'
                  and (created_at at time zone 'Asia/Manila')::date between p_from and p_to),
    'by_day', (select coalesce(jsonb_agg(d order by d ->> 'day'), '[]') from
                 (select jsonb_build_object('day', local_at::date, 'orders', count(*), 'sales', sum(total)) d from sold group by local_at::date) x),
    'by_hour', (select coalesce(jsonb_agg(jsonb_build_object('hour', hr, 'sales', amt) order by hr), '[]') from
                 (select extract(hour from local_at)::int hr, sum(total) amt from sold group by 1) x),
    'by_method', (select coalesce(jsonb_object_agg(payment_method, amt), '{}') from
                 (select payment_method, sum(total) amt from sold group by payment_method) x),
    'by_channel', (select coalesce(jsonb_object_agg(channel, amt), '{}') from
                 (select channel, sum(total) amt from sold group by channel) x),
    'by_category', (select coalesce(jsonb_object_agg(coalesce(cat, 'subscriptions'), amt), '{}') from
                 (select cat, sum(line_total) amt from lines group by cat) x),
    'best_sellers', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'sales', amt) order by q desc, amt desc), '[]') from
                 (select name, sum(qty) q, sum(line_total) amt from lines group by name order by 2 desc, 3 desc limit 10) x)
  ) into r;
  return r || jsonb_build_object('gross_margin', (r ->> 'net_sales')::numeric - (r ->> 'food_cost')::numeric,
                                 'profit', (r ->> 'net_sales')::numeric - (r ->> 'expenses')::numeric);
end $$;

-- ============ Permissions ============
-- Supabase grants EXECUTE to everyone by default; lock it down, then open only what each role calls.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.quote_order(jsonb) to anon, authenticated;
grant execute on function public.place_order(jsonb, text, text) to anon, authenticated;
grant execute on function public.get_order(uuid, uuid) to anon, authenticated;
grant execute on function public.cancel_my_order(uuid) to authenticated;
grant execute on function public.update_my_subscription(bigint, text, text, text) to authenticated;
grant execute on function public.pos_sale(jsonb, text, int, boolean, text) to authenticated;     -- admin-checked inside
grant execute on function public.set_order_status(uuid, text) to authenticated;
grant execute on function public.void_order(uuid, text, boolean) to authenticated;
grant execute on function public.open_shift(int) to authenticated;
grant execute on function public.close_shift(int, text) to authenticated;
grant execute on function public.adjust_stock(bigint, text, numeric, text) to authenticated;
grant execute on function public.receive_purchase_order(bigint) to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;
grant execute on function public.sales_report(date, date) to authenticated;
grant execute on function public.record_paymongo_payment(uuid, text, text, int, jsonb) to service_role;

-- Live order queue and order-status page
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
