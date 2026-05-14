// ========================================
// SERVER.JS — BUZZACCHI CRM
// VERSIÓN DEFINITIVA FINAL
// ========================================

const express = require("express");
const app     = express();
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const session = require("express-session");
const cors    = require("cors");
const https   = require("https");
const http    = require("http");
const { createClient } = require("@supabase/supabase-js");
const OpenAI      = require("openai");
const PDFDocument = require("pdfkit");
const sharp       = require("sharp");

// =========================
// MIDDLEWARE — UNA SOLA VEZ
// =========================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: "buzzacchi2025", resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "Público")));

// =========================
// RUTAS DE PÁGINAS HTML
// =========================
app.get("/",                   (_, res) => res.sendFile(path.join(__dirname, "funnel-publico.html")));
app.get("/funnel",             (_, res) => res.sendFile(path.join(__dirname, "funnel-publico.html")));
app.get("/funnel-publico.html",(_, res) => res.sendFile(path.join(__dirname, "funnel-publico.html")));
app.get("/login",              (_, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/login.html",         (_, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/dashboard",          (_, res) => res.sendFile(path.join(__dirname, "Público", "dashboard.html")));
app.get("/dashboard.html",     (_, res) => res.sendFile(path.join(__dirname, "Público", "dashboard.html")));
app.get("/ver",                (_, res) => res.sendFile(path.join(__dirname, "Público", "ver.html")));
app.get("/ver.html",           (_, res) => res.sendFile(path.join(__dirname, "Público", "ver.html")));
app.get("/editar",             (_, res) => res.sendFile(path.join(__dirname, "Público", "editar.html")));
app.get("/editar.html",        (_, res) => res.sendFile(path.join(__dirname, "Público", "editar.html")));
app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, 'demo.html'));
});
app.get("/logout",             (req, res) => { req.session.destroy(); res.redirect("/login"); });

// Ruta genérica — sirve CUALQUIER .html de /public o /Público
app.get("/:page.html", (req, res) => {
  const page = req.params.page + ".html";
  const enPublic  = path.join(__dirname, "public", page);
  const enPublico = path.join(__dirname, "Público", page);
  if (fs.existsSync(enPublic))  return res.sendFile(enPublic);
  if (fs.existsSync(enPublico)) return res.sendFile(enPublico);
  res.status(404).send(`Página ${page} no encontrada`);
});

// =========================
// SUPABASE
// =========================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("❌ FATAL: Falta SUPABASE_URL o SUPABASE_KEY en Render > Environment");
}
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_KEY || ""
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

