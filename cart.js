// Mock cart shared by index.html and menu.html.
// shortcut: front-end only, saved in this browser's localStorage; checkout is a demo with no payment or backend.
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
  const thumb = src => src
    ? `<img src="${esc(src)}" alt="" class="w-full h-full object-contain">`
    : `<img src="cup%20logo%202.png" alt="" class="w-full h-full object-contain opacity-40">`;

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
      foot.innerHTML = `<a href="menu.html#menu" data-cart-close class="block text-center bg-banga text-papel font-label font-bold uppercase tracking-wider py-4 rounded-full border-2 border-tinta hover:shadow-ube-sm transition">Shop the menu</a>`;
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
        <div class="flex justify-between text-sm"><dt>Pickup at Padre Faura St.</dt><dd>Free</dd></div>
        <div class="flex justify-between font-bold text-lg pt-2 border-t-2 border-dashed border-ube mt-2"><dt>Total</dt><dd>${peso(subtotal())}</dd></div>
      </dl>
      <button type="button" data-checkout class="mt-4 w-full bg-banga text-papel font-label font-bold uppercase tracking-wider py-4 rounded-full border-2 border-tinta shadow-ube hover:-translate-y-0.5 transition">Checkout</button>
      <button type="button" data-cart-close class="mt-2 w-full font-label font-bold uppercase tracking-wider text-sm py-3 rounded-full hover:bg-papel transition">Continue shopping</button>`;
  }

  function checkout() {
    const order = 'KK-' + Math.floor(1000 + Math.random() * 9000);
    const total = subtotal();
    items = []; save(); render();
    body.innerHTML = `
      <div class="h-full grid place-content-center text-center gap-3 py-16">
        <div class="relative w-28 mx-auto" aria-hidden="true">
          <svg viewBox="0 0 100 100" class="w-full"><use href="#burst" fill="#F2B732" stroke="#141414" stroke-width="1.5"/></svg>
          <svg class="absolute inset-0 m-auto w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>
        </div>
        <p class="font-display uppercase text-2xl text-banga">Order received!</p>
        <p class="font-serif text-lg">Order <b>${order}</b> · ${peso(total)}<br>Ready for pickup at Padre Faura St. in about 15 minutes.</p>
        <p class="text-sm text-tinta/70">This is a demo checkout. No payment was taken.</p>
      </div>`;
    foot.innerHTML = `<button type="button" data-cart-close class="w-full bg-banga text-papel font-label font-bold uppercase tracking-wider py-4 rounded-full border-2 border-tinta hover:shadow-ube-sm transition">Back to shopping</button>`;
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

  // item: { id, name, price, img?, variant? }
  function add(item, qty = 1) {
    const key = item.id + (item.variant ? '|' + item.variant : '');
    const found = items.find(i => i.key === key);
    if (found) found.qty += qty;
    else items.push({ key, name: item.name, price: item.price, img: item.img || null, variant: item.variant || '', qty });
    save(); render(); showToast(item);
  }

  document.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('#cart-btn, [data-cart-open]')) return open();
    if (t.closest('[data-cart-close]')) return dialog.close();
    if (t === dialog) return dialog.close(); // click on the backdrop
    if (t.closest('[data-checkout]')) return checkout();
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
