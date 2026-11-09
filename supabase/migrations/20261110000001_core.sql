-- Kasalo Kape core schema: accounts and roles, catalog, orders, payments, subscriptions, settings, audit log.
-- Money is stored in whole pesos (integer). Menu prices are VAT-inclusive.

-- ============ Accounts and roles ============
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null,
  role           text not null default 'customer' check (role in ('customer', 'admin')),
  full_name      text,
  phone          text,
  loyalty_points integer not null default 0 check (loyalty_points >= 0),
  created_at     timestamptz not null default now()
);

-- Every new sign-up gets a customer profile. Admins are promoted later (see README).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Customers may edit their own name and phone, never their role, email or points.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- ============ Catalog ============
create table public.products (
  id          text primary key,                 -- slug, used in product.html?id=
  name        text not null,
  cat         text not null check (cat in ('coffee', 'coolers', 'pastries')),
  price       integer not null check (price > 0),
  tags        text[] not null default '{}',
  img         text,                             -- file in img/products/, null = photo coming soon
  description text,
  note        text,
  notes       jsonb not null default '[]',      -- [[label, color], ...]
  variants    jsonb,                            -- [{label, price}] for the shop-card pills
  options     jsonb not null default '[]',      -- [{key, label, choices: [{label, add?, mult?}]}], already resolved per product
  sort_order  integer not null default 0,
  active      boolean not null default true,    -- false = removed from the menu
  in_stock    boolean not null default true,    -- false = shown as sold out
  updated_at  timestamptz not null default now()
);

create table public.plans (                     -- The Fix subscription plans
  id           text primary key,                -- 'monthly' | '1-year' | '2-years'
  name         text not null,
  rate         integer not null,                -- pesos per month, for display
  total        integer not null,                -- billed amount
  months       integer not null,
  billing_text text not null,
  active       boolean not null default true
);

create table public.lots (                      -- past and current The Fix coffees
  id         bigint generated always as identity primary key,
  name       text not null,
  origin     text not null,
  process    text not null check (process in ('Natural', 'Washed', 'Honey')),
  roast      text not null,
  masl       text not null,
  month      date not null,
  notes      text not null,
  fruit      integer not null check (fruit between 0 and 100),
  created_at timestamptz not null default now()
);

-- ============ Orders and payments ============
create sequence public.receipt_seq;

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        bigint generated always as identity unique,
  channel         text not null check (channel in ('online', 'pos')),
  customer_id     uuid references public.profiles (id),
  guest_name      text,                           -- guest checkout (no account)
  guest_email     text,
  access_token    uuid not null default gen_random_uuid(),   -- private receipt link for guests: receipt.html?order=…&t=…
  status         text not null default 'pending_payment'
                  check (status in ('pending_payment', 'paid', 'preparing', 'ready', 'completed', 'cancelled', 'refunded')),
  payment_method  text check (payment_method in ('cash', 'card', 'qrph', 'gcash', 'maya')),
  subtotal        integer not null,
  bundle_discount integer not null default 0,
  senior_discount integer not null default 0,     -- Senior Citizen / PWD (POS only, ID checked at the counter)
  senior_id       text,
  total           integer not null check (total >= 0),
  vatable_sales   numeric(12, 2) not null default 0,
  vat             numeric(12, 2) not null default 0,
  vat_exempt      numeric(12, 2) not null default 0,
  cash_tendered   integer,
  change_due      integer,
  receipt_no      bigint unique,                  -- assigned when paid, sequential
  shift_id        bigint,                         -- fk added in the ERP migration
  created_by      uuid references public.profiles (id),
  void_reason     text,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);

create table public.order_items (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders (id) on delete cascade,
  product_id text references public.products (id),
  plan_id    text references public.plans (id),
  name       text not null,
  cat        text,
  variant    text not null default '',
  choices    jsonb not null default '{}',
  unit_price integer not null,
  pack_mult  integer not null default 1,           -- Box of 4 = 4 portions, used for stock deduction
  qty        integer not null check (qty between 1 and 50),
  line_total integer not null,
  check ((product_id is null) <> (plan_id is null))
);

