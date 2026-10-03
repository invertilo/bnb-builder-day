/**
 * Landing de Primera Acción. Estilo Apple: tipografía del sistema con tracking negativo en títulos,
 * barra translúcida, cards con resorte críticamente amortiguado (interrumpible) que siguen al puntero,
 * feedback al presionar y entradas escalonadas. Respeta reducir movimiento / transparencia.
 * String.raw: las barras invertidas del JS de abajo se escriben tal cual (no usar backticks ni "${" adentro).
 */
const RAW_PAGE = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Primera Acción</title>
<meta name="description" content="Tu primera acción de Wall Street en BNB Chain: precio real de la bolsa, tokens de Ondo y bStocks, análisis con IA y compras con USDT desde Telegram, en español." />
<meta property="og:title" content="Primera Acción · Wall Street en BNB Chain, en español" />
<meta property="og:description" content="Precio real de la bolsa, análisis con IA y compras de acciones tokenizadas con USDT desde Telegram (@TuPrimeraAccionBot)." />
<meta property="og:type" content="website" />
<meta name="theme-color" content="#fbfbfd" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23F0B90B'/%3E%3Cpath d='M6 15.5l4-4 3 3 5-5.5' fill='none' stroke='%231d1d1f' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M14.5 9h3.5v3.5' fill='none' stroke='%231d1d1f' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
<style>
  :root {
    --bg: #fbfbfd; --bg-2: #f5f5f7; --surface: #ffffff; --text: #1d1d1f; --muted: #6e6e73;
    --border: rgba(0,0,0,.08); --shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 32px rgba(0,0,0,.07);
    --accent: #f0b90b; --accent-ink: #1d1d1f; --tg: #229ed9; --up: #1f8f4e; --down: #d70015;
    --glass: rgba(251,251,253,.72); --chip: rgba(0,0,0,.05); --code: #f5f5f7;
    --spring: cubic-bezier(.2,.8,.2,1);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #000000; --bg-2: #0b0b0d; --surface: #141416; --text: #f5f5f7; --muted: #a1a1a6;
      --border: rgba(255,255,255,.09); --shadow: 0 1px 2px rgba(0,0,0,.6), 0 12px 32px rgba(0,0,0,.5);
      --accent-ink: #1d1d1f; --up: #30d158; --down: #ff453a; --glass: rgba(0,0,0,.66); --chip: rgba(255,255,255,.08); --code: #1c1c1e;
    }
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 17px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  a { color: inherit; text-decoration: none; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
  @media (min-width: 720px) { .wrap { padding: 0 28px; } }

  /* ── Íconos SVG (trazo fino, se dibujan al aparecer) ───────── */
  .ico { width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .ico.inline { width: 1.1em; height: 1.1em; vertical-align: -0.2em; margin-right: .15em; }
  .ico.draw { stroke-dasharray: 1; stroke-dashoffset: 1; }
  .in .ico.draw, .ico.draw.go { animation: draw 1.2s var(--spring) forwards; animation-delay: calc(var(--i, 0) * 80ms + 250ms); }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  .ico.status { stroke: none; }
  .ico.up { fill: var(--up); } .ico.down { fill: var(--down); }
  .logo { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--accent); color: #1d1d1f; font-size: 18px; }
  .logo .ico { stroke-width: 2.2; }

  /* ── Barra translúcida ─────────────────────────────────────── */
  .nav { position: sticky; top: 0; z-index: 50; background: var(--glass);
    -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);
    border-bottom: 1px solid transparent; transition: border-color .3s ease; }
  .nav.scrolled { border-bottom-color: var(--border); }
  .nav .wrap { display: flex; align-items: center; justify-content: space-between; height: 52px; gap: 16px; }
  .brand { font-weight: 600; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; }
  .brand .logo { width: 26px; height: 26px; border-radius: 7px; font-size: 16px; }
  .links { display: none; gap: 24px; font-size: 13px; color: var(--muted); }
  .links a:hover { color: var(--text); }
  @media (min-width: 760px) { .links { display: flex; } }

  /* ── Botones (respuesta al presionar, sin esperar al click) ── */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font: inherit; font-weight: 600;
    font-size: 15px; padding: 12px 20px; border-radius: 980px; border: 0; cursor: pointer; user-select: none;
    -webkit-tap-highlight-color: transparent; transition: transform .1s ease-out, filter .2s ease, background .2s ease; }
  .btn:active { transform: scale(.97); }
  .btn.tg { background: var(--tg); color: #fff; }
  .btn.tg:hover { filter: brightness(1.06); }
  .btn.ghost { background: var(--chip); color: var(--text); }
  .btn.small { font-size: 13px; padding: 7px 14px; }
  .btn svg { width: 18px; height: 18px; flex: none; }

  /* ── Hero ──────────────────────────────────────────────────── */
  .hero { position: relative; padding: 40px 0 24px; text-align: center; overflow: hidden; }
  .hero::before { content: ""; position: absolute; inset: -20% -10% auto; height: 520px; z-index: -1; pointer-events: none;
    background: radial-gradient(50% 60% at 50% 0%, rgba(240,185,11,.22), transparent 70%); }
  .team { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 8px 0 28px; }
  .member { display: inline-flex; align-items: center; gap: 10px; padding: 6px 14px 6px 6px; border-radius: 980px;
    background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow);
    transition: transform .1s ease-out; }
  .member:active { transform: scale(.97); }
  .member img { width: 36px; height: 36px; border-radius: 50%; display: block; }
  .member b { display: block; font-size: 14px; line-height: 1.2; letter-spacing: -.005em; }
  .member small { display: block; font-size: 12px; color: var(--muted); line-height: 1.2; }
  .eyebrow { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
    color: var(--accent-ink); background: var(--accent); padding: 4px 10px; border-radius: 980px; margin-bottom: 18px; }
  @media (max-width: 420px) { .eyebrow { font-size: 10.5px; letter-spacing: .03em; padding: 4px 9px; } }
  h1 { font-size: clamp(40px, 8.4vw, 84px); line-height: 1.04; letter-spacing: -.035em; font-weight: 700; margin: 0 auto 18px; max-width: 14ch; }
  h1 span { background: linear-gradient(90deg, #f0b90b, #f8d33a 45%, #e7a500); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .lead { font-size: clamp(18px, 2.4vw, 22px); line-height: 1.45; letter-spacing: -.01em; color: var(--muted); max-width: 40ch; margin: 0 auto 28px; }
  .ctas { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }

  /* ── Secciones ─────────────────────────────────────────────── */
  section { padding: 56px 0; }
  .section-head { text-align: center; margin-bottom: 28px; }
  h2 { font-size: clamp(30px, 5.2vw, 52px); line-height: 1.08; letter-spacing: -.028em; font-weight: 700; margin: 0 0 10px; }
  .sub { color: var(--muted); font-size: clamp(16px, 2vw, 19px); max-width: 52ch; margin: 0 auto; letter-spacing: -.005em; }

  /* ── Cards (resorte + spotlight que sigue al puntero) ──────── */
  .grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 680px) { .grid.two { grid-template-columns: repeat(2, 1fr); } .grid.three { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 980px) { .grid.three { grid-template-columns: repeat(3, 1fr); } }
  .reveal { opacity: 0; transform: translateY(28px) scale(.985);
    transition: opacity .8s var(--spring), transform .8s var(--spring); transition-delay: calc(var(--i, 0) * 80ms); }
  .reveal.in { opacity: 1; transform: none; }
  .card { position: relative; height: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 22px;
    padding: 24px; box-shadow: var(--shadow); overflow: hidden; transform-style: preserve-3d; will-change: transform; }
  .card::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .3s ease;
    background: radial-gradient(420px circle at var(--mx, 50%) var(--my, 50%), rgba(240,185,11,.16), transparent 45%); }
  .card:hover::before { opacity: 1; }
  .card .icon { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; font-size: 24px; margin-bottom: 16px;
    color: var(--tint, var(--accent)); background: color-mix(in srgb, var(--tint, var(--accent)) 14%, transparent);
    transition: transform .5s var(--spring); }
  .card .icon .ico { transition: transform .5s var(--spring); }
  .card:hover .icon { transform: translateY(-2px) scale(1.06); }
  .card:hover .icon .ico { transform: rotate(-8deg); }
  .card h3 { font-size: 21px; line-height: 1.2; letter-spacing: -.018em; margin: 0 0 6px; }
  .card p { margin: 0; color: var(--muted); font-size: 16px; line-height: 1.5; }

  /* ── Precios en vivo ───────────────────────────────────────── */
  .live { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--up); position: relative; }
  .dot::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid var(--up); opacity: 0; animation: ping 1.8s ease-out infinite; }
  @keyframes ping { 0% { transform: scale(.6); opacity: .7; } 100% { transform: scale(1.6); opacity: 0; } }
  .quote .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
  .quote .tk { font-size: 13px; font-weight: 600; color: var(--muted); letter-spacing: .02em; }
  .quote .nm { font-size: 19px; font-weight: 600; letter-spacing: -.015em; line-height: 1.25; }
  .quote .px { font-size: 40px; font-weight: 700; letter-spacing: -.03em; line-height: 1.05; font-variant-numeric: tabular-nums; }
  .quote .px small { font-size: 15px; font-weight: 600; color: var(--muted); letter-spacing: 0; margin-left: 4px; }
  .chg { display: inline-block; font-size: 13px; font-weight: 600; padding: 3px 9px; border-radius: 980px; font-variant-numeric: tabular-nums; }
  .chg.up { color: var(--up); background: color-mix(in srgb, var(--up) 12%, transparent); }
  .chg.down { color: var(--down); background: color-mix(in srgb, var(--down) 12%, transparent); }
  .meta { font-size: 12px; color: var(--muted); margin: 6px 0 16px; }
  .toks { display: grid; gap: 8px; }
  .tok { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--bg-2); font-size: 14px; }
  .tok b { font-weight: 600; }
  .tok span { color: var(--muted); font-size: 12px; }
  .tok .r { text-align: right; font-variant-numeric: tabular-nums; }
  .skeleton { height: 230px; border-radius: 22px; background: linear-gradient(100deg, var(--surface) 30%, var(--bg-2) 50%, var(--surface) 70%);
    background-size: 300% 100%; animation: shimmer 1.6s linear infinite; border: 1px solid var(--border); }
  @keyframes shimmer { to { background-position: -150% 0; } }

  /* ── Probar ────────────────────────────────────────────────── */
  .try { max-width: 760px; margin: 0 auto; }
  form { display: flex; gap: 8px; }
  input { flex: 1; min-width: 0; font: inherit; font-size: 16px; padding: 14px 18px; border-radius: 980px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
  input:focus { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 1px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 0; justify-content: center; }
  .chip { font: inherit; font-size: 14px; font-weight: 500; padding: 7px 14px; border-radius: 980px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); cursor: pointer; transition: transform .1s ease-out; }
  .chip:active { transform: scale(.96); }
  .result { margin-top: 18px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 1.6; min-height: 72px; }
  .result.empty { color: var(--muted); }
  .result.error { color: var(--down); }
  .result strong { font-weight: 650; }
  .result code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; background: var(--chip); padding: 1px 6px; border-radius: 6px; }

  /* ── Telegram ──────────────────────────────────────────────── */
  .tg-wrap { display: grid; gap: 32px; align-items: center; }
  @media (min-width: 900px) { .tg-wrap { grid-template-columns: 1.05fr .95fr; } }
  .tg-copy h2 { text-align: left; }
  .tg-copy .sub { margin: 0 0 22px; text-align: left; }
  .handle { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px; padding: 2px 8px; border-radius: 8px; background: var(--chip); }
  .steps { list-style: none; padding: 0; margin: 0 0 26px; display: grid; gap: 12px; }
  .steps li { display: flex; gap: 12px; align-items: baseline; color: var(--muted); }
  .steps b { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; color: #fff; background: var(--tg); }
  .phone { max-width: 380px; width: 100%; margin: 0 auto; border-radius: 36px; padding: 14px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
  .phone-top { display: flex; align-items: center; gap: 10px; padding: 6px 8px 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
  .phone-top .av { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #1d1d1f; font-size: 18px; }
  .phone-top .av .ico { stroke-width: 2.2; }
  .phone-top b { display: block; font-size: 15px; }
  .phone-top small { color: var(--muted); font-size: 12px; }
  .chat { display: grid; gap: 8px; min-height: 360px; align-content: start; }
  .msg { max-width: 86%; padding: 9px 13px; border-radius: 18px; font-size: 14px; line-height: 1.45; white-space: pre-line;
    opacity: 0; transform: translateY(10px) scale(.98); transition: opacity .45s var(--spring), transform .45s var(--spring); }
  .msg.show { opacity: 1; transform: none; }
  .msg.me { justify-self: end; background: var(--tg); color: #fff; border-bottom-right-radius: 6px; }
  .msg.bot { justify-self: start; background: var(--bg-2); border-bottom-left-radius: 6px; }
  .kb { display: flex; gap: 6px; margin-top: 8px; }
  .kb span { display: flex; align-items: center; justify-content: center; gap: 4px; flex: 1; text-align: center; font-size: 13px; font-weight: 600; padding: 7px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); }
  .note { font-size: 12px; color: var(--muted); text-align: center; margin-top: 10px; }

  /* ── API ───────────────────────────────────────────────────── */
  pre { margin: 0; background: var(--code); border-radius: 16px; padding: 18px; overflow-x: auto; font-size: 13px; line-height: 1.6; border: 1px solid var(--border); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  footer { padding: 40px 0 56px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
  footer .row { display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: space-between; align-items: center; }
  footer a:hover { color: var(--text); }

  /* ── Accesibilidad ─────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .reveal, .msg { transform: none !important; transition: opacity .25s ease; transition-delay: 0s; }
    .dot::after, .skeleton { animation: none; }
    .ico.draw { stroke-dasharray: none; stroke-dashoffset: 0; animation: none !important; }
    .card:hover .icon, .card:hover .icon .ico { transform: none; }
    .btn:active, .chip:active, .member:active { transform: none; }
  }
  @media (prefers-reduced-transparency: reduce) {
    .nav { background: var(--bg); -webkit-backdrop-filter: none; backdrop-filter: none; border-bottom-color: var(--border); }
  }
  @media (prefers-contrast: more) {
    :root { --border: currentColor; --muted: var(--text); }
  }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="i-chart" viewBox="0 0 24 24"><path pathLength="1" d="M4 4v16h16"/><path pathLength="1" d="M7.5 15l3.5-3.5 3 3 5-5.5"/><path pathLength="1" d="M15.5 9h3.5v3.5"/></symbol>
  <symbol id="i-landmark" viewBox="0 0 24 24"><path pathLength="1" d="M3 9.5 12 4l9 5.5"/><path pathLength="1" d="M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7"/><path pathLength="1" d="M3 20.5h18"/></symbol>
  <symbol id="i-coin" viewBox="0 0 24 24"><circle pathLength="1" cx="12" cy="12" r="8.5"/><path pathLength="1" d="M14.6 9.6c-.5-.8-1.5-1.3-2.6-1.3-1.4 0-2.5.8-2.5 1.9 0 2.6 5.2 1.3 5.2 3.8 0 1.1-1.1 1.9-2.6 1.9-1.1 0-2.1-.5-2.7-1.4M12 6.6v1.6M12 15.9v1.5"/></symbol>
  <symbol id="i-moon" viewBox="0 0 24 24"><path pathLength="1" d="M19.5 14.6A7.9 7.9 0 1 1 9.4 4.5a6.3 6.3 0 0 0 10.1 10.1Z"/></symbol>
  <symbol id="i-bars" viewBox="0 0 24 24"><path pathLength="1" d="M5 19v-5M10 19V8M15 19v-8M20 19v-3"/><path pathLength="1" d="M3 21h18"/></symbol>
  <symbol id="i-sparkles" viewBox="0 0 24 24"><path pathLength="1" d="M11 3.5l1.9 4.9 4.9 1.9-4.9 1.9L11 17.1l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path pathLength="1" d="M18.5 14.5l.8 2.1 2.2.9-2.2.8-.8 2.2-.9-2.2-2.1-.8 2.1-.9z"/></symbol>
  <symbol id="i-scale" viewBox="0 0 24 24"><path pathLength="1" d="M12 4v16M8.5 20h7M5 7.5h14"/><path pathLength="1" d="M5 7.5 2.5 13a2.6 2.6 0 0 0 5 0Z"/><path pathLength="1" d="M19 7.5 16.5 13a2.6 2.6 0 0 0 5 0Z"/></symbol>
  <symbol id="i-pie" viewBox="0 0 24 24"><path pathLength="1" d="M11 4.1A8.5 8.5 0 1 0 19.9 13H11z"/><path pathLength="1" d="M14 3.2A8 8 0 0 1 20.8 10H14z"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path pathLength="1" d="M12 3.2 19 6v5.3c0 4.4-2.9 8-7 9.6-4.1-1.6-7-5.2-7-9.6V6z"/><path pathLength="1" d="M8.8 12.2l2.2 2.2 4.2-4.4"/></symbol>
  <symbol id="i-cpu" viewBox="0 0 24 24"><rect pathLength="1" x="6" y="6" width="12" height="12" rx="2.6"/><rect pathLength="1" x="9.5" y="9.5" width="5" height="5" rx="1.1"/><path pathLength="1" d="M9.5 2.5v2.5M14.5 2.5v2.5M9.5 19v2.5M14.5 19v2.5M2.5 9.5H5M2.5 14.5H5M19 9.5h2.5M19 14.5h2.5"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path pathLength="1" d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24"><path pathLength="1" d="M12 4 2.8 19.5h18.4z"/><path pathLength="1" d="M12 10v4.2M12 16.9v.1"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><circle pathLength="1" cx="12" cy="12" r="8.5"/><path pathLength="1" d="M10 9v6M14 9v6"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect pathLength="1" x="5" y="10.5" width="14" height="10" rx="2.2"/><path pathLength="1" d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>
  <symbol id="i-block" viewBox="0 0 24 24"><circle pathLength="1" cx="12" cy="12" r="8.5"/><path pathLength="1" d="M7.8 12h8.4"/></symbol>
  <symbol id="i-receipt" viewBox="0 0 24 24"><path pathLength="1" d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path pathLength="1" d="M9 8.5h6M9 12h6M9 15.5h3.5"/></symbol>
  <symbol id="i-swap" viewBox="0 0 24 24"><path pathLength="1" d="M5 8h13.5M15.5 5l3 3-3 3"/><path pathLength="1" d="M19 16H5.5M8.5 13l-3 3 3 3"/></symbol>
  <symbol id="i-repeat" viewBox="0 0 24 24"><path pathLength="1" d="M17 3l3 3-3 3"/><path pathLength="1" d="M4 11.5V10a4 4 0 0 1 4-4h12"/><path pathLength="1" d="M7 21l-3-3 3-3"/><path pathLength="1" d="M20 12.5V14a4 4 0 0 1-4 4H4"/></symbol>
  <symbol id="i-wallet" viewBox="0 0 24 24"><path pathLength="1" d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5z"/><path pathLength="1" d="M4 7.5 15 4.5v3"/><path pathLength="1" d="M16 13.8h.1"/></symbol>
  <symbol id="i-basket" viewBox="0 0 24 24"><path pathLength="1" d="M3 10h18l-2 10H5z"/><path pathLength="1" d="M8 10l3.2-6M16 10l-3.2-6"/><path pathLength="1" d="M9.5 13.5v3.5M14.5 13.5v3.5"/></symbol>
  <symbol id="i-info" viewBox="0 0 24 24"><circle pathLength="1" cx="12" cy="12" r="8.5"/><path pathLength="1" d="M12 11v5M12 8v.1"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle pathLength="1" cx="12" cy="12" r="8.5"/><path pathLength="1" d="M12 7.5V12l3 2"/></symbol>
  <symbol id="i-dot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.5"/></symbol>
</svg>
<nav class="nav" id="nav">
  <div class="wrap">
    <a class="brand" href="#top"><span class="logo"><svg class="ico" aria-hidden="true"><use href="#i-chart"/></svg></span>Primera Acción</a>
    <div class="links">
      <a href="#precios">Precios</a>
      <a href="#probar">Probar</a>
      <a href="#como">Cómo funciona</a>
      <a href="#telegram">Telegram</a>
      <a href="#agentes">Para agentes</a>
    </div>
    <a class="btn tg small" href="https://t.me/TuPrimeraAccionBot" target="_blank" rel="noopener">Abrir bot</a>
  </div>
</nav>

<main id="top">
  <header class="hero">
    <div class="wrap">
      <div class="team" aria-label="Equipo">
        <a class="member" href="https://github.com/invertilo" target="_blank" rel="noopener">
          <img src="https://avatars.githubusercontent.com/u/227039846?v=4&s=96" alt="" width="36" height="36" />
          <span><b>Vinicius</b><small>@invertilo</small></span>
        </a>
        <a class="member" href="https://github.com/alejondr3" target="_blank" rel="noopener">
          <img src="https://avatars.githubusercontent.com/u/239358124?v=4&s=96" alt="" width="36" height="36" />
          <span><b>Alejandro Mendoza</b><small>@alejondr3</small></span>
        </a>
        <a class="member" href="https://github.com/jasiiid" target="_blank" rel="noopener">
          <img src="https://avatars.githubusercontent.com/u/334227120?v=4&s=96" alt="" width="36" height="36" />
          <span><b>Jasid Moron</b><small>@jasiiid</small></span>
        </a>
      </div>
      <div><span class="eyebrow">BNB Hack · Tokenized Stocks · Santa Cruz, Bolivia</span></div>
      <h1>Tu primera acción de <span>Wall Street</span>.</h1>
      <p class="lead">Compra acciones tokenizadas de Apple, NVIDIA o Tesla con USDT, desde Telegram y en español. Con el precio real de la bolsa y confirmación antes de cada operación.</p>
      <div class="ctas">
        <a class="btn tg" href="https://t.me/TuPrimeraAccionBot" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.94 4.3 18.7 19.6c-.24 1.08-.88 1.35-1.79.84l-4.94-3.64-2.38 2.3c-.26.26-.49.48-1 .48l.36-5.04 9.17-8.29c.4-.36-.09-.55-.62-.2L6.16 13.2l-4.88-1.53c-1.06-.33-1.08-1.06.22-1.57L20.6 2.74c.88-.33 1.65.2 1.34 1.56Z"/></svg>
          Abrir @TuPrimeraAccionBot
        </a>
        <a class="btn ghost" href="#probar">Probar el análisis</a>
      </div>
    </div>
  </header>

  <section id="precios">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>La bolsa y BNB Chain, lado a lado.</h2>
        <p class="sub">Precio de la acción en tiempo real (incluye pre y post mercado) frente a cada token de Ondo y bStocks. <span class="live"><span class="dot"></span><span id="upd">Actualizando…</span></span></p>
      </div>
      <div class="grid three" id="quotes">
        <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>
      </div>
    </div>
  </section>

  <section id="probar">
    <div class="wrap try">
      <div class="section-head reveal">
        <h2>Pregúntale al agente.</h2>
        <p class="sub">Escribe un ticker, un monto o una pregunta en español. Responde con datos reales; no es una recomendación de inversión.</p>
      </div>
      <div class="reveal" style="--i:1">
        <div class="card tilt" data-tilt="2">
          <form id="f">
            <input id="q" maxlength="300" autocomplete="off" placeholder="Ej: NVDA 25 · analiza apple · ¿cómo viene tesla?" aria-label="Consulta" />
            <button class="btn tg" id="go" type="submit">Analizar</button>
          </form>
          <div class="chips">
            <button class="chip" type="button" data-q="analiza nvidia">analiza nvidia</button>
            <button class="chip" type="button" data-q="AAPL 25">AAPL 25</button>
            <button class="chip" type="button" data-q="¿cómo viene tesla?">¿cómo viene tesla?</button>
            <button class="chip" type="button" data-q="SPY">S&amp;P 500</button>
            <button class="chip" type="button" data-q="info de mercado libre">Mercado Libre</button>
          </div>
          <div id="out" class="result empty" aria-live="polite">El resultado aparece acá.</div>
        </div>
      </div>
    </div>
  </section>

  <section id="como">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>Simple por fuera. Cuidadoso por dentro.</h2>
        <p class="sub">Todo lo que necesitas para invertir en acciones tokenizadas, sin pelearte con wallets, DEX ni slippage.</p>
      </div>
      <div class="grid three">
        <div class="reveal" style="--i:0"><article class="card tilt" style="--tint:#0a84ff"><div class="icon"><svg class="ico draw" aria-hidden="true"><use href="#i-landmark"/></svg></div><h3>Precio real de la bolsa</h3><p>Yahoo Finance en tiempo real, con pre y post mercado, comparado con el precio onchain de cada token.</p></article></div>
        <div class="reveal" style="--i:1"><article class="card tilt" style="--tint:#bf5af2"><div class="icon"><svg class="ico draw" aria-hidden="true"><use href="#i-sparkles"/></svg></div><h3>Análisis con IA</h3><p>DeepSeek vía OpenRouter explica cada acción con datos reales. Si la IA no responde, el agente escribe el análisis con sus propias reglas.</p></article></div>
        <div class="reveal" style="--i:2"><article class="card tilt" style="--tint:#f0b90b"><div class="icon"><svg class="ico draw" aria-hidden="true"><use href="#i-scale"/></svg></div><h3>El mejor emisor</h3><p>Si la acción existe en Ondo y en bStocks, cotiza en los dos y elige el que da mejor precio frente a la bolsa.</p></article></div>
        <div class="reveal" style="--i:3"><article class="card tilt" style="--tint:#30b0c7"><div class="icon"><svg class="ico draw" aria-hidden="true"><use href="#i-pie"/></svg></div><h3>Canastas y DCA</h3><p>Arma tu canasta (IA, chips, índices), invierte en ella de una vez y programa compras periódicas que siempre te confirma.</p></article></div>
        <div class="reveal" style="--i:4"><article class="card tilt" style="--tint:#34c759"><div class="icon"><svg class="ico draw" aria-hidden="true"><use href="#i-shield"/></svg></div><h3>Nada sin tu confirmación</h3><p>Simulación, límites por operación y por día, slippage máximo y aviso si el precio onchain se aleja de la bolsa.</p></article></div>
        <div class="reveal" style="--i:5"><article class="card tilt" style="--tint:#5e5ce6"><div class="icon"><svg class="ico draw" aria-hidden="true"><use href="#i-cpu"/></svg></div><h3>Hecho para agentes</h3><p>Agente de BNB Agent Studio con identidad ERC-8004 y una API abierta para que otros agentes de IA usen el análisis.</p></article></div>
      </div>
    </div>
  </section>

  <section id="telegram">
    <div class="wrap tg-wrap">
      <div class="tg-copy reveal">
        <h2>Invierte desde Telegram.</h2>
        <p class="sub">Habla con <span class="handle">@TuPrimeraAccionBot</span> como le hablarías a un amigo. Él cotiza, simula y te pide confirmación antes de mover un solo USDT.</p>
        <ol class="steps">
          <li><b>1</b><span>Abre el bot y escribe <strong>/start</strong>.</span></li>
          <li><b>2</b><span>Pregunta: <strong>precio de apple</strong> o <strong>analiza nvidia</strong>.</span></li>
          <li><b>3</b><span>Compra: <strong>compra 25 de tesla</strong> y confirma con un toque.</span></li>
        </ol>
        <a class="btn tg" href="https://t.me/TuPrimeraAccionBot" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.94 4.3 18.7 19.6c-.24 1.08-.88 1.35-1.79.84l-4.94-3.64-2.38 2.3c-.26.26-.49.48-1 .48l.36-5.04 9.17-8.29c.4-.36-.09-.55-.62-.2L6.16 13.2l-4.88-1.53c-1.06-.33-1.08-1.06.22-1.57L20.6 2.74c.88-.33 1.65.2 1.34 1.56Z"/></svg>
          Abrir @TuPrimeraAccionBot
        </a>
      </div>
      <div class="reveal" style="--i:1">
        <div class="phone tilt" data-tilt="3" id="phone">
          <div class="phone-top"><div class="av"><svg class="ico" aria-hidden="true"><use href="#i-chart"/></svg></div><div><b>Primera Acción</b><small>@TuPrimeraAccionBot · bot</small></div></div>
          <div class="chat" id="chat">
            <div class="msg me">compra 25 de apple</div>
            <div class="msg bot"><svg class="ico inline" aria-hidden="true"><use href="#i-receipt"/></svg><strong>Comprar 25,00 USDT de AAPL</strong>
<svg class="ico inline status up" aria-hidden="true"><use href="#i-dot"/></svg>AAPLB (bStocks) ≈ 0,0749 tokens
precio 333,70 USDT · −0,03% vs bolsa
<svg class="ico inline" aria-hidden="true"><use href="#i-moon"/></svg>Bolsa cerrada (fin de semana)
<svg class="ico inline" aria-hidden="true"><use href="#i-check"/></svg>Chequeos previos OK. ¿Confirmas?<div class="kb"><span><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>Confirmar</span><span><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg>Cancelar</span></div></div>
            <div class="msg me">Confirmar</div>
            <div class="msg bot"><svg class="ico inline" aria-hidden="true"><use href="#i-check"/></svg>Compraste AAPLB por 25,00 USDT — ver transacción</div>
          </div>
          <p class="note">Ejemplo ilustrativo: la cotización y la ruta varían.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="agentes">
    <div class="wrap">
      <div class="section-head reveal">
        <h2>Una API para otros agentes.</h2>
        <p class="sub">El mismo análisis pre-compra que vende nuestro agente de BNB Agent Studio, abierto por HTTP.</p>
      </div>
      <div class="reveal" style="--i:1"><pre><code id="curl">curl -X POST /api/analyze -H 'Content-Type: application/json' -d '{"prompt":"NVDA 25"}'</code></pre></div>
    </div>
  </section>
</main>

<footer>
  <div class="wrap row">
    <span>Hecho en Santa Cruz por <a href="https://github.com/invertilo">@invertilo</a>, <a href="https://github.com/alejondr3">@alejondr3</a> y <a href="https://github.com/jasiiid">@jasiiid</a> · <a href="https://github.com/invertilo/bnb-builder-day">GitHub</a></span>
    <span>Proyecto experimental de hackathon. No es asesoría financiera.</span>
  </div>
</footer>

<script>
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // Barra: borde inferior solo cuando hay contenido debajo (efecto de borde de scroll).
  var nav = document.getElementById("nav");
  function onScroll() { nav.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // Entradas escalonadas al entrar en pantalla.
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px" });
  function observe(root) { (root || document).querySelectorAll(".reveal:not(.in)").forEach(function (el) { io.observe(el); }); }
  observe();

  // Resorte críticamente amortiguado (damping 1.0, response 0.35 s): parte del valor actual, es interrumpible.
  function Spring(response, damping) {
    this.k = Math.pow(2 * Math.PI / response, 2); this.c = 4 * Math.PI * damping / response;
    this.x = 0; this.v = 0; this.target = 0;
  }
  Spring.prototype.step = function (dt) {
    var a = -this.k * (this.x - this.target) - this.c * this.v;
    this.v += a * dt; this.x += this.v * dt;
    return Math.abs(this.x - this.target) > 0.001 || Math.abs(this.v) > 0.001;
  };

  function tilt(card) {
    var max = Number(card.dataset.tilt || 6);
    var rx = new Spring(0.35, 1), ry = new Spring(0.35, 1), s = new Spring(0.3, 1);
    s.x = 1; s.target = 1;
    var running = false, last = 0;
    function frame(t) {
      var dt = Math.min(0.032, (t - last) / 1000 || 0.016); last = t;
      var a = rx.step(dt), b = ry.step(dt), c = s.step(dt);
      card.style.transform = "perspective(900px) rotateX(" + rx.x.toFixed(3) + "deg) rotateY(" + ry.x.toFixed(3) + "deg) scale(" + s.x.toFixed(4) + ")";
      if (a || b || c) requestAnimationFrame(frame); else running = false;
    }
    function kick() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } }
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
      card.style.setProperty("--my", (py * 100).toFixed(1) + "%");
      ry.target = (px - 0.5) * 2 * max; rx.target = -(py - 0.5) * 2 * max; kick();
    });
    card.addEventListener("pointerleave", function () { rx.target = 0; ry.target = 0; s.target = 1; kick(); });
    card.addEventListener("pointerdown", function () { s.target = 0.985; kick(); });
    card.addEventListener("pointerup", function () { s.target = 1; kick(); });
  }
  function enableTilt(root) {
    if (reduce || !fine) return;
    (root || document).querySelectorAll(".tilt:not([data-tilted])").forEach(function (c) { c.dataset.tilted = "1"; tilt(c); });
  }
  enableTilt();

  // Utilidades de formato (es-BO, coma decimal).
  function num(n, d) { return Number(n).toLocaleString("es-BO", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + num(Math.abs(n), 2) + "%"; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ISSUER = { ondo: "Ondo", bstocks: "bStocks", xstocks: "xStocks" };
  var SESSION = { regular: "en vivo", pre: "pre-mercado", post: "post-mercado", closed: "último precio", unknown: "último precio" };

  // Número que se desliza al nuevo valor (entrada no gestual: duración fija, ease-out).
  function tween(el, to, d) {
    var from = parseFloat(el.dataset.v || to);
    el.dataset.v = to;
    if (reduce || from === to) { el.textContent = num(to, d); return; }
    var t0 = performance.now(), dur = 700;
    (function f(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = num(from + (to - from) * e, d);
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  }

  var grid = document.getElementById("quotes"), upd = document.getElementById("upd");
  function card(item, i) {
    var s = item.stock, chg = s && s.dayChangePct != null ? s.dayChangePct : null;
    var toks = item.tokens.map(function (t) {
      var g = t.gapPct == null ? "" : signed(t.gapPct) + " vs bolsa";
      return '<div class="tok"><div><b>' + esc(t.symbol) + "</b> <span>" + esc(ISSUER[t.issuer] || t.issuer) + (t.tradable ? "" : " · pausado") +
        '</span></div><div class="r"><b>' + num(t.price, 2) + " USDT</b><br><span>" + g + "</span></div></div>";
    }).join("");
    return '<div class="reveal" style="--i:' + i + '"><article class="card quote tilt" data-tk="' + esc(item.ticker) + '">' +
      '<div class="top"><div><div class="tk">' + esc(item.ticker) + '</div><div class="nm">' + esc(item.name) + "</div></div>" +
      (chg == null ? "" : '<span class="chg ' + (chg >= 0 ? "up" : "down") + '">' + signed(chg) + "</span>") + "</div>" +
      '<div class="px"><span class="v" data-v="' + (s ? s.price : 0) + '">' + (s ? num(s.price, 2) : "—") + "</span><small>USD</small></div>" +
      '<div class="meta">' + (s ? "En bolsa · " + (SESSION[s.session] || s.session) + " · " + esc(s.source) : "Sin precio de bolsa ahora") + "</div>" +
      '<div class="toks">' + toks + "</div></article></div>";
  }
  function load() {
    fetch("/api/quotes").then(function (r) { return r.json(); }).then(function (data) {
      var items = data.items || [];
      if (!items.length) { upd.textContent = "Sin datos ahora"; return; }
      var existing = grid.querySelectorAll(".quote");
      if (existing.length === items.length) {
        items.forEach(function (it) {
          var c = grid.querySelector('.quote[data-tk="' + it.ticker + '"] .v');
          if (c && it.stock) tween(c, it.stock.price, 2);
        });
      } else {
        grid.innerHTML = items.map(card).join("");
        observe(grid); enableTilt(grid);
      }
      upd.textContent = "Actualizado " + new Date(data.updatedAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }).catch(function () { upd.textContent = "No pude actualizar"; });
  }
  load(); setInterval(load, 30000);

  // Probar el análisis.
  var out = document.getElementById("out"), q = document.getElementById("q"), go = document.getElementById("go");
  document.getElementById("curl").textContent = "curl -X POST " + location.origin + "/api/analyze -H 'Content-Type: application/json' -d '{\"prompt\":\"NVDA 25\"}'";
  var bt = String.fromCharCode(96); // backtick, sin escribirlo dentro de String.raw
  var tick = new RegExp(bt + "([^" + bt + "\\n]+)" + bt, "g");
  // Las respuestas de la API traen emojis (el bot de Telegram los usa); en la web se muestran como íconos.
  var EMOJI_ICON = {}, codes = {
    chart: [0x1F4C8], landmark: [0x1F3DB], coin: [0x1FA99], moon: [0x1F319], bars: [0x1F4CA], sparkles: [0x1F9E0],
    "dot up": [0x1F7E2], "dot down": [0x1F534], check: [0x2705, 0x1F44C], alert: [0x26A0, 0x1F635], pause: [0x23F8],
    lock: [0x1F512], block: [0x26D4], receipt: [0x1F9FE], swap: [0x1F4B1], repeat: [0x1F501], wallet: [0x1F4BC],
    basket: [0x1F9FA], info: [0x2139], x: [0x2716, 0x274C], clock: [0x23F3, 0x23F1]
  };
  Object.keys(codes).forEach(function (name) { codes[name].forEach(function (cp) { EMOJI_ICON[String.fromCodePoint(cp)] = name; }); });
  var pictographs = /(\p{Extended_Pictographic}|\p{Regional_Indicator}{2})\uFE0F?/gu;
  function iconize(html) {
    return html.replace(pictographs, function (m) {
      var name = EMOJI_ICON[m.replace(/\uFE0F/g, "")];
      if (!name) return "";
      var parts = name.split(" ");
      var cls = parts.length > 1 ? "ico inline status " + parts[1] : "ico inline";
      return '<svg class="' + cls + '" aria-hidden="true"><use href="#i-' + parts[0] + '"/></svg>';
    });
  }
  function md(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>")
      .replace(tick, "<code>$1</code>");
  }
  function render(s) { return iconize(md(s)); }
  function run(prompt) {
    if (!prompt.trim()) return;
    q.value = prompt; go.disabled = true;
    out.className = "result empty"; out.textContent = "Consultando la bolsa y BNB Chain…";
    fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Error " + r.status); return d; }); })
      .then(function (d) { out.className = "result"; out.innerHTML = render(d.result); })
      .catch(function (e) { out.className = "result error"; out.textContent = e.message; })
      .then(function () { go.disabled = false; });
  }
  document.getElementById("f").addEventListener("submit", function (e) { e.preventDefault(); run(q.value); });
  document.querySelectorAll("[data-q]").forEach(function (b) { b.addEventListener("click", function () { run(b.dataset.q); }); });

  // Conversación de ejemplo: los mensajes aparecen en secuencia cuando el teléfono entra en pantalla.
  var msgs = document.querySelectorAll("#chat .msg");
  if (reduce) { msgs.forEach(function (m) { m.classList.add("show"); }); }
  else {
    var shown = false;
    new IntersectionObserver(function (entries, obs) {
      if (shown || !entries[0].isIntersecting) return;
      shown = true; obs.disconnect();
      msgs.forEach(function (m, i) { setTimeout(function () { m.classList.add("show"); }, 300 + i * 900); });
    }, { threshold: 0.4 }).observe(document.getElementById("phone"));
  }
})();
</script>
</body>
</html>`;

/**
 * Bun y esbuild reescriben los caracteres no ASCII (tildes, emojis) como \uXXXX o \u{XXXXX} al transpilar, y dentro de
 * String.raw esos escapes quedarían como texto literal. Los decodificamos acá (en Node no hay nada que cambiar).
 * Por eso el HTML/JS de arriba no debe usar secuencias \u propias.
 */
export const PAGE_HTML = RAW_PAGE.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_m, astral?: string, bmp?: string) =>
  astral ? String.fromCodePoint(parseInt(astral, 16)) : String.fromCharCode(parseInt(bmp!, 16)),
);
