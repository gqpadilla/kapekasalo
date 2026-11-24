-- Mock finance data for the last 30 days (Manila time): paid orders with GCash references and a few refunds,
-- one closed register shift per day, operating expenses, 8 received purchase orders with receipts and 1 open one.
-- Run once in the Supabase SQL Editor, after migration 20261125000001_po_receipts.sql.
-- Then upload supabase/mock-receipts/*.png into Storage > receipts, inside a folder named "mock".
do $$
declare
  admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  names text[] := array['Bea Santos', 'Migo Reyes', 'Carla Dizon', 'Paolo Lim', 'Rina Cruz', 'Jerome Tan', 'Aya Villanueva', 'Kiko Ramos', 'Lia Bautista', 'Nico Garcia'];
  today date := (now() at time zone 'Asia/Manila')::date;
  d date; sh public.shifts; o public.orders; p record; z jsonb;
  n int; i int; qty int; online boolean; method text; cash_in int; counted int; new_po bigint; got_at timestamptz; po record; it record;
begin
  if admin is null then raise exception 'Create an admin account first'; end if;
  if exists (select 1 from public.purchase_orders where notes like '%(sample)') then raise exception 'Mock finance data is already loaded'; end if;
  perform setseed(0.128);

  for d in select generate_series(today - 30, today - 1, interval '1 day')::date loop
    -- ---- the day's register shift and orders ----
    insert into public.shifts (opened_by, opened_at, opening_cash)
    values (admin, (d + time '06:45') at time zone 'Asia/Manila', 2000) returning * into sh;

    n := 60 + floor(random() * 25)::int + case when extract(isodow from d) >= 6 then 20 else 0 end;   -- busier weekends
    for i in 1..n loop
      select id, name, cat, price into p from public.products where active order by random() limit 1;
      qty := case when random() < 0.25 then 2 else 1 end;
      online := random() < 0.4;
      method := case when online and random() < 0.85 then 'gcash' when not online and random() < 0.3 then 'gcash' else 'cash' end;
      insert into public.orders (channel, guest_name, guest_email, status, payment_method, pay_option, subtotal, total,
                                 cash_tendered, change_due, receipt_no, shift_id, created_by, created_at, paid_at)
      values (case when online then 'online' else 'pos' end,
              case when online then names[1 + floor(random() * 10)::int] end,
              case when online then 'guest' || i || '@example.com' end,
              'completed', method, case when online then case when method = 'gcash' then 'gcash_qr' else 'pickup' end end,
              p.price * qty, p.price * qty,
              case when method = 'cash' then ceil(p.price * qty / 100.0)::int * 100 end,
              case when method = 'cash' then ceil(p.price * qty / 100.0)::int * 100 - p.price * qty end,
              nextval('public.receipt_seq'),
              case when method = 'cash' or not online then sh.id end,
              case when not online then admin end,
              (d + time '07:00' + random() * interval '13 hours') at time zone 'Asia/Manila', null)
      returning * into o;
      update public.orders set paid_at = created_at + interval '3 minutes' where id = o.id returning * into o;
      insert into public.order_items (order_id, product_id, name, cat, unit_price, qty, line_total)
      values (o.id, p.id, p.name, p.cat, p.price, qty, p.price * qty);
      insert into public.payments (order_id, provider, method, status, amount, reference, created_at, updated_at)
      values (o.id, case when method = 'gcash' then 'gcash_qr' else 'cash' end, method, 'paid', o.total,
              case when method = 'gcash' then '10' || lpad(floor(random() * 1e11)::bigint::text, 11, '0') end, o.paid_at, o.paid_at);
      if random() < 0.005 then   -- the odd refund
        update public.orders set status = 'refunded', void_reason = 'Wrong order made' where id = o.id;
        update public.payments set status = 'refunded' where order_id = o.id;
      end if;
    end loop;

    -- close the shift the same way close_shift does, with a small over/short now and then
    select coalesce(sum(total) filter (where payment_method = 'cash' and status <> 'refunded'), 0) into cash_in from public.orders where shift_id = sh.id;
    counted := 2000 + cash_in + (array[0, 0, 0, 0, -20, 10, -50, 5])[1 + floor(random() * 8)::int];
    select jsonb_build_object(
        'orders', count(*) filter (where status <> 'refunded'),
        'gross_sales', coalesce(sum(subtotal) filter (where status <> 'refunded'), 0),
        'bundle_discounts', 0, 'senior_pwd_discounts', 0,
        'net_sales', coalesce(sum(total) filter (where status <> 'refunded'), 0),
        'vatable_sales', 0, 'vat', 0, 'vat_exempt', 0,
        'refunds', coalesce(sum(total) filter (where status = 'refunded'), 0), 'voids', 0,
        'by_method', coalesce((select jsonb_object_agg(m, amt) from (select payment_method m, sum(total) amt from public.orders
                                where shift_id = sh.id and status <> 'refunded' group by payment_method) x), '{}'),
        'first_receipt', min(receipt_no), 'last_receipt', max(receipt_no),
        'opening_cash', 2000, 'expected_cash', 2000 + cash_in, 'counted_cash', counted, 'over_short', counted - 2000 - cash_in)
      into z from public.orders where shift_id = sh.id;
    update public.shifts set closed_at = (d + time '21:10') at time zone 'Asia/Manila', closed_by = admin,
           expected_cash = 2000 + cash_in, counted_cash = counted, z_report = z,
           notes = case when counted - 2000 - cash_in < -20 then 'Short; likely change given twice during the lunch rush' end
     where id = sh.id;

    -- ---- operating expenses ----
    insert into public.expenses (category, amount, note, spent_on, created_by)
    select x.c, x.a, x.n, d, admin from (values
      ('rent', 25000, 'Store rent, ' || to_char(d, 'FMMonth YYYY'), extract(day from d) = 1),
      ('salaries', 18000, 'Payroll, 2 baristas (1st half)', extract(day from d) = 15),
      ('salaries', 18000, 'Payroll, 2 baristas (2nd half)', d = (date_trunc('month', d) + interval '1 month - 1 day')::date),
      ('utilities', 6850, 'Meralco electricity', extract(day from d) = 12),
      ('utilities', 940, 'Maynilad water', extract(day from d) = 18),
      ('utilities', 1699, 'PLDT fiber internet', extract(day from d) = 20),
      ('marketing', 1500, 'Facebook and Instagram ads', extract(day from d) = 8),
      ('supplies', 350 + floor(random() * 55)::int * 10, 'Tissue, straws and cleaning supplies', extract(isodow from d) = 1)
    ) x(c, a, n, due) where x.due;
  end loop;

  -- ---- purchase orders (receipt images in supabase/mock-receipts/po-receipt-N.png) ----
  for po in select * from (values
      (1, 28, 'Batangas Barako Traders', '[["Espresso beans",5000,1.20],["Barako beans",5000,0.90]]'),
      (2, 25, 'Manila Dairy Co.',        '[["Fresh milk",40000,0.09],["Oat milk",12000,0.18],["Condensed milk",6000,0.15]]'),
      (3, 21, 'Laguna Kakanin Supply',   '[["Glutinous rice",10000,0.08],["Ube halaya",4000,0.35],["Pastry box",300,8]]'),
      (4, 17, 'Manila Dairy Co.',        '[["Fresh milk",40000,0.09],["Coconut milk",8000,0.12],["Butter",4000,0.50]]'),
      (5, 13, 'Batangas Barako Traders', '[["Espresso beans",5000,1.25],["Tablea",2000,0.60]]'),
      (6, 10, 'Laguna Kakanin Supply',   '[["Flour",15000,0.06],["Eggs",360,9],["Banana",150,6]]'),
      (7, 6,  'Manila Dairy Co.',        '[["Fresh milk",40000,0.09],["Cream cheese",3000,0.70],["Cheese",2000,0.60]]'),
      (8, 3,  'Batangas Barako Traders', '[["Barako beans",5000,0.92],["Cups and lids",1000,4.50]]'),
      (0, 1,  'Laguna Kakanin Supply',   '[["Kalamansi",300,2],["Pandan buko mix",4000,0.20]]')   -- still open, no receipt yet
    ) v(n, ago, supplier, items) order by ago desc loop
    insert into public.purchase_orders (supplier_id, status, notes, created_by, created_at, received_at, receipt_path)
    values ((select id from public.suppliers where name = po.supplier), case when po.n = 0 then 'ordered' else 'received' end,
            case when po.n = 0 then 'Deliver Friday morning (sample)' else 'Weekly restock (sample)' end, admin,
            ((today - po.ago) + time '08:00') at time zone 'Asia/Manila',
            case when po.n > 0 then ((today - po.ago + 1) + time '10:30') at time zone 'Asia/Manila' end,
            case when po.n > 0 then 'mock/po-receipt-' || po.n || '.png' end)
    returning id into new_po;
    insert into public.purchase_order_items (po_id, ingredient_id, qty, unit_cost)
    select new_po, (select id from public.ingredients where name = e->>0), (e->>1)::numeric, (e->>2)::numeric from jsonb_array_elements(po.items::jsonb) e;
    if po.n > 0 then   -- what receive_purchase_order does: stock in, cost as an ingredients expense
      got_at := ((today - po.ago + 1) + time '10:30') at time zone 'Asia/Manila';
      insert into public.stock_movements (ingredient_id, change, reason, po_id, created_by, created_at)
      select poi.ingredient_id, poi.qty, 'purchase', new_po, admin, got_at from public.purchase_order_items poi where poi.po_id = new_po;
      insert into public.expenses (category, amount, note, spent_on, created_by)
      select 'ingredients', round(sum(poi.qty * poi.unit_cost))::int, 'Purchase order #' || new_po, (got_at at time zone 'Asia/Manila')::date, admin
        from public.purchase_order_items poi where poi.po_id = new_po;
    end if;
  end loop;
end $$;
