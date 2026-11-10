// Shared admin layout and helpers. Each admin page has <div id="gate">, <div id="app" hidden> containing
// <aside id="sidebar">, loads ../js/supabase.js then this file, and calls `const me = await KKAdmin.start('menu')`.
window.KKAdmin = (() => {
  // [key, label, page, phase it arrives in (0 = available now)]
  const MODULES = [
    ['dashboard', 'Dashboard', 'index.html', 0], ['orders', 'Order queue', 'orders.html', 0], ['menu', 'Menu', 'menu.html', 0],
    ['pos', 'POS', 'pos.html', 0], ['shifts', 'Shifts & cash', 'shifts.html', 0],
    ['inventory', 'Inventory', 'inventory.html', 6], ['purchasing', 'Purchasing', 'purchasing.html', 6],
    ['customers', 'Customers', 'customers.html', 7], ['promotions', 'Promotions', 'promotions.html', 7],
    ['reports', 'Reports', 'reports.html', 7], ['audit', 'Audit log', 'audit.html', 0], ['settings', 'Settings & users', 'settings.html', 7],
  ];

  document.head.insertAdjacentHTML('beforeend', `<style>
    .mod { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .6rem .9rem; border-radius: .9rem;
      font-family: 'MADE Sunflower', sans-serif; text-transform: uppercase; letter-spacing: .05em; font-size: .8rem; }
    a.mod:hover { background: rgba(244, 235, 221, .08); }
    .mod[aria-current="page"] { background: #F2B732; color: #141414; }
    .mod .soon { font-family: Helvetica, Arial, sans-serif; text-transform: none; letter-spacing: 0; font-size: .7rem; opacity: .6; }
  </style>`);

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const time = d => new Date(d).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  const dateTime = d => new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  const minutesAgo = d => Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
  const STATUS = { pending_payment: 'Awaiting payment', paid: 'Paid', preparing: 'Preparing', ready: 'Ready', completed: 'Picked up', cancelled: 'Cancelled', refunded: 'Refunded' };

  function sidebar(active, me) {
    return `
      <div class="flex items-center justify-between lg:block px-5 py-4 lg:py-6 border-b border-gata/15">
        <a href="index.html" class="flex items-center gap-3">
          <span class="bg-gata rounded-xl px-2 py-1"><img src="../img/logo/wordmark.png" alt="Kasalo Kape" class="h-9 w-[81px] object-cover mix-blend-multiply"></span>
          <span class="font-label uppercase tracking-wider text-xs text-kalamansi">Admin</span>
        </a>
        <button id="nav-btn" type="button" aria-expanded="false" aria-controls="admin-nav" aria-label="Open admin menu" class="lg:hidden p-2 rounded-full hover:bg-gata/10">
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>
      <nav id="admin-nav" aria-label="Admin" class="hidden lg:block flex-1 overflow-y-auto no-scrollbar px-3 py-4">
        <ul class="grid gap-1">${MODULES.map(([key, label, href, phase]) => phase
          ? `<li><span class="mod opacity-60 cursor-not-allowed">${label}<span class="soon">Phase ${phase}</span></span></li>`
          : `<li><a class="mod" href="${href}" ${key === active ? 'aria-current="page"' : ''}>${label}</a></li>`).join('')}
          <li class="lg:hidden border-t border-gata/15 mt-2 pt-2 flex gap-4 px-3 font-label uppercase tracking-wider text-xs">
            <a href="../index.html" class="py-2 hover:text-kalamansi">View site</a>
            <button type="button" data-logout class="py-2 hover:text-kalamansi">Log out</button>
          </li>
        </ul>
      </nav>
      <div class="hidden lg:block px-5 py-4 border-t border-gata/15 text-sm">
        <p class="truncate">${esc(me.email)}</p>
        <div class="flex gap-4 mt-2 font-label uppercase tracking-wider text-xs">
          <a href="../index.html" class="hover:text-kalamansi">View site</a>
          <button type="button" data-logout class="hover:text-kalamansi">Log out</button>
        </div>
      </div>`;
  }

  async function start(active) {
    const me = await KK.requireAdmin();
    const aside = document.getElementById('sidebar');
    aside.className = 'bg-tinta text-gata lg:min-h-screen lg:sticky lg:top-0 lg:h-screen flex flex-col on-dark';
    aside.innerHTML = sidebar(active, me);
    document.getElementById('nav-btn').addEventListener('click', e => {
      const open = document.getElementById('admin-nav').classList.toggle('hidden') === false;
      e.currentTarget.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', e => { if (e.target.closest('[data-logout]')) KK.signOut(); });
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    return me;
  }

  return { start, esc, time, dateTime, minutesAgo, STATUS };
})();