create table public.payments (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders (id) on delete cascade,
  provider     text not null check (provider in ('paymongo', 'cash')),
  method       text,
  provider_ref text unique,                        -- PayMongo checkout session id
  checkout_url text,
  status       text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
  amount       integer not null,
  raw          jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.subscriptions (
  id           bigint generated always as identity primary key,
  customer_id  uuid not null references public.profiles (id),
  plan_id      text not null references public.plans (id),
  order_id     uuid references public.orders (id),
  status       text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  grind        text not null default 'Whole bean',
  address      text,
  next_ship_at date,
  ends_at      date,
  created_at   timestamptz not null default now()
);

create table public.newsletter_subscribers (
  email      text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);

create table public.settings (
  key   text primary key,
  value jsonb not null
);

create index on public.orders (customer_id, created_at desc);
create index on public.orders (status, created_at);
create index on public.orders (created_at);
create index on public.order_items (order_id);
create index on public.payments (order_id);

-- ============ Audit log (append-only) ============
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  actor      text not null,                        -- email, or 'system' for webhooks
  action     text not null,                        -- INSERT | UPDATE | DELETE | custom event
  table_name text,
  row_id     text,
  old_data   jsonb,
  new_data   jsonb
);
create index on public.audit_log (at desc);
create index on public.audit_log (table_name, row_id);

-- Nobody, admins included, can change or remove history.
revoke update, delete, truncate on public.audit_log from anon, authenticated, service_role;

create function public.write_audit(p_action text, p_table text, p_row text, p_old jsonb, p_new jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, actor, action, table_name, row_id, old_data, new_data)
  values (auth.uid(),
          coalesce((select email from public.profiles where id = auth.uid()), 'system'),
          p_action, p_table, p_row, p_old, p_new);
$$;
revoke execute on function public.write_audit from public, anon, authenticated;

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  -- skip updates that change nothing
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return new; end if;
  perform public.write_audit(tg_op, tg_table_name, coalesce(r ->> 'id', r ->> 'key', r ->> 'email'),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit after insert or update or delete on public.products   for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.plans      for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.settings   for each row execute function public.audit_row();
create trigger audit after update or delete            on public.orders     for each row execute function public.audit_row();
create trigger audit after update or delete            on public.payments   for each row execute function public.audit_row();
create trigger audit after update of role or delete    on public.profiles   for each row execute function public.audit_row();
create trigger audit after insert or update or delete on public.subscriptions for each row execute function public.audit_row();

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch before update on public.products for each row execute function public.touch_updated_at();
create trigger touch before update on public.payments for each row execute function public.touch_updated_at();

-- ============ Row Level Security ============
alter table public.profiles               enable row level security;
alter table public.products               enable row level security;
alter table public.plans                  enable row level security;
alter table public.lots                   enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.payments               enable row level security;
alter table public.subscriptions          enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.settings               enable row level security;
alter table public.audit_log              enable row level security;

-- profiles: see and edit yourself; admins see and edit everyone
create policy "own profile or admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy "edit own profile or admin" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_admin()) with check (id = (select auth.uid()) or public.is_admin());

-- catalog: everyone reads what is on sale; admins manage everything
create policy "public menu" on public.products for select to anon, authenticated using (active or public.is_admin());
create policy "admin menu"  on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public plans" on public.plans for select to anon, authenticated using (active or public.is_admin());
create policy "admin plans"  on public.plans for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public lots" on public.lots for select to anon, authenticated using (true);
create policy "admin lots"  on public.lots for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "public settings" on public.settings for select to anon, authenticated using (true);
create policy "admin settings"  on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- orders: created only through place_order / pos_sale (no insert policy); customers read their own
create policy "own orders or admin" on public.orders for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_admin());
create policy "own order items or admin" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or public.is_admin())));
create policy "own payments or admin" on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or public.is_admin())));

create policy "own subscriptions or admin" on public.subscriptions for select to authenticated
  using (customer_id = (select auth.uid()) or public.is_admin());

-- newsletter: anyone may sign up; only admins can read the list
create policy "anyone subscribes" on public.newsletter_subscribers for insert to anon, authenticated with check (true);
create policy "admin reads list"  on public.newsletter_subscribers for select to authenticated using (public.is_admin());

create policy "admin reads audit" on public.audit_log for select to authenticated using (public.is_admin());
