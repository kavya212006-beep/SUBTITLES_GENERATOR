export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Global CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Language",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ─── AI Speech Transcription Endpoint ───────────────────────
    if (url.pathname === "/api/transcribe" && request.method === "POST") {
      try {
        if (!env.AI) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "Cloudflare Workers AI binding (env.AI) is not configured in this environment.",
            }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const contentType = request.headers.get("content-type") || "";
        let audioBytes;
        let requestedLang = request.headers.get("X-Language") || "";

        if (contentType.includes("application/json")) {
          const jsonBody = await request.json();
          requestedLang = jsonBody.language || requestedLang;
          if (jsonBody.audioBase64) {
            const binaryString = atob(jsonBody.audioBase64);
            const len = binaryString.length;
            audioBytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              audioBytes[i] = binaryString.charCodeAt(i);
            }
          } else if (Array.isArray(jsonBody.audio)) {
            audioBytes = new Uint8Array(jsonBody.audio);
          }
        } else if (contentType.includes("multipart/form-data")) {
          const formData = await request.formData();
          const file = formData.get("file") || formData.get("audio");
          requestedLang = formData.get("language") || requestedLang;
          if (file && typeof file.arrayBuffer === "function") {
            const ab = await file.arrayBuffer();
            audioBytes = new Uint8Array(ab);
          }
        } else {
          // Direct binary audio upload (e.g. audio/wav, audio/mp4, application/octet-stream)
          const ab = await request.arrayBuffer();
          audioBytes = new Uint8Array(ab);
        }

        if (!audioBytes || audioBytes.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: "Empty or invalid audio payload received." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`[CF-AI] Received audio payload for transcription: ${audioBytes.length} bytes, language: ${requestedLang || "auto"}`);

        // Try primary model (whisper-large-v3-turbo / whisper)
        let aiResult = null;
        let modelUsed = "";

        const runAi = async (modelName) => {
          const aiInput = {
            audio: [...audioBytes],
            vad_filter: true,
            condition_on_previous_text: false,
            no_speech_threshold: 0.6,
            beam_size: 5,
          };
          // Pass language if provided
          if (requestedLang && requestedLang !== "auto") {
            const code = requestedLang.split("-")[0].toLowerCase();
            aiInput.language = code;
          }
          return await env.AI.run(modelName, aiInput);
        };

        const candidateModels = [
          "@cf/openai/whisper-large-v3-turbo",
          "@cf/openai/whisper",
          "@cf/openai/whisper-tiny-en",
        ];

        let lastErr = null;
        for (const model of candidateModels) {
          try {
            console.log(`[CF-AI] Invoking Workers AI model: ${model}...`);
            aiResult = await runAi(model);
            modelUsed = model;
            console.log(`[CF-AI] Model ${model} succeeded! Result keys:`, Object.keys(aiResult || {}));
            break;
          } catch (mErr) {
            console.warn(`[CF-AI] Model ${model} failed:`, mErr?.message || mErr);
            lastErr = mErr;
          }
        }

        if (!aiResult) {
          throw new Error(lastErr?.message || "All Cloudflare Workers AI Whisper models failed to process audio.");
        }

        // Clean repetitive words inside text (e.g. "HELLO HELLO HELLO" -> "HELLO")
        const cleanRepeatedWords = (str) => {
          return str
            .replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1")
            .replace(/\[.*?\]|\(.*?\)/g, "") // Remove [MUSIC], (LAUGHTER)
            .replace(/\s+/g, " ")
            .trim();
        };

        // Parse VTT / segments / words into structured cues
        const rawCues = [];
        let cueId = 1;

        // 1. Check if VTT string is present
        if (aiResult.vtt && typeof aiResult.vtt === "string") {
          const vttLines = aiResult.vtt.split(/\r?\n/);
          let currentStart = 0;
          let currentEnd = 0;

          const timeRegex = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;
          const shortTimeRegex = /(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2})[.,](\d{3})/;

          const parseSeconds = (h, m, s, ms) => {
            return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
          };

          for (let i = 0; i < vttLines.length; i++) {
            const line = vttLines[i].trim();
            if (!line || line.startsWith("WEBVTT") || line.startsWith("NOTE")) continue;

            const match = line.match(timeRegex);
            const shortMatch = !match ? line.match(shortTimeRegex) : null;

            if (match) {
              currentStart = parseSeconds(match[1], match[2], match[3], match[4]);
              currentEnd = parseSeconds(match[5], match[6], match[7], match[8]);
            } else if (shortMatch) {
              currentStart = parseSeconds(0, shortMatch[1], shortMatch[2], shortMatch[3]);
              currentEnd = parseSeconds(0, shortMatch[4], shortMatch[5], shortMatch[6]);
            } else if (currentStart !== undefined && currentEnd > currentStart) {
              const cleaned = cleanRepeatedWords(line.replace(/<[^>]+>/g, ""));
              if (cleaned && cleaned.length > 1) {
                const words = cleaned.split(/\s+/).filter(Boolean);
                if (words.length <= 4) {
                  rawCues.push({
                    start: Number(currentStart.toFixed(2)),
                    end: Number(currentEnd.toFixed(2)),
                    text: cleaned.toUpperCase(),
                  });
                } else {
                  const chunkSize = 3;
                  const totalSubChunks = Math.ceil(words.length / chunkSize);
                  const span = Math.max(0.8 * totalSubChunks, currentEnd - currentStart);
                  const subSpan = span / totalSubChunks;
                  for (let c = 0; c < totalSubChunks; c++) {
                    const subWords = words.slice(c * chunkSize, (c + 1) * chunkSize);
                    const cStart = Number((currentStart + c * subSpan).toFixed(2));
                    const cEnd = Number((currentStart + (c + 1) * subSpan - 0.05).toFixed(2));
                    rawCues.push({
                      start: cStart,
                      end: Math.max(cStart + 0.6, cEnd),
                      text: subWords.join(" ").toUpperCase(),
                    });
                  }
                }
                currentStart = 0;
                currentEnd = 0;
              }
            }
          }
        }

        // 2. Check if segments array is present
        if (rawCues.length === 0 && Array.isArray(aiResult.segments) && aiResult.segments.length > 0) {
          for (const seg of aiResult.segments) {
            const text = cleanRepeatedWords(seg.text || "");
            if (!text || text.length < 2) continue;
            const start = typeof seg.start === "number" ? seg.start : 0;
            const end = typeof seg.end === "number" ? seg.end : start + 2;
            
            const words = text.split(/\s+/).filter(Boolean);
            if (words.length <= 4) {
              rawCues.push({
                start: Number(start.toFixed(2)),
                end: Number(end.toFixed(2)),
                text: text.toUpperCase(),
              });
            } else {
              const chunkSize = 3;
              const totalSubChunks = Math.ceil(words.length / chunkSize);
              const span = Math.max(0.8 * totalSubChunks, end - start);
              const subSpan = span / totalSubChunks;
              for (let c = 0; c < totalSubChunks; c++) {
                const subWords = words.slice(c * chunkSize, (c + 1) * chunkSize);
                const cStart = Number((start + c * subSpan).toFixed(2));
                const cEnd = Number((start + (c + 1) * subSpan - 0.05).toFixed(2));
                rawCues.push({
                  start: cStart,
                  end: Math.max(cStart + 0.6, cEnd),
                  text: subWords.join(" ").toUpperCase(),
                });
              }
            }
          }
        }

        // 3. Check if words array is present (allows word chunking)
        if (rawCues.length === 0 && Array.isArray(aiResult.words) && aiResult.words.length > 0) {
          const words = aiResult.words;
          const chunkSize = 3;
          for (let i = 0; i < words.length; i += chunkSize) {
            const slice = words.slice(i, i + chunkSize);
            const start = slice[0].start || 0;
            const end = slice[slice.length - 1].end || start + 1.5;
            const text = cleanRepeatedWords(slice.map((w) => w.word || "").join(" "));
            if (text && text.length > 1) {
              rawCues.push({
                start: Number(start.toFixed(2)),
                end: Number(end.toFixed(2)),
                text: text.toUpperCase(),
              });
            }
          }
        }

        // 4. Fallback to full text split if no granular timestamps
        if (rawCues.length === 0 && aiResult.text && aiResult.text.trim()) {
          const rawCleaned = cleanRepeatedWords(aiResult.text);
          const rawWords = rawCleaned.split(/\s+/).filter(Boolean);
          const chunkSize = 3;
          const totalChunks = Math.ceil(rawWords.length / chunkSize);
          const estimatedDur = Math.max(5, rawWords.length * 0.45);
          const chunkSpan = estimatedDur / totalChunks;

          for (let c = 0; c < totalChunks; c++) {
            const chunkWords = rawWords.slice(c * chunkSize, (c + 1) * chunkSize);
            const start = c * chunkSpan;
            const end = (c + 1) * chunkSpan;
            rawCues.push({
              start: Number(start.toFixed(2)),
              end: Number(end.toFixed(2)),
              text: chunkWords.join(" ").toUpperCase(),
            });
          }
        }

        // Deduplicate consecutive identical / overlapping cues
        const cues = [];
        let lastEnd = 0;

        for (const cue of rawCues) {
          const t = cue.text.trim();
          if (!t) continue;

          // Skip if exact duplicate of previous cue
          if (cues.length > 0) {
            const prev = cues[cues.length - 1];
            if (prev.text === t && Math.abs(cue.start - prev.start) < 3.0) {
              prev.end = Math.max(prev.end, cue.end);
              lastEnd = prev.end;
              continue;
            }
          }

          let cStart = Math.max(lastEnd, cue.start);
          let cEnd = Math.max(cStart + 0.6, cue.end);

          cues.push({
            id: String(cueId++),
            start: Number(cStart.toFixed(2)),
            end: Number(cEnd.toFixed(2)),
            text: t,
          });
          lastEnd = cEnd;
        }

        return new Response(
          JSON.stringify({
            ok: true,
            model: modelUsed,
            totalCues: cues.length,
            cues,
            rawText: aiResult.text || "",
            vtt: aiResult.vtt || null,
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (err) {
        console.error("[CF-AI] Transcription fatal exception:", err);
        return new Response(
          JSON.stringify({
            ok: false,
            error: err?.message || String(err),
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    // ─── Cloudflare Workers Telemetry & Error Logging Endpoint ──
    if (url.pathname === "/api/log") {
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const level = body.level || "info";
          const source = body.source || "SubtitleStudio";
          const message = body.message || "";
          const meta = body.meta ? ` | meta: ${JSON.stringify(body.meta)}` : "";
          const logLine = `[CF-LOG] [${source}] [${level.toUpperCase()}] ${message}${meta}`;

          if (level === "error") {
            console.error(logLine);
          } else if (level === "warn") {
            console.warn(logLine);
          } else {
            console.log(logLine);
          }

          return new Response(JSON.stringify({ ok: true, timestamp: Date.now() }), {
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          });
        } catch (err) {
          console.error("[CF-LOG] Failed to parse log payload:", err);
          return new Response(JSON.stringify({ ok: false, error: err.message }), {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          });
        }
      }
    }

    // Pass all other requests to static assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