// =========================
// DATA LOCAL — notificaciones
// =========================
const DATA_DIR   = path.join(__dirname, "data");
const NOTIF_FILE = path.join(DATA_DIR, "notificaciones.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let notificaciones = [];
try { notificaciones = JSON.parse(fs.readFileSync(NOTIF_FILE, "utf8")) || []; } catch {}

function guardarNotifs() {
  try { fs.writeFileSync(NOTIF_FILE, JSON.stringify(notificaciones, null, 2)); } catch {}
}
function pushNotif(n) {
  notificaciones.unshift({ id: Date.now(), ts: Date.now(), leida: false, ...n });
  if (notificaciones.length > 300) notificaciones.pop();
  guardarNotifs();
}

// =========================
// KEEP-ALIVE — Render no duerme
// =========================
// Proxy de imágenes (para canvas CORS en generador de posts)
app.get("/api/proxy-image", (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Falta url");
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch(e) { return res.status(400).send("URL inválida"); }
  const lib = parsedUrl.protocol === "https:" ? https : http;
  const proxyReq = lib.get(url, (r) => {
    if (r.statusCode !== 200) return res.status(r.statusCode || 502).send("Error origen");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Content-Type", r.headers["content-type"] || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    r.pipe(res);
  });
  proxyReq.on("error", (e) => { if (!res.headersSent) res.status(500).send("Error proxy"); });
  proxyReq.setTimeout(10000, () => { proxyReq.destroy(); if (!res.headersSent) res.status(504).send("Timeout"); });
});

// Generador de posts Instagram
app.get("/generador-posts", (_, res) => res.sendFile(path.join(__dirname, "Público", "generador-posts.html")));
app.get("/generador-posts.html", (_, res) => res.sendFile(path.join(__dirname, "Público", "generador-posts.html")));

app.get("/ping", (_, res) => res.json({ ok: true, ts: Date.now(), uptime: process.uptime() }));

// ============================================================
// GENERADOR DE VIDEO IA — VERCEL + REPLICATE
// Variables necesarias (ya en Vercel):
//   ANTHROPIC_API_KEY · SUPABASE_URL · SUPABASE_KEY · REPLICATE_API_TOKEN
// ============================================================

// ─── Páginas ───
app.get("/generador-video",      (_, res) => res.sendFile(path.join(__dirname, "Público", "generador-video.html")));
app.get("/generador-video.html", (_, res) => res.sendFile(path.join(__dirname, "Público", "generador-video.html")));

// ─── Helpers visuales ───
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function getPaleta(estilo) {
  const p = {
    luxury: { bg:"#0d0d0d", bg2:"#141414", accent:"#c9a84c", text:"#ffffff", muted:"#888", overlay:"rgba(0,0,0,0.6)", font:"Georgia,serif", accentText:"#000" },
    clean:  { bg:"#f8f6f0", bg2:"#ffffff", accent:"#2c3e50", text:"#1a1a1a", muted:"#888", overlay:"rgba(255,255,255,0.7)", font:"Helvetica Neue,Arial,sans-serif", accentText:"#fff" },
    modern: { bg:"#1a2a4a", bg2:"#0d1a30", accent:"#4a90e2", text:"#ffffff", muted:"#8ab4d8", overlay:"rgba(10,20,40,0.7)", font:"Arial,sans-serif", accentText:"#fff" },
    neon:   { bg:"#040d04", bg2:"#071207", accent:"#00f5ff", text:"#ffffff", muted:"#4af0b0", overlay:"rgba(0,0,0,0.45)", font:"Arial Black,Impact,sans-serif", accentText:"#000" },
  };
  return p[estilo] || p.luxury;
}

// ─── Template Neón Aéreo (SVG con grilla de lotes) ───
function buildNeonHTML({ titulo, zona, precio, cta, telefono, tipo, imagenUrl, content, neonM2 = 2500, neonLotes = 6, neonPalabra = "OPORTUNIDAD" }) {
  const dims = tipo === "story" ? { w:540, h:960 } : { w:540, h:540 };
  const s    = tipo === "story";
  const cols    = neonLotes <= 4 ? 2 : neonLotes <= 9 ? 3 : 4;
  const rows    = Math.ceil(neonLotes / cols);
  const totalM2 = (neonM2 * neonLotes).toLocaleString("es-AR");
  const padX = 40, padY = s ? 160 : 80;
  const gridW = dims.w - padX * 2, gridH = s ? dims.h * 0.52 : dims.h * 0.48;
  const cellW = gridW / cols, cellH = gridH / rows;

  let svgCeldas = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= neonLotes) break;
      const x = padX + c * cellW, y = padY + r * cellH;
      const cx = x + cellW / 2, cy = y + cellH / 2;
      const fs = s ? 20 : 14, delay = (1.0 + idx * 0.15).toFixed(2);
      svgCeldas += `<rect x="${x+3}" y="${y+3}" width="${cellW-6}" height="${cellH-6}" fill="rgba(0,245,255,0.06)" stroke="#00f5ff" stroke-width="2.5" rx="3" filter="url(#gNeon)"><animate attributeName="opacity" values="0.8;1;0.8" dur="${(1.4+idx*0.25).toFixed(1)}s" repeatCount="indefinite"/></rect>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="#00f5ff" font-family="Arial Black,Impact,sans-serif" font-size="${fs}px" font-weight="900" filter="url(#gNeonTxt)" opacity="0"><animate attributeName="opacity" values="0;1" dur="0.4s" begin="${delay}s" fill="freeze"/><animate attributeName="opacity" values="0.7;1;0.7" dur="${(1.6+idx*0.2).toFixed(1)}s" begin="${(parseFloat(delay)+0.5).toFixed(1)}s" repeatCount="indefinite"/>${neonM2.toLocaleString("es-AR")}m²</text>`;
    }
  }
  let svgLineas = "";
  for (let c = 1; c < cols; c++) { const x = padX + c * cellW; svgLineas += `<line x1="${x}" y1="${padY}" x2="${x}" y2="${padY+gridH}" stroke="#00f5ff" stroke-width="2" opacity="0.5"/>`; }
  for (let r = 1; r < rows; r++) { const y = padY + r * cellH; svgLineas += `<line x1="${padX}" y1="${y}" x2="${padX+gridW}" y2="${y}" stroke="#00f5ff" stroke-width="2" opacity="0.5"/>`; }

  const imgTag = imagenUrl ? `<image href="${imagenUrl}" x="0" y="0" width="${dims.w}" height="${dims.h}" preserveAspectRatio="xMidYMid slice" opacity="0.55"/>` : `<rect width="${dims.w}" height="${dims.h}" fill="url(#bgGrad)"/>`;
  const bottomY = padY + gridH + (s ? 44 : 28), palabraY = s ? dims.h - 210 : dims.h - 150;
  const fsZona = s?18:13, fsPalabra = s?86:60, fsPrecio = s?26:19, fsCta = s?19:14, fsTel = s?17:13;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{width:${dims.w}px;height:${dims.h}px;overflow:hidden;background:#040d04}svg{display:block}</style></head><body>
<svg width="${dims.w}" height="${dims.h}" viewBox="0 0 ${dims.w} ${dims.h}" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#071207"/><stop offset="100%" stop-color="#020802"/></linearGradient>
<filter id="gNeon" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="gNeonTxt" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="gNeonBig" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
${imgTag}<rect width="${dims.w}" height="${dims.h}" fill="rgba(0,0,0,0.42)"/>
<text x="${dims.w/2}" y="${s?100:55}" text-anchor="middle" fill="#00f5ff" font-family="Arial Black,Impact,sans-serif" font-size="${fsZona}px" font-weight="900" letter-spacing="4" filter="url(#gNeonTxt)" opacity="0"><animate attributeName="opacity" values="0;1" dur="0.4s" begin="0.3s" fill="freeze"/>${escapeHtml((zona||"Río Cuarto").toUpperCase())}</text>
<rect x="${padX}" y="${padY}" width="${gridW}" height="${gridH}" fill="none" stroke="#00f5ff" stroke-width="3" rx="4" filter="url(#gNeon)"><animate attributeName="stroke-opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite"/></rect>
${svgLineas}${svgCeldas}
<text x="${dims.w/2}" y="${bottomY}" text-anchor="middle" fill="#4af0b0" font-family="Arial Black,Impact,sans-serif" font-size="${fsZona}px" font-weight="900" filter="url(#gNeonTxt)" opacity="0"><animate attributeName="opacity" values="0;1" dur="0.4s" begin="1.5s" fill="freeze"/>TOTAL: ${totalM2}m²  ·  ${neonLotes} LOTES</text>
<text x="${dims.w/2}" y="${palabraY}" text-anchor="middle" fill="#ffffff" font-family="Arial Black,Impact,sans-serif" font-size="${fsPalabra}px" font-weight="900" letter-spacing="4" filter="url(#gNeonBig)" opacity="0"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.9s" fill="freeze"/><animate attributeName="fill" values="#ffffff;#00f5ff;#ffffff" dur="1.6s" begin="2.2s" repeatCount="indefinite"/>${escapeHtml(neonPalabra.toUpperCase())}</text>
${precio?`<text x="${dims.w/2}" y="${palabraY+(s?64:46)}" text-anchor="middle" fill="#00f5ff" font-family="Arial Black,Impact,sans-serif" font-size="${fsPrecio}px" font-weight="900" filter="url(#gNeonTxt)" opacity="0"><animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.3s" fill="freeze"/>${escapeHtml(precio)}</text>`:""}
<rect x="${padX}" y="${dims.h-(s?118:86)}" width="${gridW}" height="${s?88:62}" fill="rgba(0,245,255,0.08)" stroke="#00f5ff" stroke-width="1.5" rx="6" opacity="0"><animate attributeName="opacity" values="0;1" dur="0.5s" begin="2.6s" fill="freeze"/></rect>
<text x="${dims.w/2}" y="${dims.h-(s?84:57)}" text-anchor="middle" fill="#ffffff" font-family="Arial Black,Impact,sans-serif" font-size="${fsCta}px" font-weight="700" opacity="0"><animate attributeName="opacity" values="0;1" dur="0.5s" begin="2.6s" fill="freeze"/>${escapeHtml(cta)}</text>
${telefono?`<text x="${dims.w/2}" y="${dims.h-(s?52:28)}" text-anchor="middle" fill="#00f5ff" font-family="Arial Black,Impact,sans-serif" font-size="${fsTel}px" font-weight="900" filter="url(#gNeonTxt)" opacity="0"><animate attributeName="opacity" values="0;1" dur="0.5s" begin="2.7s" fill="freeze"/>${escapeHtml(telefono)}</text>`:""}
<text x="${dims.w-16}" y="${s?50:36}" text-anchor="end" fill="rgba(255,255,255,0.45)" font-family="Arial,sans-serif" font-size="${s?13:10}px" letter-spacing="2">VANINA BUZZACCHI · INMUEBLES</text>
</svg></body></html>`;
}

// ─── Template estándar (luxury / clean / modern) ───
function buildVideoHTML({ titulo, zona, precio, cta, telefono, tipo, estilo, imagenUrl, content, neonM2, neonLotes, neonPalabra }) {
  if (estilo === "neon") return buildNeonHTML({ titulo, zona, precio, cta, telefono, tipo, imagenUrl, content, neonM2, neonLotes, neonPalabra });
  const pal  = getPaleta(estilo);
  const dims = tipo === "story" ? { w:540, h:960 } : { w:540, h:540 };
  const s    = tipo === "story";
  const imgTag = imagenUrl ? `<div class="bgi" style="background-image:url('${imagenUrl}')"></div>` : `<div class="bgg"></div>`;
  const bullets = (content.bullets || []).map(b => `<div class="bullet"><span class="bi">✓</span><span>${escapeHtml(b)}</span></div>`).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:${pal.font};background:${pal.bg};width:${dims.w}px;height:${dims.h}px;overflow:hidden;position:relative}.bgi{position:absolute;inset:0;background-size:cover;background-position:center;z-index:0}.bgg{position:absolute;inset:0;background:linear-gradient(135deg,${pal.bg} 0%,${pal.bg2} 100%);z-index:0}.ov{position:absolute;inset:0;background:${pal.overlay};z-index:1}.cnt{position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:${s?"40px 32px 60px":"30px"}}.dl{width:0;height:3px;background:${pal.accent};margin-bottom:16px;animation:el .6s ease .1s forwards}.badge{display:inline-block;background:${pal.accent};color:${pal.accentText};font-size:${s?"15px":"11px"};font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:6px 14px;border-radius:4px;margin-bottom:16px;opacity:0;animation:fu .6s ease .3s forwards}.hl{color:${pal.text};font-size:${s?"44px":"33px"};font-weight:700;line-height:1.05;margin-bottom:12px;opacity:0;animation:fu .6s ease .5s forwards}.shl{color:${pal.accent};font-size:${s?"22px":"17px"};margin-bottom:18px;opacity:0;animation:fu .6s ease .7s forwards}.bullets{margin-bottom:20px;opacity:0;animation:fu .6s ease .9s forwards}.bullet{display:flex;align-items:center;gap:8px;margin-bottom:8px}.bi{color:${pal.accent};font-size:${s?"18px":"13px"};font-weight:700;flex-shrink:0}.bullet span:last-child{color:${pal.text};font-size:${s?"17px":"12px"}}.pb{margin-bottom:20px;opacity:0;animation:fu .6s ease 1s forwards}.pl{font-size:${s?"13px":"10px"};color:${pal.muted};text-transform:uppercase;letter-spacing:.12em;margin-bottom:4px}.pv{font-size:${s?"34px":"25px"};font-weight:700;color:${pal.accent}}.ctab{border-top:2px solid ${pal.accent};padding-top:16px;opacity:0;animation:fu .6s ease 1.2s forwards}.ctxt{font-size:${s?"19px":"14px"};color:${pal.text};font-weight:600}.ctel{font-size:${s?"17px":"12px"};color:${pal.accent};font-weight:700;margin-top:4px}.logo{font-size:${s?"13px":"10px"};color:${pal.muted};letter-spacing:.18em;text-transform:uppercase;margin-top:8px}@keyframes fu{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes el{from{width:0;opacity:0}to{width:50px;opacity:1}}</style></head><body>
${imgTag}<div class="ov"></div><div class="cnt"><div class="dl"></div><div class="badge">${escapeHtml(zona||"Río Cuarto")}</div><div class="hl">${escapeHtml(content.headline||titulo)}</div><div class="shl">${escapeHtml(content.subheadline||"")}</div><div class="bullets">${bullets}</div>${precio?`<div class="pb"><div class="pl">Precio</div><div class="pv">${escapeHtml(precio)}</div></div>`:""}<div class="ctab"><div class="ctxt">${escapeHtml(cta)}</div>${telefono?`<div class="ctel">${escapeHtml(telefono)}</div>`:""}<div class="logo">Vanina Buzzacchi · Inmuebles</div></div></div></body></html>`;
}

