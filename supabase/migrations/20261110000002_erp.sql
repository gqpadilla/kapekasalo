-- Kasalo Kape ERP: inventory with recipes, purchasing, shifts and cash, expenses, waste, promotions.
-- All tables here are admin-only.

create table public.ingredients (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  unit          text not null check (unit in ('g', 'ml', 'pc')),
  stock         numeric(12, 2) not null default 0,
  low_stock_at  numeric(12, 2) not null default 0,   -- alert threshold
  cost_per_unit numeric(12, 4) not null default 0,   -- pesos per unit, updated when stock is received
  active        boolean not null default true
);

-- How much of each ingredient one unit of a product uses. Packs (Box of 4) multiply this.
create table public.recipes (
  product_id    text references public.products (id) on delete cascade,
  ingredient_id bigint references public.ingredients (id),
  qty           numeric(12, 2) not null check (qty > 0),
  primary key (product_id, ingredient_id)
);

create table public.suppliers (
  id         bigint generated always as identity primary key,
  name       text not null,
  contact    text,
  phone      text,
  email      text,
  notes      text,
  created_at timestamptz not null default now()
);

create table public.purchase_orders (
  id          bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers (id),
  status      text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  notes       text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  received_at timestamptz
);

create table public.purchase_order_items (
  id            bigint generated always as identity primary key,
  po_id         bigint not null references public.purchase_orders (id) on delete cascade,
  ingredient_id bigint not null references public.ingredients (id),
  qty           numeric(12, 2) not null check (qty > 0),
  unit_cost     numeric(12, 4) not null check (unit_cost >= 0)
);

-- Every change to stock is a row here; ingredients.stock is the running total.
create table public.stock_movements (
  id            bigint generated always as identity primary key,
  ingredient_id bigint not null references public.ingredients (id),
  change        numeric(12, 2) not null,
  reason        text not null check (reason in ('sale', 'refund', 'purchase', 'waste', 'count', 'adjust')),
  order_id      uuid references public.orders (id),
  po_id         bigint references public.purchase_orders (id),
  note          text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index on public.stock_movements (ingredient_id, created_at desc);

create table public.shifts (
  id            bigint generated always as identity primary key,
  opened_by     uuid not null references public.profiles (id),
  opened_at     timestamptz not null default now(),
  opening_cash  integer not null check (opening_cash >= 0),
  closed_by     uuid references public.profiles (id),
  closed_at     timestamptz,
  expected_cash integer,
  counted_cash  integer,
  z_report      jsonb,
  notes         text
);
-- only one register open at a time
create unique index one_open_shift on public.shifts ((true)) where closed_at is null;

alter table public.orders add constraint orders_shift_fk foreign key (shift_id) references public.shifts (id);

create table public.expenses (
  id         bigint generated always as identity primary key,
  category   text not null check (category in ('ingredients', 'rent', 'utilities', 'salaries', 'supplies', 'marketing', 'other')),
  amount     integer not null check (amount > 0),
  note       text,
  spent_on   date not null default current_date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.promotions (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('bundle', 'percent_off')),
  name       text not null,
  value      integer not null check (value > 0),     -- bundle: pesos off per pair; percent_off: percent
  starts_on  date,
  ends_on    date,
  active     boolean not null default true
);

-- ============ Audit ============
create trigger audit after insert or update or delete on public.ingredients     for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.recipes         for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.suppliers       for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.purchase_orders for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.shifts          for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.expenses        for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.promotions      for each row execute function public.audit_row();

-- ============ Row Level Security: admins only ============
do $$
declare t text;
begin
  foreach t in array array['ingredients', 'recipes', 'suppliers', 'purchase_orders', 'purchase_order_items',
                           'stock_movements', 'shifts', 'expenses', 'promotions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admin only" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Customers need the active bundle amount to show it in the cart.
create policy "public active promotions" on public.promotions for select to anon, authenticated using (active);

-- Stock only changes through adjust_stock / sales / receiving, so the ledger and the total stay in sync.
revoke insert, update, delete on public.stock_movements from authenticated;
-- (a column revoke does not override a table grant, so revoke the table and re-grant the editable columns)
revoke update on public.ingredients from authenticated;
grant update (name, unit, low_stock_at, cost_per_unit, active) on public.ingredients to authenticated;
