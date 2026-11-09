# Kasalo Kape: Backend and Database Handoff

The frontend is a static site (Tailwind CDN, plain JavaScript, deployed on Vercel). Everything that should come from a server is mocked in the browser today. This document lists each mock, the data shape the pages already use, and the endpoints that would replace it, so the frontend swap is small.

## 1. What is mocked today

| Feature | Where | Today | Needs |
|---|---|---|---|
| Product catalog | `products.js` (`window.KASALO`) | Hard-coded array | Products API + DB |
| Cart | `cart.js` (`window.KasaloCart`) | `localStorage` key `kasalo-cart` | Optional server cart |
| Checkout | `cart.js` `checkout()` | Random order no. `KK-####`, no payment | Orders API + payment |
| Kasalo Bundle discount | `cart.js` `bundlesIn()` | Computed in the browser | **Recompute on the server** |
| The Fix subscription | `the-fix.html` | Plan radios added to cart as one line item | Subscriptions + recurring billing |
| Past lots ("Recent coffees") | `the-fix.html` `LOTS` | Hard-coded array | Lots API |
| Newsletter | `index.html` `.newsletter` form | Shows "Thanks!" and sends nothing | Subscribe endpoint |
| Account icon | header | `href="#"` | Auth (later) |
| Trees counter | footer `#tree-count` ("1,248") | Static text | Stats endpoint (optional) |

## 2. Data shapes the frontend already uses

### Product (`products.js`)
```js
{
  id: 'ube-ulap-latte',          // slug of name, used in URLs: product.html?id=…
  name: 'Ube Ulap Latte',
  cat: 'coffee',                  // 'coffee' | 'coolers' | 'pastries'
  price: 119,                     // whole pesos (integer)
  tags: ['Iced', 'Best Seller'],  // Hot, Iced, Best Seller, Seasonal, Pastry, Rice Cake
  img: 'ube-latte.jpg' | null,    // null = "catalog photo coming soon"
  desc: '…', note?: 'Per slice',
  notes: [['Condensed milk', 'kalamansi'], …],          // tasting notes + brand color key
  variants?: [{ label: 'Classic', price: 79 }, { label: 'Ube', price: 89 }],
  options?: [...]                 // else category defaults (below)
}
```
Category option groups (`OPTIONS` in `products.js`):
- **coffee:** size (12 oz / 16 oz +₱20), milk (as served / oat +₱20 / coconut +₱20), sweetness
- **coolers:** size (+₱20 for 16 oz), sweetness, ice
- **pastries:** pack (single / box of 4 `mult: 4` / box of 6 `mult: 6`), serve (as is / warmed)

### Cart line (`localStorage['kasalo-cart']`)
```js
{ key: 'ensaymada-royale|Classic', name, price, cat, img, variant: 'Classic', qty }
```
`key` = product id + `|` + variant label. `price` is the unit price after options.

### The Fix plans (`the-fix.html`)
| value | name | rate (₱/mo) | billed |
|---|---|---|---|
| `monthly` | Monthly | 650 | ₱650 every month |
| `1-year` | 1 Year | 595 | ₱7,140 once a year |
| `2-years` | 2 Years | 565 | ₱13,560 every 2 years |

These are added to the cart as `id: 'the-fix-<value>'`, with no `cat`.

### Lot (`the-fix.html` `LOTS`)
```js
{ name, origin, process: 'Natural' | 'Honey' | 'Washed', roast, masl: '1,400', month: 'Oct 2026', notes, fruit: 0-100 }
```

## 3. Business rules the server must own

- **Kasalo Bundle:** ₱20 off for each drink (`coffee` or `coolers`) paired with a `pastries` item. Number of pairs = `min(drink qty, pastry qty)`, counted per line quantity as sold (a box of 4 counts as one pastry). The Fix never counts. Reference implementation: `bundlesIn()` in `cart.js`. **Never trust a client-sent total.**
- Prices are whole pesos. Store them as integers.
- Pickup is at Padre Faura St., Ermita and is free. The order confirmation says it's ready in about 15 minutes.
- The Fix: one 250 g bag a month, free delivery in Metro Manila, pause or cancel anytime. Annual plans include free gear (up to ₱5,000 for 1 year, ₱9,500 for 2 years).

## 4. Proposed endpoints

```
GET    /api/products                  ?cat=&tag=   -> Product[]
GET    /api/products/:id                           -> Product
GET    /api/lots                      ?process=    -> Lot[]
GET    /api/plans                                  -> Plan[]

POST   /api/orders            { items: [{ productId, variant, options, qty }] }
       -> { orderNo, lines, subtotal, bundleDiscount, total, pickupEta }
       (server reprices every line and recomputes the bundle)
GET    /api/orders/:orderNo

POST   /api/subscriptions     { plan, grind, address, … } -> { id, status, nextShip }
PATCH  /api/subscriptions/:id { status: 'paused' | 'active' | 'cancelled' }

POST   /api/newsletter        { email } -> 204   (validate, dedupe)
GET    /api/stats/trees                  -> { count: 1248, since: 2024 }
```
Errors: JSON `{ error: { code, message } }` with 4xx/5xx status codes.

## 5. Suggested tables

```
products(id PK slug, name, cat, price int, tags text[], img, description, note, sort_order, active bool)
product_variants(id, product_id FK, label, price int)
product_options(id, product_id FK null, cat null, key, label, choice, add_price int, mult int)  -- null product_id = category default
orders(id, order_no unique, status, subtotal int, bundle_discount int, total int, pickup_eta, created_at)
order_items(id, order_id FK, product_id FK, variant, options jsonb, unit_price int, qty)
plans(id, value unique, name, rate int, total int, billing_text)
subscriptions(id, plan_id FK, customer_id FK, status, address, grind, next_ship_at, created_at)
lots(id, name, origin, process, roast, masl, month date, notes, fruit int)
customers(id, email unique, name, phone, created_at)
newsletter_subscribers(email PK, created_at)
```

## 6. Frontend swap points (small, local edits)

- `products.js`: replace the inline array with `await fetch('/api/products')`. Keep the same object shape and `KASALO.find/optionsFor`.
- `cart.js` `checkout()`: `POST /api/orders` and show the returned `orderNo` and `total` instead of the random number and local total.
- `the-fix.html` add-plan handler: `POST /api/subscriptions`. Render `LOTS` from `/api/lots`.
- `index.html` newsletter handler: `POST /api/newsletter`.

## 7. Open questions

1. Payment provider (GCash / Maya / card) and whether checkout requires an account.
2. Do customer accounts come before or after launch? (The header account icon is a placeholder.)
3. Should the cart sync to the server or stay in the browser until checkout?
4. Who updates the trees count, and from what source?
5. Delivery zones and fees beyond Metro Manila for The Fix.