// ─── Claude: generar contenido ───
async function llamarClaude({ titulo, zona, precio, descripcion, tono, cta, telefono, tipo, anthropicKey }) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type":"application/json","x-api-key":anthropicKey,"anthropic-version":"2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: "Experto en marketing inmobiliario. Español argentino. Respondés SOLO con JSON válido, sin backticks ni texto extra.",
      messages: [{ role:"user", content:
`Video ${tipo==="story"?"Story 9:16":"Post 1:1"} para propiedad:
Título: ${titulo}, Zona: ${zona||"Río Cuarto"}, Precio: ${precio||"A consultar"}, Descripción: ${descripcion||""}, Tono: ${tono}, CTA: ${cta}, Tel: ${telefono||""}
Respondé con este JSON exacto:
{"guion":"80-120 palabras","headline":"max 6 palabras","subheadline":"max 10 palabras","bullets":["feat1","feat2","feat3"],"captions":[{"ts":"0:00","texto":"..."},{"ts":"0:04","texto":"..."},{"ts":"0:08","texto":"..."},{"ts":"0:12","texto":"..."},{"ts":"0:18","texto":"..."},{"ts":"0:24","texto":"CTA"}],"musicaPrompt":"prompt inglés Suno 30-50 palabras"}`
      }]
    })
  });
  const d = await resp.json();
  if (d.error) throw new Error("Claude: " + d.error.message);
  const raw = d.content?.[0]?.text || "{}";
  return JSON.parse(raw.replace(/```json|```/g,"").trim());
}

// ─── Replicate: renderizar HTML → MP4 ───
async function renderizarConReplicate({ htmlContent, tipo, duracionSeg = 28 }) {
    const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("Falta REPLICATE_API_TOKEN en variables de entorno de Vercel");

  const dims = tipo === "story" ? { w:540, h:960 } : { w:540, h:540 };
  const htmlBase64 = Buffer.from(htmlContent).toString("base64");

  const prediction = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { "Authorization":`Token ${token}`, "Content-Type":"application/json" },
    body: JSON.stringify({
      version: "5c7d5dc6dd8bf75c1acaa8565735e7986bc5b66206b55cca93cb72c9bf15ccaa",
      input: { html_content: htmlBase64, width: dims.w, height: dims.h, duration: duracionSeg, fps: 12, format: "mp4" }
    })
  });

  if (!prediction.ok) throw new Error("Replicate error: " + await prediction.text());
  const predData = await prediction.json();
  const predId   = predData.id;
  if (!predId) throw new Error("Replicate no devolvió ID de predicción");

  // Polling hasta que termine (máx 3 minutos)
  const start = Date.now();
  while (Date.now() - start < 180000) {
    await new Promise(r => setTimeout(r, 3000));
    const poll     = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, { headers:{ "Authorization":`Token ${token}` } });
    const pollData = await poll.json();
    if (pollData.status === "succeeded") {
      const url = Array.isArray(pollData.output) ? pollData.output[0] : pollData.output;
      if (!url) throw new Error("Replicate terminó sin URL de video");
      return url;
    }
    if (pollData.status === "failed" || pollData.status === "canceled") {
      throw new Error("Replicate falló: " + (pollData.error || pollData.status));
    }
  }
  throw new Error("Replicate timeout — render tardó más de 3 minutos");
}

async function subirVideoASupabase(videoUrl, filename) {
    const videoResp = await fetch(videoUrl);
  if (!videoResp.ok) throw new Error("No se pudo descargar el video de Replicate");
  const buffer = Buffer.from(await videoResp.arrayBuffer());
  const publicUrl = await subirASupabase(buffer, filename, "video/mp4");
  if (!publicUrl) throw new Error("Error subiendo a Supabase Storage");
  return publicUrl;
}

