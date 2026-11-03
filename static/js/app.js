(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const toast = (msg) => { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('show'), 2200); };

  /* ---- Theme ---- */
  $('#themeBtn')?.addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
  });

  /* ---- Scroll reveal + count-up ---- */
  const countUp = (el) => {
    const end = +el.dataset.count, suf = el.dataset.suffix || '';
    if (!end || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now(), dur = 900;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + suf; if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); $$('[data-count]', e.target).forEach(countUp); io.unobserve(e.target); }
  }), { threshold: .12 }) : null;
  $$('.reveal').forEach((el) => io ? io.observe(el) : el.classList.add('in'));

  /* ---- Tabs / switcher (event delegation, works for injected HTML) ---- */
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) {
      const card = tab.closest('.cond-card');
      $$('.tab', card).forEach((t) => t.classList.toggle('is-on', t === tab));
      $$('.pane', card).forEach((p) => p.classList.toggle('is-on', p.dataset.pane === tab.dataset.tab));
    }
    const sw = e.target.closest('.sw');
    if (sw) {
      const root = sw.closest('.analysis');
      $$('.sw', root).forEach((s) => s.classList.toggle('is-on', s === sw));
      $$('.cond-wrap', root).forEach((w) => w.classList.toggle('is-on', w.dataset.wrap === sw.dataset.switch));
    }
    if (e.target.closest('[data-print]')) window.print();
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const d = JSON.parse($('.copy-data', cp.closest('.cond-card')).textContent);
      const text = `${d.t}\n\nSelf-care:\n${d.do.map((x) => '• ' + x).join('\n')}\n\nSee a doctor if:\n${d.doc.map((x) => '• ' + x).join('\n')}\n\n(Educational info only — not medical advice.)`;
      (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast('Summary copied'), () => toast('Copy not available'));
    }
  });

  /* ---- Analyzer ---- */
  const form = $('#askForm'), input = $('#symptoms'), resultsSec = $('#resultsSec'), results = $('#results');
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const saveHistory = (q, n) => {
    const h = store.get('history', []).filter((x) => x.q.toLowerCase() !== q.toLowerCase());
    h.unshift({ q, n, t: Date.now() }); store.set('history', h.slice(0, 8)); renderHistory();
  };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; };
  function renderHistory() {
    const list = $('#histList'); if (!list) return;
    const h = store.get('history', []);
    list.innerHTML = h.map((x, i) => `<li><button type="button" data-hist="${i}"><span>${esc(x.q)}</span><small>${ago(x.t)}</small></button></li>`).join('');
    $('#histEmpty').hidden = h.length > 0; $('#clearHist').hidden = h.length === 0;
  }
  $('#histList')?.addEventListener('click', (e) => { const b = e.target.closest('[data-hist]'); if (b) { input.value = store.get('history', [])[b.dataset.hist].q; analyze(); } });
  $('#clearHist')?.addEventListener('click', () => { store.set('history', []); renderHistory(); });

  async function analyze() {
    const q = input.value.trim(); if (!q) { input.focus(); return; }
    const btn = $('.go', form); btn.disabled = true; hideSugg();
    resultsSec.hidden = false;
    results.innerHTML = `<div class="analysis"><div class="loading"><p class="eyebrow">Analyzing<span class="typing"><i></i><i></i><i></i></span></p><div class="sk" style="width:60%"></div><div class="sk"></div><div class="sk" style="width:80%"></div></div></div>`;
    resultsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const [res] = await Promise.all([
        fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symptoms: q }) }),
        new Promise((r) => setTimeout(r, 650))  // brief pause so the "thinking" state is perceptible
      ]);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Something went wrong');
      results.innerHTML = data.html;
      saveHistory(q, data.matched);
      if (data.emergency) navigator.vibrate?.(200);
    } catch (err) {
      results.innerHTML = `<div class="analysis"><div class="empty"><h3>Couldn’t analyze that</h3><p>${esc(err.message)} Please try again.</p></div></div>`;
    } finally { btn.disabled = false; }
  }
  form?.addEventListener('submit', (e) => { e.preventDefault(); analyze(); });
  $$('[data-fill]').forEach((c) => c.addEventListener('click', () => { input.value = c.dataset.fill; analyze(); }));
  renderHistory();

  /* ---- Autocomplete ---- */
  const sugg = $('#sugg'); let sIdx = -1, sTimer;
  function hideSugg() { if (sugg) { sugg.hidden = true; sugg.innerHTML = ''; sIdx = -1; } }
  const SEP = /(,|;|\band\b|\baur\b|\bwith\b)\s*/i;
  input?.addEventListener('input', () => {
    clearTimeout(sTimer);
    const parts = input.value.split(SEP), seg = (parts[parts.length - 1] || '').trim();
    if (seg.length < 2) return hideSugg();
    sTimer = setTimeout(async () => {
      try {
        const list = await (await fetch('/api/suggest?q=' + encodeURIComponent(seg))).json();
        if (!list.length) return hideSugg();
        sugg.innerHTML = list.map((s, i) => `<li role="option" data-s="${esc(s)}"><svg class="ic"><use href="#i-search"/></svg>${esc(s)}</li>`).join('');
        sugg.hidden = false; sIdx = -1;
      } catch (e) { hideSugg(); }
    }, 140);
  });
  const pick = (s) => { const m = input.value.match(/^(.*(?:,|;|\band\b|\baur\b|\bwith\b)\s*)[^,;]*$/i); input.value = (m ? m[1] : '') + s; hideSugg(); input.focus(); };
  sugg?.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); pick(li.dataset.s); } });
  input?.addEventListener('keydown', (e) => {
    if (sugg.hidden) return;
    const items = $$('li', sugg);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sIdx = (sIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((li, i) => li.setAttribute('aria-selected', i === sIdx)); }
    else if (e.key === 'Enter' && sIdx > -1) { e.preventDefault(); pick(items[sIdx].dataset.s); }
    else if (e.key === 'Escape') hideSugg();
  });
  input?.addEventListener('blur', () => setTimeout(hideSugg, 120));

  /* ---- Rotating placeholder ---- */
  if (input) {
    const ph = ['e.g. fever and cough…', 'e.g. sir dard aur chakkar…', 'e.g. stomach pain, vomiting…', 'e.g. high bp, no fever…', 'e.g. hair fall…'];
    let i = 0; setInterval(() => { if (document.activeElement !== input && !input.value) input.placeholder = ph[++i % ph.length]; }, 2800);
  }

  /* ---- Voice input ---- */
  const mic = $('#micBtn'), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (mic && SR) {
    mic.hidden = false;
    let rec = null;
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true;
      rec.onstart = () => { mic.classList.add('rec'); toast('Listening… speak your symptoms'); };
      rec.onresult = (e) => { input.value = [...e.results].map((r) => r[0].transcript).join(' '); };
      rec.onerror = () => toast('Mic unavailable or permission denied');
      rec.onend = () => { mic.classList.remove('rec'); const had = rec; rec = null; if (input.value.trim() && had) analyze(); };
      rec.start();
    });
  }

  /* ---- BMI ---- */
  const bmiH = $('#bmiH'), bmiW = $('#bmiW');
  function bmi() {
    const h = +bmiH.value / 100, w = +bmiW.value, out = $('#bmiOut'), n = $('#bmiNeedle');
    if (!(h > 0.5 && w > 10)) { out.textContent = 'Enter your height and weight.'; n.style.left = '0%'; return; }
    const v = w / (h * h);
    const [label, col] = v < 18.5 ? ['Underweight', '#38b6ff'] : v < 25 ? ['Healthy weight', '#12c99a'] : v < 30 ? ['Overweight', '#f59e0b'] : ['Obese range', '#ef3e5c'];
    const pos = Math.max(2, Math.min(98, ((v - 12) / (40 - 12)) * 100));
    n.style.left = pos + '%';
    out.innerHTML = `<b style="color:${col}">${v.toFixed(1)}</b>${label}`;
  }
  bmiH?.addEventListener('input', bmi); bmiW?.addEventListener('input', bmi);

  /* ---- Water goal ---- */
  const wtW = $('#wtW'), wtA = $('#wtA');
  function water() {
    const w = +wtW.value; if (!(w > 10)) { $('#waterOut').textContent = '— L'; $('#waterFill').style.height = '0%'; return; }
    const L = (w * 35 + (+wtA.value) * 500) / 1000;
    $('#waterOut').textContent = L.toFixed(1) + ' L / day';
    $('#waterSub').textContent = `≈ ${Math.round(L * 1000 / 250)} glasses of 250 ml`;
    $('#waterFill').style.height = Math.min(92, (L / 4.5) * 100) + '%';
  }
  wtW?.addEventListener('input', water); wtA?.addEventListener('change', water);

  /* ---- Conditions filter ---- */
  const grid = $('#condGrid');
  if (grid) {
    const search = $('#condSearch'); let cat = 'all';
    const apply = () => {
      const q = search.value.trim().toLowerCase(); let n = 0;
      $$('.mini-card', grid).forEach((c) => { const ok = (cat === 'all' || c.dataset.cat === cat) && (!q || c.dataset.text.includes(q)); c.hidden = !ok; n += ok; });
      $('#condEmpty').hidden = n > 0;
    };
    search.addEventListener('input', apply);
    $('#catChips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; cat = b.dataset.cat; $$('#catChips .chip').forEach((c) => c.classList.toggle('is-on', c === b)); apply(); });
  }
})();
