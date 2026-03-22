(() => {
  "use strict";

  const STORAGE_KEY = "wordOrderApp.v1";
  const WORD_COUNT = 10;
  const PAUSE_AFTER_SPEAK_MS = 1000;
  /** 出題に使う記事タイトルの最大文字数（これより長いものは捨てる） */
  const MAX_TITLE_LENGTH = 8;
  /** 短いタイトルを集めるための API 試行上限（1 回で最大 10 件ずつ） */
  const WIKI_FETCH_ATTEMPTS_MAX = 40;
  /** 日本語版 Wikipedia（全記事からランダムにページを返す MediaWiki API） */
  const WIKI_RANDOM_API = "https://ja.wikipedia.org/w/api.php";

  const $ = (sel, root = document) => root.querySelector(sel);

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  function normalizeAnswer(s) {
    return String(s || "")
      .trim()
      .normalize("NFKC");
  }

  function isShortArticleTitle(s) {
    const t = String(s || "").trim();
    if (!t || t.length > MAX_TITLE_LENGTH) return false;
    if (/[（(]/.test(t)) return false;
    return true;
  }

  /**
   * Wikipedia の全記事からランダム取得を繰り返し、短い記事タイトルだけを n 件集める。
   * 匿名利用では 1 リクエストあたり rnlimit 最大 10。
   */
  async function fetchShortRandomWikipediaTitles(n) {
    const seen = new Set();
    const out = [];

    for (let attempt = 0; attempt < WIKI_FETCH_ATTEMPTS_MAX && out.length < n; attempt++) {
      const url = new URL(WIKI_RANDOM_API);
      url.searchParams.set("action", "query");
      url.searchParams.set("format", "json");
      url.searchParams.set("origin", "*");
      url.searchParams.set("list", "random");
      url.searchParams.set("rnnamespace", "0");
      url.searchParams.set("rnlimit", "10");

      const res = await fetch(url.toString(), { credentials: "omit" });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      const items = data?.query?.random;
      if (!Array.isArray(items) || items.length === 0) throw new Error("empty");

      for (const x of items) {
        const title = String(x?.title ?? "").trim();
        if (!isShortArticleTitle(title)) continue;
        if (seen.has(title)) continue;
        seen.add(title);
        out.push(title);
        if (out.length >= n) break;
      }
    }

    if (out.length < n) {
      const err = new Error("short titles");
      err.shortTitles = true;
      throw err;
    }
    return out.slice(0, n);
  }

  function wikiArticleUrl(title) {
    const t = String(title || "").trim().replace(/ /g, "_");
    return `https://ja.wikipedia.org/wiki/${encodeURIComponent(t)}`;
  }

  /** 記事タイトルに対応する冒頭テキスト（複数タイトルを1リクエストで） */
  async function fetchWikipediaExtracts(titles) {
    const list = titles.map((t) => String(t || "").trim()).filter(Boolean);
    if (!list.length) return {};

    const url = new URL(WIKI_RANDOM_API);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    url.searchParams.set("prop", "extracts");
    url.searchParams.set("exintro", "1");
    url.searchParams.set("explaintext", "1");
    url.searchParams.set("exchars", "360");
    url.searchParams.set("titles", list.join("|"));

    const res = await fetch(url.toString(), { credentials: "omit" });
    if (!res.ok) throw new Error("wiki extracts");
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages || typeof pages !== "object") return {};

    const out = {};
    for (const key of Object.keys(pages)) {
      const p = pages[key];
      if (!p || p.missing) continue;
      const title = String(p.title || "").trim();
      if (!title) continue;
      const ex = String(p.extract || "")
        .replace(/\s+/g, " ")
        .trim();
      if (ex) out[title] = ex;
    }
    return out;
  }

  const POINTS_PER_QUESTION = 20;
  const MAX_TOTAL_SCORE = WORD_COUNT * POINTS_PER_QUESTION;

  async function fetchGeminiScores(correctSeq, userAnswers) {
    const res = await fetch("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: correctSeq.map((answer, index) => ({
          index,
          answer,
          response: userAnswers[index] ?? "",
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "採点に失敗しました");
    }
    if (!Array.isArray(data.items) || data.items.length !== correctSeq.length) {
      throw new Error("採点結果が不正です");
    }
    return data;
  }

  function gradeToSymbol(g) {
    if (g === "maru") return "○";
    if (g === "sankaku") return "△";
    return "×";
  }

  function gradeToCardClass(g) {
    if (g === "maru") return "isCorrect";
    if (g === "sankaku") return "isPartial";
    return "isWrong";
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { meta: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") throw new Error("bad");
      return {
        meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {},
      };
    } catch {
      return { meta: {} };
    }
  }

  function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }

  const store = loadStore();

  function flashOk() {
    document.body.classList.remove("flashOk");
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

  function makeProgress() {
    const fill = h("div", { class: "progressFill" });
    const bar = h("div", { class: "progressBar" }, [fill]);
    const wrap = h("div", { class: "progressWrap progressWrapMinimal" }, [bar]);
    return {
      el: wrap,
      setPct: (pct) => {
        const p = clamp(pct, 0, 100);
        fill.style.width = `${p}%`;
      },
    };
  }

  function cancelSpeech() {
    try {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }

  let sharedAudioCtx = null;
  function getAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
    return sharedAudioCtx;
  }

  /** 短い効果音（Web Audio）。失敗時は無音で続行。 */
  function playToneMs({ frequency, durationMs = 70, volume = 0.08, type = "sine" }) {
    return new Promise((resolve) => {
      try {
        const ctx = getAudioContext();
        if (!ctx) {
          resolve();
          return;
        }
        ctx
          .resume()
          .then(() => {
            try {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.type = type;
              osc.frequency.value = frequency;
              const t0 = ctx.currentTime;
              const dur = durationMs / 1000;
              gain.gain.setValueAtTime(0, t0);
              gain.gain.linearRampToValueAtTime(volume, t0 + 0.012);
              gain.gain.linearRampToValueAtTime(0, t0 + dur);
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.start(t0);
              osc.stop(t0 + dur + 0.02);
              setTimeout(resolve, durationMs + 25);
            } catch {
              resolve();
            }
          })
          .catch(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  /** 同じ単語の 1 回目と 2 回目の読みのあいだ */
  function playBetweenRepeatTick() {
    return playToneMs({ frequency: 1320, durationMs: 42, volume: 0.055, type: "sine" });
  }

  /** 単語と単語のあいだ（目印になる短いチャイム） */
  async function playBetweenWordsChime() {
    await playToneMs({ frequency: 523.25, durationMs: 58, volume: 0.095, type: "sine" });
    await new Promise((r) => setTimeout(r, 32));
    await playToneMs({ frequency: 659.25, durationMs: 72, volume: 0.085, type: "sine" });
  }

  /** 全問正解時の短いファンファーレ */
  async function playPerfectFanfare() {
    await playToneMs({ frequency: 523.25, durationMs: 85, volume: 0.095, type: "sine" });
    await new Promise((r) => setTimeout(r, 40));
    await playToneMs({ frequency: 659.25, durationMs: 85, volume: 0.095, type: "sine" });
    await new Promise((r) => setTimeout(r, 40));
    await playToneMs({ frequency: 783.99, durationMs: 95, volume: 0.1, type: "sine" });
    await new Promise((r) => setTimeout(r, 45));
    await playToneMs({ frequency: 1046.5, durationMs: 140, volume: 0.09, type: "sine" });
  }

  /** 利用可能な日本語ボイス（ブラウザによっては ja / ja_JP / jpn など表記ゆれあり） */
  function listJapaneseVoices() {
    if (typeof speechSynthesis === "undefined") return [];
    try {
      return speechSynthesis.getVoices().filter((v) => {
        const lang = String(v.lang || "")
          .toLowerCase()
          .replace("_", "-");
        if (lang === "ja-jp" || lang.startsWith("ja-") || lang === "ja") return true;
        if (lang === "jpn") return true;
        return false;
      });
    } catch {
      return [];
    }
  }

  /**
   * getVoices() は初回が空・段階的に増えることが多い。
   * 日本語ボイスが1件以上見えたあと、最後の voiceschanged から STABLE_MS 静かなら完了。
   * 一件も来ない場合は HARD_MAX で打ち切り（その時点のリストで選ぶ）。
   */
  function waitForSpeechVoicesLoaded(onReady) {
    if (typeof speechSynthesis === "undefined") {
      onReady();
      return;
    }

    const STABLE_MS = 550;
    const HARD_MAX_MS = 5000;
    let debounceTimer = null;
    let hardTimer = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (hardTimer) clearTimeout(hardTimer);
      speechSynthesis.removeEventListener("voiceschanged", onVc);
      try {
        void speechSynthesis.getVoices();
      } catch {
        // ignore
      }
      onReady();
    };

    const scheduleStable = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(finish, STABLE_MS);
    };

    const onVc = () => {
      try {
        void speechSynthesis.getVoices();
      } catch {
        // ignore
      }
      if (dedupeJapaneseVoices(listJapaneseVoices()).length > 0) {
        scheduleStable();
      }
    };

    speechSynthesis.addEventListener("voiceschanged", onVc);
    void speechSynthesis.getVoices();
    if (dedupeJapaneseVoices(listJapaneseVoices()).length > 0) {
      scheduleStable();
    }
    hardTimer = setTimeout(finish, HARD_MAX_MS);
  }

  function scoreJapaneseVoice(v) {
    const id = `${v.name} ${v.voiceURI || ""}`.toLowerCase();
    let s = 0;
    if (id.includes("google")) s += 28;
    if (id.includes("wavenet") || id.includes("neural") || id.includes("natural")) s += 22;
    if (id.includes("premium")) s += 12;
    if (id.includes("microsoft") && (id.includes("nanami") || id.includes("ayumi") || id.includes("multilingual")))
      s += 16;
    if (id.includes("azure")) s += 14;
    if (v.localService === false) s += 8;
    if (id.includes("kyoko") || id.includes("otoya")) s += 10;
    if (id.includes("sapi") || id.includes("microsoft david") || id.includes("zira")) s -= 20;
    const lang = String(v.lang || "").toLowerCase();
    if (lang === "ja-jp" || lang === "ja_jp") s += 4;
    return s;
  }

  /** 同一人物の重複を除いた日本語ボイス一覧 */
  function dedupeJapaneseVoices(voices) {
    const seen = new Set();
    const out = [];
    for (const v of voices) {
      const key = `${v.voiceURI || ""}|${v.name}|${v.lang}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }

  /** scoreJapaneseVoice が最も高い日本語ボイスを1つ固定で使う */
  function pickBestJapaneseVoice() {
    const raw = dedupeJapaneseVoices(listJapaneseVoices());
    if (!raw.length) return null;

    const scored = raw
      .map((v) => ({ v, s: scoreJapaneseVoice(v) }))
      .filter((x) => x.s > -8);

    if (!scored.length) return raw[0];

    scored.sort((a, b) => b.s - a.s);
    return scored[0].v;
  }

  function applyJapaneseTts(utter, voice) {
    if (voice) utter.voice = voice;
    utter.lang = "ja-JP";
    utter.rate = 0.92;
    utter.pitch = 1;
    utter.volume = 1;
  }

  if (typeof speechSynthesis !== "undefined") {
    void speechSynthesis.getVoices();
  }

  /** @param voice このラウンドで固定する話者。2回連続の読み上げにも同じ声を使う */
  /** @param description 省略または空なし時は単語2回のみ。指定時は2回のあとに説明を読み上げる */
  function speakWordTwiceThenPause(word, onDone, voice, description) {
    if (typeof speechSynthesis === "undefined" || !speechSynthesis) {
      setTimeout(onDone, PAUSE_AFTER_SPEAK_MS);
      return;
    }

    const descText = String(description || "").trim();

    let started = false;
    let fallbackTimer = null;

    const finishRound = () => setTimeout(onDone, PAUSE_AFTER_SPEAK_MS);

    const play = () => {
      if (started) return;
      started = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      speechSynthesis.removeEventListener("voiceschanged", onVoices);

      const u1 = new SpeechSynthesisUtterance(word);
      const u2 = new SpeechSynthesisUtterance(word);
      applyJapaneseTts(u1, voice);
      applyJapaneseTts(u2, voice);
      u1.onend = () => {
        playBetweenRepeatTick().then(() => {
          speechSynthesis.speak(u2);
        });
      };
      u2.onend = () => {
        if (!descText) {
          finishRound();
          return;
        }
        const u3 = new SpeechSynthesisUtterance(descText);
        applyJapaneseTts(u3, voice);
        u3.onend = finishRound;
        speechSynthesis.speak(u3);
      };
      speechSynthesis.speak(u1);
    };

    function onVoices() {
      if (listJapaneseVoices().length > 0) play();
    }

    if (listJapaneseVoices().length > 0) {
      play();
      return;
    }

    speechSynthesis.addEventListener("voiceschanged", onVoices);
    void speechSynthesis.getVoices();
    fallbackTimer = setTimeout(() => play(), 700);
  }

  function getSavedPlayMode() {
    return store.meta?.playMode === "card" ? "card" : "audio";
  }

  function savePlayMode(mode) {
    store.meta = { ...(store.meta || {}), playMode: mode === "card" ? "card" : "audio" };
    saveStore(store);
  }

  /** 音声・カード共通の「説明」表示（共有スイッチ1つで両方に反映） */
  function getSavedDescription() {
    const m = store.meta || {};
    if (typeof m.showDescription === "boolean") return m.showDescription;
    return m.showDescriptionAudio === true || m.showDescriptionCard === true;
  }

  function saveDescription(on) {
    const v = !!on;
    store.meta = {
      ...(store.meta || {}),
      showDescription: v,
      showDescriptionAudio: v,
      showDescriptionCard: v,
    };
    saveStore(store);
    syncDescriptionAmbient();
  }

  /** 説明ON時はページ全体を電球の光で優しく照らす（CSS `.descAmbientOn`） */
  function syncDescriptionAmbient() {
    const on = getSavedDescription();
    document.body.classList.toggle("descAmbientOn", on);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", on ? "#ebe8e4" : "#bfb6ab");
    }
  }

  function renderGame(root) {
    clearNode(root);
    const area = h("div", { class: "gameArea" });

    let seq = [];
    let timeoutIds = [];
    /** 判定の詳細レイヤーを閉じる（画面遷移時に呼ぶ） */
    let cleanupResultDetail = null;
    let cleanupDescBulb = null;

    function teardownDescBulb() {
      try {
        if (typeof cleanupDescBulb === "function") cleanupDescBulb();
      } catch {
        // ignore
      }
      cleanupDescBulb = null;
    }

    function clearTimeouts() {
      for (const id of timeoutIds) clearTimeout(id);
      timeoutIds = [];
    }

    function schedule(fn, ms) {
      const id = setTimeout(() => {
        timeoutIds = timeoutIds.filter((x) => x !== id);
        fn();
      }, ms);
      timeoutIds.push(id);
    }

    function renderStartScreen() {
      cancelSpeech();
      clearTimeouts();
      teardownDescBulb();
      try {
        if (typeof cleanupResultDetail === "function") cleanupResultDetail();
      } catch {
        // ignore
      }
      cleanupResultDetail = null;
      clearNode(area);
      area.className = "gameArea";
      syncDescriptionAmbient();

      const modeAudio = h("input", { type: "radio", name: "playMode", value: "audio", id: "modeAudio" });
      const modeCard = h("input", { type: "radio", name: "playMode", value: "card", id: "modeCard" });
      if (getSavedPlayMode() === "card") modeCard.checked = true;
      else modeAudio.checked = true;

      const labelAudio = h("label", { class: "modeCardPick", for: "modeAudio" }, [
        h("span", { class: "modeCardTitle", text: "音声" }),
      ]);
      const labelCard = h("label", { class: "modeCardPick", for: "modeCard" }, [
        h("span", { class: "modeCardTitle", text: "カード" }),
      ]);

      modeAudio.addEventListener("change", () => {
        if (modeAudio.checked) savePlayMode("audio");
      });
      modeCard.addEventListener("change", () => {
        if (modeCard.checked) savePlayMode("card");
      });

      const btnStart = h("button", { class: "primaryBtn startBtn", type: "button", text: "開始" });
      const errBox = h("div", { class: "formError", text: "", hidden: true });

      btnStart.addEventListener("click", async () => {
        errBox.hidden = true;
        errBox.textContent = "";
        const mode = modeCard.checked ? "card" : "audio";
        savePlayMode(mode);
        const prevLabel = btnStart.textContent;
        btnStart.disabled = true;
        btnStart.textContent = "取得中…";
        try {
          const titles = await fetchShortRandomWikipediaTitles(WORD_COUNT);
          seq = shuffle(titles);
          let cardExtractMap = null;
          if (mode === "card" && getSavedDescription()) {
            try {
              cardExtractMap = await fetchWikipediaExtracts(seq);
            } catch {
              cardExtractMap = {};
            }
          }
          if (mode === "audio") runAudioPhase();
          else runCardPhase(cardExtractMap);
        } catch (e) {
          errBox.textContent =
            e && e.shortTitles
              ? "短い単語が十分に集まりませんでした。しばらくしてからもう一度お試しください。"
              : "単語の取得に失敗しました。ネットワークを確認してください。";
          errBox.hidden = false;
        } finally {
          btnStart.disabled = false;
          btnStart.textContent = prevLabel;
        }
      });

      const descWrap = h("div", { class: "descToggleWrap" });
      descWrap.appendChild(
        h("div", { class: "descToggleHead" }, [
          h("span", { class: "descToggleTitle", text: "説明" }),
          h("span", { class: "descToggleHint", text: "コードを下へ引いて切り替え" }),
        ])
      );
      descWrap.appendChild(h("div", { class: "descToggleBulbHost" }));

      function mountDescFallback() {
        teardownDescBulb();
        const host = descWrap.querySelector(".descToggleBulbHost");
        if (host) host.remove();
        const inp = h("input", { type: "checkbox", id: "descFallback", checked: getSavedDescription() });
        inp.addEventListener("change", () => saveDescription(inp.checked));
        const row = h("div", { class: "descToggleFallback" }, [
          h("label", { for: "descFallback", text: "説明を表示する" }),
          inp,
        ]);
        descWrap.appendChild(row);
      }

      if (typeof window.initDescriptionBulb === "function") {
        window
          .initDescriptionBulb(descWrap, {
            initialOn: getSavedDescription(),
            onChange: saveDescription,
          })
          .then((api) => {
            cleanupDescBulb = api.destroy;
          })
          .catch(() => {
            mountDescFallback();
          });
      } else {
        mountDescFallback();
      }

      const modeGrid = h("div", { class: "modeGrid modeGrid--belowBulb" }, [
        h("div", { class: "modeRow" }, [modeAudio, labelAudio]),
        h("div", { class: "modeRow" }, [modeCard, labelCard]),
      ]);

      area.appendChild(descWrap);
      area.appendChild(modeGrid);
      area.appendChild(errBox);
      area.appendChild(h("div", { class: "formRow startBtnRow" }, [btnStart]));
    }

    function runAudioPhase() {
      teardownDescBulb();
      cancelSpeech();
      clearTimeouts();
      clearNode(area);
      area.className = "gameArea";

      const status = h("div", { class: "helpRow" }, [h("span", { class: "counter", text: "0/10" })]);
      const progress = makeProgress();
      progress.setPct(0);

      area.appendChild(status);
      area.appendChild(progress.el);

      let i = 0;
      let sessionVoice = null;
      let roundBegun = false;
      let audioExtractMap = {};

      async function next() {
        if (i >= seq.length) {
          cancelSpeech();
          renderAnswerPhase();
          return;
        }
        status.firstChild.textContent = `${i + 1}/10`;
        progress.setPct((i / seq.length) * 100);
        if (i > 0) await playBetweenWordsChime();
        const w = seq[i];
        const desc = getSavedDescription() ? String(audioExtractMap[w] || "").trim() : "";
        speakWordTwiceThenPause(
          w,
          () => {
            i++;
            next();
          },
          sessionVoice,
          desc
        );
      }

      async function beginAudioRound() {
        if (roundBegun) return;
        roundBegun = true;
        sessionVoice = pickBestJapaneseVoice();
        if (getSavedDescription()) {
          try {
            audioExtractMap = await fetchWikipediaExtracts(seq);
          } catch {
            audioExtractMap = {};
          }
        } else {
          audioExtractMap = {};
        }
        void next();
      }

      if (typeof speechSynthesis === "undefined") {
        beginAudioRound();
      } else {
        waitForSpeechVoicesLoaded(beginAudioRound);
      }
    }

    function runCardPhase(extractMap) {
      teardownDescBulb();
      cancelSpeech();
      clearTimeouts();
      clearNode(area);
      area.className = "gameArea";

      let i = 0;
      const showDesc = extractMap != null && typeof extractMap === "object";

      const status = h("div", { class: "helpRow" }, [h("span", { class: "counter", text: "1/10" })]);
      const progress = makeProgress();
      progress.setPct(0);

      const card = h("div", {
        class: "bigNumber wordCard" + (showDesc ? " wordCard--withDesc" : ""),
      });

      const btnNext = h("button", { class: "primaryBtn nextWordBtn", type: "button", text: "次 →" });

      function refreshCard() {
        status.firstChild.textContent = `${i + 1}/10`;
        progress.setPct((i / seq.length) * 100);
        const title = seq[i] || "—";
        clearNode(card);
        if (!showDesc) {
          card.textContent = title;
        } else {
          card.appendChild(h("div", { class: "wordCardTitle", text: title }));
          const ex = extractMap[title];
          card.appendChild(
            h("div", {
              class: "wordCardExtract",
              text: ex ? ex : "（説明を取得できませんでした）",
            })
          );
        }
        btnNext.textContent = i >= seq.length - 1 ? "回答" : "次 →";
      }

      refreshCard();

      btnNext.addEventListener("click", () => {
        if (i >= seq.length - 1) {
          renderAnswerPhase();
          return;
        }
        i++;
        refreshCard();
      });

      area.appendChild(status);
      area.appendChild(progress.el);
      area.appendChild(card);
      area.appendChild(h("div", { class: "formRow" }, [btnNext]));
    }

    function renderAnswerPhase() {
      teardownDescBulb();
      cancelSpeech();
      clearTimeouts();
      clearNode(area);
      area.className = "gameArea";

      const inputs = [];
      const grid = h("div", { class: "answerGrid" });

      for (let i = 0; i < seq.length; i++) {
        const inp = h("input", {
          class: "input answerInput",
          type: "text",
          autocomplete: "off",
          autocapitalize: "off",
        });
        inp.setAttribute("aria-label", String(i + 1));
        const row = h("label", { class: "answerRow" }, [
          h("span", { class: "answerIdx", text: `${i + 1}.` }),
          inp,
        ]);
        grid.appendChild(row);
        inputs.push(inp);
      }

      const btnCheck = h("button", { class: "primaryBtn", type: "button", text: "OK" });
      const btnBack = h("button", { class: "ghostBtn", type: "button", text: "戻る" });

      async function renderResultView(savedUserAnswers) {
        if (!savedUserAnswers) btnCheck.disabled = true;
        const user = savedUserAnswers || inputs.map((el) => normalizeAnswer(el.value));

        clearNode(area);
        area.className = "gameArea gameArea--result";
        area.appendChild(
          h("div", { class: "resultLoading" }, [
            h("p", { class: "resultLoadingText", text: "AIが採点し、説明を取得しています…" }),
          ])
        );

        let extractMap = {};
        let gradeItems = [];
        let totalScore = 0;

        try {
          const [gradePayload, wikiEx] = await Promise.all([
            fetchGeminiScores(seq, user),
            fetchWikipediaExtracts(seq).catch(() => ({})),
          ]);
          extractMap = wikiEx && typeof wikiEx === "object" ? wikiEx : {};
          gradeItems = gradePayload.items;
          totalScore =
            typeof gradePayload.totalScore === "number"
              ? gradePayload.totalScore
              : gradeItems.reduce((a, b) => a + (Number(b.score) || 0), 0);
        } catch (e) {
          clearNode(area);
          area.className = "gameArea gameArea--result";
          const msg = e && e.message ? String(e.message) : "採点に失敗しました";
          area.appendChild(h("div", { class: "formError", text: msg }));
          area.appendChild(
            h("div", { class: "formRow" }, [
              h("button", {
                class: "primaryBtn",
                type: "button",
                text: "再試行",
                onclick: () => void renderResultView(user),
              }),
            ])
          );
          area.appendChild(
            h("div", { class: "formRow" }, [
              h("button", {
                class: "ghostBtn",
                type: "button",
                text: "はじめに戻る",
                onclick: () => renderStartScreen(),
              }),
            ])
          );
          return;
        }

        const allOk = totalScore >= MAX_TOTAL_SCORE;

        clearNode(area);
        area.className =
          "gameArea gameArea--result" + (allOk ? " gameArea--resultPerfect" : "");

        if (allOk) {
          void playPerfectFanfare();
          flashOk();
        } else {
          shake(root);
        }

        const summary = h("div", { class: "resultSummary" + (allOk ? " resultSummaryPerfect" : "") }, [
          ...(allOk
            ? [
                h("div", { class: "resultPerfectDecor", "aria-hidden": "true" }, [
                  h("span", { class: "resultSpark", text: "✦" }),
                  h("span", { class: "resultSpark resultSparkB", text: "✦" }),
                  h("span", { class: "resultSpark resultSparkC", text: "✧" }),
                ]),
              ]
            : []),
          h("span", {
            class: "resultSummaryScore",
            text: `${totalScore}点 / ${MAX_TOTAL_SCORE}点`,
          }),
          ...(allOk ? [h("span", { class: "resultPerfectBadge", text: "満点！" })] : []),
        ]);

        const tapHint = h("p", { class: "resultTapHint", text: "カードを押すと詳細・説明を表示します" });

        const resultGrid = h("div", { class: "answerGrid answerResultGrid" });

        let detailBackdrop = null;
        let detailEscapeAbort = null;

        function removeDetailOverlay() {
          if (detailEscapeAbort) {
            detailEscapeAbort.abort();
            detailEscapeAbort = null;
          }
          if (detailBackdrop) {
            detailBackdrop.remove();
            detailBackdrop = null;
          }
        }

        function openDetailForIndex(j) {
          removeDetailOverlay();
          const yourLine = user[j] ? user[j] : "（未入力）";
          const ex = extractMap[seq[j]] || "";
          const wikiUrl = wikiArticleUrl(seq[j]);
          const g = gradeItems[j] || { score: 0, grade: "batsu", comment: "" };
          const sym = gradeToSymbol(g.grade);
          const gradeClass =
            g.grade === "maru"
              ? "resultDetailBadgeOk"
              : g.grade === "sankaku"
                ? "resultDetailBadgeWarn"
                : "resultDetailBadgeNg";

          const backdrop = h("div", { class: "resultDetailBackdrop" });
          const titleId = `resultDetailTitle-${j}`;

          const panel = h("div", {
            class: "resultDetailPanel",
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": titleId,
          });

          const closeBtn = h("button", { type: "button", class: "resultDetailClose", text: "×" });
          closeBtn.setAttribute("aria-label", "閉じる");
          closeBtn.addEventListener("click", removeDetailOverlay);

          const titleEl = h("h2", {
            id: titleId,
            class: "resultDetailHeading",
            text: `${j + 1}. ${seq[j]}`,
          });

          const gradeRow = h("div", { class: "resultDetailGradeRow" }, [
            h("span", { class: `resultDetailBadge ${gradeClass}`, text: sym }),
            h("span", { class: "resultDetailPoints", text: `${g.score}/${POINTS_PER_QUESTION}点` }),
          ]);

          const commentP = h("p", { class: "resultDetailComment", text: g.comment || "（コメントなし）" });

          const extractP = h("p", { class: "resultDetailExtract", text: ex || "（説明を取得できませんでした）" });

          const wikiA = h("a", {
            class: "resultDetailWikiLink",
            href: wikiUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            text: "Wikipedia で開く",
          });

          panel.appendChild(closeBtn);
          panel.appendChild(titleEl);
          panel.appendChild(gradeRow);
          panel.appendChild(h("h3", { class: "resultDetailSubhead", text: "採点コメント" }));
          panel.appendChild(commentP);
          panel.appendChild(
            h("div", { class: "resultDetailRows" }, [
              h("div", { class: "resultDetailPair" }, [
                h("span", { class: "answerLabel", text: "あなた" }),
                h("span", { class: "answerVal", text: yourLine }),
              ]),
              h("div", { class: "resultDetailPair" }, [
                h("span", { class: "answerLabel", text: "正解" }),
                h("span", { class: "answerVal", text: seq[j] }),
              ]),
            ])
          );
          panel.appendChild(h("h3", { class: "resultDetailSubhead", text: "説明" }));
          panel.appendChild(extractP);
          panel.appendChild(wikiA);

          backdrop.appendChild(panel);
          panel.addEventListener("click", (e) => e.stopPropagation());
          backdrop.addEventListener("click", removeDetailOverlay);

          detailEscapeAbort = new AbortController();
          document.addEventListener(
            "keydown",
            (e) => {
              if (e.key === "Escape") removeDetailOverlay();
            },
            { signal: detailEscapeAbort.signal }
          );

          detailBackdrop = backdrop;
          area.appendChild(backdrop);
        }

        for (let j = 0; j < seq.length; j++) {
          const g = gradeItems[j] || { grade: "batsu", score: 0 };
          const yourLine = user[j] ? user[j] : "（未入力）";
          const sym = gradeToSymbol(g.grade);
          const card = h("button", {
            type: "button",
            class: `answerResultCard ${gradeToCardClass(g.grade)}`,
          });
          card.appendChild(h("span", { class: "answerIdx", text: `${j + 1}.` }));
          card.appendChild(
            h("div", { class: "answerResultCols" }, [
              h("div", { class: "answerPairLine" }, [
                h("span", { class: "answerLabel", text: "あなた" }),
                h("span", { class: "answerVal", text: yourLine }),
              ]),
              h("div", { class: "answerPairLine answerCorrectPair" }, [
                h("span", { class: "answerLabel", text: "正解" }),
                h("span", { class: "answerVal", text: seq[j] }),
              ]),
              h("div", { class: "answerMetaLine" }, [
                h("span", { class: "answerMetaScore", text: `${g.score}点` }),
              ]),
            ])
          );
          card.appendChild(
            h("span", { class: "resultGradeSymbol", text: sym, "aria-hidden": "true", title: sym })
          );
          card.addEventListener("click", () => openDetailForIndex(j));
          resultGrid.appendChild(card);
        }

        cleanupResultDetail = removeDetailOverlay;

        const btnHome = h("button", { class: "primaryBtn", type: "button", text: "はじめに戻る" });
        btnHome.addEventListener("click", () => renderStartScreen());

        const scroll = h("div", { class: "resultScroll" }, [summary, tapHint, resultGrid]);
        const footer = h("div", { class: "resultFooter" }, [
          h("div", { class: "formRow" }, [btnHome]),
        ]);
        area.appendChild(h("div", { class: "resultScreen" }, [scroll, footer]));
      }

      btnCheck.addEventListener("click", () => {
        void renderResultView();
      });

      btnBack.addEventListener("click", () => {
        renderStartScreen();
      });

      area.appendChild(grid);
      area.appendChild(h("div", { class: "formRow" }, [btnCheck, btnBack]));

      schedule(() => inputs[0]?.focus(), 80);
    }

    root.appendChild(area);
    renderStartScreen();

    return () => {
      teardownDescBulb();
      cancelSpeech();
      clearTimeouts();
    };
  }

  const gameRoot = $("#gameRoot");
  let cleanupGame = null;

  function mountGame() {
    if (cleanupGame) {
      try {
        cleanupGame();
      } catch {
        // ignore
      }
      cleanupGame = null;
    }
    clearNode(gameRoot);
    cleanupGame = renderGame(gameRoot) || null;
  }

  syncDescriptionAmbient();
  mountGame();

  if ("serviceWorker" in navigator) {
    if (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }
  }
})();
