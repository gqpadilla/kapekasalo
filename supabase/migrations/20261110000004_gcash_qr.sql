-- Payments without a card processor: customers pay to the café's GCash/InstaPay QR and submit the
-- reference number, or pay cash at pickup. An admin confirms each payment before the order counts as paid.

alter table public.orders add column pay_option text check (pay_option in ('gcash_qr', 'pickup'));

alter table public.payments drop constraint payments_provider_check;
alter table public.payments add constraint payments_provider_check check (provider in ('gcash_qr', 'cash'));
alter table public.payments add column reference text;   -- GCash / InstaPay reference number
alter table public.payments add column note text;        -- rejection reason shown to the customer

-- A reference number can back only one order (a rejected one can be re-used after correction).
create unique index payments_reference_once on public.payments (reference) where reference is not null and status <> 'failed';

drop function public.record_paymongo_payment(uuid, text, text, int, jsonb);

-- Owner, admin, or a guest holding the order's private link. coalesce: guest orders have no customer_id.
create function public.can_see_order(o public.orders, p_token uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(o.customer_id = (select auth.uid()) or public.is_admin() or o.access_token = p_token, false);
$$;

-- ============ Checkout ============
drop function public.place_order(jsonb, text, text);
create function public.place_order(p_items jsonb, p_guest_name text default null, p_guest_email text default null,
                                   p_pay_option text default 'gcash_qr') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; email text := lower(trim(p_guest_email));
begin
  if p_pay_option not in ('gcash_qr', 'pickup') then raise exception 'Choose GCash or pay at pickup'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where e ? 'plan_id') then
    if auth.uid() is null then raise exception 'Log in to subscribe to The Fix'; end if;
    if p_pay_option <> 'gcash_qr' then raise exception 'Pay for The Fix with GCash'; end if;
  end if;
  if auth.uid() is null and (coalesce(trim(p_guest_name), '') = '' or email is null or email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter your name and a valid email to check out as a guest';
  end if;

  o := public.create_order('online', auth.uid(), p_items, false, null, null);
  update public.orders
     set pay_option = p_pay_option,
         guest_name = case when auth.uid() is null then trim(p_guest_name) end,
         guest_email = case when auth.uid() is null then email end
   where id = o.id returning * into o;
  return public.order_json(o) || jsonb_build_object('access_token', o.access_token);
end $$;

-- The order page: order, buyer name, and the latest payment attempt (reference, status, rejection note).
create or replace function public.get_order(p_order uuid, p_token uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order;
  if not found or not public.can_see_order(o, p_token) then raise exception 'Order not found'; end if;
  return public.order_json(o) || jsonb_build_object(
    'buyer', coalesce((select coalesce(full_name, email) from public.profiles where id = o.customer_id), o.guest_name, 'Walk-in customer'),
    'payment', (select jsonb_build_object('status', p.status, 'reference', p.reference, 'note', p.note, 'method', p.method, 'at', p.updated_at)
                  from public.payments p where p.order_id = o.id order by p.id desc limit 1));
end $$;

-- Customer submits the GCash/InstaPay reference after paying the QR. Resubmitting replaces a pending one.
create function public.submit_gcash_payment(p_order uuid, p_reference text, p_token uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; ref text := upper(regexp_replace(coalesce(p_reference, ''), '[\s-]', '', 'g')); pay_id bigint;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.can_see_order(o, p_token) then raise exception 'Order not found'; end if;
  if o.status <> 'pending_payment' then raise exception 'This order is already %', replace(o.status, '_', ' '); end if;
  if coalesce(o.pay_option, 'gcash_qr') <> 'gcash_qr' then raise exception 'This order is paid at pickup'; end if;
  if ref !~ '^[0-9A-Z]{6,30}$' then raise exception 'Enter the reference number from your GCash receipt (numbers only, no spaces)'; end if;

  select id into pay_id from public.payments where order_id = o.id and status = 'pending' order by id desc limit 1;
  begin
    if pay_id is null then
      insert into public.payments (order_id, provider, method, status, amount, reference)
      values (o.id, 'gcash_qr', 'gcash', 'pending', o.total, ref);
    else
      update public.payments set reference = ref, note = null where id = pay_id;
    end if;
  exception when unique_violation then
    raise exception 'That reference number was already used for another order';
  end;
  perform public.write_audit('PAYMENT_SUBMITTED', 'orders', o.id::text, null, jsonb_build_object('reference', ref, 'amount', o.total));
  return public.get_order(p_order, p_token);
end $$;

-- ============ Admin: confirm or reject ============
-- p_method 'gcash' confirms a GCash/InstaPay payment (customer-submitted, or shown at the counter with p_reference);
-- p_method 'cash' records cash at pickup or at the counter.
create function public.confirm_payment(p_order uuid, p_method text, p_cash_tendered int default null, p_reference text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; pay_id bigint;
begin
  perform public.require_admin();
  if p_method not in ('gcash', 'cash') then raise exception 'Method must be gcash or cash'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Unknown order'; end if;
  if o.status <> 'pending_payment' then raise exception 'Order is already %', replace(o.status, '_', ' '); end if;

  if p_method = 'cash' then
    if p_cash_tendered is null or p_cash_tendered < o.total then raise exception 'Cash received is less than the total'; end if;
    update public.payments set status = 'failed', note = 'Paid in cash instead' where order_id = o.id and status = 'pending';
    insert into public.payments (order_id, provider, method, status, amount) values (o.id, 'cash', 'cash', 'paid', o.total);
    update public.orders set cash_tendered = p_cash_tendered, change_due = p_cash_tendered - o.total where id = o.id;
  else
    select id into pay_id from public.payments where order_id = o.id and status = 'pending' order by id desc limit 1;
    if pay_id is not null then
      update public.payments set status = 'paid', reference = coalesce(nullif(trim(p_reference), ''), reference) where id = pay_id;
    elsif coalesce(trim(p_reference), '') <> '' then
      insert into public.payments (order_id, provider, method, status, amount, reference)
      values (o.id, 'gcash_qr', 'gcash', 'paid', o.total, upper(trim(p_reference)));
    else
      raise exception 'No GCash reference submitted yet; type the reference from the customer''s receipt';
    end if;
  end if;
  o := public.finalize_paid(o.id, p_method);
  return public.order_json(o);
end $$;

create function public.reject_payment(p_order uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform public.require_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'Tell the customer why (e.g. no payment found with that reference)'; end if;
  update public.payments set status = 'failed', note = trim(p_reason)
   where id = (select id from public.payments where order_id = p_order and status = 'pending' order by id desc limit 1);
  if not found then raise exception 'No pending payment to reject'; end if;
  select * into o from public.orders where id = p_order;
  return public.order_json(o);
end $$;

-- POS: GCash at the counter now means the café's QR, confirmed with confirm_payment.
alter table public.orders drop constraint orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method in ('cash', 'gcash'));
create or replace function public.pos_sale(p_items jsonb, p_method text, p_cash_tendered int default null,
                                           p_senior boolean default false, p_senior_id text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare shift_id bigint; o public.orders;
begin
  perform public.require_admin();
  if p_method not in ('cash', 'gcash') then raise exception 'Payment method must be cash or gcash'; end if;
  select id into shift_id from public.shifts where closed_at is null;
  if shift_id is null then raise exception 'Open the register (start a shift) before selling'; end if;

  o := public.create_order('pos', null, p_items, p_senior, p_senior_id, shift_id);
  if p_method = 'cash' then
    if p_cash_tendered is null or p_cash_tendered < o.total then raise exception 'Cash received is less than the total'; end if;
    update public.orders set cash_tendered = p_cash_tendered, change_due = p_cash_tendered - o.total where id = o.id;
    insert into public.payments (order_id, provider, method, status, amount) values (o.id, 'cash', 'cash', 'paid', o.total);
    o := public.finalize_paid(o.id, 'cash');
  end if;
  -- gcash stays pending until staff confirm it with confirm_payment
  return public.order_json(o);
end $$;

-- ============ Permissions ============
revoke execute on function public.can_see_order(public.orders, uuid) from public, anon, authenticated;
revoke execute on function public.place_order(jsonb, text, text, text) from public;
revoke execute on function public.submit_gcash_payment(uuid, text, uuid) from public;
revoke execute on function public.confirm_payment(uuid, text, int, text) from public, anon;
revoke execute on function public.reject_payment(uuid, text) from public, anon;
grant execute on function public.place_order(jsonb, text, text, text) to anon, authenticated;
grant execute on function public.submit_gcash_payment(uuid, text, uuid) to anon, authenticated;
grant execute on function public.confirm_payment(uuid, text, int, text) to authenticated;   -- admin-checked inside
grant execute on function public.reject_payment(uuid, text) to authenticated;               -- admin-checked inside

-- Not a BIR-registered business yet: receipts show "Order Receipt" and no registration numbers.
update public.settings set value = (value - 'is_demo') || '{"bir_registered": false}'::jsonb where key = 'invoice';
insert into public.settings (key, value) values ('gcash', '{"qr_image": "img/gcash-qr.webp", "account_name": "GA****L P."}'::jsonb)
  on conflict (key) do nothing;
