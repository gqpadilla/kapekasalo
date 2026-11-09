# Kasalo Kape

Run it locally from this folder, then open the address it prints (usually http://localhost:3000):

```
npx serve .
```

## Folders

| Folder / file | What's in it |
|---|---|
| `index.html` `the-fix.html` `product.html` `login.html` `account.html` `receipt.html` | The pages (kept here so their addresses stay short) |
| `admin/` | Admin pages (dashboard) |
| `css/` | `brand.css`: fonts, moving text, checkboxes, shared styles |
| `js/` | `supabase.js` (database connection), `cart.js`, `products.js`, `tailwind.config.js`, `chat.js` |
| `img/` | Photos used by the site, `logo/`, `icons/`, `products/`, `gcash-qr.webp` |
| `video/` | Intro film and its poster |
| `fonts/` | Web fonts loaded by `css/brand.css` |
| `api/` | Chatbot function for Vercel (must stay in `api/`) |
| `supabase/` | Database migrations, seed data, schema test, email templates |
| `docs/` | Backend handoff notes, font list |
| `assets-src/` | Original photos, logos and fonts (not loaded by the site) |
