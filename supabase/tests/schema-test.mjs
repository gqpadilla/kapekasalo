// Schema test: runs every migration + seed in PGlite (Postgres in Node) with a Supabase-like auth stub,
// then checks pricing, discounts, payments, stock, POS, shifts and role security.
// Usage (installs PGlite into a throwaway folder, not this project):
//   mkdir %TEMP%\pg && cd %TEMP%\pg && npm init -y && npm i @electric-sql/pglite@0.2.17
//   node supabase/tests/schema-test.mjs <that folder> .
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [, , pgDir, projectDir] = process.argv;
const require = createRequire(path.join(pgDir, 'package.json'));
const { pathToFileURL } = await import('node:url');
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href);
const db = new PGlite();

// ---- Supabase-like environment ----
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`);

const dir = path.join(projectDir, 'supabase', 'migrations');
for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); console.log('applied', f); }
  catch (e) { console.error('FAILED', f, e.message); process.exit(1); }
}
await db.exec(fs.readFileSync(path.join(projectDir, 'supabase', 'seed.sql'), 'utf8'));
console.log('seeded');

// The café is non-VAT (seed vat_rate 0); run the first checks in VAT mode so the 12% math stays covered.
await db.exec(`update public.settings set value = '0.12' where key = 'vat_rate'`);

// ---- helpers ----
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', ADMIN = '00000000-0000-0000-0000-0000000000ad';

async function as(role, uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${role};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
async function fails(role, uid, sql, params, pattern) {
  try { await as(role, uid, sql, params); return false; }
  catch (e) { return pattern ? new RegExp(pattern, 'i').test(e.message) || (console.log('      got:', e.message), false) : true; }
}
const one = async (...a) => (await as(...a)).rows[0];
const stock = async name => Number((await db.query('select stock from public.ingredients where name = $1', [name])).rows[0].stock);

// ---- users ----
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@test.ph'), ('${B}', 'b@test.ph'), ('${ADMIN}', 'admin@test.ph');
               update public.profiles set role = 'admin' where id = '${ADMIN}';`);
ok((await db.query('select count(*)::int n from public.profiles')).rows[0].n === 3, 'sign-up creates a customer profile');

// ---- pricing ----
const cart = JSON.stringify([
  { product_id: 'ube-ulap-latte', choices: { size: 1, milk: 1 }, qty: 2, price: 1 },   // client "price" must be ignored
  { product_id: 'ensaymada-royale', choices: { flavor: 1, pack: 1 }, qty: 1 },
]);
const quote = (await one('anon', null, 'select public.quote_order($1) q', [cart])).q;
ok(quote.subtotal === 674 && quote.bundle_discount === 20, `quote: 2×(119+20+20) + (79+10)×4 = 674, bundle −20 (got ${quote.subtotal}, −${quote.bundle_discount})`);
ok(quote.lines[1].variant === 'Ube · Box of 4 · As is', `variant label "${quote.lines[1].variant}"`);
ok(await fails('authenticated', A, 'select public.quote_order($1)', [JSON.stringify([{ product_id: 'kutsinta', choices: { pack: 9 }, qty: 1 }])], 'Invalid'), 'invalid option index rejected');
ok(await fails('authenticated', A, 'select public.quote_order($1)', [JSON.stringify([{ product_id: 'kutsinta', qty: 0 }])], 'Quantity'), 'zero quantity rejected');

