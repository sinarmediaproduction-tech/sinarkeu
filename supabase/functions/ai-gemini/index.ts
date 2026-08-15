// ==========================================================================
// SinarKeu — Mesin AI (Gemini) via Supabase Edge Function
// ==========================================================================
// Fungsi ini adalah PENGGANTI/ALTERNATIF dari Cloudflare Worker (Groq) yang
// sudah ada (lihat js/ai.js -> sk_ai_worker_url). Tujuannya cuma menyediakan
// "mesin"-nya dulu: terima { prompt }, teruskan ke Gemini API, kembalikan
// { result } dengan KONTRAK RESPONS YANG SAMA PERSIS dengan worker lama
// ({ result: string } saat sukses, { error: string } saat gagal) supaya
// client (js/ai.js) tinggal ganti URL tujuan tanpa perlu ubah parsing
// respons. Fitur-fitur pemakaian (jenis prompt, dsb) menyusul belakangan --
// yang penting mesinnya sudah bisa dipanggil dan tidak gampang mati total
// hanya gara-gara satu API key Gemini kena limit/expired/invalid.
//
// ---------------------------------------------------------------------
// FALLBACK BERLAPIS
// ---------------------------------------------------------------------
// 1. Multi API KEY: env GEMINI_API_KEYS berisi beberapa API key Gemini
//    dipisah koma. Berguna karena kuota gratis Gemini per API key/project
//    terbatas -- kalau key pertama kena 429 (rate limit) / 403 (invalid,
//    dicabut, dsb), function ini otomatis coba key berikutnya, BUKAN
//    langsung gagal ke user.
// 2. Multi MODEL: env GEMINI_MODELS (opsional) berisi beberapa nama model
//    Gemini dipisah koma, dicoba urut dari yang paling murah/cepat dulu.
//    Kalau model tertentu lagi overload (503) atau tidak tersedia buat
//    key itu, lanjut ke model berikutnya sebelum pindah ke key berikutnya.
// Total percobaan = jumlah key x jumlah model (urutan: key pertama dicoba
// ke semua model dulu, baru pindah ke key berikutnya) -- dibatasi
// MAX_ATTEMPTS supaya tidak menggantung terlalu lama kalau semua env-nya
// salah/kosong.
//
// ---------------------------------------------------------------------
// DEPLOY (lihat juga README.md di folder ini)
// ---------------------------------------------------------------------
//   supabase functions deploy ai-gemini --no-verify-jwt
//   supabase secrets set GEMINI_API_KEYS="key1,key2,key3"
//   supabase secrets set GEMINI_MODELS="gemini-2.0-flash,gemini-1.5-flash"   # opsional
//
// Client (browser) memanggil:
//   POST https://<project-ref>.supabase.co/functions/v1/ai-gemini
//   headers: { apikey: <supabase-anon-key>, Content-Type: 'application/json' }
//   body:    { prompt: "..." }
// ==========================================================================

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Urutan default model kalau GEMINI_MODELS tidak di-set: dari yang paling
// hemat kuota/cepat ke yang lebih lengkap. "flash-lite" dulu supaya kuota
// free-tier awet, baru fallback ke flash biasa kalau flash-lite bermasalah.
const DEFAULT_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

const MAX_ATTEMPTS = 12; // batas total percobaan key x model, jaga-jaga env salah isi
const GEMINI_TIMEOUT_MS = 25_000; // per percobaan, supaya satu key/model lemot tidak menggantung lama

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function parseCsvEnv(name: string): string[] {
  const raw = Deno.env.get(name) || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; retryable: boolean; message: string }> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // 429 (kuota habis), 503 (model overload), 500 -> layak dicoba
      // key/model lain. 400/403 dengan key salah juga aman dilanjut ke
      // key berikutnya (bukan ditolak permanen untuk SEMUA percobaan).
      const retryable = [429, 500, 503].includes(res.status) ||
        res.status === 403 || res.status === 400;
      const message = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, retryable, message };
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "")
        .join("") ?? "";

    if (!text.trim()) {
      // Kemungkinan diblok safety filter / respons kosong -- coba opsi lain.
      const blockReason = data?.candidates?.[0]?.finishReason;
      return {
        ok: false,
        retryable: true,
        message: blockReason ? `Respons kosong (${blockReason})` : "Respons kosong dari Gemini",
      };
    }

    return { ok: true, text: text.trim() };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return {
      ok: false,
      retryable: true,
      message: aborted ? "Timeout menghubungi Gemini" : String(e?.message || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed, gunakan POST." }, 405);
  }

  let prompt = "";
  try {
    const body = await req.json();
    prompt = (body?.prompt || "").toString().trim();
  } catch {
    return jsonResponse({ error: "Body harus JSON valid: { prompt: string }" }, 400);
  }

  if (!prompt) {
    return jsonResponse({ error: "Field 'prompt' wajib diisi dan tidak boleh kosong." }, 400);
  }

  const apiKeys = parseCsvEnv("GEMINI_API_KEYS");
  if (apiKeys.length === 0) {
    return jsonResponse(
      {
        error:
          "GEMINI_API_KEYS belum dikonfigurasi di secrets edge function. " +
          "Jalankan: supabase secrets set GEMINI_API_KEYS=\"key1,key2,...\"",
      },
      500,
    );
  }

  const models = parseCsvEnv("GEMINI_MODELS");
  const modelList = models.length > 0 ? models : DEFAULT_MODELS;

  const errors: string[] = [];
  let attempts = 0;

  // Key pertama dicoba ke semua model dulu, baru pindah ke key berikutnya --
  // supaya kalau key #1 memang sehat tapi cuma model tertentu yang overload,
  // kita tetap prioritaskan pakai key #1 (kuota key lain tidak ikut kepakai
  // sia-sia) sebelum benar-benar pindah key.
  for (const apiKey of apiKeys) {
    for (const model of modelList) {
      if (attempts >= MAX_ATTEMPTS) break;
      attempts++;

      const result = await callGemini(apiKey, model, prompt);
      if (result.ok) {
        return jsonResponse({
          result: result.text,
          meta: { model, engine: "gemini", attempts },
        });
      }

      const keyLabel = apiKey.length > 8
        ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
        : "key";
      errors.push(`[${keyLabel} / ${model}] ${result.message}`);

      if (!result.retryable) {
        // Error yang jelas bukan soal kuota/overload (mis. prompt diblok
        // kebijakan konten) -- tidak akan membaik walau ganti key/model,
        // langsung hentikan supaya tidak buang-buang percobaan.
        return jsonResponse(
          { error: result.message, meta: { engine: "gemini", attempts, tried: errors } },
          502,
        );
      }
    }
    if (attempts >= MAX_ATTEMPTS) break;
  }

  // Semua key & model sudah dicoba dan tetap gagal.
  return jsonResponse(
    {
      error: "Semua API key/model Gemini gagal dipanggil. Detail: " + errors.join(" | "),
      meta: { engine: "gemini", attempts, tried: errors },
    },
    502,
  );
});
