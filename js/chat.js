// "Ask Kasalo" chat panel, shared by every page. Sends each message to /api/chat (api/chat.js, a Vercel function that
// holds the model key), which answers Kasalo Kape questions and returns a fixed invalid-request message for anything else.
(() => {
  document.body.insertAdjacentHTML('beforeend', `
    <button type="button" id="chat-btn" aria-controls="chat-panel" aria-expanded="false"
      class="fixed z-40 bottom-4 right-4 sm:bottom-6 sm:right-6 inline-flex items-center gap-2 bg-kalamansi text-tinta font-label font-bold uppercase tracking-wider text-sm px-5 py-3 rounded-full border-2 border-tinta shadow-ube hover:-translate-y-0.5 transition">
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>Ask Kasalo
    </button>
    <section id="chat-panel" hidden aria-label="Ask Kasalo chat"
      class="fixed z-40 bottom-20 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-96 h-[min(32rem,70dvh)] flex flex-col bg-papel border-2 border-tinta rounded-3xl shadow-ube overflow-hidden">
      <div class="flex items-center justify-between px-5 h-14 border-b-2 border-tinta bg-gata shrink-0">
        <h2 class="font-display uppercase text-banga text-lg">Ask Kasalo</h2>
        <button type="button" data-chat-close aria-label="Close chat" class="w-9 h-9 grid place-items-center rounded-full hover:bg-papel transition">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div id="chat-log" role="log" aria-live="polite" class="flex-1 overflow-y-auto px-4 py-4 space-y-3"></div>
      <form id="chat-form" class="flex gap-2 p-3 border-t-2 border-tinta bg-gata shrink-0">
        <label for="chat-input" class="sr-only">Message</label>
        <input id="chat-input" autocomplete="off" maxlength="500" placeholder="Ask about the menu, bundle, The Fix…"
          class="flex-1 min-w-0 bg-papel border-2 border-tinta rounded-full px-4 py-2.5 placeholder:text-tinta/70">
        <button type="submit" class="bg-banga text-papel font-label font-bold uppercase tracking-wider text-sm px-4 rounded-full border-2 border-tinta hover:shadow-ube-sm transition">Send</button>
      </form>
    </section>`);

  const btn = document.getElementById('chat-btn'), panel = document.getElementById('chat-panel');
  const log = document.getElementById('chat-log'), form = document.getElementById('chat-form'), input = document.getElementById('chat-input');

  function bubble(text, who) {
    const p = document.createElement('p');
    p.className = who === 'you'
      ? 'ml-auto max-w-[85%] w-fit bg-kalamansi-soft border-2 border-tinta rounded-2xl rounded-br-md px-3.5 py-2'
      : 'max-w-[85%] w-fit bg-gata rounded-2xl rounded-bl-md px-3.5 py-2 whitespace-pre-line';
    p.textContent = text;                        // textContent: replies are shown as text, never as HTML
    log.append(p); log.scrollTop = log.scrollHeight;
    return p;
  }
  function setOpen(open) {
    panel.hidden = !open; btn.setAttribute('aria-expanded', open);
    if (open) { if (!log.children.length) bubble('Hi! Ask me about our menu, the Kasalo Bundle, The Fix, or our hours.', 'bot'); input.focus(); }
    else btn.focus();
  }
  btn.addEventListener('click', () => setOpen(panel.hidden));
  panel.querySelector('[data-chat-close]').addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || form.inert) return;
    input.value = ''; bubble(text, 'you');
    const wait = bubble('…', 'bot'); form.inert = true;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 429) { wait.textContent = data.error; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      wait.textContent = data.reply || "Sorry, I couldn't answer that. Email us at kasalokape@gmail.com.";
    } catch {
      wait.textContent = 'Ask Kasalo is offline right now. Email us at kasalokape@gmail.com.';
    } finally {
      form.inert = false; input.focus(); log.scrollTop = log.scrollHeight;
    }
  });
})();