// ─── RUTA 1: Generar guión + HTML (~3s) ───
app.post("/api/generar-video", async (req, res) => {
  const { titulo, zona, precio, descripcion, tono, cta, telefono, tipo, estilo, imagenUrl, neonM2, neonLotes, neonPalabra } = req.body;
  if (!titulo) return res.status(400).json({ ok:false, error:"Falta título" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ ok:false, error:"Falta ANTHROPIC_API_KEY" });
  try {
    const content = await llamarClaude({ titulo, zona, precio, descripcion, tono, cta, telefono, tipo, anthropicKey:key });
    const html    = buildVideoHTML({ titulo, zona, precio, cta, telefono, tipo, estilo, imagenUrl, content, neonM2, neonLotes, neonPalabra });
    res.json({ ok:true, html, guion:content.guion||"", captions:content.captions||[], musicaPrompt:content.musicaPrompt||"" });
  } catch(e) {
    console.error("[generar-video]", e.message);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ─── RUTA 2: Renderizar HTML → MP4 via Replicate (~60-120s) ───
app.post("/api/render-video", async (req, res) => {
  const { html, tipo = "story", duracion = 28 } = req.body;
  if (!html) return res.status(400).json({ ok:false, error:"Falta HTML" });
  try {
    console.log("[render-video] Enviando a Replicate…");
    const replicateUrl = await renderizarConReplicate({ htmlContent: html, tipo, duracionSeg: duracion });
    console.log("[render-video] Subiendo a Supabase…");
    const publicUrl = await subirVideoASupabase(replicateUrl, `video-${Date.now()}.mp4`);
    res.json({ ok:true, url: publicUrl });
  } catch(e) {
    console.error("[render-video]", e.message);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ─── RUTA 3: Todo en uno — Claude + Replicate + Supabase ───
app.post("/api/generar-y-renderizar", async (req, res) => {
  const { titulo, zona, precio, descripcion, tono, cta, telefono,
          tipo="story", estilo="luxury", imagenUrl, duracion=28,
          neonM2, neonLotes, neonPalabra } = req.body;
  if (!titulo) return res.status(400).json({ ok:false, error:"Falta título" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(400).json({ ok:false, error:"Falta ANTHROPIC_API_KEY" });
  try {
    console.log("[gen-render] Paso 1: Claude…");
    const content = await llamarClaude({ titulo, zona, precio, descripcion, tono, cta, telefono, tipo, anthropicKey:key });
    const html    = buildVideoHTML({ titulo, zona, precio, cta, telefono, tipo, estilo, imagenUrl, content, neonM2, neonLotes, neonPalabra });
    console.log("[gen-render] Paso 2: Replicate…");
    const replicateUrl = await renderizarConReplicate({ htmlContent: html, tipo, duracionSeg: duracion });
    console.log("[gen-render] Paso 3: Supabase…");
    const publicUrl = await subirVideoASupabase(replicateUrl, `video-${Date.now()}.mp4`);
    res.json({ ok:true, url:publicUrl, html, guion:content.guion||"", captions:content.captions||[], musicaPrompt:content.musicaPrompt||"" });
  } catch(e) {
    console.error("[gen-render]", e.message);
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ============================================================
// FIN — GENERADOR DE VIDEO IA

setInterval(() => {
  const port = process.env.PORT || 10000;
  http.get(`http://localhost:${port}/ping`, () => {}).on("error", () => {});
}, 4 * 60 * 1000);

// =========================
// MULTER + SUBIDA A SUPABASE
// =========================
const upload = multer({ storage: multer.memoryStorage() });

const BUCKET = "Subidas"; // nombre exacto del bucket en Supabase (case-sensitive)

async function subirASupabase(buffer, name, type) {
  // Sanitizar nombre y guardarlo dentro de la subcarpeta "Subidas/"
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename  = `Subidas/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType: type, upsert: true });

  if (error) {
    console.error("Storage error:", error.message);
    return null;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

// =========================
// MAPPERS
// =========================
function sbToInm(r) {
  return {
    id:                  r.id,
    titulo:              r.titulo,
    zona:                r.zona,
    tipoOperacion:       r.tipo_operacion,
    tipoPropiedad:       r.tipo_propiedad,
    direccion:           r.direccion,
    precio:              r.precio,
    moneda:              r.moneda,
    dormitorios:         r.dormitorios,
    banos:               r.banos,
    m2Totales:           r.m2_totales,
    m2Cubiertos:         r.m2_cubiertos,
    descripcion:         r.descripcion,
    propietario:         r.propietario,
    telefonoPropietario: r.telefono_propietario,
    scriptVenta:         r.script_venta,
    mapsUrl:             r.maps_url,
    mediaUrls:           r.media_urls,
    imagenes:            Array.isArray(r.imagenes) ? r.imagenes : [],
    estadoPublicacion:   r.estado_publicacion || "borrador",
    rating:              r.rating,
    origen:              r.origen,
    linkPublicacion:     r.link_publicacion,
    thumbUrl:            r.thumb_url,
    cantidadPublicaciones: r.cantidad_publicaciones || 0,
  };
}

function inmToSb(i) {
  const o = {};
  const set = (k, v) => { if (v !== undefined && v !== "") o[k] = v; };
  set("titulo",              i.titulo);
  set("zona",                i.zona);
  set("tipo_operacion",      i.tipoOperacion);
  set("tipo_propiedad",      i.tipoPropiedad);
  set("direccion",           i.direccion);
  if (i.precio !== undefined) o.precio = i.precio ? parseFloat(i.precio) : null;
  set("moneda",              i.moneda);
  if (i.dormitorios !== undefined) o.dormitorios = i.dormitorios ? parseInt(i.dormitorios) : null;
  if (i.banos !== undefined)       o.banos = i.banos ? parseInt(i.banos) : null;
  if (i.m2Totales !== undefined)   o.m2_totales = i.m2Totales ? parseFloat(i.m2Totales) : null;
  if (i.m2Cubiertos !== undefined) o.m2_cubiertos = i.m2Cubiertos ? parseFloat(i.m2Cubiertos) : null;
  set("descripcion",         i.descripcion);
  set("propietario",         i.propietario);
  set("telefono_propietario",i.telefonoPropietario);
  set("script_venta",        i.scriptVenta);
  set("maps_url",            i.mapsUrl);
  set("media_urls",          i.mediaUrls);
  if (i.imagenes !== undefined) o.imagenes = i.imagenes;
  set("estado_publicacion",  i.estadoPublicacion);
  return o;
}

// =========================
// AUTH
// =========================
const USUARIOS = [
  { email: "admin@inmo.com",     password: process.env.ADMIN_PASSWORD || "1234", rol: "admin"     },
  { email: "mariano@inmo.com",   password: "1234",                               rol: "admin"     },
  { email: "vanina@inmo.com",    password: "1234",                               rol: "admin"     },
  { email: "catalina@inmo.com",  password: "1234",                               rol: "agente"    },
  { email: "marketing@inmo.com", password: "1234",                               rol: "marketing" },
];

app.post("/login", (req, res) => {
  const u = USUARIOS.find(x => x.email === req.body.email && x.password === req.body.password);
  if (!u) return res.redirect("/login?error=1");
  req.session.user = u;
  res.redirect("/dashboard");
});

// =========================
// INMUEBLES
// =========================
app.get("/api/inmuebles", async (req, res) => {
  try {
    const { data, error } = await supabase.from("inmuebles").select("*").order("id", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(sbToInm));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/inmuebles-publicos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("inmuebles").select("*")
      .in("estado_publicacion", ["lista", "publicada"])
      .order("id", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(sbToInm));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/inmuebles/:id", async (req, res) => {
  try {
    const { data, error } = await supabase.from("inmuebles").select("*").eq("id", req.params.id).single();
    if (error) return res.status(404).json({ error: "No encontrado" });
    res.json(sbToInm(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/guardar", upload.fields([{ name: "imagenes" }, { name: "video" }]), async (req, res) => {
  try {
    const imgs = [];
    for (const f of (req.files?.imagenes || [])) {
      const url = await subirASupabase(f.buffer, f.originalname, f.mimetype);
      if (url) imgs.push(url);
    }
    let videoUrl = null;
    if (req.files?.video?.[0]) {
      const vf = req.files.video[0];
      videoUrl = await subirASupabase(vf.buffer, vf.originalname, vf.mimetype);
    }
    const payload = inmToSb({ ...req.body, imagenes: imgs, estadoPublicacion: "borrador" });
    if (videoUrl) payload.video_url = videoUrl;
    const { error } = await supabase.from("inmuebles").insert([payload]);
    if (error) { console.error("Error guardando:", error.message); return res.status(500).send("Error: " + error.message); }
    pushNotif({ tipo: "nuevo_inmueble", titulo: req.body.titulo, zona: req.body.zona });
    res.redirect("/dashboard.html");
  } catch (e) { console.error(e); res.status(500).send("Error interno"); }
});

app.put("/api/inmuebles/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("inmuebles").update(inmToSb(req.body)).eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /editar/:id — form submit desde editar.html
app.post("/editar/:id", upload.fields([{ name: "imagenes" }]), async (req, res) => {
  try {
    const id = req.params.id;

    // Subir fotos nuevas si las hay
    const nuevasFotos = [];
    for (const f of (req.files?.imagenes || [])) {
      const url = await subirASupabase(f.buffer, f.originalname, f.mimetype);
      if (url) nuevasFotos.push(url);
    }

    // Reconstruir lista de imágenes: las que ya existían (nombresImagenes) + nuevas
    let imagenesExistentes = req.body.nombresImagenes || [];
    if (!Array.isArray(imagenesExistentes)) imagenesExistentes = [imagenesExistentes];
    const imagenes = [...imagenesExistentes, ...nuevasFotos];

    const payload = {
      titulo:      req.body.titulo?.trim()      || null,
      precio:      req.body.precio              ? parseFloat(req.body.precio) : null,
      descripcion: req.body.descripcion?.trim() || null,
      imagenes:    imagenes,
    };

    const { error } = await supabase.from("inmuebles").update(payload).eq("id", id);
    if (error) {
      console.error("Error editando inmueble:", error.message);
      return res.status(500).send("Error al guardar: " + error.message);
    }
    res.redirect("/ver.html?id=" + id);
  } catch (e) {
    console.error("Error en POST /editar:", e.message);
    res.status(500).send("Error interno: " + e.message);
  }
});

// POST /editar/:id/fotos/eliminar — eliminar foto individual (fotos en /uploads/ locales)
app.post("/editar/:id/fotos/eliminar", async (req, res) => {
  try {
    const id = req.params.id;
    const nombreFoto = req.body.nombreFoto;
    if (!nombreFoto) return res.status(400).json({ error: "nombreFoto requerido" });

    // Quitar de la lista en Supabase
    const { data } = await supabase.from("inmuebles").select("imagenes").eq("id", id).single();
    let imgs = Array.isArray(data?.imagenes) ? data.imagenes : [];
    imgs = imgs.filter(i => i !== nombreFoto);
    await supabase.from("inmuebles").update({ imagenes: imgs }).eq("id", id);

    // Si es archivo local, borrar del disco
    const localPath = path.join(__dirname, "uploads", nombreFoto);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/inmuebles/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("inmuebles").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Acciones de estado
async function cambiarEstado(id, estado, res) {
  try {
    const updates = { estado_publicacion: estado };
    if (estado === "publicada") {
      const { data: curr } = await supabase.from("inmuebles").select("cantidad_publicaciones").eq("id", id).single();
      updates.cantidad_publicaciones = ((curr?.cantidad_publicaciones || 0) + 1);
    }
    const { error } = await supabase.from("inmuebles").update(updates).eq("id", id);
    if (error) return res.status(500).send("Error: " + error.message);
    pushNotif({ tipo: "estado_" + estado, id: Number(id) });
    res.redirect("/dashboard.html");
  } catch (e) { res.status(500).send("Error interno"); }
}

app.post("/publicar/:id",  (req, res) => cambiarEstado(req.params.id, "lista",     res));
app.post("/publicada/:id", (req, res) => cambiarEstado(req.params.id, "publicada", res));
app.post("/vendida/:id",   (req, res) => cambiarEstado(req.params.id, "vendida",   res));
app.post("/alquilada/:id", (req, res) => cambiarEstado(req.params.id, "alquilada", res));
app.post("/eliminar/:id",  async (req, res) => {
  try {
    await supabase.from("inmuebles").delete().eq("id", req.params.id);
    res.redirect("/dashboard.html");
  } catch { res.redirect("/dashboard.html"); }
});

// =========================
// OPORTUNIDADES
// =========================
app.post("/oportunidad", upload.single("thumb"), async (req, res) => {
  try {
    let thumbUrl = null;
    if (req.file) thumbUrl = await subirASupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    const payload = {
      titulo: req.body.titulo, origen: req.body.origen,
      link_publicacion: req.body.linkPublicacion, tipo_operacion: req.body.tipoOperacion,
      tipo_propiedad: req.body.tipoPropiedad, zona: req.body.zona, direccion: req.body.direccion,
      precio: req.body.precio ? parseFloat(req.body.precio) : null, moneda: req.body.moneda || "USD",
      dormitorios: req.body.dormitorios ? parseInt(req.body.dormitorios) : null,
      banos: req.body.banos ? parseInt(req.body.banos) : null,
      descripcion: req.body.descripcion, thumb_url: thumbUrl, estado: "nueva",
    };
    const { error } = await supabase.from("oportunidades").insert([payload]);
    if (error) console.error("Error oportunidad:", error.message);
    else pushNotif({ tipo: "nueva_oportunidad", titulo: payload.titulo });
    res.redirect("/dashboard.html");
  } catch { res.redirect("/dashboard.html"); }
});

app.get("/api/oportunidades", async (req, res) => {
  try {
    const { data, error } = await supabase.from("oportunidades").select("*").order("id", { ascending: false });
    if (error) return res.json([]);
    res.json(data || []);
  } catch { res.json([]); }
});

// =========================
// LEADS
// =========================
app.post("/api/leads", async (req, res) => {
  try {
    const lead = { ...req.body, estado: req.body.estado || "nuevo", created_at: new Date().toISOString() };
    const { error } = await supabase.from("leads").insert([lead]);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    pushNotif({ tipo: "nuevo_lead", titulo: lead.nombre || "Lead nuevo" });
    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/leads", async (req, res) => {
  try {
    const { data, error } = await supabase.from("leads").select("*").order("id", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/leads/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("leads").update(req.body).eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =========================
// COMPRADORES
// =========================
app.get("/api/compradores", async (req, res) => {
  try {
    const { data, error } = await supabase.from("compradores").select("*").order("id", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/compradores", async (req, res) => {
  try {
    const { error } = await supabase.from("compradores").insert([req.body]);
    if (error) return res.status(500).json({ error: error.message });
    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/compradores/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("compradores").update(req.body).eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =========================
// DEMANDAS
// =========================
app.get("/api/demandas", async (req, res) => {
  try {
    const { data, error } = await supabase.from("demandas").select("*").order("id", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/demandas", async (req, res) => {
  try {
    const { error } = await supabase.from("demandas").insert([req.body]);
    if (error) return res.status(500).json({ error: error.message });
    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/match-demanda/:id", async (req, res) => {
  try {
    const { data: d } = await supabase.from("demandas").select("*").eq("id", req.params.id).single();
    const { data: inm } = await supabase.from("inmuebles").select("*");
    const matches = (inm || []).map(sbToInm).filter(i => i.zona?.toLowerCase().includes((d?.zona || "").toLowerCase()));
    res.json({ matches });
  } catch { res.json({ matches: [] }); }
});

// =========================
// NOTIFICACIONES
// =========================
app.get("/api/notificaciones", (req, res) => {
  const since = parseInt(req.query.since || "0");
  const items = notificaciones.filter(n => Number(n.ts || 0) > since);
  res.json({ items, total: notificaciones.length });
});

app.post("/api/notificaciones/leer", (req, res) => {
  notificaciones = notificaciones.map(n => ({ ...n, leida: true }));
  guardarNotifs();
  res.redirect("/dashboard");
});

// =========================
// RATING
// =========================
app.post("/api/rating", async (req, res) => {
  try {
    const { propiedad_id, rating } = req.body;
    await supabase.from("inmuebles").update({ rating }).eq("id", propiedad_id);
    res.redirect("/dashboard");
  } catch (e) { res.status(500).json({ ok: false }); }
});

// =========================
// RADAR IA
// =========================
const radarIA = [];
app.post("/api/radar-ia", (req, res) => { radarIA.push({ ...req.body, ts: Date.now() }); res.redirect("/dashboard"); });
app.get("/api/radar-ia",  (_, res) => res.json(radarIA));

// =========================
// TRANSCRIPCIÓN
// =========================
app.post("/api/transcribir-audio", upload.single("audio"), async (req, res) => {
  try {
    const stream = require("stream").Readable.from(req.file.buffer);
    stream.path = "audio.webm";
    const r = await openai.audio.transcriptions.create({ file: stream, model: "whisper-1", language: "es" });
    res.json({ ok: true, texto: r.text });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// =========================
// PDF FICHA
// =========================
app.get("/api/ficha-pdf/:id", async (req, res) => {
  try {
    const { data } = await supabase.from("inmuebles").select("*").eq("id", req.params.id).single();
    const p = sbToInm(data);
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="ficha-${p.id}.pdf"`);
    doc.pipe(res);
    doc.fontSize(22).fillColor("#0e6b4d").text(p.titulo || "Sin título");
    doc.moveDown(0.5).fontSize(13).fillColor("#333");
    if (p.zona)          doc.text(`Zona: ${p.zona}`);
    if (p.tipoOperacion) doc.text(`Operación: ${p.tipoOperacion}`);
    if (p.precio)        doc.text(`Precio: ${p.moneda || "USD"} ${Number(p.precio).toLocaleString("es-AR")}`);
    if (p.dormitorios)   doc.text(`Dormitorios: ${p.dormitorios}`);
    if (p.banos)         doc.text(`Baños: ${p.banos}`);
    if (p.descripcion)   { doc.moveDown(); doc.fontSize(12).text(p.descripcion); }
    doc.end();
  } catch (e) { res.status(500).json({ error: "Error generando PDF" }); }
});

// =========================
// FAQs y OBJECIONES
// =========================
app.get("/api/faqs", async (req, res) => {
  try {
    const { data } = await supabase.from("Preguntas frecuentes").select("*");
    res.json(Array.isArray(data) ? data : []);
  } catch { res.json([]); }
});

app.get("/api/objeciones", async (req, res) => {
  try {
    const { data } = await supabase.from("Objeciones").select("*");
    res.json(Array.isArray(data) ? data : []);
  } catch { res.json([]); }
});

// =========================
// CATA CHAT
// Usa Anthropic si hay clave, sino OpenAI
// Siempre devuelve formato Anthropic { content: [{type:"text", text:"..."}] }
// =========================
// Helper: https.request como Promise (compatible Node 14/16/18+)
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    const options = {
      hostname, path, method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(bodyStr) }
    };
    const req = https.request(options, (r) => {
      let raw = "";
      r.on("data", chunk => raw += chunk);
      r.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error("JSON parse error: " + raw.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

app.post("/api/cata-chat", async (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey    = process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    try {
      const { system, messages } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "messages es requerido y debe ser un array" });
      }

      const data = await httpsPost(
        "api.anthropic.com",
        "/v1/messages",
        {
          "Content-Type":      "application/json",
          "x-api-key":         anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        { model: "claude-haiku-4-5-20251001", max_tokens: 600, system, messages }
      );

      console.log("Anthropic response type:", data && data.type, "| error:", data && data.error);

      if (data && !data.error) return res.json(data);

      console.error("Anthropic API error completo:", JSON.stringify(data && data.error || data));
      return res.status(500).json({ error: (data && data.error && data.error.message) || "Error en Anthropic API" });

    } catch (e) {
      console.error("Anthropic https error:", e.message);
      return res.status(500).json({ error: "Error conectando con Anthropic: " + e.message });
    }
  }

  if (openaiKey) {
    const { messages, system, mensaje, historial, propiedad } = req.body || {};
    const userMsg = mensaje || (Array.isArray(messages) ? messages[messages.length - 1]?.content : null);
    if (!userMsg) return res.status(400).json({ error: "Sin mensaje" });
    try {
      const sysCtx = system || (propiedad
        ? `Sos Cata, asistente de Vanina Buzzacchi en Río Cuarto. Propiedad: ${propiedad.titulo} · ${propiedad.zona} · ${propiedad.moneda} ${propiedad.precio}. Si capturás nombre + contacto, terminá con LEAD_CAPTURADO.`
        : "Sos Cata, asistente de Vanina Buzzacchi Negocios Inmobiliarios en Río Cuarto. Respondé en español, máximo 3 oraciones.");
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: sysCtx },
          ...(historial || (Array.isArray(messages) ? messages.slice(0, -1) : [])),
          { role: "user", content: userMsg }
        ],
        max_tokens: 300,
        temperature: 0.7
      });
      const text = completion.choices[0].message.content.trim();
      // Devolver siempre en formato Anthropic para que el funnel lo entienda
      return res.json({ content: [{ type: "text", text }] });
    } catch (e) {
      console.error("OpenAI error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(500).json({ error: "No hay API key configurada" });
});

// =========================
// BUSCADOR IA DEL FUNNEL
// =========================
app.post("/api/match-ia", async (req, res) => {
  const { consulta, presupuesto, operacion } = req.body;
  if (!consulta) return res.status(400).json({ ok: false, error: "Falta consulta" });

  try {
    // Traer todos los inmuebles publicados
    const { data: inmuebles, error } = await supabase
      .from("inmuebles")
      .select("id, titulo, zona, tipo_operacion, tipo_propiedad, precio, dormitorios, banos, descripcion, superficie_total")
      .eq("estado_publicacion", "publicado")
      .limit(100);

    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!inmuebles || !inmuebles.length) return res.json({ ok: true, ids: [], scores: {} });

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      // Sin IA — filtro simple por texto
      const q = consulta.toLowerCase();
      const filtrados = inmuebles.filter(p =>
        (p.titulo       || "").toLowerCase().includes(q) ||
        (p.zona         || "").toLowerCase().includes(q) ||
        (p.descripcion  || "").toLowerCase().includes(q)
      );
      const scores = {};
      filtrados.forEach((p, i) => { scores[p.id] = Math.max(70, 95 - i * 4); });
      return res.json({ ok: true, ids: filtrados.map(p => p.id), scores });
    }

    // Con IA — Claude analiza y rankea
    const listaTexto = inmuebles.map(p =>
      `ID:${p.id} | ${p.titulo} | ${p.zona || "—"} | ${p.tipo_operacion} | ${p.tipo_propiedad} | USD ${p.precio || "consultar"} | ${p.dormitorios || 0} dorm | ${p.descripcion?.slice(0, 80) || ""}`
    ).join("\n");

    const prompt = `El usuario busca: "${consulta}"${presupuesto ? ` con presupuesto máximo USD ${presupuesto}` : ""}${operacion && operacion !== "todos" ? `, operación: ${operacion}` : ""}.

Lista de propiedades disponibles:
${listaTexto}

Analizá cuáles propiedades coinciden mejor con lo que busca el usuario. Devolvé SOLO un JSON con este formato exacto, sin texto adicional:
{"ids":[id1,id2,id3],"scores":{"id1":95,"id2":87,"id3":72}}

Incluí solo las propiedades que realmente coinciden (máximo 8). Los scores son de 0 a 100.`;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const aiData = await resp.json();
    const texto = aiData.content?.[0]?.text || "{}";
    const clean = texto.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    res.json({ ok: true, ids: parsed.ids || [], scores: parsed.scores || {} });
  } catch(e) {
    console.error("Match IA error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =========================
// TOUR VIRTUAL — guardar meta
// =========================
app.post("/api/inmuebles/:id/tour-meta", async (req, res) => {
  const { id } = req.params;
  const { tourMeta } = req.body;
  if (!tourMeta) return res.status(400).json({ ok: false, error: "Falta tourMeta" });
  try {
    const { error } = await supabase
      .from("inmuebles")
      .update({ tour_meta: tourMeta })
      .eq("id", id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Ruta de página tour
app.get("/tour-virtual",      (_, res) => res.sendFile(path.join(__dirname, "Público", "tour-virtual.html")));
app.get("/tour-virtual.html", (_, res) => res.sendFile(path.join(__dirname, "Público", "tour-virtual.html")));

// =========================
// IMPORTAR DESDE GOOGLE DRIVE
// =========================

function extraerFolderIdDrive(url) {
  const m = url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m2) return m2[1];
  return null;
}

app.post("/api/drive-listar", async (req, res) => {
  const { linkDrive } = req.body;
  if (!linkDrive) return res.status(400).json({ ok: false, error: "Falta el link de Drive" });

  const folderId = extraerFolderIdDrive(linkDrive);
  if (!folderId) return res.status(400).json({ ok: false, error: "No se pudo extraer el ID de la carpeta." });

  try {
    const url = `https://drive.google.com/drive/folders/${folderId}`;
    const resp = await (await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CRM-Buzzacchi/1.0)" }
    })).text();

    const imageIds = [];
    const seen = new Set();
    const re2 = /\/file\/d\/([a-zA-Z0-9_-]{25,})\//g;
    const re3 = /\["([a-zA-Z0-9_-]{25,})","[^"]*","(?:image\/jpeg|image\/png|image\/webp)"/g;
    let m;
    while ((m = re2.exec(resp)) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); imageIds.push(m[1]); }
    }
    while ((m = re3.exec(resp)) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); imageIds.push(m[1]); }
    }

    if (imageIds.length === 0) {
      return res.json({ ok: true, folderId, fotos: [], mensaje: "La carpeta está vacía o no es pública." });
    }

    const fotos = imageIds.slice(0, 20).map(id => ({
      id,
      thumbUrl:    `https://drive.google.com/thumbnail?id=${id}&sz=w400`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`
    }));

    // Extraer nombre sugerido de la carpeta desde el HTML
    const tituloMatch = resp.match(/<title>([^<]+)<\/title>/);
    const tituloSugerido = tituloMatch ? tituloMatch[1].replace(" - Google Drive", "").trim() : "";

    res.json({ ok: true, folderId, fotos, total: imageIds.length, tituloSugerido });
  } catch (e) {
    console.error("Drive listar error:", e.message);
    res.status(500).json({ ok: false, error: "Error accediendo a Drive: " + e.message });
  }
});

app.post("/api/drive-importar", async (req, res) => {
  const { fotoIds, titulo, zona, tipoOperacion, tipoPropiedad, precio, moneda, dormitorios, banos, descripcion } = req.body;
  if (!fotoIds || !fotoIds.length) return res.status(400).json({ ok: false, error: "No hay fotos seleccionadas" });

  try {
    const imagenesSubidas = [];

    for (const fileId of fotoIds.slice(0, 15)) {
      try {
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        const r = await fetch(downloadUrl, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
        if (!r.ok) continue;
        const buffer = await r.buffer();
        const contentType = r.headers.get("content-type") || "image/jpeg";
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const filename = `drive-${fileId}-${Date.now()}.${ext}`;
        const uploadUrl = await subirASupabase(buffer, filename, contentType);
        if (uploadUrl) imagenesSubidas.push(uploadUrl);
      } catch (e) { console.warn("Error foto", fileId, e.message); }
    }

    if (!imagenesSubidas.length) return res.status(400).json({ ok: false, error: "No se pudo importar ninguna foto." });

    const payload = inmToSb({
      titulo: titulo || "Inmueble importado desde Drive",
      zona: zona || "", tipoOperacion: tipoOperacion || "venta",
      tipoPropiedad: tipoPropiedad || "casa", precio: precio || null,
      moneda: moneda || "USD", dormitorios: dormitorios || null,
      banos: banos || null, descripcion: descripcion || "",
      imagenes: imagenesSubidas, estadoPublicacion: "borrador"
    });

    const { data, error } = await supabase.from("inmuebles").insert([payload]).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });

    pushNotif({ tipo: "nuevo_inmueble", titulo: payload.titulo, zona: payload.zona });
    res.json({ ok: true, inmuebleId: data.id, fotosImportadas: imagenesSubidas.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/importar-drive",      (_, res) => res.sendFile(path.join(__dirname, "Público", "importar-drive.html")));
app.get("/importar-drive.html", (_, res) => res.sendFile(path.join(__dirname, "Público", "importar-drive.html")));

// =========================
// RADAR PROSPECTOS
// =========================

// Perfiles predefinidos de búsqueda
const PERFILES_PROSPECTOS = {
  propietarios: [
    "inmobiliaria", "escribanía", "estudio juridico", "contador", "arquitecto",
    "constructora", "empresa constructora", "desarrolladora inmobiliaria"
  ],
  servicios: [
    "constructora", "desarrolladora", "empresa construccion", "carpinteria",
    "electricista", "plomero", "pintor", "decoradora", "muebleria", "cerrajeria",
    "empresa de mudanzas", "storage deposito"
  ]
};

// Buscar prospectos usando Google Places API
app.post("/api/radar-prospectos/buscar", async (req, res) => {
  const { sector, perfil, radio = 5000, lat = -33.1232, lng = -64.3493 } = req.body;
  // lat/lng default = Río Cuarto centro

  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleKey) {
    return res.status(400).json({
      ok: false,
      error: "Falta GOOGLE_PLACES_API_KEY en las variables de entorno de Render.",
      ayuda: "Conseguila gratis en console.cloud.google.com → Places API"
    });
  }

  const query = sector || (PERFILES_PROSPECTOS[perfil] || ["negocio"])[0];

  try {

    // Google Places Text Search
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + " Río Cuarto Córdoba Argentina")}&location=${lat},${lng}&radius=${radio}&key=${googleKey}&language=es`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return res.status(500).json({ ok: false, error: `Google Places error: ${data.status}`, detalle: data.error_message });
    }

    const resultados = (data.results || []).slice(0, 20).map(p => ({
      placeId:   p.place_id,
      nombre:    p.name,
      direccion: p.formatted_address || p.vicinity || "",
      rating:    p.rating || null,
      tipos:     p.types || [],
      lat:       p.geometry?.location?.lat,
      lng:       p.geometry?.location?.lng,
      tieneWeb:  false, // se completa con Place Details
      telefono:  null,
      web:       null,
      estado:    "nuevo"
    }));

    // Enriquecer con Place Details (teléfono + web) — hasta 10 para no gastar quota
    for (const r of resultados.slice(0, 10)) {
      try {
        const det = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${r.placeId}&fields=formatted_phone_number,website&key=${googleKey}&language=es`);
        const detData = await det.json();
        const result = detData.result || {};
        r.telefono = result.formatted_phone_number || null;
        r.web      = result.website || null;
        r.tieneWeb = !!result.website;
      } catch(e) { /* sigue */ }
    }

    res.json({ ok: true, total: resultados.length, resultados, query });
  } catch(e) {
    console.error("Radar prospectos error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Generar mensaje WhatsApp personalizado con IA
app.post("/api/radar-prospectos/mensaje", async (req, res) => {
  const { nombre, sector, tieneWeb, perfil, servicio } = req.body;
  if (!nombre) return res.status(400).json({ ok: false, error: "Falta nombre" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(400).json({ ok: false, error: "Falta ANTHROPIC_API_KEY" });

  const esServicio = perfil === "servicios";

  const system = `Sos Vanina Buzzacchi, inmobiliaria en Río Cuarto. Escribís mensajes de WhatsApp cortos, cálidos y directos. Sin emojis en exceso. Máximo 4 líneas. Nunca mencionés que sos una IA.`;

  const prompt = esServicio
    ? `Generá un mensaje de WhatsApp para ofrecerle a "${nombre}" (${sector}) el servicio de tour virtual 360° y publicación en redes sociales para sus propiedades o proyectos. Mencioná que lo hacemos nosotros y que tienen resultados reales en Río Cuarto.`
    : `Generá un mensaje de WhatsApp para "${nombre}" (${sector}) preguntando si tienen propiedades para vender o alquilar. Ofrecé tasación gratuita y mencioná que trabajamos en Río Cuarto con resultados reales. ${!tieneWeb ? "No tienen página web, así que podés ofrecerles también mayor visibilidad digital." : ""}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await resp.json();
    const mensaje = data.content?.[0]?.text || "Hola! Te contactamos de Buzzacchi Inmuebles.";
    res.json({ ok: true, mensaje });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Guardar prospecto en Supabase
app.post("/api/radar-prospectos/guardar", async (req, res) => {
  const { nombre, telefono, web, direccion, sector, perfil, mensaje, estado = "nuevo" } = req.body;
  try {
    const { data, error } = await supabase
      .from("radar_prospectos")
      .insert([{ nombre, telefono, web, direccion, sector, perfil, mensaje, estado, creado_en: new Date().toISOString() }])
      .select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, id: data.id });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Listar prospectos guardados
app.get("/api/radar-prospectos/lista", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("radar_prospectos")
      .select("*")
      .order("creado_en", { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, items: data || [] });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Actualizar estado de prospecto
app.post("/api/radar-prospectos/estado", async (req, res) => {
  const { id, estado } = req.body;
  try {
    const { error } = await supabase
      .from("radar_prospectos")
      .update({ estado })
      .eq("id", id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Rutas de página
app.get("/radar-prospectos",      (_, res) => res.sendFile(path.join(__dirname, "Público", "radar-prospectos.html")));
app.get("/radar-prospectos.html", (_, res) => res.sendFile(path.join(__dirname, "Público", "radar-prospectos.html")));

// =========================
// HEALTH CHECK
// =========================
app.get("/health", (_, res) => {
  res.json({
    ok: true,
    supabase:  !!process.env.SUPABASE_URL,
    openai:    !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    uptime:    process.uptime(),
    ts:        new Date().toISOString(),
  });
});

// =========================
// SERVER START
// =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`\n✅ BUZZACCHI CRM — Puerto ${PORT}`);
  console.log(`🔗 Supabase:  ${process.env.SUPABASE_URL  ? "✅" : "❌ FALTA"}`);
  console.log(`🤖 OpenAI:    ${process.env.OPENAI_API_KEY  ? "✅" : "⚠️"}`);
  console.log(`🧠 Anthropic: ${process.env.ANTHROPIC_API_KEY ? "✅" : "⚠️"}`);
  console.log(`⏰ Keep-alive activo cada 4 min\n`);
});