// ---- customer ordering + RLS ----
ok(await fails('anon', null, 'select public.place_order($1)', [cart], 'guest'), 'guests must give a name and email');
const order = (await one('authenticated', A, 'select public.place_order($1) o', [cart])).o;
ok(order.total === 654 && order.status === 'pending_payment' && order.items.length === 2, `order placed: total ${order.total}, ${order.status}`);
ok(Math.abs(Number(order.vat) - (654 - 654 / 1.12)) < 0.01, `VAT inside the price: ${order.vat}`);
ok((await as('authenticated', B, 'select * from public.orders')).rows.length === 0, "customer B cannot see customer A's orders");
ok((await as('authenticated', A, 'select * from public.orders')).rows.length === 1, 'customer A sees their own order');
ok(await fails('authenticated', A, `insert into public.orders (channel, subtotal, total) values ('online', 1, 1)`), 'customers cannot insert orders directly');
ok(await fails('authenticated', A, `update public.profiles set role = 'admin' where id = '${A}'`), 'customers cannot make themselves admin');
await as('authenticated', A, `update public.profiles set full_name = 'Ana' where id = '${A}'`);
ok((await db.query(`select full_name from public.profiles where id = '${A}'`)).rows[0].full_name === 'Ana', 'customers can edit their name');
ok(await fails('authenticated', A, `select public.pos_sale($1, 'cash', 1000)`, [cart], 'Admins only'), 'customers cannot use the POS');
ok((await as('authenticated', A, 'select * from public.ingredients')).rows.length === 0, 'customers cannot read inventory');
ok((await as('authenticated', A, 'select * from public.audit_log')).rows.length === 0, 'customers cannot read the audit log');
ok(await fails('authenticated', A, `select public.record_paymongo_payment($1, 'x', 'card', 654, '{}')`, [order.id]), 'customers cannot mark orders paid');

// ---- PayMongo webhook path (service role) ----
await db.query(`insert into public.payments (order_id, provider, provider_ref, amount) values ($1, 'paymongo', 'cs_test_1', 654)`, [order.id]);
const beansBefore = await stock('Espresso beans');
const bad = (await one('service_role', null, `select public.record_paymongo_payment($1, 'cs_test_1', 'card', 600, '{}') r`, [order.id])).r;
ok(!!bad.error && (await db.query(`select status from public.payments where provider_ref = 'cs_test_1'`)).rows[0].status === 'failed', 'wrong paid amount is refused and the payment marked failed');
await db.query(`update public.payments set status = 'pending' where provider_ref = 'cs_test_1'`);
const paid = (await one('service_role', null, `select public.record_paymongo_payment($1, 'cs_test_1', 'qrph', 654, '{}') r`, [order.id])).r;
ok(paid.status === 'paid' && paid.receipt_no != null && paid.payment_method === 'qrph', `webhook marks paid, receipt #${paid.receipt_no}`);
ok(beansBefore - await stock('Espresso beans') === 36, 'stock deducted: 2 lattes × 18 g espresso');
ok(await stock('Flour') === 15000 - 70 * 4, 'box of 4 ensaymada deducts 4 portions of flour');
ok((await db.query(`select loyalty_points from public.profiles where id = '${A}'`)).rows[0].loyalty_points === 13, 'loyalty: ₱654 → 13 points');
const again = (await one('service_role', null, `select public.record_paymongo_payment($1, 'cs_test_1', 'qrph', 654, '{}') r`, [order.id])).r;
ok(again.receipt_no === paid.receipt_no && beansBefore - await stock('Espresso beans') === 36, 'webhook retry does not double-charge stock');

// ---- subscription purchase ----
const sub = (await one('authenticated', B, 'select public.place_order($1) o', [JSON.stringify([{ plan_id: 'monthly', qty: 1 }])])).o;
ok(sub.total === 650 && sub.bundle_discount === 0, 'The Fix monthly plan priced ₱650, no bundle');
await db.query(`insert into public.payments (order_id, provider, provider_ref, amount) values ($1, 'paymongo', 'cs_test_2', 650)`, [sub.id]);
await as('service_role', null, `select public.record_paymongo_payment($1, 'cs_test_2', 'card', 650, '{}')`, [sub.id]);
ok((await as('authenticated', B, 'select * from public.subscriptions')).rows.length === 1, 'paying a plan creates the subscription');
const paused = (await one('authenticated', B, `select (public.update_my_subscription((select id from public.subscriptions limit 1), 'paused')).status s`)).s;
ok(paused === 'paused', 'customer can pause their subscription');

// ---- POS + shift ----
ok(await fails('authenticated', ADMIN, `select public.pos_sale($1, 'cash', 500)`, [cart], 'Open the register'), 'POS needs an open shift');
await as('authenticated', ADMIN, 'select public.open_shift(1000)');
const senior = (await one('authenticated', ADMIN, `select public.pos_sale($1, 'cash', 200, true, 'SC-12345') o`,
  [JSON.stringify([{ product_id: 'kape-kastila', qty: 1 }, { product_id: 'kutsinta', qty: 1 }])])).o;
