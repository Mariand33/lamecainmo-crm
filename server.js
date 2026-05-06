// ========================================
// SERVER.JS — BUZZACCHI CRM
// VERSIÓN DEFINITIVA — TODOS LOS BUGS CORREGIDOS
// ========================================

const express   = require("express");
const app       = express();
const multer    = require("multer");
const path      = require("path");
const fs        = require("fs");
const session   = require("express-session");
const cors      = require("cors");
const https     = require("https");
const http      = require("http");
const { createClient } = require("@supabase/supabase-js");
const OpenAI    = require("openai");
const PDFDocument = require("pdfkit");
const sharp     = require("sharp");

// =========================
// MIDDLEWARE — UNA SOLA VEZ
// =========================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: "buzzacchi2025", resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, "Público")));

// =========================
// RUTAS DE PÁGINAS HTML
// =========================
const PUB = path.join(__dirname, "Público");

app.get("/",                  (_, res) => res.sendFile(path.join(__dirname, "funnel-publico.html")));
app.get("/funnel",            (_, res) => res.sendFile(path.join(__dirname, "funnel-publico.html")));
app.get("/funnel-publico.html",(_, res)=> res.sendFile(path.join(__dirname, "funnel-publico.html")));
app.get("/dashboard",         (_, res) => res.sendFile(path.join(PUB, "dashboard.html")));
app.get("/dashboard.html",    (_, res) => res.sendFile(path.join(PUB, "dashboard.html")));

// =========================
// SUPABASE
// =========================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("❌ FATAL: Falta SUPABASE_URL o SUPABASE_KEY en variables de entorno (Render > Environment)");
}

