// Cart shared by every page. The bag lives in this browser's localStorage; checkout creates the order in Supabase
// (place_order reprices everything on the server), then opens the order page to pay by GCash QR or at pickup.
(() => {
  const KEY = 'kasalo-cart';
  const peso = n => '₱' + n.toLocaleString('en-PH');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let items = [];
  try { items = JSON.parse(localStorage.getItem(KEY)) || []; } catch { items = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} };

  document.head.insertAdjacentHTML('beforeend', `<style>
    .cart-drawer { margin: 0 0 0 auto; height: 100dvh; max-height: 100dvh; width: min(440px, 100vw); max-width: 100vw;
      padding: 0; border: 0; border-left: 2px solid #141414; background: #FFFFFF; color: #141414; }
    .cart-drawer::backdrop { background: rgba(20, 20, 20, .55); }
    .cart-drawer[open] { animation: cart-in .25s ease-out; }
    @keyframes cart-in { from { transform: translateX(100%); } }
    body:has(.cart-drawer[open]) { overflow: hidden; }
    @media (prefers-reduced-motion: reduce) { .cart-drawer[open] { animation: none; } }
  </style>`);

  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="cart" class="cart-drawer" aria-labelledby="cart-title">
      <div class="flex flex-col h-full">
        <div class="flex items-center justify-between px-6 h-16 border-b-2 border-tinta shrink-0">
          <h2 id="cart-title" class="font-display uppercase text-xl">Your Bag <span id="cart-title-count" class="font-sans normal-case text-base"></span></h2>
          <button type="button" data-cart-close aria-label="Close bag" class="w-10 h-10 grid place-items-center rounded-full hover:bg-gata transition">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div id="cart-body" class="flex-1 overflow-y-auto px-6"></div>
        <div id="cart-foot" class="shrink-0 border-t-2 border-tinta bg-gata px-6 py-5"></div>
      </div>
    </dialog>
    <div id="cart-toast" role="status" aria-live="polite" class="fixed z-50 top-20 right-4 left-4 sm:left-auto sm:w-96 transition duration-200 opacity-0 -translate-y-2 pointer-events-none"></div>`);

  const dialog = document.getElementById('cart');
  const body = document.getElementById('cart-body');
  const foot = document.getElementById('cart-foot');
  const toast = document.getElementById('cart-toast');
  const count = () => items.reduce((n, i) => n + i.qty, 0);
  const subtotal = () => items.reduce((n, i) => n + i.qty * i.price, 0);

  // Kasalo Bundle: each drink (coffee or cooler) paired with a pastry or rice cake saves ₱20.
  // Pairs are counted by quantity as sold (a "Box of 4" line is one pastry); The Fix plans have no cat and never count.
  const BUNDLE_OFF = 20;
  const catOf = i => i.cat || window.KASALO?.find(i.key.split('|')[0])?.cat;   // items saved before cat was stored
  const qtyIn = (list, cats) => list.filter(i => cats.includes(catOf(i))).reduce((n, i) => n + i.qty, 0);
  const bundlesIn = list => Math.min(qtyIn(list, ['coffee', 'coolers']), qtyIn(list, ['pastries']));
  console.assert(bundlesIn([{ key: 'a', cat: 'coffee', qty: 2 }, { key: 'b', cat: 'pastries', qty: 1 }, { key: 'the-fix-1-year', qty: 1 }]) === 1
    && bundlesIn([{ key: 'a', cat: 'coolers', qty: 3 }, { key: 'b', cat: 'pastries', qty: 2 }]) === 2
    && bundlesIn([{ key: 'b', cat: 'pastries', qty: 4 }]) === 0, 'Kasalo Bundle pairing');
  const discount = () => bundlesIn(items) * BUNDLE_OFF;
  const total = () => subtotal() - discount();
  const thumb = src => src
    ? `<img src="${esc(src)}" alt="" class="w-full h-full object-contain">`
    : `<img src="img/logo/cup-logo.png" alt="" class="w-full h-full object-contain opacity-40">`;

  function render() {
    const n = count();
    const countEl = document.getElementById('cart-count');
    if (countEl) countEl.textContent = n;
    document.getElementById('cart-dot')?.classList.toggle('hidden', n === 0);
    document.getElementById('cart-title-count').textContent = n ? `(${n})` : '';

    if (!items.length) {
      body.innerHTML = `
        <div class="h-full grid place-content-center text-center gap-3 py-16">
          <p class="font-display uppercase text-2xl">Your bag is empty</p>
          <p class="font-serif text-lg">Pick a drink, grab a pastry, bring a kasalo.</p>
        </div>`;
      foot.innerHTML = `<a href="index.html#menu" data-cart-close class="block text-center bg-banga text-papel font-label font-bold uppercase tracking-wider py-4 rounded-full border-2 border-tinta hover:shadow-ube-sm transition">Shop the menu</a>`;
      return;
    }

    body.innerHTML = `<ul>${items.map(i => `
      <li class="flex gap-4 py-5 border-b border-tinta/15">
        <div class="w-20 h-20 shrink-0 rounded-xl bg-gata overflow-hidden p-1">${thumb(i.img)}</div>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between gap-3">
            <p class="font-bold leading-snug">${esc(i.name)}</p>
            <p class="font-bold whitespace-nowrap">${peso(i.price * i.qty)}</p>
          </div>
          ${i.variant ? `<p class="text-sm text-tinta/70">${esc(i.variant)}</p>` : ''}
          <div class="mt-3 flex items-center justify-between">
            <div class="inline-flex items-center border-2 border-tinta rounded-full">
              <button type="button" data-qty="-1" data-key="${esc(i.key)}" aria-label="Remove one ${esc(i.name)}" class="w-9 h-9 grid place-items-center text-lg hover:text-banga">−</button>
              <span class="w-7 text-center font-bold">${i.qty}</span>
              <button type="button" data-qty="1" data-key="${esc(i.key)}" aria-label="Add one more ${esc(i.name)}" class="w-9 h-9 grid place-items-center text-lg hover:text-banga">+</button>
            </div>
            <button type="button" data-remove="${esc(i.key)}" class="text-sm underline underline-offset-4 hover:text-banga">Remove</button>
          </div>
        </div>
      </li>`).join('')}</ul>`;

    foot.innerHTML = `
      <dl class="space-y-1">
        <div class="flex justify-between"><dt>Subtotal</dt><dd>${peso(subtotal())}</dd></div>
        ${discount() ? `<div class="flex justify-between font-bold text-banga"><dt>Kasalo Bundle${bundlesIn(items) > 1 ? ` ×${bundlesIn(items)}` : ''}</dt><dd>−${peso(discount())}</dd></div>` : ''}
        <div class="flex justify-between text-sm"><dt>Pickup at Padre Faura St.</dt><dd>Free</dd></div>
        <div class="flex justify-between font-bold text-lg pt-2 border-t-2 border-dashed border-ube mt-2"><dt>Total</dt><dd>${peso(total())}</dd></div>
      </dl>
      <button type="button" data-checkout class="mt-4 w-full bg-banga text-papel font-label font-bold uppercase tracking-wider py-4 rounded-full border-2 border-tinta shadow-ube hover:-translate-y-0.5 transition">Checkout</button>
      <button type="button" data-cart-close class="mt-2 w-full font-label font-bold uppercase tracking-wider text-sm py-3 rounded-full hover:bg-papel transition">Continue shopping</button>`;
  }

  // ---------- Checkout ----------
  // A bag line as the server expects it: { product_id, choices, qty } or { plan_id, qty } for The Fix.
  const toServer = i => {
    const id = i.pid || i.key.split('|')[0];
    return id.startsWith('the-fix-') ? { plan_id: id.slice(8), qty: i.qty } : { product_id: id, choices: i.choices || {}, qty: i.qty };
  };
  const hasPlan = () => items.some(i => (i.pid || i.key).startsWith('the-fix-'));
  const rootPath = () => (location.pathname.includes('/admin/') ? '../' : '');
  let guestSaved = {};
  try { guestSaved = JSON.parse(localStorage.getItem('kasalo-guest')) || {}; } catch {}

  async function checkout() {
    const me = await window.KK?.profile().catch(() => null);
    const plan = hasPlan();
    const back = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    body.innerHTML = `
      <form id="checkout-form" class="py-6 grid gap-6" novalidate>
        <div>
          <p class="font-label uppercase tracking-wider text-xs">Step 2 of 2</p>
          <p class="font-serif text-3xl leading-tight mt-1">Almost yours.</p>
        </div>
        ${me ? `
          <div class="rounded-2xl border-2 border-tinta bg-gata-light p-4">
            <p class="text-sm">Ordering as</p>
            <p class="font-bold">${esc(me.full_name || me.email)}</p>
            <p class="text-sm text-tinta/70">${esc(me.email)}</p>
          </div>` : `
          <div class="grid gap-4">
            <p class="text-sm">Checking out as a guest. <a href="${rootPath()}login.html?next=${back}" class="underline underline-offset-4 hover:text-banga">Log in</a> to earn points${plan ? ' (needed for The Fix)' : ''}.</p>
            <label class="block"><span class="font-label uppercase tracking-wider text-xs">Your name</span>
              <input name="name" autocomplete="name" value="${esc(guestSaved.name || '')}" class="mt-1 w-full px-4 py-3 rounded-xl border-2 border-tinta focus:outline-none focus:shadow-ube-sm" placeholder="Juan dela Cruz"></label>
            <label class="block"><span class="font-label uppercase tracking-wider text-xs">Email for your receipt</span>
              <input name="email" type="email" autocomplete="email" value="${esc(guestSaved.email || '')}" class="mt-1 w-full px-4 py-3 rounded-xl border-2 border-tinta focus:outline-none focus:shadow-ube-sm" placeholder="you@email.com"></label>
          </div>`}
        <fieldset class="grid gap-3">
          <legend class="font-label uppercase tracking-wider text-xs mb-3">How will you pay?</legend>
          <label class="flex gap-3 items-start rounded-2xl border-2 border-tinta p-4 cursor-pointer has-[:checked]:bg-kalamansi-soft has-[:checked]:shadow-ube-sm">
            <input type="radio" name="pay" value="gcash_qr" checked class="kk-check rounded-full mt-0.5">
            <span><b>GCash / InstaPay QR</b><br><span class="text-sm">Scan our QR with GCash, Maya or any bank app, then enter the reference number.</span></span>
          </label>
          <label class="flex gap-3 items-start rounded-2xl border-2 border-tinta p-4 ${plan ? 'opacity-50' : 'cursor-pointer'} has-[:checked]:bg-kalamansi-soft has-[:checked]:shadow-ube-sm">
            <input type="radio" name="pay" value="pickup" ${plan ? 'disabled' : ''} class="kk-check rounded-full mt-0.5">
            <span><b>Pay at pickup</b><br><span class="text-sm">${plan ? 'Not available for The Fix subscriptions.' : 'Pay cash at the counter on Padre Faura St.'}</span></span>
          </label>
        </fieldset>
        <p id="checkout-error" role="alert" hidden class="rounded-2xl border-2 border-sili bg-sili-soft px-4 py-3 text-sm"></p>
      </form>`;
    foot.innerHTML = `
      <div class="flex justify-between font-bold text-lg"><span>Total</span><span>${peso(total())}</span></div>
      <button type="submit" form="checkout-form" id="place-order" class="mt-4 w-full bg-banga text-papel font-label font-bold uppercase tracking-wider py-4 rounded-full border-2 border-tinta shadow-ube hover:-translate-y-0.5 transition disabled:opacity-60">Place order</button>
      <button type="button" data-cart-back class="mt-2 w-full font-label font-bold uppercase tracking-wider text-sm py-3 rounded-full hover:bg-papel transition">Back to bag</button>`;
    body.querySelector('input[name="name"]')?.focus();

    document.getElementById('checkout-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target, err = document.getElementById('checkout-error'), btn = document.getElementById('place-order');
      const fail = m => { err.hidden = false; err.textContent = m; btn.disabled = false; btn.textContent = 'Place order'; };
      if (!window.KK?.configured) return fail('Ordering is offline right now. Please try again later.');
      const name = form.elements.name?.value.trim(), email = form.elements.email?.value.trim();
      if (!me) {
        if (!name) return fail('Please tell us your name.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return fail('Enter a valid email for your receipt.');
        try { localStorage.setItem('kasalo-guest', JSON.stringify({ name, email })); } catch {}
      }
      btn.disabled = true; btn.textContent = 'Placing your order…';
      const { data, error } = await KK.sb.rpc('place_order', {
        p_items: items.map(toServer), p_guest_name: me ? null : name, p_guest_email: me ? null : email,
        p_pay_option: form.elements.pay.value,
      });
      if (error) return fail(KK.message(error));
      items = []; save();
      location.href = `${rootPath()}receipt.html?order=${data.id}&t=${data.access_token}`;
    });
  }

  let toastTimer;
  function showToast(item) {
    toast.innerHTML = `
      <div class="bg-papel border-2 border-tinta rounded-2xl p-4 shadow-ube flex gap-4 items-center pointer-events-auto">
        <div class="w-14 h-14 shrink-0 rounded-lg bg-gata overflow-hidden p-1">${thumb(item.img)}</div>
        <div class="flex-1 min-w-0">
          <p class="flex items-center gap-1.5 font-label font-bold uppercase tracking-wider text-xs text-banga">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6"/></svg>Added to bag
          </p>
          <p class="font-bold truncate">${esc(item.name)}${item.variant ? ` · ${esc(item.variant)}` : ''}</p>
        </div>
        <button type="button" data-cart-open class="shrink-0 font-label font-bold uppercase tracking-wider text-xs px-3 py-2 rounded-full border-2 border-tinta hover:bg-kalamansi transition">View bag (${count()})</button>
      </div>`;
    toast.classList.remove('opacity-0', '-translate-y-2', 'pointer-events-none');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 3500);
  }
  const hideToast = () => toast.classList.add('opacity-0', '-translate-y-2', 'pointer-events-none');

  function open() {
    hideToast();
    render();
    dialog.showModal();
  }

  // item: { id, name, price, cat?, img?, variant?, choices? }
  //   cat: products.js category (Kasalo Bundle estimate); choices: { optionKey: choiceIndex } sent to the server at checkout
  function add(item, qty = 1) {
    const key = item.id + (item.variant ? '|' + item.variant : '');
    const found = items.find(i => i.key === key);
    if (found) found.qty += qty;
    else items.push({ key, pid: item.id, choices: item.choices || {}, name: item.name, price: item.price, cat: item.cat || '',
                      img: item.img || null, variant: item.variant || '', qty });
    save(); render(); showToast(item);
  }

  document.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('#cart-btn, [data-cart-open]')) return open();
    if (t.closest('[data-cart-close]')) return dialog.close();
    if (t === dialog) return dialog.close(); // click on the backdrop
    if (t.closest('[data-checkout]')) return checkout();
    if (t.closest('[data-cart-back]')) return render();
    const qtyBtn = t.closest('[data-qty]');
    if (qtyBtn) {
      const i = items.find(x => x.key === qtyBtn.dataset.key);
      i.qty += Number(qtyBtn.dataset.qty);
      if (i.qty < 1) items = items.filter(x => x !== i);
      save(); return render();
    }
    const rm = t.closest('[data-remove]');
    if (rm) { items = items.filter(x => x.key !== rm.dataset.remove); save(); render(); }
  });

  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    try { items = JSON.parse(e.newValue) || []; } catch { items = []; }
    render();
  });

  window.KasaloCart = { add, open };
  render();
})();
