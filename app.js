/* eslint-disable no-alert */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STORAGE_KEY = "memoryApp.v1";

  const nowISO = () => new Date().toISOString();
  const fmtTime = (iso) => {
    try {
      const d = new Date(iso);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
        d.getHours()
      )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch {
      return iso;
    }
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const cheerMessages = [
    "ナイス集中！",
    "その調子！",
    "いい感じです。",
    "記憶の筋トレ、効いてます。",
    "今のは良い一手。",
    "落ち着いてできています。",
    "積み上がってます。",
  ];
  const randPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { logs: {}, state: {}, meta: { createdAt: nowISO() } };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") throw new Error("bad");
      return {
        logs: parsed.logs && typeof parsed.logs === "object" ? parsed.logs : {},
        state: parsed.state && typeof parsed.state === "object" ? parsed.state : {},
        meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : { createdAt: nowISO() },
      };
    } catch {
      return { logs: {}, state: {}, meta: { createdAt: nowISO() } };
    }
  }

  function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  const store = loadStore();

  function setCssVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  function flashOk() {
    document.body.classList.remove("flashOk");
    // force reflow
    void document.body.offsetWidth;
    document.body.classList.add("flashOk");
    setTimeout(() => document.body.classList.remove("flashOk"), 520);
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
    setTimeout(() => el.classList.remove("shake"), 420);
  }

  function isSameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function updateStreakMeta() {
    const today = new Date();
    const meta = store.meta || {};
    const last = meta.lastVisitAt ? new Date(meta.lastVisitAt) : null;
    let streak = Number(meta.streak || 0);
    if (!last) streak = 1;
    else if (isSameDay(last, today)) {
      // keep
    } else {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      if (isSameDay(last, yesterday)) streak = streak + 1;
      else streak = 1;
    }
    store.meta = {
      ...meta,
      lastVisitAt: today.toISOString(),
      streak,
      accentMode: meta.accentMode || "difficulty",
      accentCustom: meta.accentCustom || "#2563eb",
    };
    saveStore(store);
  }
  updateStreakMeta();

  function pushLog(gameId, entry) {
    if (!store.logs[gameId]) store.logs[gameId] = [];
    const mood = store.meta?.mood || "";
    const withMood =
      mood && mood.length
        ? {
            ...entry,
            tags: [{ text: mood, kind: "warn" }].concat(entry.tags || []),
          }
        : entry;

    const enriched = { ...withMood, at: nowISO() };
    // Best Update tag (scoreがある場合)
    if (typeof enriched.score === "number") {
      const prevBest = getBestScore(gameId);
      if (prevBest === null || enriched.score > prevBest) {
        enriched.tags = [{ text: "Best Update!", kind: "ok" }].concat(enriched.tags || []);
      }
    }

    store.logs[gameId].unshift(enriched);
    store.logs[gameId] = store.logs[gameId].slice(0, 200);

    // 最近3つ
    const recent = Array.isArray(store.meta?.recent) ? store.meta.recent.slice() : [];
    const nextRecent = [gameId].concat(recent.filter((x) => x !== gameId)).slice(0, 3);
    store.meta = { ...(store.meta || {}), recent: nextRecent };
    saveStore(store);

    // ルーチン中なら次へ（ログ=1プレイ完了扱い）
    maybeAdvanceRoutine(gameId);
  }

  function getBestScore(gameId) {
    const arr = store.logs[gameId] || [];
    let best = null;
    for (const it of arr) {
      if (typeof it.score === "number") best = best === null ? it.score : Math.max(best, it.score);
    }
    return best;
  }

  function maybeAdvanceRoutine(gameId) {
    const r = store.meta?.routine;
    const active = store.meta?.routineActive;
    if (!active || !Array.isArray(r) || !r.length) return;
    const idx = Number(store.meta?.routineIndex || 0);
    if (r[idx] !== gameId) return;
    const nextIdx = idx + 1;
    if (nextIdx >= r.length) {
      store.meta = { ...(store.meta || {}), routineActive: false, routineIndex: 0 };
      saveStore(store);
      if (routineStatus) routineStatus.textContent = "完了";
      toast("ルーチン完了！", "ok", 1800);
      return;
    }
    store.meta = { ...(store.meta || {}), routineIndex: nextIdx };
    saveStore(store);
    if (routineStatus) routineStatus.textContent = `次へ：${nextIdx + 1}/${r.length}`;
    setTimeout(() => {
      // 画面遷移
      if (currentGameId) openGame(r[nextIdx]);
    }, 550);
  }

  function setGameState(gameId, state) {
    store.state[gameId] = state;
    saveStore(store);
  }
  function getGameState(gameId, fallback = {}) {
    const s = store.state[gameId];
    return s && typeof s === "object" ? s : fallback;
  }

  function toast(msg, kind = "ok", ms = 2400) {
    const host = $("#toastHost");
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity .2s ease";
      setTimeout(() => el.remove(), 250);
    }, ms);
  }

  function toastSaved(kind = "ok") {
    toast(randPick(cheerMessages), kind, 2200);
  }

  function setNotice(text, kind = "ok") {
    const n = $("#globalNotice");
    if (!text) {
      n.hidden = true;
      n.textContent = "";
      n.className = "inlineNotice";
      return;
    }
    n.hidden = false;
    n.textContent = text;
    n.className = `inlineNotice ${kind}`;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (v === false || v === null || v === undefined) continue;
      else el.setAttribute(k, String(v));
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      if (typeof c === "string") el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    }
    return el;
  }

  function makeField({ label, placeholder = "", value = "", rows = 4, id, memo = false, autoGrow = true }) {
    const textarea = h("textarea", {
      class: "textarea",
      rows: String(rows),
      placeholder,
      id,
    });
    textarea.value = value;
    if (memo) textarea.dataset.memo = "1";
    const field = h("label", { class: "field" }, [
      h("span", { class: "labelText", text: label }),
      textarea,
    ]);
    if (autoGrow) enableAutoGrow(textarea);
    return { field, textarea };
  }

  function makeInput({ label, placeholder = "", value = "", id, type = "text", inputMode, memo = false }) {
    const input = h("input", {
      class: "input",
      placeholder,
      value,
      id,
      type,
    });
    if (inputMode) input.inputMode = inputMode;
    if (memo) input.dataset.memo = "1";
    const field = h("label", { class: "field" }, [
      h("span", { class: "labelText", text: label }),
      input,
    ]);
    return { field, input };
  }

  function makeProgress(secondsTotal, opts = {}) {
    const { showPct = true } = opts;
    const fill = h("div", { class: "progressFill" });
    const bar = h("div", { class: "progressBar" }, [fill]);
    let total = secondsTotal;
    const pctEl = h("span", { class: "progressPct", text: "0%" });
    const meta = h("div", { class: "progressMeta" }, [
      h("span", { text: "進捗" }),
      pctEl,
    ]);
    const wrap = h("div", { class: "progressWrap" }, [bar, meta]);
    if (!showPct) meta.hidden = true;

    let anim = null;
    let shown = 0;
    function animateTo(target) {
      if (anim) cancelAnimationFrame(anim);
      const start = shown;
      const diff = target - start;
      const t0 = performance.now();
      const dur = 220;
      const step = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        const v = Math.round(start + diff * (1 - Math.pow(1 - p, 3)));
        shown = v;
        pctEl.textContent = `${v}%`;
        if (p < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }

    return {
      el: wrap,
      setTotal: (s) => {
        total = Math.max(1, s);
        fill.style.width = "0%";
        shown = 0;
        pctEl.textContent = "0%";
      },
      setRemaining: (remain) => {
        const pct = clamp(((total - remain) / total) * 100, 0, 100);
        fill.style.width = `${pct}%`;
        animateTo(Math.round(pct));
      },
      setPct: (pct) => {
        fill.style.width = `${clamp(pct, 0, 100)}%`;
        animateTo(Math.round(clamp(pct, 0, 100)));
      },
      dispose: () => {
        if (anim) cancelAnimationFrame(anim);
      },
    };
  }

  function enableAutoGrow(textarea) {
    if (!textarea || textarea.dataset.grow === "1") return;
    textarea.dataset.grow = "1";
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(420, textarea.scrollHeight)}px`;
    };
    textarea.addEventListener("input", resize);
    requestAnimationFrame(resize);
  }

  function setAccentForDifficulty(difficulty) {
    const meta = store.meta || {};
    if (meta.accentMode === "custom" && meta.accentCustom) {
      setCssVar("--accent", meta.accentCustom);
      setCssVar("--accent2", meta.accentCustom);
      return;
    }
    if (difficulty === "easy") {
      setCssVar("--accent", "#16a34a");
      setCssVar("--accent2", "#86efac");
    } else if (difficulty === "hard") {
      setCssVar("--accent", "#dc2626");
      setCssVar("--accent2", "#fb7185");
    } else {
      setCssVar("--accent", "#2563eb");
      setCssVar("--accent2", "#60a5fa");
    }
  }

  function renderRecent() {
    if (!recentGames) return;
    clearNode(recentGames);
    const rec = Array.isArray(store.meta?.recent) ? store.meta.recent : [];
    if (!rec.length) {
      recentGames.appendChild(h("div", { class: "muted", text: "まだありません" }));
      return;
    }
    for (const id of rec) {
      const g = games.find((x) => x.id === id);
      if (!g) continue;
      const btn = h("button", { class: "chipBtn", type: "button", text: g.title.replace(/^① |^② |^③ |^④ |^⑤ |^⑥ |^⑦ |^⑧ |^⑨ |^⑩ |^⑪ /, "") });
      btn.addEventListener("click", () => openGame(id));
      recentGames.appendChild(btn);
    }
  }

  function renderRoutineSelects() {
    const sels = [routine1, routine2, routine3].filter(Boolean);
    if (!sels.length) return;
    const options = games.map((g) => ({ id: g.id, label: g.title }));
    for (const sel of sels) {
      if (sel.options.length) continue;
      sel.appendChild(h("option", { value: "", text: "なし" }));
      for (const o of options) sel.appendChild(h("option", { value: o.id, text: o.label }));
    }
    const saved = Array.isArray(store.meta?.routine) ? store.meta.routine : [];
    if (routine1) routine1.value = saved[0] || "";
    if (routine2) routine2.value = saved[1] || "";
    if (routine3) routine3.value = saved[2] || "";
    if (routineStatus) {
      routineStatus.textContent = store.meta?.routineActive ? `進行中 ${Number(store.meta?.routineIndex || 0) + 1}/${saved.length || 0}` : "未開始";
    }
  }

  function getNextDifficulty(cur) {
    if (cur === "easy") return "normal";
    if (cur === "normal") return "hard";
    return "hard";
  }

  function maybeSuggestDifficultyUp(gameId, ok) {
    if (!ok) return;
    const st = getGameState(gameId, {});
    const streak = Number(st.successStreak || 0) + 1;
    setGameState(gameId, { ...st, successStreak: streak });
    if (streak === 3) {
      const cur = getDifficulty();
      const next = getNextDifficulty(cur);
      if (cur !== next) {
        toast(`好調です。難易度を「${next === "normal" ? "ふつう" : "むずかしい"}」に上げますか？`, "ok", 3600);
        // 提案：confirmで簡易に
        setTimeout(() => {
          const yes = confirm("好調です。難易度を1段階上げますか？");
          if (yes) {
            difficultySelect.value = next;
            setAccentForDifficulty(next);
            toast("難易度を上げました", "ok");
            if (currentGameId) openGame(currentGameId);
          }
        }, 200);
      }
    }
  }

  function renderLogs(gameId) {
    const root = $("#gameLogs");
    clearNode(root);
    const items = store.logs[gameId] || [];
    if (!items.length) {
      root.appendChild(h("div", { class: "muted", text: "まだ履歴がありません。" }));
      return;
    }
    for (const it of items) {
      const tags = (it.tags || []).map((t) =>
        h("span", { class: `tag ${t.kind || ""}`, text: t.text })
      );
      const body =
        typeof it.body === "string" ? it.body : it.bodyHtml ? "" : JSON.stringify(it.body, null, 2);
      const bodyNode = it.bodyHtml
        ? h("div", { class: "logBody", html: it.bodyHtml })
        : h("div", { class: "logBody", text: body });
      root.appendChild(
        h("div", { class: "logItem" }, [
          h("div", { class: "logTop" }, [
            h("p", { class: "logTitle", text: it.title || "記録" }),
            h("p", { class: "logTime", text: fmtTime(it.at) }),
          ]),
          bodyNode,
          tags.length ? h("div", { class: "logTags" }, tags) : null,
        ])
      );
    }
  }

  function computeDashboard() {
    const total = Object.values(store.logs || {}).reduce((acc, arr) => acc + (arr ? arr.length : 0), 0);
    // ベスト（現状は短期記憶ゲームの bestLen と、フラッシュの一致数を優先表示）
    const bestStm = Number((store.state?.g3_stm && store.state.g3_stm.bestLen) || 0);
    let bestFlash = 0;
    const flashLogs = store.logs?.g11_flash || [];
    for (const it of flashLogs) {
      const m = String(it.body || "").match(/位置一致：(\d+)\/(\d+)/);
      if (m) bestFlash = Math.max(bestFlash, Number(m[1] || 0));
    }
    const best = bestStm ? `短期記憶 ${bestStm}` : bestFlash ? `フラッシュ ${bestFlash}` : "—";
    const bestHint = bestStm
      ? "③ 短期記憶のベスト長"
      : bestFlash
        ? "⑪ フラッシュの位置一致ベスト"
        : "まだ記録がありません";
    const streak = Number(store.meta?.streak || 0);
    return { total, best, bestHint, streak };
  }

  function renderDashboard() {
    const totalEl = $("#dashTotal");
    const bestEl = $("#dashBest");
    const bestHintEl = $("#dashBestHint");
    const streakEl = $("#dashStreak");
    if (!totalEl || !bestEl || !bestHintEl || !streakEl) return;
    const d = computeDashboard();
    totalEl.textContent = String(d.total);
    bestEl.textContent = d.best;
    bestHintEl.textContent = d.bestHint;
    streakEl.textContent = `連続 ${d.streak} 日`;
  }

  function computeGameStats() {
    const out = [];
    for (const g of games) {
      const logs = store.logs[g.id] || [];
      const plays = logs.length;
      let ok = 0;
      let bad = 0;
      let scoreSum = 0;
      let scoreN = 0;
      for (const it of logs) {
        const tags = it.tags || [];
        for (const t of tags) {
          if (t.text === "正解" || t.text === "完全一致" || t.text === "一致") ok++;
          if (t.text === "不正解" || t.text === "不一致") bad++;
        }
        if (typeof it.score === "number") {
          scoreSum += it.score;
          scoreN++;
        }
      }
      const acc = ok + bad > 0 ? Math.round((ok / (ok + bad)) * 100) : null;
      const avgScore = scoreN ? Math.round((scoreSum / scoreN) * 10) / 10 : null;
      out.push({
        id: g.id,
        title: g.title,
        plays,
        acc,
        avgScore,
      });
    }
    return out;
  }

  function renderStatsAndHeatmap() {
    if (statsSummary) {
      const stats = computeGameStats()
        .filter((x) => x.plays > 0)
        .sort((a, b) => b.plays - a.plays);
      if (!stats.length) {
        statsSummary.textContent = "まだ記録がありません。1回プレイすると統計が出ます。";
      } else {
        const top = stats.slice(0, 6);
        statsSummary.textContent =
          "上位：" +
          top
            .map((x) => {
              const acc = x.acc === null ? "" : ` / 正解率${x.acc}%`;
              const avg = x.avgScore === null ? "" : ` / 平均${x.avgScore}`;
              return `${x.title.replace(/^⑪ |^⑩ |^⑨ |^⑧ |^⑦ |^⑥ |^⑤ |^④ |^③ |^② |^① /, "")}(${x.plays})${acc}${avg}`;
            })
            .join(" | ");
      }
    }
    renderHeatmap();
  }

  function renderHeatmap() {
    if (!heatmapRoot) return;
    clearNode(heatmapRoot);
    const buckets = [
      { label: "0-3", h0: 0, h1: 3 },
      { label: "4-7", h0: 4, h1: 7 },
      { label: "8-11", h0: 8, h1: 11 },
      { label: "12-15", h0: 12, h1: 15 },
      { label: "16-19", h0: 16, h1: 19 },
      { label: "20-23", h0: 20, h1: 23 },
    ];
    const days = ["日", "月", "火", "水", "木", "金", "土"];
    const grid = Array.from({ length: 7 }, () => Array.from({ length: buckets.length }, () => 0));

    for (const arr of Object.values(store.logs || {})) {
      for (const it of arr || []) {
        if (!it.at) continue;
        const d = new Date(it.at);
        if (Number.isNaN(d.getTime())) continue;
        const day = d.getDay(); // 0 Sun
        const h = d.getHours();
        const bi = buckets.findIndex((b) => h >= b.h0 && h <= b.h1);
        if (bi >= 0) grid[day][bi]++;
      }
    }
    let max = 0;
    for (const row of grid) for (const v of row) max = Math.max(max, v);

    // header
    heatmapRoot.appendChild(h("div", { class: "hmHead", text: "" }));
    for (const b of buckets) heatmapRoot.appendChild(h("div", { class: "hmHead", text: b.label }));
    // rows
    for (let di = 0; di < 7; di++) {
      heatmapRoot.appendChild(h("div", { class: "hmRowLabel", text: days[di] }));
      for (let bi = 0; bi < buckets.length; bi++) {
        const v = grid[di][bi];
        const a = max ? v / max : 0;
        const cell = h("div", { class: "hmCell" });
        cell.dataset.v = String(v);
        cell.style.setProperty("--a", String(clamp(a, 0, 1)));
        cell.title = `${days[di]} ${buckets[bi].label}：${v}回`;
        heatmapRoot.appendChild(cell);
      }
    }
  }

  function downloadText(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function logsToCsv() {
    const rows = [];
    rows.push(["gameId", "gameTitle", "at", "title", "tags", "score", "body"].join(","));
    for (const g of games) {
      const arr = store.logs[g.id] || [];
      for (const it of arr) {
        const tags = (it.tags || []).map((t) => t.text).join("|");
        const body = String(it.body || "").replace(/\r?\n/g, "\\n");
        const vals = [
          g.id,
          g.title,
          it.at || "",
          it.title || "",
          tags,
          typeof it.score === "number" ? String(it.score) : "",
          body,
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
        rows.push(vals.join(","));
      }
    }
    return rows.join("\n");
  }

  function diffWords(a, b) {
    const tok = (s) =>
      String(s || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const A = tok(a);
    const B = tok(b);
    const setA = new Set(A.map((x) => x.toLowerCase()));
    const setB = new Set(B.map((x) => x.toLowerCase()));
    const onlyA = A.filter((w) => !setB.has(w.toLowerCase()));
    const onlyB = B.filter((w) => !setA.has(w.toLowerCase()));
    return { onlyA, onlyB, aCount: A.length, bCount: B.length };
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderDiffHtml(a, b) {
    const tok = (s) =>
      String(s || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const A = tok(a);
    const B = tok(b);
    const setA = new Set(A.map((x) => x.toLowerCase()));
    const setB = new Set(B.map((x) => x.toLowerCase()));
    const del = A.filter((w) => !setB.has(w.toLowerCase()));
    const add = B.filter((w) => !setA.has(w.toLowerCase()));
    const mk = (arr, cls) =>
      arr.length
        ? arr.map((w) => `<span class="${cls}">${escapeHtml(w)}</span>`).join(" ")
        : "—";
    return {
      addHtml: mk(add, "diffAdd"),
      delHtml: mk(del, "diffDel"),
      addCount: add.length,
      delCount: del.length,
    };
  }

  function countChars(s) {
    return Array.from(String(s || "")).length;
  }

  function normalizeStr(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function similarityHint(a, b) {
    const A = normalizeStr(a).toLowerCase();
    const B = normalizeStr(b).toLowerCase();
    if (!A && !B) return { pct: 100, hint: "両方空です" };
    if (!A || !B) return { pct: 0, hint: "片方が空です" };
    const aw = A.split(" ");
    const bw = B.split(" ");
    const setA = new Set(aw);
    const setB = new Set(bw);
    let hit = 0;
    for (const w of setA) if (setB.has(w)) hit++;
    const denom = Math.max(1, Math.ceil((setA.size + setB.size) / 2));
    const pct = Math.round((hit / denom) * 100);
    let hint = "一致ワード割合";
    if (pct >= 80) hint = "かなり近い";
    else if (pct >= 50) hint = "まあまあ近い";
    else if (pct >= 20) hint = "ズレが大きい";
    else hint = "ほぼ別物";
    return { pct, hint };
  }

  const difficultyConfig = {
    easy: {
      snapshotMin: 25,
      snapshotMax: 45,
      streamSeconds: 25,
      ruleSpeedMs: 900,
      reverseDelayMs: 12_000,
      noLookPeekMs: 1600,
      multitaskSwitchMs: 6500,
      intentionSwitchMs: 6500,
      flashPeekMs: 800,
    },
    normal: {
      snapshotMin: 18,
      snapshotMax: 35,
      streamSeconds: 30,
      ruleSpeedMs: 750,
      reverseDelayMs: 10_000,
      noLookPeekMs: 1200,
      multitaskSwitchMs: 5200,
      intentionSwitchMs: 5200,
      flashPeekMs: 650,
    },
    hard: {
      snapshotMin: 12,
      snapshotMax: 25,
      streamSeconds: 35,
      ruleSpeedMs: 600,
      reverseDelayMs: 8500,
      noLookPeekMs: 900,
      multitaskSwitchMs: 4200,
      intentionSwitchMs: 4200,
      flashPeekMs: 520,
    },
  };

  const games = [
    {
      id: "g1_snapshot",
      title: "① 思考スナップショット回収装置",
      meta: "ランダムに「今何考えてた？」→数秒前の思考を回収",
      badges: ["瞬間回収", "比較", "短時間"],
      desc:
        "ランダムタイミングでポップアップが出たら、数秒前に考えていたことを短く入力。直前ログと比較して“思考の蒸発”を殴ります。",
      render: renderGame1Snapshot,
    },
    {
      id: "g2_stream",
      title: "② 意識ストリーム固定チャレンジ",
      meta: "1テーマを30秒（難易度で変化）書き続ける",
      badges: ["集中維持", "脱線検知"],
      desc:
        "テーマを自分で決めて、制限時間ずっと書き続けます。終了後、脱線ワードを自分でチェックして集中維持力を鍛えます。",
      render: renderGame2Stream,
    },
    {
      id: "g3_stm",
      title: "③ 短期記憶崩壊検知ゲーム",
      meta: "自分で列を作る→数秒後に再現（長さが増減）",
      badges: ["限界点", "外部データ不要"],
      desc:
        "数字や単語の列を自分で入力→数秒後に再現。正解が続くと長く、失敗すると短くなります。自分の限界点を可視化。",
      render: renderGame3STM,
    },
    {
      id: "g4_rules",
      title: "④ ルール保持タスク",
      meta: "ルールを保ったまま流れる数字に反応",
      badges: ["ワーキングメモリ", "反応抑制"],
      desc:
        "ルール（例：3の倍数でだけタップ）を頭に置いたまま、流れる数字に反応。条件に合う時だけ反応する力を鍛えます。",
      render: renderGame4Rules,
    },
    {
      id: "g5_reverse",
      title: "⑤ 思考逆走テスト",
      meta: "文章を書く→10秒後に1文前/2文前…を問う",
      badges: ["巻き戻し", "保持"],
      desc:
        "文章を複数文書きます。しばらく後に「1文前は？」「2文前は？」と遡って答えます。記憶の巻き戻し能力を鍛えます。",
      render: renderGame5Reverse,
    },
    {
      id: "g6_nolook",
      title: "⑥ ノールック編集チャレンジ",
      meta: "一瞬だけ表示→隠す→指示どおり編集",
      badges: ["保持", "操作"],
      desc:
        "文章を一瞬表示して隠します。見えない状態で「特定の単語を削除」などの指示を実行。見えない保持力を鍛えます。",
      render: renderGame6NoLook,
    },
    {
      id: "g7_compress",
      title: "⑦ 思考圧縮ループ",
      meta: "考えを書く→半分の文字数に→さらに半分",
      badges: ["圧縮", "要約"],
      desc:
        "自分の考えを文章化して、半分の文字数へ圧縮→さらに半分へ。残る形に変換する力を鍛えます。",
      render: renderGame7Compress,
    },
    {
      id: "g8_delaytalk",
      title: "⑧ 時間差自己対話",
      meta: "質問に答える→数分後に同じ質問→差分表示",
      badges: ["ズレ可視化", "自己検証"],
      desc:
        "質問に答え、しばらく後に同じ質問へ再回答。差分を見ることで記憶の歪みを可視化します。",
      render: renderGame8DelayTalk,
    },
    {
      id: "g9_multitask",
      title: "⑨ マルチタスク分断耐性",
      meta: "タスクA→割り込みB→Aに戻って再開",
      badges: ["割り込み耐性", "復帰"],
      desc:
        "入力タスクAの途中で、割り込みタスクBを挿入。Aへ戻った時にスムーズに再開できるかを測ります。",
      render: renderGame9MultiTask,
    },
    {
      id: "g10_intent",
      title: "⑩ 意図保持チャレンジ",
      meta: "これからやること→別タスク→元の意図を再現",
      badges: ["実用", "意図保持"],
      desc:
        "「これからやること」を書き、別タスクを挟んだ後に元の意図を再現。日常で“何しようとしてた？”を減らします。",
      render: renderGame10Intent,
    },
    {
      id: "g11_flash",
      title: "⑪ 英文字フラッシュカード",
      meta: "枚数選択→めくる→並べ替え→答え合わせ",
      badges: ["順序記憶", "並べ替え"],
      desc:
        "好きな枚数を選んで開始。英文字カードを順番にめくった後、並べ替えて元の順序を再現し、答え合わせします。",
      render: renderGame11Flash,
    },
  ];

  // --- UI shell ---
  const gameGrid = $("#gameGrid");
  const gamePanel = $("#gamePanel");
  const homePanel = $("#homePanel");
  const tipsPanel = $("#tipsPanel");
  const gameRoot = $("#gameRoot");
  const btnBack = $("#btnBack");
  const btnResetGame = $("#btnResetGame");
  const btnClearGameLogs = $("#btnClearGameLogs");
  const difficultySelect = $("#difficultySelect");
  const fabBack = $("#fabBack");
  const fabBackBtn = $("#fabBackBtn");
  const typingViz = $("#typingViz");
  const accentPicker = $("#accentPicker");
  const accentMode = $("#accentMode");
  const gameSearch = $("#gameSearch");
  const btnRandom = $("#btnRandom");
  const recentGames = $("#recentGames");
  const statsSummary = $("#statsSummary");
  const heatmapRoot = $("#heatmap");
  const routine1 = $("#routine1");
  const routine2 = $("#routine2");
  const routine3 = $("#routine3");
  const btnRoutineStart = $("#btnRoutineStart");
  const btnRoutineStop = $("#btnRoutineStop");
  const routineStatus = $("#routineStatus");
  const moodSelect = $("#moodSelect");
  const netNotice = $("#netNotice");
  const btnPomo = $("#btnPomo");
  const pomoStatus = $("#pomoStatus");

  const btnExportCsv = $("#btnExportCsv");
  const btnImportMerge = $("#btnImportMerge");
  const speechToggle = $("#speechToggle");
  const notifyToggle = $("#notifyToggle");

  let currentGameId = null;
  let cleanupCurrent = null;
  let lastRenderedQuery = "";

  // Pomodoro (global, simple)
  const pomo = {
    mode: "focus", // focus|break
    running: false,
    remainSec: 25 * 60,
    timer: null,
  };

  function getDifficulty() {
    const v = difficultySelect.value;
    return difficultyConfig[v] ? v : "normal";
  }

  function renderGameGrid(query = "") {
    lastRenderedQuery = query;
    clearNode(gameGrid);
    renderDashboard();
    const q = normalizeStr(query).toLowerCase();
    const filtered = q
      ? games.filter((g) => {
          const hay =
            `${g.title} ${g.meta} ${(g.badges || []).join(" ")} ${(g.desc || "")}`.toLowerCase();
          return hay.includes(q);
        })
      : games;

    renderRecent();
    renderRoutineSelects();
    renderStatsAndHeatmap();

    for (const g of filtered) {
      const badges = (g.badges || []).slice(0, 3);
      const done = (store.logs[g.id] || []).length > 0;
      const card = h("button", { class: "gameCard", type: "button" }, [
        done ? h("div", { class: "gameCardDone", "aria-label": "履歴あり" }) : null,
        h("p", { class: "gameCardTitle", text: g.title }),
        h("p", { class: "gameCardMeta", text: g.meta }),
        h(
          "div",
          { class: "badgeRow" },
          badges.map((b) => h("span", { class: "badge", text: b, title: badgeHelpText(b) }))
        ),
      ]);
      card.addEventListener("click", () => openGame(g.id));
      card.style.setProperty("--delay", `${Math.min(360, (gameGrid.childElementCount || 0) * 45)}ms`);
      gameGrid.appendChild(card);
    }
    if (q && !filtered.length) {
      gameGrid.appendChild(h("div", { class: "muted", text: "見つかりませんでした。" }));
    }
  }

  function badgeHelpText(label) {
    const map = {
      "瞬間回収": "一瞬の思考を回収して比較する",
      "比較": "直前のログと比べてズレを見る",
      "短時間": "短い時間で回せる",
      "集中維持": "テーマに留まる力を鍛える",
      "脱線検知": "脱線の兆候に気づく",
      "限界点": "限界の長さを測る",
      "外部データ不要": "自分の入力だけで完結",
      "ワーキングメモリ": "ルールを保持して反応する",
      "反応抑制": "押したい衝動を止める",
      "巻き戻し": "直前の自分を辿る",
      "保持": "見えない状態でも維持する",
      "圧縮": "情報を短く保つ",
      "要約": "本質を残す",
      "ズレ可視化": "答えの差分を見る",
      "自己検証": "同じ質問で確認する",
      "割り込み耐性": "中断から戻る",
      "復帰": "どこから再開するか",
      "実用": "日常の“意図忘れ”に効く",
      "意図保持": "目的を保つ",
      "順序記憶": "順番で覚える",
      "並べ替え": "復元して答え合わせ",
    };
    return map[label] || label;
  }

  function openGame(gameId) {
    const game = games.find((x) => x.id === gameId);
    if (!game) return;
    if (cleanupCurrent) {
      try {
        cleanupCurrent();
      } catch {
        // ignore
      }
      cleanupCurrent = null;
    }
    currentGameId = gameId;
    document.body.dataset.screen = "game";
    if (homePanel) homePanel.hidden = true;
    if (tipsPanel) tipsPanel.hidden = true;
    $("#gameTitle").textContent = game.title;
    $("#gameDesc").textContent = game.desc;
    $("#gameKicker").textContent = "トレーニング";
    setNotice("");
    gamePanel.hidden = false;
    gamePanel.classList.add("fullScreen");
    if (fabBack) fabBack.hidden = false;
    if (moodSelect) moodSelect.value = store.meta?.mood || "";
    // 画面遷移っぽく：ハッシュで現在ゲームを保持
    if (location.hash !== `#${gameId}`) location.hash = `#${gameId}`;
    window.scrollTo({ top: 0, behavior: "instant" });

    // ローディング・スケルトン（短く）
    clearNode(gameRoot);
    const sk = h("div", { class: "skeleton", "aria-hidden": "true" }, [
      h("div", { class: "skLine" }),
      h("div", { class: "skLine" }),
      h("div", { class: "skBox" }),
      h("div", { class: "skBox" }),
    ]);
    gameRoot.appendChild(sk);
    setTimeout(() => {
      clearNode(gameRoot);
      cleanupCurrent = game.render(gameRoot, { gameId, difficulty: getDifficulty() }) || null;
      renderLogs(gameId);
    }, 120);
  }

  function closeGame() {
    if (cleanupCurrent) {
      try {
        cleanupCurrent();
      } catch {
        // ignore
      }
      cleanupCurrent = null;
    }
    currentGameId = null;
    gamePanel.hidden = true;
    gamePanel.classList.remove("fullScreen");
    if (homePanel) homePanel.hidden = false;
    if (tipsPanel) tipsPanel.hidden = false;
    document.body.dataset.screen = "home";
    if (fabBack) fabBack.hidden = true;
    clearNode(gameRoot);
    setNotice("");
    // ハッシュを消してホームへ
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    window.scrollTo({ top: 0, behavior: "smooth" });
    renderGameGrid(lastRenderedQuery);
  }

  btnBack.addEventListener("click", closeGame);
  if (fabBackBtn) fabBackBtn.addEventListener("click", closeGame);
  btnResetGame.addEventListener("click", () => {
    if (!currentGameId) return;
    setGameState(currentGameId, {});
    toast("このゲームの状態をリセットしました", "warn");
    openGame(currentGameId);
    renderDashboard();
  });
  btnClearGameLogs.addEventListener("click", () => {
    if (!currentGameId) return;
    store.logs[currentGameId] = [];
    saveStore(store);
    renderLogs(currentGameId);
    toast("このゲームの履歴を削除しました", "warn");
    renderDashboard();
    renderGameGrid();
  });

  difficultySelect.addEventListener("change", () => {
    setAccentForDifficulty(getDifficulty());
    toast(`難易度：${difficultySelect.selectedOptions[0].textContent}`, "ok");
    if (currentGameId) openGame(currentGameId);
  });

  if (gameSearch) {
    gameSearch.addEventListener("input", () => {
      renderGameGrid(gameSearch.value);
    });
  }
  if (btnRandom) {
    btnRandom.addEventListener("click", () => {
      const pick = randPick(games).id;
      openGame(pick);
    });
  }

  if (moodSelect) {
    moodSelect.addEventListener("change", () => {
      store.meta = { ...(store.meta || {}), mood: moodSelect.value || "" };
      saveStore(store);
      toast("気分タグを保存しました", "ok", 1200);
    });
  }

  // Pomodoro UI
  function fmtMMSS(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function updatePomoUi() {
    if (pomoStatus) pomoStatus.textContent = fmtMMSS(pomo.remainSec);
    if (btnPomo) btnPomo.textContent = pomo.running ? "停止" : "開始";
  }
  function pomoTick() {
    pomo.remainSec = Math.max(0, pomo.remainSec - 1);
    updatePomoUi();
    if (pomo.remainSec <= 0) {
      if (pomo.timer) clearInterval(pomo.timer);
      pomo.timer = null;
      pomo.running = false;
      if (pomo.mode === "focus") {
        pomo.mode = "break";
        pomo.remainSec = 5 * 60;
        toast("休憩（5分）", "ok", 2200);
      } else {
        pomo.mode = "focus";
        pomo.remainSec = 25 * 60;
        toast("集中（25分）", "ok", 2200);
      }
      updatePomoUi();
    }
  }
  if (btnPomo) {
    btnPomo.addEventListener("click", () => {
      if (!pomo.running) {
        pomo.running = true;
        if (pomo.timer) clearInterval(pomo.timer);
        pomo.timer = setInterval(pomoTick, 1000);
        toast("ポモドーロ開始", "ok", 1200);
      } else {
        pomo.running = false;
        if (pomo.timer) clearInterval(pomo.timer);
        pomo.timer = null;
        toast("ポモドーロ停止", "warn", 1200);
      }
      updatePomoUi();
    });
  }
  updatePomoUi();

  if (btnRoutineStart) {
    btnRoutineStart.addEventListener("click", () => {
      const ids = [routine1?.value, routine2?.value, routine3?.value].filter(Boolean);
      if (!ids.length) return toast("ルーチンのゲームを選んでください", "warn", 2000);
      store.meta = { ...(store.meta || {}), routine: ids, routineActive: true, routineIndex: 0 };
      saveStore(store);
      if (routineStatus) routineStatus.textContent = `進行中 1/${ids.length}`;
      toast("ルーチン開始", "ok", 1600);
      openGame(ids[0]);
    });
  }
  if (btnRoutineStop) {
    btnRoutineStop.addEventListener("click", () => {
      store.meta = { ...(store.meta || {}), routineActive: false, routineIndex: 0 };
      saveStore(store);
      if (routineStatus) routineStatus.textContent = "停止";
      toast("ルーチン停止", "warn", 1400);
    });
  }

  // --- Data dialog ---
  const dataDialog = $("#dataDialog");
  const btnOpenData = $("#btnOpenData");
  const btnCloseData = $("#btnCloseData");
  const btnExport = $("#btnExport");
  const btnImport = $("#btnImport");
  const btnClearAll = $("#btnClearAll");
  const importTextarea = $("#importTextarea");
  const dataNotice = $("#dataNotice");

  function setDataNotice(text, kind = "ok") {
    if (!text) {
      dataNotice.hidden = true;
      dataNotice.textContent = "";
      dataNotice.className = "inlineNotice";
      return;
    }
    dataNotice.hidden = false;
    dataNotice.textContent = text;
    dataNotice.className = `inlineNotice ${kind}`;
  }

  btnOpenData.addEventListener("click", () => {
    setDataNotice("");
    importTextarea.value = "";
    // sync theme picker UI
    if (accentPicker) accentPicker.value = store.meta?.accentCustom || "#2563eb";
    if (accentMode) accentMode.value = store.meta?.accentMode || "difficulty";
    dataDialog.showModal();
  });
  btnCloseData.addEventListener("click", () => dataDialog.close());
  btnExport.addEventListener("click", async () => {
    const json = localStorage.getItem(STORAGE_KEY) || JSON.stringify(store);
    try {
      await navigator.clipboard.writeText(json);
      setDataNotice("コピーしました。メモ帳などに貼り付けて保存してください。", "ok");
    } catch {
      setDataNotice("クリップボードにコピーできませんでした。下の欄に貼り付けて手動保存してください。", "warn");
      importTextarea.value = json;
    }
  });
  if (btnExportCsv) {
    btnExportCsv.addEventListener("click", () => {
      const csv = logsToCsv();
      const name = `memory_logs_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadText(name, csv, "text/csv");
      setDataNotice("CSVをダウンロードしました。", "ok");
    });
  }
  btnImport.addEventListener("click", () => {
    const raw = importTextarea.value.trim();
    if (!raw) return setDataNotice("JSONを貼り付けてください。", "warn");
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") throw new Error("bad");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      toast("インポートしました（再読み込みします）", "ok", 1800);
      setTimeout(() => location.reload(), 800);
    } catch {
      setDataNotice("JSONの形式が正しくありません。", "bad");
    }
  });
  if (btnImportMerge) {
    btnImportMerge.addEventListener("click", () => {
      const raw = importTextarea.value.trim();
      if (!raw) return setDataNotice("JSONを貼り付けてください。", "warn");
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") throw new Error("bad");
        const merged = mergeStores(store, parsed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        toast("マージしました（再読み込みします）", "ok", 1800);
        setTimeout(() => location.reload(), 800);
      } catch {
        setDataNotice("JSONの形式が正しくありません。", "bad");
      }
    });
  }
  btnClearAll.addEventListener("click", () => {
    const ok = confirm("全データを削除します。よろしいですか？");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    toast("全データを削除しました（再読み込みします）", "warn", 1800);
    setTimeout(() => location.reload(), 800);
  });

  function applyAccentFromMeta() {
    const meta = store.meta || {};
    if (accentPicker && meta.accentCustom) accentPicker.value = meta.accentCustom;
    if (accentMode && meta.accentMode) accentMode.value = meta.accentMode;
    setAccentForDifficulty(getDifficulty());
  }

  if (accentPicker) {
    accentPicker.addEventListener("input", () => {
      store.meta = { ...(store.meta || {}), accentCustom: accentPicker.value };
      saveStore(store);
      applyAccentFromMeta();
    });
  }
  if (accentMode) {
    accentMode.addEventListener("change", () => {
      store.meta = { ...(store.meta || {}), accentMode: accentMode.value };
      saveStore(store);
      applyAccentFromMeta();
      toast(accentMode.value === "custom" ? "アクセントを固定にしました" : "難易度の色に戻しました", "ok");
    });
  }

  // online/offline notice
  function updateNetNotice() {
    if (!netNotice) return;
    const online = navigator.onLine;
    if (online) {
      netNotice.hidden = true;
      netNotice.textContent = "";
      return;
    }
    netNotice.hidden = false;
    netNotice.className = "inlineNotice warn";
    netNotice.textContent = "オフラインです。記録は端末内（localStorage）なので引き続き保存されます。";
  }
  window.addEventListener("online", updateNetNotice);
  window.addEventListener("offline", updateNetNotice);
  updateNetNotice();

  // Speech/Notification settings
  function applyApiTogglesToUi() {
    if (speechToggle) speechToggle.value = store.meta?.speechOn ? "on" : "off";
    if (notifyToggle) notifyToggle.value = store.meta?.notifyOn ? "on" : "off";
  }
  applyApiTogglesToUi();

  if (speechToggle) {
    speechToggle.addEventListener("change", () => {
      store.meta = { ...(store.meta || {}), speechOn: speechToggle.value === "on" };
      saveStore(store);
      toast(store.meta.speechOn ? "読み上げをONにしました" : "読み上げをOFFにしました", "ok");
    });
  }

  if (notifyToggle) {
    notifyToggle.addEventListener("change", async () => {
      const want = notifyToggle.value === "on";
      if (!("Notification" in window)) {
        toast("このブラウザは通知に対応していません", "warn", 2600);
        notifyToggle.value = "off";
        return;
      }
      if (want) {
        try {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") {
            toast("通知が許可されませんでした", "warn", 2400);
            notifyToggle.value = "off";
            store.meta = { ...(store.meta || {}), notifyOn: false };
            saveStore(store);
            return;
          }
        } catch {
          notifyToggle.value = "off";
          store.meta = { ...(store.meta || {}), notifyOn: false };
          saveStore(store);
          return;
        }
      }
      store.meta = { ...(store.meta || {}), notifyOn: want };
      saveStore(store);
      toast(want ? "通知をONにしました" : "通知をOFFにしました", "ok");
    });
  }

  function speak(text) {
    if (!store.meta?.speechOn) return;
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = "en-US";
    u.rate = 1.0;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }

  function mergeStores(current, incoming) {
    const cur = current && typeof current === "object" ? current : { logs: {}, state: {}, meta: {} };
    const inc = incoming && typeof incoming === "object" ? incoming : { logs: {}, state: {}, meta: {} };
    const out = {
      logs: { ...(cur.logs || {}) },
      state: { ...(cur.state || {}) },
      meta: { ...(cur.meta || {}) },
    };
    const sig = (it) => `${it.at || ""}::${it.title || ""}::${String(it.body || it.bodyHtml || "")}`;
    for (const [gid, arr] of Object.entries(inc.logs || {})) {
      const a = Array.isArray(arr) ? arr : [];
      const existing = out.logs[gid] || [];
      const set = new Set(existing.map(sig));
      for (const it of a) {
        if (!it || typeof it !== "object") continue;
        const k = sig(it);
        if (set.has(k)) continue;
        existing.push(it);
        set.add(k);
      }
      existing.sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
      out.logs[gid] = existing.slice(0, 200);
    }
    // stateは基本現行優先。ただし、現行に無いゲームstateは取り込む
    for (const [gid, st] of Object.entries(inc.state || {})) {
      if (!out.state[gid] && st && typeof st === "object") out.state[gid] = st;
    }
    // metaは現行優先（テーマ/ストリーク/最近など）。不足分だけ補完
    for (const [k, v] of Object.entries(inc.meta || {})) {
      if (out.meta[k] === undefined) out.meta[k] = v;
    }
    return out;
  }

  // --- Game implementations ---

  function renderGame1Snapshot(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, {
      running: false,
      nextAt: null,
      lastInput: "",
    });
    let timer = null;

    const info = h("div", { class: "muted", text: "開始するとランダムでポップアップが出ます。" });
    const status = h("div", { class: "helpRow" }, [
      h("span", { class: "counter", text: s.running ? "稼働中" : "停止中" }),
      h("span", { class: "counter", text: "ポップアップ：ランダム" }),
    ]);
    const btn = h("button", { class: "primaryBtn", type: "button", text: s.running ? "停止" : "開始" });
    const btnTest = h("button", { class: "ghostBtn", type: "button", text: "今すぐ出す（テスト）" });
    const row = h("div", { class: "formRow" }, [btn, btnTest]);

    function schedule() {
      const sec = randInt(cfg.snapshotMin, cfg.snapshotMax);
      const at = Date.now() + sec * 1000;
      setGameState(gameId, { ...getGameState(gameId, {}), running: true, nextAt: at });
      if (timer) clearTimeout(timer);
      timer = setTimeout(trigger, sec * 1000);
      status.firstChild.textContent = "稼働中";
      status.lastChild.textContent = `次まで：約${sec}秒`;
    }

    function stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      const cur = getGameState(gameId, {});
      setGameState(gameId, { ...cur, running: false, nextAt: null });
      status.firstChild.textContent = "停止中";
      status.lastChild.textContent = "ポップアップ：—";
    }

    function trigger() {
      // 背面でも気づける通知（任意）
      if (store.meta?.notifyOn && document.hidden && "Notification" in window) {
        try {
          if (Notification.permission === "granted") {
            new Notification("記憶力向上アプリ", { body: "今何考えてた？（スナップショット）" });
          }
        } catch {
          // ignore
        }
      }
      const cur = getGameState(gameId, {});
      const prev = cur.lastInput || "";
      const promptText = prev
        ? "今何考えてた？（数秒前の思考を短く）\n※直前ログと比較します"
        : "今何考えてた？（数秒前の思考を短く）";
      const ans = window.prompt(promptText, "");
      if (ans === null) {
        pushLog(gameId, {
          title: "スナップショット（キャンセル）",
          body: "入力なし（キャンセル）",
          tags: [{ text: "キャンセル", kind: "warn" }],
        });
        renderLogs(gameId);
        schedule();
        return;
      }
      const input = normalizeStr(ans);
      const { pct, hint } = similarityHint(prev, input);
      const dif = diffWords(prev, input);

      pushLog(gameId, {
        title: "スナップショット",
        body:
          `今回：${input || "（空）"}\n` +
          `直前：${prev || "（なし）"}\n\n` +
          `一致っぽさ：${pct}%（${hint}）\n` +
          `今回だけ：${dif.onlyB.slice(0, 12).join(" / ") || "—"}\n` +
          `直前だけ：${dif.onlyA.slice(0, 12).join(" / ") || "—"}`,
        tags: [
          { text: `一致${pct}%`, kind: pct >= 70 ? "ok" : pct >= 35 ? "warn" : "bad" },
          { text: input ? "入力あり" : "空", kind: input ? "ok" : "warn" },
        ],
      });
      setGameState(gameId, { ...cur, lastInput: input, running: true, nextAt: null });
      renderLogs(gameId);
      toast(randPick(["回収しました", "キャッチ成功", "思考を捕まえた"]), "ok");
      flashOk();
      renderDashboard();
      schedule();
    }

    btn.addEventListener("click", () => {
      const cur = getGameState(gameId, {});
      if (cur.running) {
        stop();
        btn.textContent = "開始";
        toast("停止しました", "warn");
      } else {
        schedule();
        btn.textContent = "停止";
        toast("開始しました", "ok");
      }
    });
    btnTest.addEventListener("click", () => {
      const cur = getGameState(gameId, {});
      if (!cur.running) {
        setGameState(gameId, { ...cur, running: true });
      }
      trigger();
      btn.textContent = "停止";
    });

    root.appendChild(info);
    root.appendChild(status);
    root.appendChild(row);

    // Resume if running
    if (s.running && s.nextAt && typeof s.nextAt === "number") {
      const remain = Math.max(0, s.nextAt - Date.now());
      const sec = Math.ceil(remain / 1000);
      status.firstChild.textContent = "稼働中";
      status.lastChild.textContent = `次まで：約${sec}秒`;
      timer = setTimeout(trigger, remain);
      btn.textContent = "停止";
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }

  function renderGame2Stream(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, { theme: "", lastText: "" });
    let interval = null;
    let remaining = 0;

    const theme = makeInput({
      label: "テーマ（1つだけ決める）",
      placeholder: "例：今日の予定 / 仕事の課題 / 旅行の計画",
      value: s.theme || "",
      id: "g2_theme",
    });
    const text = makeField({
      label: "30秒間（難易度で変化）書き続ける",
      placeholder: "止まってもOK。続けるのが目的です。",
      value: s.lastText || "",
      rows: 8,
      id: "g2_text",
    });
    const counter = h("span", { class: "counter", text: `残り：—` });
    const progress = makeProgress(cfg.streamSeconds);
    const row = h("div", { class: "helpRow" }, [
      counter,
      h("span", { class: "counter", text: `時間：${cfg.streamSeconds}秒` }),
    ]);
    const btnStart = h("button", { class: "primaryBtn", type: "button", text: "開始" });
    const btnStop = h("button", { class: "ghostBtn danger", type: "button", text: "中断" });
    const btnMark = h("button", { class: "ghostBtn", type: "button", text: "脱線ワードをマーク" });
    const btnSave = h("button", { class: "ghostBtn", type: "button", text: "記録" });
    const btnVoice = h("button", { class: "ghostBtn", type: "button", text: "音声入力" });
    btnStop.disabled = true;
    // 下書き自動保存（10秒ごと）
    const draftKey = "draft";
    const savedDraft = getGameState(gameId, {})[draftKey];
    if (savedDraft && typeof savedDraft === "object") {
      if (!theme.input.value) theme.input.value = savedDraft.theme || theme.input.value;
      if (!text.textarea.value) text.textarea.value = savedDraft.text || text.textarea.value;
    }
    let draftTimer = setInterval(() => {
      setGameState(gameId, {
        ...getGameState(gameId, {}),
        [draftKey]: { theme: theme.input.value, text: text.textarea.value, at: Date.now() },
      });
    }, 10_000);

    // Web Speech API（音声入力）
    let rec = null;
    let recOn = false;
    function toggleVoice() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        toast("このブラウザは音声入力に非対応です", "warn", 2600);
        return;
      }
      if (!rec) {
        rec = new SR();
        rec.lang = "ja-JP";
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (ev) => {
          let finalText = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += r[0].transcript;
          }
          if (finalText) {
            text.textarea.value = (text.textarea.value ? text.textarea.value + " " : "") + finalText.trim();
            text.textarea.dispatchEvent(new Event("input", { bubbles: true }));
          }
        };
        rec.onend = () => {
          if (recOn) {
            recOn = false;
            btnVoice.textContent = "音声入力";
          }
        };
      }
      if (!recOn) {
        try {
          rec.start();
          recOn = true;
          btnVoice.textContent = "停止";
          toast("音声入力ON", "ok", 1200);
        } catch {
          // ignore
        }
      } else {
        try {
          rec.stop();
        } catch {
          // ignore
        }
        recOn = false;
        btnVoice.textContent = "音声入力";
      }
    }
    btnVoice.addEventListener("click", toggleVoice);


    const markField = makeInput({
      label: "脱線ワード（自分でチェック。空白区切りでOK）",
      placeholder: "例：SNS ゲーム お腹",
      value: "",
      id: "g2_off",
    });

    function tick() {
      remaining = Math.max(0, remaining - 1);
      counter.textContent = `残り：${remaining}s`;
      if (remaining <= 3 && remaining > 0) counter.classList.add("countdownPulse");
      else counter.classList.remove("countdownPulse");
      progress.setRemaining(remaining);
      if (remaining <= 0) finish();
    }

    function updateRemainingUI() {
      counter.textContent = `残り：${remaining}s`;
      if (remaining <= 3 && remaining > 0) counter.classList.add("countdownPulse");
      else counter.classList.remove("countdownPulse");
      progress.setRemaining(remaining);
    }

    function finish() {
      if (interval) clearInterval(interval);
      interval = null;
      btnStart.disabled = false;
      btnStop.disabled = true;
      text.textarea.disabled = false;
      theme.input.disabled = false;
      counter.textContent = "終了";
      counter.classList.remove("countdownPulse");
      toast("終了。脱線チェックへ", "ok");
      setNotice("終了しました。脱線ワードをマークして「記録」すると振り返れます。", "ok");
    }

    btnStart.addEventListener("click", () => {
      const th = normalizeStr(theme.input.value);
      if (!th) {
        setNotice("テーマを1つ入力してください。", "warn");
        shake(root);
        return;
      }
      setNotice("");
      remaining = cfg.streamSeconds;
      progress.setTotal(cfg.streamSeconds);
      updateRemainingUI();
      btnStart.disabled = true;
      btnStop.disabled = false;
      theme.input.disabled = true;
      text.textarea.disabled = false;
      text.textarea.focus();
      if (interval) clearInterval(interval);
      interval = setInterval(tick, 1000);
    });

    btnStop.addEventListener("click", () => {
      if (interval) clearInterval(interval);
      interval = null;
      btnStart.disabled = false;
      btnStop.disabled = true;
      theme.input.disabled = false;
      toast("中断しました", "warn");
      setNotice("中断しました。必要なら「記録」で残せます。", "warn");
    });

    btnMark.addEventListener("click", () => {
      const body = text.textarea.value;
      const off = normalizeStr(markField.input.value);
      if (!off) return setNotice("脱線ワードを入力してください（空白区切り）。", "warn");
      const offWords = off.split(" ").filter(Boolean);
      const lower = body.toLowerCase();
      const hits = offWords.filter((w) => lower.includes(w.toLowerCase()));
      const ratio = body.trim() ? Math.round((hits.length / offWords.length) * 100) : 0;
      setNotice(
        `脱線ワード検知：${hits.length}/${offWords.length}（${ratio}%） ヒット：${
          hits.join(" / ") || "—"
        }`,
        hits.length ? "warn" : "ok"
      );
    });

    btnSave.addEventListener("click", () => {
      const th = normalizeStr(theme.input.value);
      const body = normalizeStr(text.textarea.value);
      const off = normalizeStr(markField.input.value);
      if (!th || !body) {
        setNotice("テーマと本文を入力してください。", "warn");
        shake(root);
        return;
      }
      const offWords = off ? off.split(" ").filter(Boolean) : [];
      const hits = offWords.length
        ? offWords.filter((w) => body.toLowerCase().includes(w.toLowerCase()))
        : [];
      pushLog(gameId, {
        title: "ストリーム固定",
        body: `テーマ：${th}\n\n本文：\n${body}\n\n脱線ワード：${off || "—"}\nヒット：${hits.join(" / ") || "—"}`,
        tags: [
          { text: `文字数${countChars(body)}`, kind: "ok" },
          { text: hits.length ? `脱線${hits.length}` : "脱線0", kind: hits.length ? "warn" : "ok" },
        ],
      });
      setGameState(gameId, { theme: th, lastText: body });
      // 下書きクリア
      const cur = getGameState(gameId, {});
      if (cur[draftKey]) setGameState(gameId, { ...cur, [draftKey]: null });
      renderLogs(gameId);
      toastSaved("ok");
      setNotice("保存しました。次は同じテーマでも別テーマでもOKです。", "ok");
    });

    root.appendChild(theme.field);
    root.appendChild(row);
    root.appendChild(progress.el);
    root.appendChild(text.field);
    root.appendChild(h("div", { class: "formRow" }, [btnStart, btnStop, btnVoice, btnMark, btnSave]));
    root.appendChild(markField.field);

    return () => {
      if (interval) clearInterval(interval);
      if (draftTimer) clearInterval(draftTimer);
      draftTimer = null;
      if (rec && recOn) {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }
    };
  }

  function renderGame3STM(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, {
      len: 4,
      delaySec: 6,
      lastTarget: "",
      stage: "idle", // idle|memorize|recall
      startedAt: null,
      bestLen: 0,
    });
    let timer = null;
    let remaining = 0;

    const lenInput = h("input", { class: "input", type: "number", min: "2", max: "30", value: String(s.len || 4) });
    const delayInput = h("input", { class: "input", type: "number", min: "2", max: "20", value: String(s.delaySec || 6) });
    const modeSelect = h("select", { class: "select" }, [
      h("option", { value: "digits", text: "数字（0-9）" }),
      h("option", { value: "words", text: "単語（空白区切り）" }),
      h("option", { value: "custom", text: "自分で列を入力" }),
    ]);
    modeSelect.value = "digits";

    const customField = makeInput({
      label: "自分で列（custom時のみ）",
      placeholder: "例：赤 青 7 猫",
      value: "",
      id: "g3_custom",
    });
    customField.field.hidden = true;

    const memoBox = h("div", { class: "bigNumber", text: "—" });
    const counter = h("span", { class: "counter", text: `状態：${s.stage}` });
    const best = h("span", { class: "counter", text: `ベスト長：${s.bestLen || 0}` });
    const row = h("div", { class: "helpRow" }, [counter, best]);
    const progress = makeProgress(10);

    const recall = makeInput({
      label: "再現（同じ列を入力）",
      placeholder: "例：1234 / 赤 青 7 猫",
      value: "",
      id: "g3_recall",
    });
    recall.input.disabled = true;

    const btnStart = h("button", { class: "primaryBtn", type: "button", text: "開始" });
    const btnCheck = h("button", { class: "ghostBtn", type: "button", text: "答え合わせ" });
    const btnNext = h("button", { class: "ghostBtn", type: "button", text: "次へ" });
    btnCheck.disabled = true;
    btnNext.disabled = true;

    function buildTarget(len, mode) {
      if (mode === "digits") {
        let out = "";
        for (let i = 0; i < len; i++) out += String(randInt(0, 9));
        return out;
      }
      if (mode === "words") {
        const pool = [
          "赤",
          "青",
          "緑",
          "犬",
          "猫",
          "山",
          "川",
          "空",
          "雨",
          "本",
          "音",
          "光",
          "花",
          "紙",
          "指",
          "声",
          "道",
          "星",
          "火",
          "雪",
        ];
        return shuffle(pool).slice(0, len).join(" ");
      }
      const raw = normalizeStr(customField.input.value);
      if (!raw) return "";
      const parts = raw.split(" ").filter(Boolean);
      return parts.slice(0, len).join(" ");
    }

    function setStage(stage) {
      const cur = getGameState(gameId, {});
      setGameState(gameId, { ...cur, stage });
      counter.textContent = `状態：${stage}`;
    }

    function stopTimer() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function start() {
      setNotice("");
      const len = clamp(Number(lenInput.value || 4), 2, 30);
      const delaySec = clamp(Number(delayInput.value || 6), 2, 20);
      const mode = modeSelect.value;
      const target = buildTarget(len, mode);
      if (mode === "custom" && !target) {
        setNotice("customを選んだ場合、列を入力してください。", "warn");
        shake(root);
        return;
      }
      memoBox.textContent = target;
      recall.input.value = "";
      recall.input.disabled = true;
      btnStart.disabled = true;
      btnCheck.disabled = true;
      btnNext.disabled = true;
      remaining = delaySec;
      progress.setTotal(delaySec);
      progress.setRemaining(remaining);
      setStage("memorize");
      setGameState(gameId, {
        len,
        delaySec,
        lastTarget: target,
        stage: "memorize",
        startedAt: Date.now(),
        bestLen: s.bestLen || 0,
        mode,
      });

      stopTimer();
      timer = setInterval(() => {
        remaining = Math.max(0, remaining - 1);
        progress.setRemaining(remaining);
        if (remaining <= 0) {
          stopTimer();
          memoBox.textContent = "（思い出して入力）";
          recall.input.disabled = false;
          recall.input.focus();
          btnCheck.disabled = false;
          setStage("recall");
          toast("再現フェーズ", "ok");
        }
      }, 1000);
    }

    function check() {
      const cur = getGameState(gameId, {});
      const target = cur.lastTarget || "";
      const mode = cur.mode || "digits";
      const ans = normalizeStr(recall.input.value);
      let ok = false;
      if (mode === "digits") {
        ok = ans.replace(/\s+/g, "") === target;
      } else {
        ok = ans.toLowerCase() === target.toLowerCase();
      }
      const len = Number(cur.len || 4);
      const nextLen = clamp(len + (ok ? 1 : -1), 2, 30);
      const bestLenVal = Math.max(Number(cur.bestLen || 0), ok ? len : 0);

      pushLog(gameId, {
        title: "短期記憶テスト",
        body: `ターゲット：${target}\n回答：${ans || "（空）"}\n結果：${ok ? "正解" : "不正解"}\n次の長さ：${nextLen}`,
        score: ok ? len : 0,
        tags: [
          { text: ok ? "正解" : "不正解", kind: ok ? "ok" : "bad" },
          { text: `長さ${len}`, kind: "ok" },
        ],
      });
      renderLogs(gameId);
      setNotice(ok ? "正解。長さが増えます。" : "不正解。長さが短くなります。", ok ? "ok" : "bad");
      if (ok) flashOk();
      else shake(root);
      maybeSuggestDifficultyUp(gameId, ok);

      setGameState(gameId, { ...cur, len: nextLen, stage: "idle", bestLen: bestLenVal });
      best.textContent = `ベスト長：${bestLenVal}`;
      btnNext.disabled = false;
      btnCheck.disabled = true;
      btnStart.disabled = false;
      setStage("idle");
      memoBox.textContent = `正解：${target}`;
      renderDashboard();
    }

    btnStart.addEventListener("click", start);
    btnCheck.addEventListener("click", check);
    btnNext.addEventListener("click", () => {
      setNotice("");
      lenInput.value = String(getGameState(gameId, {}).len || 4);
      start();
    });

    modeSelect.addEventListener("change", () => {
      customField.field.hidden = modeSelect.value !== "custom";
    });

    const configRow = h("div", { class: "row" }, [
      h("label", { class: "field" }, [
        h("span", { class: "labelText", text: "長さ（自動で増減）" }),
        lenInput,
      ]),
      h("label", { class: "field" }, [
        h("span", { class: "labelText", text: "遅延（秒）" }),
        delayInput,
      ]),
    ]);

    root.appendChild(h("div", { class: "row" }, [
      h("label", { class: "field" }, [
        h("span", { class: "labelText", text: "モード" }),
        modeSelect,
      ]),
      h("div", { class: "field" }, [
        h("span", { class: "labelText", text: "ヒント" }),
        h("div", { class: "muted", text: "digits/wordsは自動生成。customは自分の列を使用。" }),
      ]),
    ]));
    root.appendChild(customField.field);
    root.appendChild(configRow);
    root.appendChild(row);
    root.appendChild(progress.el);
    root.appendChild(memoBox);
    root.appendChild(recall.field);
    root.appendChild(h("div", { class: "formRow" }, [btnStart, btnCheck, btnNext]));

    return () => stopTimer();
  }

  function renderGame4Rules(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const ruleSelect = h("select", { class: "select" }, [
      h("option", { value: "mult3", text: "3の倍数のときだけタップ" }),
      h("option", { value: "prime", text: "素数のときだけタップ" }),
      h("option", { value: "even", text: "偶数のときだけタップ" }),
      h("option", { value: "odd", text: "奇数のときだけタップ" }),
      h("option", { value: "contains7", text: "7を含むときだけタップ" }),
    ]);
    ruleSelect.value = getGameState(gameId, { rule: "mult3" }).rule || "mult3";

    let interval = null;
    let current = randInt(1, 99);
    let seen = 0;
    let hits = 0;
    let misses = 0;
    let falseHits = 0;
    let running = false;

    const ruleText = h("div", { class: "inlineNotice", text: "ルール：—" });
    const num = h("div", { class: "bigNumber", text: String(current) });
    const stats = h("div", { class: "helpRow" }, [
      h("span", { class: "counter", text: "回数：0" }),
      h("span", { class: "counter", text: "正：0 / 誤：0" }),
    ]);
    const btnStart = h("button", { class: "primaryBtn", type: "button", text: "開始" });
    const btnStop = h("button", { class: "ghostBtn danger", type: "button", text: "停止" });
    const btnTap = h("button", { class: "ghostBtn", type: "button", text: "条件に合う！タップ" });
    btnStop.disabled = true;
    btnTap.disabled = true;

    const ruleFns = {
      mult3: (n) => n % 3 === 0,
      even: (n) => n % 2 === 0,
      odd: (n) => n % 2 === 1,
      contains7: (n) => String(n).includes("7"),
      prime: (n) => {
        if (n < 2) return false;
        for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
        return true;
      },
    };

    function updateRuleText() {
      const label = ruleSelect.selectedOptions[0]?.textContent || "—";
      ruleText.textContent = `ルール：${label}`;
    }

    function nextNumber() {
      current = randInt(1, 99);
      num.textContent = String(current);
      seen++;
      stats.firstChild.textContent = `回数：${seen}`;
      stats.lastChild.textContent = `正：${hits} / 誤：${falseHits + misses}`;
    }

    function stop(reason = "停止") {
      if (interval) clearInterval(interval);
      interval = null;
      running = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnTap.disabled = true;
      pushLog(gameId, {
        title: "ルール保持",
        body:
          `ルール：${ruleSelect.selectedOptions[0]?.textContent}\n` +
          `回数：${seen}\n正：${hits}\n見逃し：${misses}\n誤タップ：${falseHits}\n終了：${reason}`,
        score: hits,
        tags: [
          { text: `正${hits}`, kind: "ok" },
          { text: `誤${falseHits + misses}`, kind: (falseHits + misses) ? "warn" : "ok" },
        ],
      });
      renderLogs(gameId);
      toastSaved("ok");
      setNotice("終了しました。次はルールを変えてもOKです。", "ok");
      renderDashboard();
    }

    function start() {
      setNotice("");
      hits = 0;
      misses = 0;
      falseHits = 0;
      seen = 0;
      running = true;
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnTap.disabled = false;
      updateRuleText();
      setGameState(gameId, { rule: ruleSelect.value });
      nextNumber();
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        const ruleOk = ruleFns[ruleSelect.value]?.(current) || false;
        // "見逃し" は、条件に合うのにタップしないまま次に進んだ時にカウント
        if (ruleOk) misses++;
        nextNumber();
      }, cfg.ruleSpeedMs);
    }

    btnTap.addEventListener("click", () => {
      if (!running) return;
      const ruleOk = ruleFns[ruleSelect.value]?.(current) || false;
      if (ruleOk) {
        hits++;
        // 見逃しカウントの補正：条件に合うのに次へ進む前に押したので、直近の見逃し予定を戻す
        misses = Math.max(0, misses - 1);
        toast("正タップ", "ok", 900);
        flashOk();
        maybeSuggestDifficultyUp(gameId, true);
      } else {
        falseHits++;
        toast("誤タップ", "bad", 900);
        shake(root);
      }
      stats.lastChild.textContent = `正：${hits} / 誤：${falseHits + misses}`;
    });

    btnStart.addEventListener("click", start);
    btnStop.addEventListener("click", () => stop("手動停止"));
    ruleSelect.addEventListener("change", updateRuleText);
    updateRuleText();

    root.appendChild(
      h("div", { class: "row" }, [
        h("label", { class: "field" }, [
          h("span", { class: "labelText", text: "ルール" }),
          ruleSelect,
        ]),
        h("div", { class: "field" }, [
          h("span", { class: "labelText", text: "スピード" }),
          h("div", { class: "muted", text: `難易度で変化（${cfg.ruleSpeedMs}ms/更新）` }),
        ]),
      ])
    );
    root.appendChild(ruleText);
    root.appendChild(stats);
    root.appendChild(num);
    root.appendChild(h("div", { class: "formRow" }, [btnStart, btnStop, btnTap]));

    return () => {
      if (interval) clearInterval(interval);
    };
  }

  function renderGame5Reverse(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, { sentences: [], stage: "write" });
    let timer = null;

    const input = makeField({
      label: "文章を書く（1文ずつ。改行で区切り）",
      placeholder: "例：今日は早起きした。\n朝ごはんを食べた。\n駅まで歩いた。",
      value: (s.sentences || []).join("\n"),
      rows: 7,
      id: "g5_text",
    });
    const delay = h("span", { class: "counter", text: `遅延：${Math.round(cfg.reverseDelayMs / 1000)}秒` });
    const btnStart = h("button", { class: "primaryBtn", type: "button", text: "テスト開始" });
    const btnAsk1 = h("button", { class: "ghostBtn", type: "button", text: "1文前は？" });
    const btnAsk2 = h("button", { class: "ghostBtn", type: "button", text: "2文前は？" });
    const btnAsk3 = h("button", { class: "ghostBtn", type: "button", text: "3文前は？" });
    btnAsk1.disabled = true;
    btnAsk2.disabled = true;
    btnAsk3.disabled = true;

    const ans = makeInput({
      label: "回答（ここに入力してもOK）",
      placeholder: "思い出した文を入力",
      value: "",
      id: "g5_ans",
    });

    const reveal = h("div", { class: "inlineNotice", text: "開始すると一定時間後に質問できます。" });

    function parseSentences() {
      return input.textarea.value
        .split(/\n+/)
        .map((x) => normalizeStr(x))
        .filter(Boolean);
    }

    function enableAsks(ok) {
      btnAsk1.disabled = !ok;
      btnAsk2.disabled = !ok;
      btnAsk3.disabled = !ok;
    }

    function start() {
      setNotice("");
      const sentences = parseSentences();
      if (sentences.length < 3) return setNotice("最低3文は書いてください。", "warn");
      setGameState(gameId, { sentences, stage: "waiting" });
      input.textarea.disabled = true;
      btnStart.disabled = true;
      enableAsks(false);
      reveal.textContent = `待機中…（${Math.round(cfg.reverseDelayMs / 1000)}秒後に質問が解放されます）`;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        enableAsks(true);
        reveal.textContent = "質問できます。直前の文から遡って答えてください。";
        toast("質問解放", "ok");
      }, cfg.reverseDelayMs);
    }

    function ask(k) {
      const sentences = getGameState(gameId, {}).sentences || [];
      const idx = sentences.length - 1 - k;
      if (idx < 0) return;
      const q = `${k}文前は？（思い出して入力 or 口頭でもOK）`;
      const expected = sentences[idx];
      const resp = window.prompt(q, ans.input.value || "");
      if (resp === null) return;
      const r = normalizeStr(resp);
      ans.input.value = r;
      const ok = normalizeStr(r).toLowerCase() === normalizeStr(expected).toLowerCase();
      pushLog(gameId, {
        title: "思考逆走",
        body: `質問：${k}文前\n期待：${expected}\n回答：${r || "（空）"}\n結果：${ok ? "一致" : "不一致"}`,
        tags: [{ text: ok ? "一致" : "不一致", kind: ok ? "ok" : "bad" }],
      });
      renderLogs(gameId);
      setNotice(ok ? "一致。次もいけます。" : "不一致。ズレた場所をメモすると効きます。", ok ? "ok" : "warn");
    }

    function resetEditable() {
      if (timer) clearTimeout(timer);
      timer = null;
      input.textarea.disabled = false;
      btnStart.disabled = false;
      enableAsks(false);
      reveal.textContent = "開始すると一定時間後に質問できます。";
    }

    btnStart.addEventListener("click", start);
    btnAsk1.addEventListener("click", () => ask(1));
    btnAsk2.addEventListener("click", () => ask(2));
    btnAsk3.addEventListener("click", () => ask(3));

    root.appendChild(delay);
    root.appendChild(input.field);
    root.appendChild(reveal);
    root.appendChild(ans.field);
    root.appendChild(h("div", { class: "formRow" }, [btnStart, btnAsk1, btnAsk2, btnAsk3]));

    return () => {
      resetEditable();
    };
  }

  function renderGame6NoLook(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, { lastText: "", lastInstruction: "" });
    let timeout = null;
    let peeked = false;

    const input = makeField({
      label: "文章を入力",
      placeholder: "短めでOK（1〜3文くらい）",
      value: s.lastText || "",
      rows: 6,
      id: "g6_text",
    });
    const instruction = h("select", { class: "select" }, [
      h("option", { value: "removeWord", text: "特定の単語を削除" }),
      h("option", { value: "removeChar", text: "特定の文字を削除" }),
      h("option", { value: "removeAllSpaces", text: "空白を全部削除" }),
      h("option", { value: "replaceWord", text: "単語を別の単語に置換" }),
    ]);
    instruction.value = "removeWord";

    const paramA = makeInput({
      label: "指示パラメータA（単語/文字など）",
      placeholder: "例：猫 / え / the",
      value: "",
      id: "g6_a",
    });
    const paramB = makeInput({
      label: "指示パラメータB（置換先。置換時のみ）",
      placeholder: "例：犬",
      value: "",
      id: "g6_b",
    });
    paramB.field.hidden = true;

    const peek = h("div", { class: "inlineNotice", text: "ここに一瞬だけ表示されます。" });
    const btnPeek = h("button", { class: "primaryBtn", type: "button", text: "一瞬表示して隠す" });
    const btnDo = h("button", { class: "ghostBtn", type: "button", text: "ノールックで編集して提出" });
    btnDo.disabled = true;
    const answer = makeField({
      label: "見ずに編集結果を入力（原文は見ない）",
      placeholder: "編集後の文章をここに入力",
      value: "",
      rows: 6,
      id: "g6_ans",
    });
    answer.textarea.disabled = true;

    function buildInstructionText() {
      const kind = instruction.value;
      if (kind === "removeAllSpaces") return "空白を全部削除してください";
      if (kind === "removeChar") return `「${paramA.input.value || "?"}」という文字を全削除してください`;
      if (kind === "removeWord") return `「${paramA.input.value || "?"}」という単語を全削除してください`;
      if (kind === "replaceWord") return `「${paramA.input.value || "?"}」を「${paramB.input.value || "?"}」に置換してください`;
      return "—";
    }

    function applyInstruction(textRaw) {
      const text = String(textRaw || "");
      const kind = instruction.value;
      const a = String(paramA.input.value || "");
      const b = String(paramB.input.value || "");
      if (kind === "removeAllSpaces") return text.replace(/\s+/g, "");
      if (kind === "removeChar") {
        if (!a) return text;
        return text.split(a).join("");
      }
      if (kind === "removeWord") {
        if (!a) return text;
        // simple token replace, keep punctuation
        const re = new RegExp(`\\b${escapeRegExp(a)}\\b`, "gi");
        return text.replace(re, "").replace(/\s{2,}/g, " ").trim();
      }
      if (kind === "replaceWord") {
        if (!a) return text;
        const re = new RegExp(`\\b${escapeRegExp(a)}\\b`, "gi");
        return text.replace(re, b);
      }
      return text;
    }

    function escapeRegExp(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function doPeek() {
      setNotice("");
      const raw = normalizeStr(input.textarea.value);
      if (!raw) {
        setNotice("文章を入力してください。", "warn");
        shake(root);
        return;
      }
      peeked = true;
      btnDo.disabled = false;
      answer.textarea.disabled = false;
      const instrText = buildInstructionText();
      setNotice(`指示：${instrText}`, "ok");
      peek.textContent = raw;
      peek.classList.remove("bad", "warn", "ok");
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        peek.textContent = "（非表示）";
      }, cfg.noLookPeekMs);
    }

    function submit() {
      if (!peeked) return setNotice("先に「一瞬表示して隠す」を押してください。", "warn");
      const raw = normalizeStr(input.textarea.value);
      const expected = normalizeStr(applyInstruction(raw));
      const ansText = normalizeStr(answer.textarea.value);
      if (!ansText) {
        setNotice("編集結果を入力してください。", "warn");
        shake(root);
        return;
      }
      const ok = expected.toLowerCase() === ansText.toLowerCase();
      pushLog(gameId, {
        title: "ノールック編集",
        body:
          `原文：${raw}\n` +
          `指示：${buildInstructionText()}\n` +
          `期待：${expected}\n` +
          `回答：${ansText}\n` +
          `結果：${ok ? "一致" : "不一致"}`,
        tags: [{ text: ok ? "一致" : "不一致", kind: ok ? "ok" : "bad" }],
      });
      setGameState(gameId, { lastText: raw, lastInstruction: instruction.value });
      renderLogs(gameId);
      setNotice(ok ? "一致。保持しながら操作できています。" : "不一致。どこが崩れたかがヒントです。", ok ? "ok" : "warn");
      if (ok) flashOk();
      else shake(root);
      toastSaved(ok ? "ok" : "warn");
      renderDashboard();
    }

    instruction.addEventListener("change", () => {
      paramB.field.hidden = instruction.value !== "replaceWord";
      setNotice("");
    });

    btnPeek.addEventListener("click", doPeek);
    btnDo.addEventListener("click", submit);

    root.appendChild(input.field);
    root.appendChild(h("label", { class: "field" }, [
      h("span", { class: "labelText", text: "指示の種類" }),
      instruction,
    ]));
    root.appendChild(paramA.field);
    root.appendChild(paramB.field);
    root.appendChild(peek);
    root.appendChild(answer.field);
    root.appendChild(h("div", { class: "formRow" }, [btnPeek, btnDo]));

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }

  function renderGame7Compress(root, { gameId }) {
    const s = getGameState(gameId, { last: "" });
    const input = makeField({
      label: "元の文章",
      placeholder: "考えをそのまま書く（長くてOK）",
      value: s.last || "",
      rows: 7,
      id: "g7_src",
      memo: true,
    });

    const out1 = makeField({
      label: "圧縮①（半分の文字数目標）",
      placeholder: "ここに半分くらいで要約",
      value: "",
      rows: 5,
      id: "g7_1",
      memo: true,
    });
    const out2 = makeField({
      label: "圧縮②（さらに半分の文字数目標）",
      placeholder: "さらに半分くらいで要約",
      value: "",
      rows: 4,
      id: "g7_2",
      memo: true,
    });

    // 下書き自動保存（10秒ごと）
    const draftKey = "draft";
    const savedDraft = getGameState(gameId, {})[draftKey];
    if (savedDraft && typeof savedDraft === "object") {
      if (!input.textarea.value) input.textarea.value = savedDraft.src || input.textarea.value;
      if (!out1.textarea.value) out1.textarea.value = savedDraft.c1 || out1.textarea.value;
      if (!out2.textarea.value) out2.textarea.value = savedDraft.c2 || out2.textarea.value;
    }
    let draftTimer = setInterval(() => {
      setGameState(gameId, {
        ...getGameState(gameId, {}),
        [draftKey]: { src: input.textarea.value, c1: out1.textarea.value, c2: out2.textarea.value, at: Date.now() },
      });
    }, 10_000);

    const stat = h("div", { class: "helpRow" }, [
      h("span", { class: "counter", text: "元：0" }),
      h("span", { class: "counter", text: "目標：—" }),
    ]);

    function refreshTargets() {
      const c0 = countChars(input.textarea.value);
      const t1 = Math.max(1, Math.floor(c0 / 2));
      const t2 = Math.max(1, Math.floor(t1 / 2));
      stat.firstChild.textContent = `元：${c0}`;
      stat.lastChild.textContent = `目標：①${t1} / ②${t2}`;
      return { c0, t1, t2 };
    }

    const btnCheck = h("button", { class: "ghostBtn", type: "button", text: "達成チェック" });
    const btnSave = h("button", { class: "primaryBtn", type: "button", text: "記録" });

    btnCheck.addEventListener("click", () => {
      const { t1, t2 } = refreshTargets();
      const c1 = countChars(out1.textarea.value);
      const c2 = countChars(out2.textarea.value);
      const ok1 = c1 <= t1;
      const ok2 = c2 <= t2;
      setNotice(
        `① ${c1}/${t1}（${ok1 ? "達成" : "未達"}） / ② ${c2}/${t2}（${ok2 ? "達成" : "未達"}）`,
        ok1 && ok2 ? "ok" : ok1 || ok2 ? "warn" : "bad"
      );
    });

    btnSave.addEventListener("click", () => {
      const src = normalizeStr(input.textarea.value);
      const c1 = normalizeStr(out1.textarea.value);
      const c2 = normalizeStr(out2.textarea.value);
      if (!src || !c1 || !c2) {
        setNotice("元文・圧縮①・圧縮②をすべて入力してください。", "warn");
        shake(root);
        return;
      }
      const { t1, t2 } = refreshTargets();
      const ok1 = countChars(c1) <= t1;
      const ok2 = countChars(c2) <= t2;
      pushLog(gameId, {
        title: "思考圧縮",
        body: `元（${countChars(src)}字）：\n${src}\n\n①（${countChars(c1)}字 / 目標${t1}）：\n${c1}\n\n②（${countChars(c2)}字 / 目標${t2}）：\n${c2}`,
        tags: [
          { text: ok1 ? "①達成" : "①未達", kind: ok1 ? "ok" : "warn" },
          { text: ok2 ? "②達成" : "②未達", kind: ok2 ? "ok" : "warn" },
        ],
      });
      setGameState(gameId, { last: src });
      // 下書きクリア
      const cur = getGameState(gameId, {});
      if (cur[draftKey]) setGameState(gameId, { ...cur, [draftKey]: null });
      renderLogs(gameId);
      if (ok1 && ok2) flashOk();
      toastSaved(ok1 && ok2 ? "ok" : "warn");
      renderDashboard();
      setNotice("保存しました。繰り返すほど“残る形”が作りやすくなります。", "ok");
    });

    input.textarea.addEventListener("input", refreshTargets);
    refreshTargets();

    root.appendChild(stat);
    root.appendChild(input.field);
    root.appendChild(out1.field);
    root.appendChild(out2.field);
    root.appendChild(h("div", { class: "formRow" }, [btnCheck, btnSave]));

    return () => {
      if (draftTimer) clearInterval(draftTimer);
      draftTimer = null;
    };
  }

  function renderGame8DelayTalk(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, {
      question: "今日何した？",
      first: null,
      second: null,
      delayMs: 120_000,
    });
    let timer = null;

    const question = makeInput({
      label: "質問",
      placeholder: "例：今日何した？ / 昼ごはん何食べた？",
      value: s.question || "今日何した？",
      id: "g8_q",
    });
    const delayMin = h("input", {
      class: "input",
      type: "number",
      min: "1",
      max: "30",
      value: String(Math.round((s.delayMs || 120000) / 60000)),
    });
    const a1 = makeField({
      label: "回答①",
      placeholder: "まず答える",
      value: s.first?.text || "",
      rows: 5,
      id: "g8_a1",
    });
    const a2 = makeField({
      label: "回答②（時間差後）",
      placeholder: "時間が経ったら同じ質問にもう一度答える",
      value: s.second?.text || "",
      rows: 5,
      id: "g8_a2",
    });
    const status = h("div", { class: "helpRow" }, [
      h("span", { class: "counter", text: "状態：—" }),
      h("span", { class: "counter", text: `難易度：${difficulty}` }),
    ]);
    const progress = makeProgress(60);
    const btnSave1 = h("button", { class: "primaryBtn", type: "button", text: "回答①を保存して待機開始" });
    const btnSave2 = h("button", { class: "ghostBtn", type: "button", text: "回答②を保存して差分を見る" });
    const btnCancel = h("button", { class: "ghostBtn danger", type: "button", text: "待機キャンセル" });
    btnCancel.disabled = true;

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function renderDiff(q, t1, t2) {
      const d = diffWords(t1, t2);
      const sim = similarityHint(t1, t2);
      const body =
        `質問：${q}\n\n` +
        `①：${t1}\n\n` +
        `②：${t2}\n\n` +
        `一致っぽさ：${sim.pct}%（${sim.hint}）\n` +
        `②だけ：${d.onlyB.slice(0, 20).join(" / ") || "—"}\n` +
        `①だけ：${d.onlyA.slice(0, 20).join(" / ") || "—"}`;
      const colored = renderDiffHtml(t1, t2);
      const bodyHtml =
        `<div><b>質問</b>：${escapeHtml(q)}</div>` +
        `<div style="margin-top:8px"><b>①</b>：${escapeHtml(t1)}</div>` +
        `<div style="margin-top:8px"><b>②</b>：${escapeHtml(t2)}</div>` +
        `<div style="margin-top:10px"><b>差分</b></div>` +
        `<div style="margin-top:6px"><span class="diffAdd">追加</span>：${colored.addHtml}</div>` +
        `<div style="margin-top:6px"><span class="diffDel">削除</span>：${colored.delHtml}</div>` +
        `<div style="margin-top:10px"><b>一致っぽさ</b>：${sim.pct}%（${escapeHtml(sim.hint)}）</div>`;
      return { body, bodyHtml, simPct: sim.pct, onlyA: d.onlyA.length, onlyB: d.onlyB.length };
    }

    btnSave1.addEventListener("click", () => {
      setNotice("");
      const q = normalizeStr(question.input.value);
      const minutes = clamp(Number(delayMin.value || 2), 1, 30);
      const dms = minutes * 60_000;
      const t1 = normalizeStr(a1.textarea.value);
      if (!q || !t1) {
        setNotice("質問と回答①を入力してください。", "warn");
        shake(root);
        return;
      }
      const startedAt = Date.now();
      setGameState(gameId, { question: q, delayMs: dms, first: { text: t1, at: startedAt }, second: null });
      status.firstChild.textContent = `状態：待機中（${minutes}分）`;
      toast("待機開始", "ok");
      btnCancel.disabled = false;
      progress.setTotal(minutes * 60);
      let remain = minutes * 60;
      progress.setRemaining(remain);
      stop();
      timer = setInterval(() => {
        remain = Math.max(0, remain - 1);
        progress.setRemaining(remain);
        if (remain <= 0) {
          stop();
          status.firstChild.textContent = "状態：回答②を入力してください";
          toast("時間です。回答②へ", "ok", 3000);
          setNotice("時間です。さっきと同じ質問に、もう一度答えてください。", "ok");
          btnCancel.disabled = true;
        }
      }, 1000);
    });

    btnCancel.addEventListener("click", () => {
      stop();
      btnCancel.disabled = true;
      status.firstChild.textContent = "状態：キャンセル";
      setNotice("待機をキャンセルしました。回答①は残ります。", "warn");
      toast("待機キャンセル", "warn");
    });

    btnSave2.addEventListener("click", () => {
      setNotice("");
      const st = getGameState(gameId, {});
      const q = normalizeStr(question.input.value);
      const t1 = normalizeStr(st.first?.text || a1.textarea.value);
      const t2 = normalizeStr(a2.textarea.value);
      if (!q || !t1 || !t2) {
        setNotice("質問と回答①②を入力してください。", "warn");
        shake(root);
        return;
      }
      const { body, bodyHtml, simPct } = renderDiff(q, t1, t2);
      pushLog(gameId, {
        title: "時間差自己対話",
        body,
        bodyHtml,
        score: simPct,
        tags: [{ text: `一致${simPct}%`, kind: simPct >= 70 ? "ok" : simPct >= 35 ? "warn" : "bad" }],
      });
      setGameState(gameId, { ...st, question: q, second: { text: t2, at: Date.now() } });
      renderLogs(gameId);
      toastSaved(simPct >= 70 ? "ok" : "warn");
      if (simPct >= 70) flashOk();
      renderDashboard();
      setNotice("保存しました。ズレた単語をメモすると“歪みのクセ”が見えます。", "ok");
    });

    root.appendChild(
      h("div", { class: "row" }, [
        question.field,
        h("label", { class: "field" }, [
          h("span", { class: "labelText", text: "待機（分）" }),
          delayMin,
        ]),
      ])
    );
    root.appendChild(status);
    root.appendChild(progress.el);
    root.appendChild(a1.field);
    root.appendChild(a2.field);
    root.appendChild(h("div", { class: "formRow" }, [btnSave1, btnCancel, btnSave2]));

    // resume waiting (best-effort)
    const st = getGameState(gameId, {});
    if (st.first?.at && st.delayMs && !st.second) {
      const elapsed = Date.now() - st.first.at;
      const remainMs = Math.max(0, st.delayMs - elapsed);
      const remainSec = Math.ceil(remainMs / 1000);
      const totalSec = Math.ceil(st.delayMs / 1000);
      progress.setTotal(totalSec);
      progress.setRemaining(remainSec);
      if (remainSec > 0) {
        status.firstChild.textContent = `状態：待機中（残り約${Math.ceil(remainSec / 60)}分）`;
        btnCancel.disabled = false;
        stop();
        timer = setInterval(() => {
          const r = Math.max(0, Math.ceil((st.first.at + st.delayMs - Date.now()) / 1000));
          progress.setRemaining(r);
          if (r <= 0) {
            stop();
            status.firstChild.textContent = "状態：回答②を入力してください";
            toast("時間です。回答②へ", "ok", 3000);
            btnCancel.disabled = true;
          }
        }, 1000);
      } else {
        status.firstChild.textContent = "状態：回答②を入力してください";
        btnCancel.disabled = true;
      }
      question.input.value = st.question || question.input.value;
      a1.textarea.value = st.first?.text || a1.textarea.value;
    } else {
      status.firstChild.textContent = "状態：—";
      progress.setPct(0);
    }

    return () => stop();
  }

  function renderGame9MultiTask(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, { stage: "idle", aText: "", bText: "", startedAt: null });
    let timer = null;
    let remain = 0;

    const a = makeField({
      label: "タスクA：文章を入力（途中で割り込み）",
      placeholder: "Aを入力し始める",
      value: s.aText || "",
      rows: 5,
      id: "g9_a",
    });
    const b = makeField({
      label: "タスクB：割り込み（短い計算 or 文字入力）",
      placeholder: "Bの指示が出たらここに入力",
      value: s.bText || "",
      rows: 4,
      id: "g9_b",
    });
    b.textarea.disabled = true;

    const status = h("div", { class: "helpRow" }, [
      h("span", { class: "counter", text: "状態：—" }),
      h("span", { class: "counter", text: `割り込み：${Math.round(cfg.multitaskSwitchMs / 1000)}秒後` }),
    ]);
    const progress = makeProgress(Math.round(cfg.multitaskSwitchMs / 1000));

    const btnStart = h("button", { class: "primaryBtn", type: "button", text: "開始" });
    const btnFinishB = h("button", { class: "ghostBtn", type: "button", text: "B完了→Aに戻る" });
    const btnEnd = h("button", { class: "ghostBtn danger", type: "button", text: "終了して記録" });
    btnFinishB.disabled = true;

    const bPrompt = h("div", { class: "inlineNotice", text: "開始するとA→Bへ割り込みます。" });
    let bExpected = null;
    let aSnapshot = "";

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function start() {
      setNotice("");
      a.textarea.disabled = false;
      b.textarea.disabled = true;
      b.textarea.value = "";
      bExpected = null;
      aSnapshot = "";
      btnStart.disabled = true;
      btnFinishB.disabled = true;
      status.firstChild.textContent = "状態：A入力中";
      a.textarea.focus();
      remain = Math.round(cfg.multitaskSwitchMs / 1000);
      progress.setTotal(remain);
      progress.setRemaining(remain);
      stop();
      timer = setInterval(() => {
        remain = Math.max(0, remain - 1);
        progress.setRemaining(remain);
        if (remain <= 0) {
          stop();
          switchToB();
        }
      }, 1000);
    }

    function switchToB() {
      aSnapshot = a.textarea.value;
      a.textarea.disabled = true;
      b.textarea.disabled = false;
      btnFinishB.disabled = false;
      status.firstChild.textContent = "状態：割り込みB";
      const type = Math.random() < 0.5 ? "calc" : "copy";
      if (type === "calc") {
        const x = randInt(7, 29);
        const y = randInt(5, 19);
        bExpected = String(x + y);
        bPrompt.textContent = `割り込みB：${x}+${y} = ?（答えを入力）`;
      } else {
        const token = shuffle("ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split("")).slice(0, 5).join("");
        bExpected = token;
        bPrompt.textContent = `割り込みB：このコードをそのまま入力 → ${token}`;
      }
      b.textarea.focus();
      toast("割り込み発生", "warn", 2000);
    }

    function finishB() {
      const ans = normalizeStr(b.textarea.value);
      const ok = bExpected ? ans.replace(/\s+/g, "") === bExpected : false;
      a.textarea.disabled = false;
      a.textarea.focus();
      b.textarea.disabled = true;
      btnFinishB.disabled = true;
      status.firstChild.textContent = "状態：Aに復帰";
      setNotice(ok ? "Bは正解。Aに戻りました。" : "Bが不正解でもOK。Aに戻りました。", ok ? "ok" : "warn");
      toast("Aに戻る", "ok", 1400);
      return ok;
    }

    btnStart.addEventListener("click", start);
    btnFinishB.addEventListener("click", () => finishB());

    btnEnd.addEventListener("click", () => {
      stop();
      const aText = normalizeStr(a.textarea.value);
      const bText = normalizeStr(b.textarea.value);
      const bOk = bExpected ? bText.replace(/\s+/g, "") === bExpected : null;
      const resumed = aSnapshot ? countChars(aText) - countChars(aSnapshot) : 0;
      pushLog(gameId, {
        title: "マルチタスク分断耐性",
        body:
          `A（最終）：\n${aText}\n\n` +
          `A（割り込み直前スナップショット）：\n${normalizeStr(aSnapshot) || "—"}\n\n` +
          `B：${bPrompt.textContent}\n回答：${bText || "—"}\nB結果：${bOk === null ? "—" : bOk ? "正解" : "不正解"}\n\n` +
          `A復帰後に増えた文字数（目安）：${resumed}`,
        tags: [
          { text: `復帰+${resumed}`, kind: resumed > 0 ? "ok" : "warn" },
          { text: bOk === null ? "B未実施" : bOk ? "B正解" : "B不正解", kind: bOk ? "ok" : "warn" },
        ],
      });
      setGameState(gameId, { stage: "idle", aText, bText });
      renderLogs(gameId);
      btnStart.disabled = false;
      btnFinishB.disabled = true;
      a.textarea.disabled = false;
      b.textarea.disabled = true;
      status.firstChild.textContent = "状態：終了";
      if (resumed > 0) flashOk();
      toastSaved(resumed > 0 ? "ok" : "warn");
      renderDashboard();
      setNotice("保存しました。割り込み後に“どこから再開したか”を意識すると伸びます。", "ok");
    });

    root.appendChild(status);
    root.appendChild(progress.el);
    root.appendChild(a.field);
    root.appendChild(bPrompt);
    root.appendChild(b.field);
    root.appendChild(h("div", { class: "formRow" }, [btnStart, btnFinishB, btnEnd]));

    return () => stop();
  }

  function renderGame10Intent(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, {
      intent: "",
      distract: "",
      recall: "",
      stage: "idle",
      startedAt: null,
    });
    let timer = null;
    let remain = 0;

    const intent = makeInput({
      label: "これからやること（意図）",
      placeholder: "例：洗濯物を干す / メール返信 / 皿洗い",
      value: s.intent || "",
      id: "g10_intent",
    });
    const distract = makeField({
      label: "別タスク（割り込み）",
      placeholder: "割り込みタスクをやったつもりで、ここに簡単に入力して埋める",
      value: s.distract || "",
      rows: 4,
      id: "g10_dist",
    });
    const recall = makeInput({
      label: "元の意図を再現（思い出して入力）",
      placeholder: "さっき何をしようとしてた？",
      value: s.recall || "",
      id: "g10_recall",
    });
    recall.input.disabled = true;

    const status = h("div", { class: "helpRow" }, [
      h("span", { class: "counter", text: "状態：—" }),
      h("span", { class: "counter", text: `挟む時間：${Math.round(cfg.intentionSwitchMs / 1000)}秒` }),
    ]);
    const progress = makeProgress(Math.round(cfg.intentionSwitchMs / 1000));

    const btnStart = h("button", { class: "primaryBtn", type: "button", text: "開始（意図→割り込み）" });
    const btnDoneDistract = h("button", { class: "ghostBtn", type: "button", text: "割り込み完了→思い出す" });
    const btnCheck = h("button", { class: "ghostBtn", type: "button", text: "答え合わせして記録" });
    btnDoneDistract.disabled = true;
    btnCheck.disabled = true;

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    btnStart.addEventListener("click", () => {
      setNotice("");
      const it = normalizeStr(intent.input.value);
      if (!it) {
        setNotice("意図を入力してください。", "warn");
        shake(root);
        return;
      }
      setGameState(gameId, { ...s, intent: it, stage: "distract", startedAt: Date.now(), distract: "", recall: "" });
      distract.textarea.value = "";
      recall.input.value = "";
      recall.input.disabled = true;
      btnDoneDistract.disabled = true;
      btnCheck.disabled = true;
      intent.input.disabled = true;
      distract.textarea.disabled = false;
      distract.textarea.focus();
      status.firstChild.textContent = "状態：割り込み中";
      remain = Math.round(cfg.intentionSwitchMs / 1000);
      progress.setTotal(remain);
      progress.setRemaining(remain);
      stop();
      timer = setInterval(() => {
        remain = Math.max(0, remain - 1);
        progress.setRemaining(remain);
        if (remain <= 0) {
          stop();
          btnDoneDistract.disabled = false;
          toast("割り込み完了ボタンが押せます", "ok", 2500);
          setNotice("割り込みが終わった想定で「割り込み完了→思い出す」を押してください。", "ok");
        }
      }, 1000);
    });

    btnDoneDistract.addEventListener("click", () => {
      const d = normalizeStr(distract.textarea.value);
      distract.textarea.disabled = true;
      recall.input.disabled = false;
      recall.input.focus();
      btnCheck.disabled = false;
      btnDoneDistract.disabled = true;
      status.firstChild.textContent = "状態：意図を思い出す";
      setGameState(gameId, { ...getGameState(gameId, {}), distract: d, stage: "recall" });
    });

    btnCheck.addEventListener("click", () => {
      const st = getGameState(gameId, {});
      const it = normalizeStr(st.intent || intent.input.value);
      const d = normalizeStr(st.distract || distract.textarea.value);
      const r = normalizeStr(recall.input.value);
      if (!r) {
        setNotice("思い出した意図を入力してください。", "warn");
        shake(root);
        return;
      }
      const sim = similarityHint(it, r);
      const ok = sim.pct >= 70;
      pushLog(gameId, {
        title: "意図保持",
        body: `意図：${it}\n割り込み：${d || "—"}\n再現：${r}\n一致っぽさ：${sim.pct}%（${sim.hint}）`,
        tags: [{ text: `一致${sim.pct}%`, kind: ok ? "ok" : sim.pct >= 35 ? "warn" : "bad" }],
      });
      setGameState(gameId, { intent: it, distract: d, recall: r, stage: "idle", startedAt: null });
      renderLogs(gameId);
      if (ok) flashOk();
      else shake(root);
      toastSaved(ok ? "ok" : "warn");
      renderDashboard();
      setNotice(ok ? "意図保持できています。" : "ズレてもOK。ズレ方が改善ポイントです。", ok ? "ok" : "warn");
      intent.input.disabled = false;
      btnCheck.disabled = true;
      status.firstChild.textContent = "状態：終了";
    });

    root.appendChild(status);
    root.appendChild(progress.el);
    root.appendChild(intent.field);
    root.appendChild(distract.field);
    root.appendChild(recall.field);
    root.appendChild(h("div", { class: "formRow" }, [btnStart, btnDoneDistract, btnCheck]));

    return () => stop();
  }

  function renderGame11Flash(root, { gameId, difficulty }) {
    const cfg = difficultyConfig[difficulty];
    const s = getGameState(gameId, { lastCount: 6, stage: "setup" });

    const countSel = h("select", { class: "select" }, []);
    for (let n = 3; n <= 14; n++) countSel.appendChild(h("option", { value: String(n), text: `${n}枚` }));
    countSel.value = String(s.lastCount || 6);

    const poolSel = h("select", { class: "select" }, [
      h("option", { value: "upper", text: "英大文字（A-Z）" }),
      h("option", { value: "lower", text: "英小文字（a-z）" }),
      h("option", { value: "mix", text: "混合（A-Z + a-z）" }),
    ]);
    poolSel.value = "upper";

    const btnStart = h("button", { class: "primaryBtn", type: "button", text: "開始" });
    const area = h("div", {});

    let seq = [];
    let idx = 0;
    let shown = 0;
    let timeout = null;
    let userOrder = [];

    function stopTimer() {
      if (timeout) clearTimeout(timeout);
      timeout = null;
    }

    function buildPool() {
      const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      const lower = "abcdefghijklmnopqrstuvwxyz".split("");
      if (poolSel.value === "lower") return lower;
      if (poolSel.value === "mix") return upper.concat(lower);
      return upper;
    }

    function renderSetup() {
      clearNode(area);
      area.appendChild(
        h("div", { class: "row" }, [
          h("label", { class: "field" }, [
            h("span", { class: "labelText", text: "フラッシュカード枚数" }),
            countSel,
          ]),
          h("label", { class: "field" }, [
            h("span", { class: "labelText", text: "文字セット" }),
            poolSel,
          ]),
        ])
      );
      area.appendChild(
        h("div", { class: "muted", text: `表示速度は難易度で変化（${cfg.flashPeekMs}ms/枚）。` })
      );
      area.appendChild(h("div", { class: "formRow" }, [btnStart]));
    }

    function renderFlash() {
      clearNode(area);
      const status = h("div", { class: "helpRow" }, [
        h("span", { class: "counter", text: `めくり：${shown}/${seq.length}` }),
        h("span", { class: "counter", text: `速度：${cfg.flashPeekMs}ms` }),
      ]);
      const card = h("div", { class: "bigNumber", text: seq[idx] || "—" });
      const progress = makeProgress(seq.length);
      progress.setTotal(seq.length);
      progress.setPct((shown / seq.length) * 100);
      area.appendChild(status);
      area.appendChild(progress.el);
      area.appendChild(card);
    }

    function flashNext() {
      renderFlash();
      const ch = seq[idx];
      if (ch) speak(ch);
      stopTimer();
      timeout = setTimeout(() => {
        shown++;
        idx++;
        if (idx >= seq.length) {
          stopTimer();
          toast("並べ替えへ", "ok");
          renderReorder();
          return;
        }
        flashNext();
      }, cfg.flashPeekMs);
    }

    function renderReorder() {
      clearNode(area);
      setNotice("見た順番を再現してください。下の候補からタップで順に積み上げます。間違えたら最後を戻せます。", "ok");
      userOrder = [];
      const candidates = shuffle(seq);
      const status = h("div", { class: "helpRow" }, [
        h("span", { class: "counter", text: `選択：0/${seq.length}` }),
        h("span", { class: "counter", text: "操作：タップ" }),
      ]);
      const chosen = h("div", { class: "chips" }, []);
      const pool = h("div", { class: "chips" }, []);

      function refresh() {
        status.firstChild.textContent = `選択：${userOrder.length}/${seq.length}`;
        clearNode(chosen);
        for (let i = 0; i < userOrder.length; i++) {
          const ch = h("button", { class: "chipBtn on", type: "button", text: `${i + 1}. ${userOrder[i]}` });
          chosen.appendChild(ch);
        }
        clearNode(pool);
        for (const c of candidates) {
          const usedCount = userOrder.filter((x) => x === c).length;
          const totalCount = seq.filter((x) => x === c).length;
          const disabled = usedCount >= totalCount || userOrder.length >= seq.length;
          const btn = h("button", { class: "chipBtn", type: "button", text: c, disabled });
          btn.addEventListener("click", () => {
            userOrder.push(c);
            refresh();
          });
          pool.appendChild(btn);
        }
      }

      const btnUndo = h("button", { class: "ghostBtn", type: "button", text: "最後を戻す" });
      const btnClear = h("button", { class: "ghostBtn danger", type: "button", text: "全部クリア" });
      const btnCheck = h("button", { class: "primaryBtn", type: "button", text: "答え合わせ" });
      btnCheck.disabled = true;

      // 初期描画（ここを呼ばないと候補が出ない）
      refresh();

      btnUndo.addEventListener("click", () => {
        userOrder.pop();
        refresh();
        setNotice("", "ok");
      });
      btnClear.addEventListener("click", () => {
        userOrder = [];
        refresh();
        setNotice("", "ok");
      });
      btnCheck.addEventListener("click", () => {
        const ok = userOrder.join("|") === seq.join("|");
        const correctPos = userOrder.reduce((acc, v, i) => acc + (v === seq[i] ? 1 : 0), 0);
        pushLog(gameId, {
          title: "英文字フラッシュカード",
          body:
            `枚数：${seq.length}\n` +
            `正解：${seq.join(" ")}\n` +
            `回答：${userOrder.join(" ")}\n` +
            `位置一致：${correctPos}/${seq.length}\n結果：${ok ? "完全一致" : "不一致"}`,
          score: correctPos,
          tags: [
            { text: ok ? "完全一致" : "不一致", kind: ok ? "ok" : "bad" },
            { text: `一致${correctPos}/${seq.length}`, kind: correctPos >= Math.ceil(seq.length * 0.7) ? "ok" : "warn" },
          ],
        });
        renderLogs(gameId);
        setNotice(
          ok ? "完全一致。次は枚数を増やしてOKです。" : "不一致。ズレた位置を見てパターンを掴みましょう。",
          ok ? "ok" : "warn"
        );
        if (ok) flashOk();
        else shake(root);
        toastSaved(ok ? "ok" : "warn");
        renderDashboard();
        maybeSuggestDifficultyUp(gameId, ok);
      });

      // enable check when full length
      const observer = new MutationObserver(() => {
        btnCheck.disabled = userOrder.length !== seq.length;
      });
      observer.observe(chosen, { childList: true, subtree: true });

      area.appendChild(status);
      area.appendChild(h("div", { class: "divider" }));
      area.appendChild(h("div", { class: "kicker", text: "あなたの並び" }));
      area.appendChild(chosen);
      area.appendChild(h("div", { class: "divider" }));
      area.appendChild(h("div", { class: "kicker", text: "候補（タップして追加）" }));
      area.appendChild(pool);
      area.appendChild(h("div", { class: "formRow" }, [btnUndo, btnClear, btnCheck]));

      return () => observer.disconnect();
    }

    btnStart.addEventListener("click", () => {
      setNotice("");
      const count = clamp(Number(countSel.value || 6), 3, 14);
      const pool = buildPool();
      seq = shuffle(pool).slice(0, count);
      idx = 0;
      shown = 0;
      setGameState(gameId, { lastCount: count, stage: "run" });
      toast("めくり開始", "ok");
      flashNext();
    });

    root.appendChild(
      h("div", { class: "muted", text: "⑪は“順序”がポイント。タップ操作だけで確実に並べ替えできます。" })
    );
    root.appendChild(area);
    renderSetup();

    return () => stopTimer();
  }

  // --- Initial render ---
  document.body.dataset.screen = "home";
  applyAccentFromMeta();
  renderGameGrid("");

  // PWA: register Service Worker (requires https/localhost)
  (() => {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      return;
    }
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // ignore
      });
    });
  })();

  // タイピング速度ビジュアライザー（入力速度に応じて上部バーが伸縮）
  (() => {
    if (!typingViz) return;
    let lastT = 0;
    let lastLen = 0;
    let tOff = null;
    const onAnyInput = (e) => {
      const el = e.target;
      if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
      const t = performance.now();
      const len = String(el.value || "").length;
      if (lastT > 0) {
        const dt = Math.max(1, t - lastT);
        const d = Math.max(0, len - lastLen);
        const cps = (d / dt) * 1000; // chars/sec
        const v = clamp(Math.round(cps * 14), 0, 100);
        typingViz.style.setProperty("--typing", String(v));
        typingViz.classList.add("on");
        if (tOff) clearTimeout(tOff);
        tOff = setTimeout(() => typingViz.classList.remove("on"), 500);
      }
      lastT = t;
      lastLen = len;
    };
    document.addEventListener("input", onAnyInput, { passive: true });
  })();

  // 直リンク/戻る対応（#g11_flash など）
  function syncRouteFromHash() {
    const id = (location.hash || "").replace(/^#/, "");
    if (!id) {
      if (!gamePanel.hidden) closeGame();
      return;
    }
    const exists = games.some((g) => g.id === id);
    if (!exists) return;
    if (currentGameId !== id) openGame(id);
  }
  window.addEventListener("hashchange", syncRouteFromHash);
  syncRouteFromHash();

  // keyboard friendly: Esc closes dialog / game
  (() => {
    let escTimer = null;
    const toggleZen = () => {
      const cur = document.body.dataset.zen === "1";
      document.body.dataset.zen = cur ? "0" : "1";
      toast(cur ? "禅モード解除" : "禅モード", "ok", 1400);
    };
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (escTimer) return;
      // 長押しで禅モード
      escTimer = setTimeout(() => {
        escTimer = null;
        toggleZen();
      }, 800);
    });
    window.addEventListener("keyup", (e) => {
      if (e.key !== "Escape") return;
      if (!escTimer) return;
      clearTimeout(escTimer);
      escTimer = null;
      // 短押しは従来動作
      if (dataDialog.open) dataDialog.close();
      else if (!gamePanel.hidden) closeGame();
    });
  })();
})();

