/* محرك مصحف المدينة: من بيانات الصفحات (سطور/كلمات) لفهرس كلمات ونطاقات (ربع/صفحات) */
(function (root) {
  'use strict';
  // data = { names, pages:[ [ {t:'h',n}|{t:'b'}|{t:'l',i:[word|ayahNumber|'۩']] ] }
  function buildIndex(data) {
    const words = [];           // {p, l, k, s, a}
    const verseFirst = {}, verseLast = {};
    let sura = 0, pending = [];
    data.pages.forEach((pg, pi) => {
      pg.l.forEach((ln, li) => {
        if (ln.t === 'h') { sura = ln.n; pending = []; return; }
        if (ln.t !== 'l') return;
        ln.i.forEach((it, k) => {
          if (it[0] === 0) {
            pending.push(words.length);
            words.push({ p: pi + 1, l: li, k, s: sura, a: 0 });
          } else if (it[0] === 1) {
            const key = sura + ':' + it[1];
            pending.forEach(w => { words[w].a = it[1]; });
            if (pending.length) { verseFirst[key] = pending[0]; verseLast[key] = pending[pending.length - 1]; }
            pending = [];
          }
        });
      });
    });
    return { words, verseFirst, verseLast };
  }

  // نطاق ربع: [أول كلمة, آخر كلمة] (فهرس عام)
  function rubRange(idx, quarters, n) {
    const q = quarters[n - 1];
    const first = idx.verseFirst[q[0] + ':' + q[1]];
    let last;
    if (n < quarters.length) { const nx = quarters[n]; last = idx.verseFirst[nx[0] + ':' + nx[1]] - 1; }
    else last = idx.words.length - 1;
    return [first, last];
  }
  // نطاق صفحات
  function pageRange(idx, p1, p2) {
    let first = -1, last = -1;
    for (let i = 0; i < idx.words.length; i++) {
      const p = idx.words[i].p;
      if (p >= p1 && first < 0) first = i;
      if (p <= p2) last = i;
    }
    return [first, last];
  }
  // دمج نطاقات متلاصقة/متداخلة
  function mergeRanges(rs) {
    const a = rs.filter(r => r && r[0] >= 0 && r[1] >= r[0]).sort((x, y) => x[0] - y[0]);
    const out = [];
    a.forEach(r => { const l = out[out.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else out.push([r[0], r[1]]); });
    return out;
  }
  // ورد اليوم من حالة تطبيق آنيس (نفس منطق التطبيق: القريب + البعيد)
  function wirdFromAppState(st) {
    if (!st || !Array.isArray(st.items)) return [];
    const byId = new Map(st.items.map(i => [i.id, i]));
    const limit = st.dailyNearLimit ?? 4;
    const out = new Map();
    if (st.items.length && limit > 0) {
      const recent = (st.recentAddedIds || []).map(id => byId.get(id)).filter(Boolean);
      const near = recent.length >= limit ? recent.slice(0, limit)
        : [...st.items].sort((a, b) => b.addedAt - a.addedAt).slice(0, Math.min(limit, st.items.length));
      near.forEach(i => out.set(i.quarter, 'قريب'));
    }
    ((st.todaySession && st.todaySession.farTasks) || []).forEach(t => {
      const it = byId.get(t.itemId); if (it && !out.has(it.quarter)) out.set(it.quarter, 'بعيد');
    });
    return [...out.entries()].map(([n, kind]) => ({ n, kind })).sort((a, b) => a.n - b.n);
  }
  const api = { buildIndex, rubRange, pageRange, mergeRanges, wirdFromAppState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MushafLab = api;
})(typeof window !== 'undefined' ? window : globalThis);
