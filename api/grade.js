/**
 * Gemini による採点（Vercel Serverless）。
 * 環境変数: GEMINI_API_KEY（必須）, GEMINI_MODEL（任意、既定 gemini-3.1-flash-lite-preview）
 */
const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

function clampScore(n) {
  const x = Math.round(Number(n));
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(20, x));
}

function gradeFromScore(score) {
  if (score >= 14) return "maru";
  if (score >= 7) return "sankaku";
  return "batsu";
}

function normalizeGradeToken(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase();
  if (t === "maru" || t === "circle" || t === "○") return "maru";
  if (t === "sankaku" || t === "triangle" || t === "delta" || t === "△") return "sankaku";
  if (t === "batsu" || t === "cross" || t === "x" || t === "×" || t === "batu") return "batsu";
  return "";
}

function parseJsonFromGeminiText(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY が設定されていません" });
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let payload;
  try {
    const raw = req.body;
    payload = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    return res.status(400).json({ error: "JSON の解析に失敗しました" });
  }

  const itemsIn = payload.items;
  if (!Array.isArray(itemsIn) || itemsIn.length === 0) {
    return res.status(400).json({ error: "items が必要です" });
  }

  const compact = itemsIn.map((it, i) => ({
    index: typeof it.index === "number" ? it.index : i,
    answer: String(it.answer ?? "").slice(0, 200),
    response: String(it.response ?? "").slice(0, 200),
  }));

  const instruction = `あなたは日本語の語彙・表記の採点者です。次の各問について、模範解答（answer）と受験者の解答（response）を比べ、0〜20の整数 score を付けてください。

採点では少なくとも次の観点を考慮してください（コメントに簡潔に触れてください）:
・意味が一致しているか（同義・表記ゆれ・ひらがな/カタカナ/漢字の違いで意図が通じるか）
・漢字の正誤・許容できる異体字・俗字
・空欄や全く別の語は低得点

丸・三角・×の目安（score と整合させること）:
・14〜20: maru（実質正解としてよい）
・7〜13: sankaku（一部正しいが不完全）
・0〜6: batsu（不正解に近い）

出力は JSON のみ。次の型に厳密に従ってください:
{"items":[{"index":数値,"score":0〜20の整数,"grade":"maru"|"sankaku"|"batsu","comment":string}]}
comment は日本語で60文字以内。

入力データ:
${JSON.stringify({ items: compact }, null, 0)}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let geminiRes;
  try {
    geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }] }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
        },
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: "Gemini API への接続に失敗しました" });
  }

  if (!geminiRes.ok) {
    const errText = await geminiRes.text().catch(() => "");
    return res.status(502).json({
      error: "Gemini API がエラーを返しました",
      detail: errText.slice(0, 200),
    });
  }

  const geminiJson = await geminiRes.json();
  const text =
    geminiJson?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const parsed = parseJsonFromGeminiText(text);
  const outItems = parsed?.items;

  if (!Array.isArray(outItems) || outItems.length !== compact.length) {
    return res.status(502).json({ error: "採点結果の形式が不正です" });
  }

  const byIndex = new Map(outItems.map((x) => [Number(x.index), x]));

  const normalized = compact.map((src) => {
    const g = byIndex.get(src.index) ?? {};
    const score = clampScore(g?.score);
    let grade = normalizeGradeToken(g?.grade);
    if (!grade) grade = gradeFromScore(score);
    else {
      const expected = gradeFromScore(score);
      if (grade !== expected) grade = expected;
    }
    const comment = String(g?.comment ?? "")
      .trim()
      .slice(0, 120);
    return {
      index: src.index,
      score,
      grade,
      comment: comment || "（コメントなし）",
    };
  });

  const totalScore = normalized.reduce((a, b) => a + b.score, 0);

  return res.status(200).json({ items: normalized, totalScore });
};
