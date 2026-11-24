-- Expense receipts. An expense from a received purchase order links to that PO and uses its receipt;
-- every other new expense needs its own receipt (photo or PDF in the private 'receipts' bucket).
alter table public.expenses add column receipt_path text;
alter table public.expenses add column po_id bigint references public.purchase_orders (id);

update public.expenses set po_id = substring(note from '^Purchase order #(\d+)$')::bigint
 where category = 'ingredients' and note ~ '^Purchase order #\d+$'
   and exists (select 1 from public.purchase_orders where id = substring(note from '^Purchase order #(\d+)$')::bigint);

-- not valid: older expenses without a receipt stay as they are (shown as Missing); new ones must have one.
alter table public.expenses add constraint expenses_need_receipt check (receipt_path is not null or po_id is not null) not valid;

-- Same as before, plus: the expense links back to its purchase order.
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
  insert into public.expenses (category, amount, note, po_id, created_by)
  values ('ingredients', round(cost)::int, 'Purchase order #' || p_po, p_po, auth.uid());
  return po;
end $$;