const supabase = createClient(
  process.env.SUPABASE_URL  || "",
  process.env.SUPABASE_KEY  || ""
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

// =========================
// DATA LOCAL (notificaciones)
// =========================
const DATA_DIR   = path.join(__dirname, "data");
const NOTIF_FILE = path.join(DATA_DIR, "notificaciones.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let notificaciones = [];
try {
  const raw = fs.readFileSync(NOTIF_FILE, "utf8");
  notificaciones = JSON.parse(raw) || [];
} catch {}

function guardarNotifs() {
  fs.writeFileSync(NOTIF_FILE, JSON.stringify(notificaciones, null, 2));
}

function pushNotif(n) {
  const item = { id: Date.now(), ts: Date.now(), leida: false, ...n };
  notificaciones.unshift(item);
  if (notificaciones.length > 300) notificaciones.pop();
  guardarNotifs();
  return item;
}

// =========================
// MULTER — memoria
// =========================
const upload = multer({ storage: multer.memoryStorage() });

async function subirASupabase(buffer, name, type) {
  const filename = `${Date.now()}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await supabase.storage
    .from("SUBIDAS")
    .upload(filename, buffer, { contentType: type, upsert: false });
  if (error) { console.error("Supabase storage error:", error.message); return null; }
  const { data } = supabase.storage.from("SUBIDAS").getPublicUrl(filename);
  return data.publicUrl;
}

// =========================
// MAPPERS INMUEBLES
// =========================
function sbToInm(r) {
  return {
    id:                 r.id,
    titulo:             r.titulo,
    zona:               r.zona,
    tipoOperacion:      r.tipo_operacion,
    tipoPropiedad:      r.tipo_propiedad,
    direccion:          r.direccion,
    precio:             r.precio,
    moneda:             r.moneda,
    dormitorios:        r.dormitorios,
    banos:              r.banos,
    m2Totales:          r.m2_totales,
    m2Cubiertos:        r.m2_cubiertos,
    descripcion:        r.descripcion,
    propietario:        r.propietario,
    telefonoPropietario:r.telefono_propietario,
    scriptVenta:        r.script_venta,
    mapsUrl:            r.maps_url,
    mediaUrls:          r.media_urls,
    imagenes:           r.imagenes || [],
    estadoPublicacion:  r.estado_publicacion || "borrador",
    creadoPor:          r.creado_por,
    cantidadPublicaciones: r.cantidad_publicaciones || 0,
    rating:             r.rating,
    origen:             r.origen,
    linkPublicacion:    r.link_publicacion,
    thumbUrl:           r.thumb_url,
  };
}

function inmToSb(i) {
  const obj = {};
  if (i.titulo             !== undefined) obj.titulo              = i.titulo;
  if (i.zona               !== undefined) obj.zona                = i.zona;
  if (i.tipoOperacion      !== undefined) obj.tipo_operacion      = i.tipoOperacion;
  if (i.tipoPropiedad      !== undefined) obj.tipo_propiedad      = i.tipoPropiedad;
  if (i.direccion          !== undefined) obj.direccion           = i.direccion;
  if (i.precio             !== undefined) obj.precio              = i.precio ? parseFloat(i.precio) : null;
  if (i.moneda             !== undefined) obj.moneda              = i.moneda;
  if (i.dormitorios        !== undefined) obj.dormitorios         = i.dormitorios ? parseInt(i.dormitorios) : null;
  if (i.banos              !== undefined) obj.banos               = i.banos ? parseInt(i.banos) : null;
  if (i.m2Totales          !== undefined) obj.m2_totales          = i.m2Totales ? parseFloat(i.m2Totales) : null;
  if (i.m2Cubiertos        !== undefined) obj.m2_cubiertos        = i.m2Cubiertos ? parseFloat(i.m2Cubiertos) : null;
  if (i.descripcion        !== undefined) obj.descripcion         = i.descripcion;
  if (i.propietario        !== undefined) obj.propietario         = i.propietario;
  if (i.telefonoPropietario!== undefined) obj.telefono_propietario= i.telefonoPropietario;
  if (i.scriptVenta        !== undefined) obj.script_venta        = i.scriptVenta;
  if (i.mapsUrl            !== undefined) obj.maps_url            = i.mapsUrl;
  if (i.mediaUrls          !== undefined) obj.media_urls          = i.mediaUrls;
  if (i.imagenes           !== undefined) obj.imagenes            = i.imagenes;
  if (i.estadoPublicacion  !== undefined) obj.estado_publicacion  = i.estadoPublicacion;
  return obj;
}

// =========================
// AUTH
// =========================
const USUARIOS = [
  { email: "admin@inmo.com", password: process.env.ADMIN_PASSWORD || "1234", rol: "admin" },
];

app.post("/login", (req, res) => {
  const u = USUARIOS.find(x => x.email === req.body.email && x.password === req.body.password);
  if (!u) return res.status(401).json({ ok: false, error: "Credenciales incorrectas" });
  req.session.user = u;
  res.json({ ok: true });
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

// =========================
// PING — KEEP-ALIVE (fix: Render no se duerme)
// =========================
app.get("/ping", (_, res) => res.json({ ok: true, ts: Date.now(), uptime: process.uptime() }));

// Auto-ping interno cada 4 minutos
const SELF = process.env.RENDER_EXTERNAL_URL
  ? `https://${process.env.RENDER_EXTERNAL_URL.replace(/^https?:\/\//, "")}`
  : `http://localhost:${process.env.PORT || 10000}`;

setInterval(() => {
  const u = `${SELF}/ping`;
  const cli = u.startsWith("https") ? https : http;
  cli.get(u, () => {}).on("error", () => {});
}, 4 * 60 * 1000);

// =========================
// INMUEBLES — CRUD COMPLETO
// =========================

// GET todos
app.get("/api/inmuebles", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("inmuebles").select("*").order("id", { ascending: false });
    if (error) { console.error(error.message); return res.status(500).json({ error: error.message }); }
    res.json((data || []).map(sbToInm));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET públicos (para el funnel)
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

// GET uno por id
app.get("/api/inmuebles/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("inmuebles").select("*").eq("id", req.params.id).single();
    if (error) return res.status(404).json({ error: "No encontrado" });
    res.json(sbToInm(data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST guardar nuevo inmueble (desde form.html)
app.post("/guardar", upload.fields([{ name: "imagenes" }, { name: "video" }]), async (req, res) => {
  try {
    const imgs = [];
    for (const f of (req.files?.imagenes || [])) {
      const url = await subirASupabase(f.buffer, f.originalname, f.mimetype);
      if (url) imgs.push(url);
    }

    // Video (si viene)
    let videoUrl = null;
    if (req.files?.video?.[0]) {
      const vf = req.files.video[0];
      videoUrl = await subirASupabase(vf.buffer, vf.originalname, vf.mimetype);
    }

    const payload = inmToSb({ ...req.body, imagenes: imgs, estadoPublicacion: "borrador" });
    if (videoUrl) payload.video_url = videoUrl;

    const { data, error } = await supabase.from("inmuebles").insert([payload]).select().single();
    if (error) { console.error("Error guardando:", error.message); return res.status(500).send("Error: " + error.message); }

    pushNotif({ tipo: "nuevo_inmueble", titulo: req.body.titulo, zona: req.body.zona, precio: req.body.precio, moneda: req.body.moneda, id: data.id });
    res.redirect("/dashboard.html");
  } catch (e) { console.error(e); res.status(500).send("Error interno"); }
});

// PUT editar inmueble
app.put("/api/inmuebles/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("inmuebles").update(inmToSb(req.body)).eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE inmueble
app.delete("/api/inmuebles/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("inmuebles").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =========================
// ACCIONES DE ESTADO (desde dashboard — botones de formulario)
// FIX: estas rutas no existían
// =========================
async function cambiarEstado(id, estado, res) {
  try {
    const updates = { estado_publicacion: estado };
    if (estado === "publicada") {
      // Incrementar contador de publicaciones
      const { data: curr } = await supabase.from("inmuebles").select("cantidad_publicaciones").eq("id", id).single();
      updates.cantidad_publicaciones = ((curr?.cantidad_publicaciones || 0) + 1);
    }
    const { data, error } = await supabase.from("inmuebles").update(updates).eq("id", id).select("titulo,zona,precio,moneda").single();
    if (error) { console.error(error.message); return res.status(500).send("Error: " + error.message); }

    const tipoNotif = estado === "lista" ? "inmueble_lista" : estado === "publicada" ? "inmueble_publicada" : "nuevo_inmueble";
    pushNotif({ tipo: tipoNotif, titulo: data?.titulo, zona: data?.zona, precio: data?.precio, moneda: data?.moneda, id: Number(id) });
    res.redirect("/dashboard.html");
  } catch (e) { res.status(500).send("Error interno"); }
}

app.post("/publicar/:id",   (req, res) => cambiarEstado(req.params.id, "lista",     res));
app.post("/publicada/:id",  (req, res) => cambiarEstado(req.params.id, "publicada", res));
app.post("/vendida/:id",    (req, res) => cambiarEstado(req.params.id, "vendida",   res));
app.post("/alquilada/:id",  (req, res) => cambiarEstado(req.params.id, "alquilada", res));
app.post("/eliminar/:id",   async (req, res) => {
  try {
    await supabase.from("inmuebles").delete().eq("id", req.params.id);
    res.redirect("/dashboard.html");
  } catch { res.redirect("/dashboard.html"); }
});

// =========================
// OPORTUNIDADES — CRUD COMPLETO
// FIX: solo existía POST /oportunidad sin GET
// =========================

// POST guardar oportunidad (desde oportunidad.html)
app.post("/oportunidad", upload.single("thumb"), async (req, res) => {
  try {
    let thumbUrl = null;
    if (req.file) {
      thumbUrl = await subirASupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    }

    const payload = {
      titulo:           req.body.titulo,
      origen:           req.body.origen,
      link_publicacion: req.body.linkPublicacion,
      tipo_operacion:   req.body.tipoOperacion,
      tipo_propiedad:   req.body.tipoPropiedad,
      zona:             req.body.zona,
      direccion:        req.body.direccion,
      precio:           req.body.precio ? parseFloat(req.body.precio) : null,
      moneda:           req.body.moneda || "USD",
      dormitorios:      req.body.dormitorios ? parseInt(req.body.dormitorios) : null,
      banos:            req.body.banos ? parseInt(req.body.banos) : null,
      descripcion:      req.body.descripcion,
      thumb_url:        thumbUrl,
      estado:           "nueva",
    };

    const { data, error } = await supabase.from("oportunidades").insert([payload]).select().single();
    if (error) {
      console.error("Error oportunidad:", error.message);
      // Si la tabla no existe en Supabase, crear el registro en inmuebles con estado oportunidad
      const fallback = inmToSb({ ...req.body, imagenes: thumbUrl ? [thumbUrl] : [], estadoPublicacion: "oportunidad" });
      fallback.origen = req.body.origen;
      fallback.link_publicacion = req.body.linkPublicacion;
      await supabase.from("inmuebles").insert([fallback]);
    } else {
      pushNotif({ tipo: "nueva_oportunidad", titulo: payload.titulo, zona: payload.zona, precio: payload.precio, moneda: payload.moneda, id: data?.id, origen: payload.origen });
    }

    res.redirect("/dashboard.html?msg=oportunidad_guardada");
  } catch (e) { console.error(e); res.redirect("/dashboard.html"); }
});

// GET listar oportunidades
app.get("/api/oportunidades", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("oportunidades").select("*").order("id", { ascending: false });
    if (error) {
      // Si la tabla no existe, devolver vacío sin romper
      return res.json([]);
    }
    res.json(data || []);
  } catch { res.json([]); }
});

// =========================
// LEADS — GET + POST
// FIX: solo existía POST, faltaba GET
// =========================

// POST nuevo lead (desde funnel / chat Cata)
app.post("/api/leads", async (req, res) => {
  try {
    const lead = { ...req.body, estado: req.body.estado || "nuevo", created_at: new Date().toISOString() };
    const { error } = await supabase.from("leads").insert([lead]);
    if (error) { console.error("Error lead:", error.message); return res.status(500).json({ ok: false, error: error.message }); }
    pushNotif({ tipo: "nuevo_lead", nombre: lead.nombre, titulo: lead.nombre || "Lead nuevo", ts: Date.now() });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET todos los leads — FIX: esta ruta FALTABA, por eso el dashboard mostraba 0
app.get("/api/leads", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("leads").select("*").order("id", { ascending: false });
    if (error) { console.error("Error leads:", error.message); return res.status(500).json({ error: error.message }); }
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT actualizar estado de lead
app.put("/api/leads/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("leads").update(req.body).eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =========================
// COMPRADORES — CRUD
// FIX: GET /api/compradores no existía, el dashboard la pedía
// =========================
app.get("/api/compradores", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("compradores").select("*").order("id", { ascending: false });
    if (error) { console.error("Error compradores:", error.message); return res.status(500).json({ error: error.message }); }
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/compradores", async (req, res) => {
  try {
    const { error } = await supabase.from("compradores").insert([req.body]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/compradores/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("compradores").update(req.body).eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
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
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// MATCH
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
// FIX: el dashboard espera { items: [] } con filtro ?since=, el server devolvía array plano
// =========================
app.get("/api/notificaciones", (req, res) => {
  const since = parseInt(req.query.since || "0");
  const items = notificaciones.filter(n => Number(n.ts || 0) > since);
  res.json({ items, total: notificaciones.length });
});

app.post("/api/notificaciones/leer", (req, res) => {
  notificaciones = notificaciones.map(n => ({ ...n, leida: true }));
  guardarNotifs();
  res.json({ ok: true });
});

// =========================
// RATING
// =========================
app.post("/api/rating", async (req, res) => {
  try {
    const { propiedad_id, rating } = req.body;
    await supabase.from("inmuebles").update({ rating }).eq("id", propiedad_id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

// =========================
// RADAR IA
// =========================
const radarIA = [];
app.post("/api/radar-ia", (req, res) => { radarIA.push({ ...req.body, ts: Date.now() }); res.json({ ok: true }); });
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
  } catch (e) { console.error(e.message); res.status(500).json({ ok: false }); }
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
    doc.fontSize(22).fillColor("#0e6b4d").text(p.titulo || "Sin título", { underline: false });
    doc.moveDown(0.5);
    doc.fontSize(13).fillColor("#333");
    if (p.zona)        doc.text(`📍 Zona: ${p.zona}`);
    if (p.tipoOperacion) doc.text(`🏷️  Operación: ${p.tipoOperacion}`);
    if (p.precio)      doc.text(`💰 Precio: ${p.moneda || "USD"} ${Number(p.precio).toLocaleString("es-AR")}`);
    if (p.dormitorios) doc.text(`🛏️  Dormitorios: ${p.dormitorios}`);
    if (p.banos)       doc.text(`🚿 Baños: ${p.banos}`);
    if (p.m2Totales)   doc.text(`📐 m² totales: ${p.m2Totales}`);
    if (p.m2Cubiertos) doc.text(`📐 m² cubiertos: ${p.m2Cubiertos}`);
    if (p.descripcion) { doc.moveDown(); doc.fontSize(12).text(p.descripcion, { lineGap: 4 }); }
    doc.end();
  } catch (e) { res.status(500).json({ error: "Error generando PDF" }); }
});

// =========================
// CATA CHAT — SIN DUPLICADO
// FIX: había dos app.post("/api/cata-chat"), Express solo tomaba el primero
// Usa Anthropic (Claude). Fallback a OpenAI si no hay ANTHROPIC_API_KEY.
// =========================
app.post("/api/cata-chat", async (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // — Anthropic (Claude) — lo que usa el funnel
  if (anthropicKey) {
    try {
      const { system, messages } = req.body;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":    "application/json",
          "x-api-key":       anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 600, system, messages })
      });
      const data = await response.json();
      return res.json(data);
    } catch (e) {
      console.error("Cata-chat Anthropic error:", e.message);
      return res.status(500).json({ error: "Error Anthropic" });
    }
  }

  // — OpenAI fallback —
  if (process.env.OPENAI_API_KEY) {
    const { mensaje, historial, propiedad } = req.body || {};
    if (!mensaje) return res.status(400).json({ ok: false, error: "Sin mensaje" });
    try {
      const propCtx = propiedad
        ? `Propiedad: ${propiedad.titulo || ""} · ${propiedad.zona || ""} · ${propiedad.moneda || "USD"} ${propiedad.precio || 0}`
        : "Consulta general";
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `Sos Cata, asistente de Vanina Buzzacchi Negocios Inmobiliarios en Río Cuarto. ${propCtx}. Si el cliente muestra interés concreto, pedile nombre y teléfono. Respondé en español, máximo 3 oraciones.` },
          ...(historial || []),
          { role: "user", content: mensaje }
        ],
        max_tokens: 300, temperature: 0.7
      });
      return res.json({ ok: true, respuesta: completion.choices[0].message.content.trim() });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(500).json({ error: "No hay API key de IA configurada (ANTHROPIC_API_KEY o OPENAI_API_KEY)" });
});

// =========================
// FAQS Y OBJECIONES (para el chat Cata)
// =========================
app.get("/api/faqs", async (req, res) => {
  try {
    const { data, error } = await supabase.from("Preguntas frecuentes").select("*");
    if (error) return res.json([]);
    res.json(data || []);
  } catch { res.json([]); }
});

app.get("/api/objeciones", async (req, res) => {
  try {
    const { data, error } = await supabase.from("Objeciones").select("*");
    if (error) return res.json([]);
    res.json(data || []);
  } catch { res.json([]); }
});

// =========================
// HEALTH CHECK
// =========================
app.get("/health", (_, res) => {
  res.json({
    ok: true,
    supabase:   !!process.env.SUPABASE_URL,
    openai:     !!process.env.OPENAI_API_KEY,
    anthropic:  !!process.env.ANTHROPIC_API_KEY,
    uptime:     process.uptime(),
    ts:         new Date().toISOString(),
    notifs:     notificaciones.length,
  });
});

// =========================
// SERVER START
// =========================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`\n✅ BUZZACCHI CRM — SERVIDOR OK`);
  console.log(`🚪 Puerto: ${PORT}`);
  console.log(`🔗 Supabase:  ${process.env.SUPABASE_URL  ? "✅ configurado" : "❌ FALTA SUPABASE_URL"}`);
  console.log(`🤖 OpenAI:    ${process.env.OPENAI_API_KEY  ? "✅" : "⚠️  no configurado"}`);
  console.log(`🧠 Anthropic: ${process.env.ANTHROPIC_API_KEY ? "✅" : "⚠️  no configurado"}`);
  console.log(`⏰ Keep-alive: ping interno cada 4 min → Render no se duerme\n`);
});

