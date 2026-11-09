// Shared Supabase client and auth helpers for every page. Load after the supabase-js CDN script:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"></script>
//   <script src="supabase.js"></script>
// The URL and publishable (anon) key are public by design; Row Level Security in the database decides what each user can do.
window.KK = (() => {
  const SUPABASE_URL = 'https://jopcshxmpsoiodjqejow.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_EoNxUCz8bxYjzYdLghNIjA_ncFZq2KL';

  const configured = !SUPABASE_ANON_KEY.startsWith('PASTE_');
  const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  const root = location.pathname.includes('/admin/') ? '../' : '';   // admin pages live one folder down

  async function session() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session;
  }

  let profileCache;
  async function profile() {
    const s = await session();
    if (!s) return null;
    if (profileCache?.id === s.user.id) return profileCache;
    const { data, error } = await sb.from('profiles').select('*').eq('id', s.user.id).single();
    if (error) throw error;
    return (profileCache = data);
  }

  // next = this page relative to the site root, e.g. "account.html" or "admin/index.html?tab=x"
  const loginUrl = () => `${root}login.html?next=${encodeURIComponent((root ? 'admin/' : '') + (location.pathname.split('/').pop() || 'index.html') + location.search)}`;

  // Sends logged-out visitors to the login page and back here afterwards.
  async function requireLogin() {
    const p = await profile();
    if (!p) { location.replace(loginUrl()); return new Promise(() => {}); }
    return p;
  }

  async function requireAdmin() {
    const p = await requireLogin();
    if (p.role !== 'admin') { location.replace(`${root}account.html`); return new Promise(() => {}); }
    return p;
  }

  async function signOut() {
    if (sb) await sb.auth.signOut();
    profileCache = null;
    location.href = `${root}index.html`;
  }

  // Header account icon: login page when logged out, account (or admin) when logged in.
  async function wireHeader() {
    const link = document.getElementById('account-link');
    if (!link) return;
    const p = await profile().catch(() => null);
    if (!p) { link.href = `${root}login.html`; link.setAttribute('aria-label', 'Log in'); return; }
    link.href = p.role === 'admin' ? `${root}admin/index.html` : `${root}account.html`;
    link.setAttribute('aria-label', p.role === 'admin' ? 'Admin dashboard' : `Your account (${p.full_name || p.email})`);
    link.classList.add('bg-kalamansi', 'border-2', 'border-tinta');
  }

  // Database errors carry raw text; show people something friendly.
  function message(err) {
    const m = err?.message || String(err || '');
    if (/Invalid login credentials/i.test(m)) return 'That email and password don’t match. Try again or reset your password.';
    if (/Email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for our link.';
    if (/User already registered/i.test(m)) return 'An account with this email already exists. Log in instead.';
    if (/Password should be at least/i.test(m)) return 'Use a password with at least 8 characters.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries. Please wait a minute and try again.';
    if (/Signups not allowed for otp|User not found/i.test(m)) return 'No account uses that email yet. Sign up first.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Can’t reach the server. Check your connection.';
    return m || 'Something went wrong. Please try again.';
  }

  const peso = n => '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  const orderLabel = n => 'KK-' + String(n).padStart(4, '0');

  if (sb) sb.auth.onAuthStateChange(() => { profileCache = null; });
  document.addEventListener('DOMContentLoaded', wireHeader);

  return { sb, configured, root, session, profile, requireLogin, requireAdmin, signOut, message, peso, orderLabel };
})();