ok(senior.subtotal === 158 && senior.bundle_discount === 20 && senior.total === 99 && senior.senior_discount === 39,
  `Senior/PWD: (109+49−20)=138, VAT removed 123.21, 20% off → ₱99 (got ${senior.total})`);
ok(senior.change_due === 101 && senior.status === 'paid' && Number(senior.vat) === 0, 'cash change ₱101, VAT-exempt');
ok(await fails('authenticated', ADMIN, `select public.pos_sale($1, 'cash', 200, true, '')`, [JSON.stringify([{ product_id: 'kutsinta', qty: 1 }])], 'ID'), 'Senior/PWD needs an ID number');
ok(await fails('authenticated', ADMIN, `select public.pos_sale($1, 'cash', 10)`, [JSON.stringify([{ product_id: 'barako-brusko', qty: 1 }])], 'less than'), 'cash below total refused');
const barako = (await one('authenticated', ADMIN, `select public.pos_sale($1, 'cash', 100) o`, [JSON.stringify([{ product_id: 'barako-brusko', qty: 1 }])])).o;
const card = (await one('authenticated', ADMIN, `select public.pos_sale($1, 'card') o`, [JSON.stringify([{ product_id: 'espasol', qty: 2 }])])).o;
ok(card.status === 'pending_payment', 'POS card sale waits for PayMongo');

const barakoBeans = await stock('Barako beans');
ok(await fails('authenticated', ADMIN, `select public.void_order($1, '')`, [barako.id], 'reason'), 'void needs a reason');
const voided = (await one('authenticated', ADMIN, `select public.void_order($1, 'Wrong drink') o`, [barako.id])).o;
ok(voided.status === 'refunded' && await stock('Barako beans') === barakoBeans + 18, 'refund restocks ingredients');
ok(await fails('authenticated', ADMIN, `select public.set_order_status($1, 'ready')`, [card.id], 'Cannot move'), 'unpaid order cannot jump to ready');
ok((await one('authenticated', ADMIN, `select (public.set_order_status($1, 'preparing')) ->> 'status' s`, [senior.id])).s === 'preparing', 'order queue: paid → preparing');

const shift = (await one('authenticated', ADMIN, 'select (public.close_shift(1099)).z_report z')).z;
ok(shift.expected_cash === 1099 && shift.over_short === 0, `Z-report expected cash 1000 + 99 + 79 − 79 = ${shift.expected_cash}`);
ok(shift.senior_pwd_discounts === 39 && shift.refunds === 79, 'Z-report shows Senior/PWD discounts and refunds');

// ---- inventory + purchasing ----
const milk = (await db.query(`select id from public.ingredients where name = 'Fresh milk'`)).rows[0].id;
ok(await fails('authenticated', ADMIN, `select public.adjust_stock($1, 'waste', 500)`, [milk], 'note'), 'waste needs a note');
await as('authenticated', ADMIN, `select public.adjust_stock($1, 'waste', 500, 'Spoiled carton')`, [milk]);
await as('authenticated', ADMIN, `select public.adjust_stock($1, 'count', 15000)`, [milk]);
ok(await stock('Fresh milk') === 15000, 'stock count sets the counted value');
ok(await fails('authenticated', ADMIN, `update public.ingredients set stock = 99999 where id = $1`, [milk]), 'stock cannot be edited directly');
const po = (await one('authenticated', ADMIN, `insert into public.purchase_orders (supplier_id) values (2) returning id`)).id;
await as('authenticated', ADMIN, `insert into public.purchase_order_items (po_id, ingredient_id, qty, unit_cost) values ($1, $2, 5000, 0.1)`, [po, milk]);
await as('authenticated', ADMIN, 'select public.receive_purchase_order($1)', [po]);
ok(await stock('Fresh milk') === 20000, 'receiving a purchase order adds stock');
ok((await db.query(`select amount from public.expenses where note = $1`, [`Purchase order #${po}`])).rows[0]?.amount === 500, 'receiving records a ₱500 ingredients expense');

