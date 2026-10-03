/** Página pública: prueba el análisis pre-compra sin Telegram y muestra cómo lo llaman otros agentes. */
export const PAGE_HTML = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Primera Acción</title>
<meta name="description" content="Agente en español para acciones tokenizadas de EE.UU. en BNB Chain: precio en bolsa en tiempo real, tokens de Ondo y bStocks, y análisis con IA." />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📈</text></svg>" />
<style>
  :root {
    --bg: #fafaf7; --surface: #ffffff; --text: #17181c; --muted: #5d6170; --border: #e6e4dc;
    --accent: #f0b90b; --accent-ink: #1a1500; --code: #f3f1ea; --danger: #b42318;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1013; --surface: #17191e; --text: #ecedf0; --muted: #9a9fad; --border: #2a2d35; --accent: #f0b90b; --accent-ink: #1a1500; --code: #1f2229; --danger: #ff8a80; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 16px 64px; }
  header h1 { font-size: clamp(28px, 6vw, 40px); line-height: 1.1; margin: 0 0 8px; letter-spacing: -0.02em; }
  header p { margin: 0; color: var(--muted); font-size: 18px; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--accent-ink); background: var(--accent); padding: 3px 8px; border-radius: 999px; margin-bottom: 14px; }
  form { display: flex; gap: 8px; margin: 28px 0 12px; }
  input { flex: 1; min-width: 0; font: inherit; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { font: inherit; font-weight: 600; padding: 12px 18px; border-radius: 10px; border: 0; background: var(--accent); color: var(--accent-ink); cursor: pointer; }
  button:disabled { opacity: .6; cursor: progress; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 14px; font-weight: 500; padding: 6px 12px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 999px; }
  .card { margin-top: 24px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 64px; }
  .card.empty { color: var(--muted); }
  .card.error { color: var(--danger); }
  h2 { font-size: 18px; margin: 40px 0 10px; }
  pre { background: var(--code); border-radius: 10px; padding: 14px; overflow-x: auto; font-size: 13px; margin: 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  ul { padding-left: 20px; margin: 0; color: var(--muted); }
  a { color: inherit; text-decoration-color: var(--accent); text-underline-offset: 3px; }
  footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: 14px; }
  .row { display: flex; flex-wrap: wrap; gap: 16px; }
</style>
</head>
<body>
<main>
  <header>
    <span class="badge">BNB Hack · Tokenized Stocks</span>
    <h1>Primera Acción 🇧🇴</h1>
    <p>Tu primera acción de Wall Street en BNB Chain, en español. Precio en bolsa en tiempo real, tokens de Ondo y bStocks, y análisis con IA.</p>
  </header>

  <form id="f">
    <input id="q" name="prompt" maxlength="300" autocomplete="off" placeholder="Ej: NVDA 25 · analiza apple · ¿cómo viene tesla?" aria-label="Consulta" />
    <button id="go" type="submit">Analizar</button>
  </form>
  <div class="chips">
    <button class="chip" type="button" data-q="NVDA 25">NVDA 25</button>
    <button class="chip" type="button" data-q="analiza apple">analiza apple</button>
    <button class="chip" type="button" data-q="TSLA">TSLA</button>
    <button class="chip" type="button" data-q="SPY">S&amp;P 500</button>
    <button class="chip" type="button" data-q="info de mercado libre">Mercado Libre</button>
  </div>

  <div id="out" class="card empty" aria-live="polite">El resultado aparece acá. Es información, no una recomendación de inversión.</div>

  <h2>Úsalo desde Telegram</h2>
  <p id="tg">Compra y vende con USDT desde el bot, con confirmación antes de cada operación.</p>

  <h2>Úsalo desde otro agente</h2>
  <pre><code id="curl">curl -X POST /api/analyze -H 'Content-Type: application/json' -d '{"prompt":"NVDA 25"}'</code></pre>

  <footer>
    <div class="row">
      <a href="https://github.com/invertilo/bnb-builder-day">GitHub</a>
      <span>Hecho en Santa Cruz por <a href="https://github.com/invertilo">@invertilo</a>, <a href="https://github.com/alejondr3">@alejondr3</a> y <a href="https://github.com/jasiiid">@jasiiid</a></span>
    </div>
    <p>Proyecto experimental de hackathon. No es asesoría financiera.</p>
  </footer>
</main>
<script>
  const out = document.getElementById("out");
  const q = document.getElementById("q");
  const go = document.getElementById("go");
  document.getElementById("curl").textContent =
    "curl -X POST " + location.origin + "/api/analyze -H 'Content-Type: application/json' -d '{\\"prompt\\":\\"NVDA 25\\"}'";

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Markdown de Telegram → HTML (después de escapar): *negrita*, _cursiva_, \`código\` y links https.
  const md = (s) => esc(s)
    .replace(/\\[([^\\]]+)\\]\\((https:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\\*([^*\\n]+)\\*/g, "<strong>$1</strong>")
    .replace(/(^|[\\s(])_([^_\\n]+)_/g, "$1<em>$2</em>")
    .replace(/\`([^\`\\n]+)\`/g, "<code>$1</code>");

  async function run(prompt) {
    if (!prompt.trim()) return;
    q.value = prompt;
    go.disabled = true;
    out.className = "card empty";
    out.textContent = "Consultando la bolsa y BNB Chain…";
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error " + res.status);
      out.className = "card";
      out.innerHTML = md(data.result);
    } catch (err) {
      out.className = "card error";
      out.textContent = err.message;
    } finally {
      go.disabled = false;
    }
  }

  document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); run(q.value); });
  document.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => run(b.dataset.q)));

  fetch("/api/info").then((r) => r.json()).then((info) => {
    if (info.telegram) {
      const user = String(info.telegram).replace(/^@/, "");
      document.getElementById("tg").innerHTML =
        'Compra y vende con USDT desde <a href="https://t.me/' + encodeURIComponent(user) + '">@' + esc(user) + "</a>, con confirmación antes de cada operación.";
    }
  }).catch(() => {});
</script>
</body>
</html>`;
