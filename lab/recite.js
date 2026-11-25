/* ربط محرك Tilawa (@tilawa/core 1.x) بصفحة المراجعة.
   المحرك بيسمع على الجهاز نفسه، ويبعت مكان القارئ (سورة، آية، كلمة) والأخطاء المؤكدة.
   الملف ده بيحوّل ده لحالة كل كلمة في النطاق: hidden | ok | shown | err | skip.
   الموديل: CC BY 4.0 (Tilawa، من tlog وQUA). الكود: MIT. */
(function (root) {
  'use strict';

  const BUNDLE = 'vendor/tilawa-web.js?v=1.0.0-rc.1';
  const KIND = { wrong_word: 'كلمة غلط', omitted_word: 'كلمة ناقصة', added_word: 'كلمة زيادة', skipped_passage: 'تخطّي جزء' };
  const SKIP_GAP = 3; // لو القفزة لقدّام أكتر من كده، الكلمات اللي في النص متتحسبش صح
  // المحرك مش بيقفل على المكان غير بعد كلمتين على الأقل (minWords = 2 في tracker).
  // فقبل القفل: لو أقوى المرشحين هو الكلمة الحالية أو اللي بعدها، نكشفها على طول.
  // ده بيحل الكلمة اللي بتتقال لوحدها، والحروف المقطّعة في أول السورة (الم، حم…).
  const TENTATIVE = { conf: 0.5, ahead: 1, top: 3 };
  // القفزة لقدّام أكتر من SKIP_GAP متتصدقش من أول حدث (المحرك ممكن يتلخبط بعد كلمة غلط).
  // بتتقبل لو المحرك أكّد skipped_passage، أو سمع القارئ مكمّل من المكان الجديد.
  const JUMP_CONFIRM = 2; // كلمات تقدّم بعد مكان القفزة

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
    const status = new Array(n).fill('hidden');
    const stats = { ok: 0, wrong: 0, shown: 0, accepted: 0, skipped: 0 };
    const byId = new Map(); // checker id → index
    const sus = new Set();
    const opened = new Set(); // كلمات غلط اتكشفت بـ «أظهر الكلمة»
    let pos = 0, lastErr = null;

    function set(i, s) {
      const old = status[i]; if (old === s) return;
      if (old === 'ok') stats.ok--; if (s === 'ok') stats.ok++;
      status[i] = s;
    }
    // آخر كلمة اتقرأت = k
    function advanceTo(k) {
      if (k < pos || k >= n) return false;
      const gap = k - pos;
      for (let i = pos; i < k; i++) if (status[i] === 'hidden') { if (gap > SKIP_GAP) { set(i, 'skip'); stats.skipped++; } else set(i, 'ok'); }
      if (status[k] === 'hidden') set(k, 'ok');
      pos = k + 1; return true;
    }
    function checker(e, k) {
      const known = byId.get(e.id);
      if (e.state === 'suspected') { if (k >= 0) { sus.add(k); byId.set(e.id, k); } return null; }
      if (e.state === 'resolved' || e.state === 'uncertain') {
        if (known !== undefined) {
          sus.delete(known);
          // صحّح نفسه: الكلمة تظهر صح
          if (status[known] === 'err') { set(known, known < pos ? 'ok' : 'hidden'); opened.delete(known); stats.wrong = Math.max(0, stats.wrong - 1); }
          byId.delete(e.id);
          if (lastErr && lastErr.id === e.id) lastErr = null;
        }
        return null;
      }
      // confirmed
      if (k >= 0) sus.delete(k);
      stats.wrong++;
      if (k >= 0 && e.errorClass !== 'added_word') set(k, 'err');
      byId.set(e.id, k);
      lastErr = { id: e.id, k, kind: KIND[e.errorClass] || e.errorClass };
      return lastErr;
    }
    // «كنت صح»: الخطأ الأخير كان غلط من المحرك
    function accept() {
      if (!lastErr) return null;
      const { k } = lastErr; lastErr = null;
      if (k >= 0 && status[k] === 'err') set(k, 'ok');
      stats.wrong = Math.max(0, stats.wrong - 1); stats.accepted++;
      return k;
    }
    // «أظهر الكلمة»: لو فيه كلمة غلط لسه مخفية تتكشف هي، وإلا الكلمة الحالية
    function reveal() {
      if (lastErr && lastErr.k >= 0 && status[lastErr.k] === 'err' && !opened.has(lastErr.k)) { opened.add(lastErr.k); stats.shown++; return lastErr.k; }
      if (pos >= n) return null;
      const i = pos; if (status[i] === 'hidden') { set(i, 'shown'); stats.shown++; } pos++; return i;
    }
    return { status, stats, sus, opened, advanceTo, checker, accept, reveal, get pos() { return pos; }, set pos(v) { pos = v; }, get done() { return pos >= n; }, get lastErr() { return lastErr; } };
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

    let tilawa = null, session = null, mic = null, want = false, busy = false, seg = -1, jump = null;
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
        if (e.state === 'lost' || !e.observed[0]) return;
        let k = -1;
        if (e.state === 'locked') k = at(e.observed[0].word);
        else {
          for (const c of e.observed.slice(0, TENTATIVE.top)) {
            const j = at(c.word);
            if (j >= track.pos && j <= track.pos + TENTATIVE.ahead && c.confidence >= TENTATIVE.conf) { k = j; break; }
          }
        }
        if (k >= 0 && e.state === 'locked' && k - track.pos > SKIP_GAP) {
          // قفزة بعيدة: نستنى تأكيد
          if (!jump || k < jump.k) jump = { k, first: k };
          else jump.k = k;
          if (jump.k - jump.first >= JUMP_CONFIRM) { const t = jump.k; jump = null; if (track.advanceTo(t)) ui.render(); }
          return;
        }
        if (k >= 0) jump = null;
        if (k >= 0 && track.advanceTo(k)) ui.render();
        if (track.done) { stop(); ui.done && ui.done(); return; }
        if (want && segs[seg] && track.pos > segs[seg].end) nextSegment();
      } else if (e.type === 'checker') {
        const k = at(e.location);
        if (e.errorClass === 'skipped_passage' && e.state === 'confirmed' && jump) { const t = jump.k; jump = null; track.advanceTo(t); }
        const err = track.checker(e, k);
        if (err) {
          log.push({ word: k >= 0 ? ui.wordText(k) : '—', kind: err.kind, expected: e.expected || '', observed: e.observed || '', conf: e.confidence });
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
