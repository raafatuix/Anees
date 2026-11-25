/* مطابقة الكلام المسموع بنص المصحف المتوقع، كلمة بكلمة.
   الفكرة: التطبيق عارف النطاق، فبيقارن كل كلمة مسموعة بالكلمة اللي جاية. */
(function (root) {
  'use strict';

  // تشكيل وعلامات قرآنية صغيرة وتطويل
  const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ]/g;

  function normalize(s) {
    return String(s || '')
      .replace(MARKS, '')
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ء/g, '')
      .replace(/[^ء-ي]/g, '')
      .trim();
  }

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  function sim(a, b) {
    if (!a || !b) return 0;
    return 1 - lev(a, b) / Math.max(a.length, b.length);
  }

  const stripAl = (w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w);

  // أشكال بديلة للكلمة: المحرك بيكتب الإملائي العادي، والمصحف عثماني
  //  - الألف الخنجرية (ـٰ) ممكن تتكتب ألف أو تتساب
  //  - النون المخفاة/المدغمة: بتتسقط أو بتتسمع ميم
  function forms(raw) {
    const base = normalize(raw);
    const dag = normalize(String(raw || '').replace(/\u0670/g, 'ا'));
    const set = new Set([base, dag]);
    for (const f of [base, dag]) {
      if (f.length > 2) {
        set.add(f[0] + f.slice(1).replace(/ن/g, ''));
        set.add(f.replace(/ن/g, 'م'));
      }
    }
    return [...set].filter(Boolean);
  }
  function similarity(spoken, expected) {
    const A = forms(spoken), B = forms(expected);
    let best = 0;
    for (const a of A) for (const b of B) best = Math.max(best, sim(a, b), sim(stripAl(a), stripAl(b)));
    return best;
  }

  function createSession(expectedRaw, opts) {
    const o = Object.assign({ threshold: 0.72 }, opts || {});
    const expected = expectedRaw.map(normalize);
    const status = expected.map(() => 'hidden'); // hidden | ok | shown
    let p = 0;
    const stats = { ok: 0, wrong: 0, skip: 0, shown: 0, accepted: 0 };
    let lastWrong = null;

    function advance(kind, n) {
      for (let k = 0; k < n && p < expected.length; k++) { status[p] = kind; p++; }
    }

    // يستقبل كلمات مسموعة، ويرجّع أحداث: ok / wrong / skip
    function feed(spokenWords) {
      const events = [];
      for (const raw of spokenWords) {
        if (p >= expected.length) break;
        const w = normalize(raw);
        if (!w) continue;
        const idx = p;
        // المحرك قسّم كلمة لجزأين: الجزء اللي فات + الحالي
        if (lastWrong && lastWrong.idx === p) {
          const joined = lastWrong.raw + raw;
          if (similarity(joined, expectedRaw[p]) >= Math.max(o.threshold, 0.8)) {
            stats.wrong = Math.max(0, stats.wrong - 1); lastWrong = null;
            advance('ok', 1); stats.ok++; events.push({ type: 'ok', idx, spoken: joined, score: 1, split: true }); continue;
          }
        }
        const s1 = similarity(raw, expectedRaw[p]);
        if (s1 >= o.threshold) { lastWrong = null; advance('ok', 1); stats.ok++; events.push({ type: 'ok', idx, spoken: raw, score: s1 }); continue; }
        // المحرك دمج كلمتين في كلمة
        if (p + 1 < expected.length) {
          const merged = expected[p] + expected[p + 1];
          if (sim(w, merged) >= Math.max(o.threshold, 0.8)) { advance('ok', 2); stats.ok += 2; events.push({ type: 'ok', idx, spoken: raw, score: 1, merged: true }); continue; }
        }
        // قال كلمة جاية، يعني تخطّى
        let skipTo = -1;
        for (let k = 1; k <= 3 && p + k < expected.length; k++) {
          if (similarity(raw, expectedRaw[p + k]) >= Math.max(o.threshold, 0.8)) { skipTo = p + k; break; }
        }
        if (skipTo > 0) { stats.skip++; events.push({ type: 'skip', idx, spoken: raw, matchedIdx: skipTo }); continue; }
        stats.wrong++; lastWrong = { idx, raw };
        events.push({ type: 'wrong', idx, spoken: raw, score: s1 });
      }
      return events;
    }

    // "كنت صح": المستخدم بيقول إن الإنذار كان خطأ، فنعدّي الكلمة
    function accept() { if (p >= expected.length) return null; const i = p; advance('ok', 1); stats.accepted++; return i; }
    // "أظهر الكلمة": تتكشف الكلمة اللي وقف عندها
    function reveal() { if (p >= expected.length) return null; const i = p; advance('shown', 1); stats.shown++; return i; }

    return { feed, accept, reveal, status, stats, get pos() { return p; }, get done() { return p >= expected.length; }, threshold: (v) => { o.threshold = v; } };
  }

  const api = { normalize, similarity, createSession };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Matcher = api;
})(typeof window !== 'undefined' ? window : globalThis);