// ---- reports, roles, audit, newsletter ----
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const rep = (await one('authenticated', ADMIN, 'select public.sales_report($1, $1) r', [today])).r;
ok(rep.net_sales === 654 + 650 + 99 && rep.best_sellers.length > 0 && rep.food_cost > 0, `sales report: net ₱${rep.net_sales}, food cost ₱${rep.food_cost}`);
ok(await fails('authenticated', A, 'select public.sales_report($1, $1)', [today], 'Admins only'), 'customers cannot run reports');
ok(await fails('authenticated', ADMIN, `select public.set_user_role('${ADMIN}', 'customer')`, [], 'own admin'), 'admin cannot remove their own admin access');
await as('authenticated', ADMIN, `select public.set_user_role('${B}', 'admin')`);
await as('authenticated', ADMIN, `update public.products set price = 125 where id = 'ube-ulap-latte'`);
const audit = (await as('authenticated', ADMIN, `select action, table_name, actor from public.audit_log`)).rows;
ok(audit.some(r => r.table_name === 'products' && r.action === 'UPDATE' && r.actor === 'admin@test.ph'), 'price change is in the audit log with who did it');
ok(audit.some(r => r.table_name === 'profiles' && r.action === 'UPDATE'), 'role change is audited');
ok(audit.some(r => r.action === 'PAYMENT_MISMATCH'), 'amount mismatch is audited');
ok(await fails('authenticated', ADMIN, 'delete from public.audit_log'), 'admins cannot delete audit rows');
ok(await fails('service_role', null, 'delete from public.audit_log'), 'even the service role cannot delete audit rows');
await as('anon', null, `insert into public.newsletter_subscribers (email) values ('hello@test.ph')`);
ok((await as('anon', null, 'select * from public.newsletter_subscribers')).rows.length === 0, 'anyone can join the newsletter but not read the list');
ok(await fails('anon', null, `insert into public.newsletter_subscribers (email) values ('not-an-email')`), 'bad email rejected');
ok((await as('anon', null, 'select * from public.products')).rows.length === 19, 'visitors can read the menu');

// ---- guest checkout + receipt links ----
const guest = (await one('anon', null, `select public.place_order($1, 'Juan Cruz', ' Juan@Test.PH ') o`, [cart])).o;
ok(guest.guest_email === 'juan@test.ph' && guest.customer_id === null && !!guest.access_token, 'guest order saved with a cleaned-up email and a receipt link');
ok(await fails('anon', null, `select public.place_order($1, 'Juan', 'nope')`, [cart], 'valid email'), 'guest with a bad email refused');
ok(await fails('anon', null, `select public.place_order($1, 'Juan', 'j@test.ph')`, [JSON.stringify([{ plan_id: 'monthly', qty: 1 }])], 'Log in'), 'guests cannot subscribe to The Fix');
ok((await one('anon', null, 'select public.get_order($1, $2) o', [guest.id, guest.access_token])).o.buyer === 'Juan Cruz', 'guest opens their receipt with the link');
ok(await fails('anon', null, 'select public.get_order($1, gen_random_uuid())', [guest.id], 'not found'), 'a wrong receipt link is refused');
ok(await fails('authenticated', A, 'select public.get_order($1)', [guest.id], 'not found'), "a customer cannot open someone else's receipt without the link");
ok(await fails('anon', null, 'select public.get_order($1)', [order.id], 'not found'), 'logged-out visitors cannot open account receipts');
ok((await one('authenticated', A, 'select public.get_order($1) o', [order.id])).o.buyer === 'Ana', 'customer A opens their own receipt');

// ---- non-VAT café (the real setting) ----
await db.exec(`update public.settings set value = '0' where key = 'vat_rate'`);
await as('authenticated', ADMIN, 'select public.open_shift(500)');
const nv = (await one('authenticated', ADMIN, `select public.pos_sale($1, 'cash', 200, true, 'PWD-777') o`,
  [JSON.stringify([{ product_id: 'kape-kastila', qty: 1 }, { product_id: 'kutsinta', qty: 1 }])])).o;
ok(nv.total === 110 && nv.senior_discount === 28 && Number(nv.vat) === 0 && Number(nv.vatable_sales) === 0,
  `non-VAT Senior/PWD: 138 × 80% = ₱110, no VAT lines (got ${nv.total})`);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
