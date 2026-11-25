/* ربط محرك Tilawa (@tilawa/core 1.x) بصفحة المراجعة.
   المحرك بيسمع على الجهاز نفسه، ويبعت مكان القارئ (سورة، آية، كلمة) والأخطاء المؤكدة.
   الملف ده بيحوّل ده لحالة كل كلمة في النطاق: hidden | ok | shown | err | skip.
   الموديل: CC BY 4.0 (Tilawa، من tlog وQUA). الكود: MIT. */
(function (root) {
  'use strict';

  const BUNDLE = 'vendor/tilawa-web.js?v=1.0.0-rc.1';
  const KIND = { wrong_word: 'كلمة غلط', omitted_word: 'كلمة ناقصة', added_word: 'كلمة زيادة', skipped_passage: 'تخطّي جزء' };
  // وضع البوابة: الصفحة متتخطّاش كلمة. تقف عند أول كلمة مش متأكدين منها لحد ما تتقال صح أو تتكشف.
  const CONF = 0.5;      // أقل ثقة لمرشح غير مقفول (تقديري)
  const MAX_STEP = 3;    // أقصى عدد كلمات يتكشف في حدث واحد (المحرك ممكن يبعت أكتر من كلمة مرة واحدة)
  const PULLBACK = 3;    // لو خطأ اتأكد على كلمة ظهرت من شوية، نرجع لها ونخبّي اللي بعدها
  let libP = null, tilawaP = null;
  function lib() { return libP || (libP = import(new URL(BUNDLE, document.baseURI).href)); }
  function engine(onProgress) {
    if (!tilawaP) {
      tilawaP = lib().then(m => m.createTilawa({ onProgress })).catch(e => { tilawaP = null; throw e; });
    }
    return tilawaP;
  }

  /* حالة النطاق: مستقلة عن المحرك عشان تتختبر لوحدها */
  function createTrack(n) {
    const status = new Array(n).fill('hidden'); // hidden | ok | shown | err
    const stats = { ok: 0, wrong: 0, shown: 0, accepted: 0 };
    const sus = new Set();
    const opened = new Set(); // للتوافق مع العرض: كلمات غلط ظاهرة بالأحمر
    let pos = 0, lastErr = null;

    function set(i, s) {
      const old = status[i]; if (old === s) return;
      if (old === 'ok') stats.ok--; if (s === 'ok') stats.ok++;
      status[i] = s;
    }
    const gated = () => pos < n && status[pos] === 'err';

    // المحرك سمع لحد الكلمة k
    function heard(k) {
      if (k < pos || pos >= n) return false;
      if (k === pos) { set(pos, 'ok'); if (lastErr && lastErr.k === pos) lastErr = null; sus.delete(pos); pos++; return true; }
      if (gated()) return false;               // واقفين: لازم الكلمة الحالية الأول
      if (k - pos > MAX_STEP) return gate('الكلمة دي مش واضحة');
      for (let i = pos; i <= k; i++) { set(i, 'ok'); sus.delete(i); }
      pos = k + 1; return true;
    }
    // القارئ عدّى الكلمة الحالية من غير ما تتسمع صح
    function gate(kind) {
      if (pos >= n) return false;
      if (status[pos] !== 'err') { set(pos, 'err'); stats.wrong++; }
      lastErr = { k: pos, kind };
      return true;
    }
    // خطأ مؤكد من المحرك على كلمة k
    function mistake(k, kind) {
      if (k < 0) { lastErr = { k: -1, kind }; return lastErr; }
      if (k < pos) {
        if (pos - k > PULLBACK) return null;   // قديم، نتجاهله
        for (let i = k + 1; i < pos; i++) if (status[i] === 'ok') set(i, 'hidden');
        pos = k;
      }
      if (k > pos) k = pos;                    // البوابة عند أول كلمة مش محسومة
      gate(kind);
      return lastErr;
    }
    // «كنت صح»: الكلمة الواقفين عندها صح
    function accept() {
      if (!gated()) return null;
      const k = pos; set(k, 'ok'); stats.wrong = Math.max(0, stats.wrong - 1); stats.accepted++; lastErr = null; pos++;
      return k;
    }
    // «أظهر الكلمة»: تتكشف الكلمة الحالية ونكمل
    function reveal() {
      if (pos >= n) return null;
      const k = pos;
      if (status[k] === 'err') { opened.add(k); stats.shown++; }
      else { set(k, 'shown'); stats.shown++; }
      if (lastErr && lastErr.k === k) lastErr = null;
      sus.delete(k); pos++;
      return k;
    }
    return { status, stats, sus, opened, heard, gate, mistake, accept, reveal,
      get pos() { return pos; }, get done() { return pos >= n; }, get gated() { return gated(); }, get lastErr() { return lastErr; } };
  }

  /* refs[i] = {s, a, w} لكل كلمة في النطاق بالترتيب (w من 1) */
  function createReciter(refs, ui) {
    const n = refs.length;
    const track = createTrack(n);
    const key = (s, a, w) => s + ':' + a + ':' + w;
    const map = new Map(refs.map((r, i) => [key(r.s, r.a, r.w), i]));
    const at = (ref) => (ref ? (map.has(key(ref.surah, ref.ayah, ref.word)) ? map.get(key(ref.surah, ref.ayah, ref.word)) : -1) : -1);

    // النطاق ممكن يعدّي على أكتر من سورة، والمحرك بياخد سورة واحدة في الجلسة
    const segs = [];
    refs.forEach((r, i) => { const L = segs[segs.length - 1]; if (L && L.s === r.s) L.end = i; else segs.push({ s: r.s, start: i, end: i }); });

    let tilawa = null, session = null, mic = null, want = false, busy = false, seg = -1;
    const log = [];

    function segOf(i) { return segs.findIndex(g => i >= g.start && i <= g.end); }

    async function openSegment() {
      const i = Math.min(track.pos, n - 1); seg = segOf(i); const g = segs[seg];
      const passage = { surah: g.s, fromAyah: refs[i].a, toAyah: refs[g.end].a };
      session = tilawa.startMemorization(passage, { confirm: { after: 'next-word' } });
      session.subscribe(onEvent);
      mic = await tilawa.listen(session);
    }
    async function closeSegment() {
      const m = mic; mic = null; session = null;
      if (m) { try { await m.stop(); } catch (_) {} }
    }

    function onEvent(e) {
      if (e.type === 'position') {
        ui.trace && ui.trace(e, e.observed[0] ? at(e.observed[0].word) : -1);
        if (e.state === 'lost' || !e.observed[0] || track.done) return;
        const locked = e.state === 'locked';
        let moved = false;
        for (const c of e.observed.slice(0, locked ? 1 : 3)) {
          const k = at(c.word);
          if (k < track.pos) continue;
          if (!locked && c.confidence < CONF) continue;
          if (!locked && k > track.pos + 1) continue;      // قبل القفل: الكلمة الحالية أو اللي بعدها بس
          moved = track.heard(k);
          if (!moved && locked && k > track.pos && !track.gated) moved = track.gate('الكلمة دي مش واضحة');
          if (moved || locked) break;
        }
        // مقفول على مكان بعد الكلمة الحالية واحنا واقفين: القارئ كمّل من غير ما يصلّحها
        if (moved) { ui.render(); const L = track.lastErr; if (L && L.k === track.pos && track.gated) ui.mistake && ui.mistake(L); }
        if (track.done) { stop(); ui.done && ui.done(); return; }
        if (want && segs[seg] && track.pos > segs[seg].end) nextSegment();
      } else if (e.type === 'checker') {
        const k = at(e.location);
        if (e.state === 'suspected') { if (k >= track.pos) track.sus.add(k); ui.render(); return; }
        if (e.state === 'resolved' || e.state === 'uncertain') {
          track.sus.delete(k);
          // صحّح نفسه على الكلمة الواقفين عندها
          if (e.state === 'resolved' && k === track.pos && track.gated) track.heard(k);
          ui.render(); return;
        }
        const kind = KIND[e.errorClass] || e.errorClass;
        const err = e.errorClass === 'added_word' ? { k: -1, kind } : track.mistake(k, kind);
        if (err) {
          log.push({ word: k >= 0 ? ui.wordText(k) : '—', kind, expected: e.expected || '', observed: e.observed || '', conf: e.confidence });
          ui.mistake && ui.mistake(err);
        }
        ui.render();
      }
    }
    async function nextSegment() {
      if (busy) return; busy = true;
      try { await closeSegment(); if (want && !track.done) await openSegment(); } catch (err) { fail(err); } finally { busy = false; }
    }

    function fail(err) {
      want = false; ui.mic(false);
      const r = err && err.reason;
      if (r === 'denied') ui.status('المايك مش مسموح. فعّل الإذن من إعدادات المتصفح.');
      else if (r === 'unavailable') ui.status('مفيش مايك متاح، يمكن تطبيق تاني ماسكه.');
      else if (r === 'insecure-context') ui.status('المايك محتاج https.');
      else if (err && err.name === 'TilawaLoadError') ui.status('تعذّر تحميل المحرك. اتأكد من الإنترنت أول مرة.');
      else ui.status('خطأ في المحرك: ' + ((err && err.message) || err));
    }

    async function start() {
      if (want || busy || track.done) return;
      want = true; busy = true; ui.mic(true);
      try {
        if (!tilawa) {
          ui.status('بحمّل محرك الصوت (مرة واحدة)...');
          tilawa = await engine(p => ui.status('بحمّل محرك الصوت: ' + Math.round((p.fraction || 0) * 100) + '%' + (p.fromCache ? ' (من الجهاز)' : '')));
        }
        if (!want) return;
        await openSegment();
        ui.status('بسمعك. اقرأ على طول، الكلمة بتظهر بعد ما تقولها بلحظة.');
      } catch (err) { fail(err); }
      finally { busy = false; }
    }
    async function stop() {
      want = false; ui.mic(false);
      await closeSegment();
    }
    // بعد «أظهر الكلمة» أو «كنت صح» ممكن نكون عدّينا آخر السورة
    function after() { if (want && segs[seg] && track.pos > segs[seg].end) nextSegment(); ui.render(); }

    return {
      track, log, start, stop,
      get listening() { return want; },
      reveal() { const i = track.reveal(); after(); return i; },
      accept() { const i = track.accept(); ui.render(); return i; },
      info() { return tilawa ? tilawa.model : null; },
    };
  }

  const api = { createTrack, createReciter, KIND };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LabRecite = api;
})(typeof window !== 'undefined' ? window : globalThis);
