-- Supplier receipts for purchase orders: a photo or PDF in a private bucket, required before a PO is received.
alter table public.purchase_orders add column receipt_path text;   -- object name in the 'receipts' bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "admins read receipts"    on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.is_admin());
create policy "admins upload receipts"  on storage.objects for insert to authenticated with check (bucket_id = 'receipts' and public.is_admin());
create policy "admins replace receipts" on storage.objects for update to authenticated using (bucket_id = 'receipts' and public.is_admin());

-- Same as before, plus: no receipt, no receiving.
create or replace function public.receive_purchase_order(p_po bigint) returns public.purchase_orders
language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; it record; cost numeric := 0;
begin
  perform public.require_admin();
  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'Unknown purchase order'; end if;
  if po.status not in ('draft', 'ordered') then raise exception 'Purchase order is already %', po.status; end if;
  if po.receipt_path is null then raise exception 'Attach the supplier receipt before receiving'; end if;

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
