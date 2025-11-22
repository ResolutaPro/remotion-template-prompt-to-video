import * as http from "http";
import { generateStoryFromWeb, generateStoryTextFromWeb } from "./web-generator";

const PORT = 4000;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AI Story Generator</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e5e7eb; margin: 0; padding: 2rem; display: flex; justify-content: center; }
      .card { max-width: 640px; width: 100%; background: #020617; border-radius: 1rem; padding: 1.5rem 1.75rem; box-shadow: 0 24px 60px rgba(15,23,42,0.8); border: 1px solid #1f2937; }
      h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
      p { margin: 0 0 1rem; color: #9ca3af; }
      label { display: block; font-size: 0.85rem; margin-bottom: 0.25rem; color: #d1d5db; }
      input { width: 100%; padding: 0.5rem 0.6rem; border-radius: 0.5rem; border: 1px solid #374151; background: #020617; color: #e5e7eb; font-size: 0.9rem; }
      input:focus { outline: 2px solid #4f46e5; outline-offset: 1px; border-color: #4f46e5; }
      .field { margin-bottom: 0.9rem; }
      button { appearance: none; border: none; border-radius: 999px; padding: 0.55rem 1.5rem; font-weight: 600; font-size: 0.9rem; background: linear-gradient(135deg, #6366f1, #22c55e); color: white; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem; }
      button:disabled { opacity: 0.6; cursor: default; }
      .status { margin-top: 0.75rem; font-size: 0.85rem; min-height: 1.2rem; }
      .status.error { color: #fca5a5; }
      .status.success { color: #6ee7b7; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.8rem; }
      .hint { font-size: 0.8rem; color: #9ca3af; margin-top: -0.25rem; margin-bottom: 0.5rem; }
      .preview { margin-top: 0.75rem; padding: 0.75rem 0.9rem; border-radius: 0.75rem; background: #020617; border: 1px solid #1f2937; font-size: 0.85rem; white-space: pre-wrap; max-height: 260px; overflow: auto; }
      .buttons { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
      .buttons button.secondary { background: #111827; border: 1px solid #374151; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>AI Story Generator</h1>
      <p>Gera uma nova história, imagens, áudio e <code>timeline.json</code> usando as mesmas regras da CLI.</p>
      <form id="form">
        <div class="field">
          <label for="title">Título</label>
          <input id="title" name="title" required placeholder="History of Venus" />
        </div>
        <div class="field">
          <label for="topic">Tema</label>
          <input id="topic" name="topic" required placeholder="Curiosidades, História, ELI5..." />
        </div>
        <div class="field">
          <label for="apiKey">OpenAI API Key (opcional)</label>
          <input id="apiKey" name="apiKey" placeholder="Usa OPENAI_API_KEY do .env se vazio" />
          <div class="hint">Use apenas se quiser sobrescrever a variável de ambiente.</div>
        </div>
        <div class="field">
          <label for="elevenKey">ElevenLabs API Key (opcional)</label>
          <input id="elevenKey" name="elevenKey" placeholder="Usa ELEVENLABS_API_KEY ou LOCAL_TTS_URL do .env" />
        </div>
        <div class="buttons">
          <button type="submit"><span>Gerar história completa</span></button>
          <button type="button" id="previewBtn" class="secondary"><span>Pré-visualizar só o texto</span></button>
        </div>
        <div id="status" class="status"></div>
        <pre id="storyPreview" class="preview"></pre>
      </form>
    </div>
    <script>
      const form = document.getElementById('form');
      const statusEl = document.getElementById('status');
      const button = form.querySelector('button[type="submit"]');
      const previewBtn = document.getElementById('previewBtn');
      const previewEl = document.getElementById('storyPreview');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        statusEl.textContent = 'Gerando... isso pode levar alguns minutos.';
        statusEl.className = 'status';
        button.disabled = true;
        try {
          const body = {
            title: form.title.value.trim(),
            topic: form.topic.value.trim(),
          };
          if (form.apiKey.value.trim()) body.apiKey = form.apiKey.value.trim();
          if (form.elevenKey.value.trim()) body.elevenlabsApiKey = form.elevenKey.value.trim();
          const res = await fetch('/api/generate-story', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Erro desconhecido');
          }
          statusEl.textContent = 'OK! História gerada em public/content/' + data.slug + '. Abra o Remotion Studio e selecione a composição "' + data.slug + '".';
          statusEl.className = 'status success';
          if (previewEl) previewEl.textContent = '';
        } catch (err) {
          statusEl.textContent = 'Erro: ' + (err && err.message ? err.message : String(err));
          statusEl.className = 'status error';
        } finally {
          button.disabled = false;
        }
      });
      if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
          statusEl.textContent = 'Gerando somente o texto da história...';
          statusEl.className = 'status';
          previewBtn.disabled = true;
          try {
            const body = {
              title: form.title.value.trim(),
              topic: form.topic.value.trim(),
            };
            if (form.apiKey.value.trim()) body.apiKey = form.apiKey.value.trim();
            const res = await fetch('/api/preview-story', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error || 'Erro desconhecido');
            }
            statusEl.textContent = 'Texto gerado com sucesso. Revise abaixo.';
            statusEl.className = 'status success';
            if (previewEl) previewEl.textContent = data.text;
          } catch (err) {
            statusEl.textContent = 'Erro: ' + (err && err.message ? err.message : String(err));
            statusEl.className = 'status error';
          } finally {
            previewBtn.disabled = false;
          }
        });
      }
    </script>
  </body>
</html>`;

const handler: http.RequestListener = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(INDEX_HTML);
    return;
  }

  if (req.method === "POST" && req.url === "/api/generate-story") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const result = await generateStoryFromWeb(parsed);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err: any) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: false,
            error: err && err.message ? err.message : String(err),
          }),
        );
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/preview-story") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const result = await generateStoryTextFromWeb(parsed);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err: any) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: false,
            error: err && err.message ? err.message : String(err),
          }),
        );
      }
    });
    return;
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
};

if (!(globalThis as any).__ai_story_server_started) {
  (globalThis as any).__ai_story_server_started = true;
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`AI Story generator server listening on http://localhost:${PORT}`);
  });
}
