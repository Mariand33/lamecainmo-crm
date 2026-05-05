// ========================================
// SERVER.JS - BUZZACCHI CRM
// LIMPIO + ORDENADO + SUPABASE
// ========================================

const express = require("express");
const app = express();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const archiver = require("archiver");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const PDFDocument = require("pdfkit");
const https = require("https");
const http = require("http");
const sharp = require("sharp");

// =========================
// MIDDLEWARE (una sola vez, al inicio)
// =========================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: "buzzacchi", resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, "public")));

// =========================
// ARCHIVOS ESTÁTICOS / RUTAS PRINCIPALES
// =========================
app.get("/funnel", (req, res) => {
  res.sendFile(path.join(__dirname, "funnel-publico.html"));
});
app.get("/funnel-publico.html", (req, res) => {
  res.sendFile(path.join(__dirname, "funnel-publico.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "Público", "dashboard.html"));
});
app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "Público", "dashboard.html"));
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "funnel-publico.html"));
});

// =========================
// KEEP-ALIVE (Bug #3 — ping endpoint + loop interno)
// =========================
app.get("/ping", (req, res) => res.json({ ok: true, ts: Date.now() }));

// Loop interno cada 14 min para evitar que Render duerma el servidor
setInterval(() => {
  const PORT_PING = process.env.PORT || 10000;
  http.get(`http://localhost:${PORT_PING}/ping`, (r) => {
    console.log("keep-alive ping →", r.statusCode);
  }).on("error", (e) => console.warn("keep-alive error:", e.message));
}, 14 * 60 * 1000);

// =========================
// CONFIG
// =========================

// Bug #5 — supabase null: lanzar error claro si faltan variables de entorno
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("❌ FATAL: SUPABASE_URL y SUPABASE_KEY son requeridas.");
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ""
});

// =========================
// DATA (LOCAL)
// =========================

let notificaciones = [];
let radarIA = [];
let vendedoresDetectados = [];
let radarLeads = [];

const DATA_DIR = path.join(__dirname, "data");
const NOTIF_FILE = path.join(DATA_DIR, "notificaciones.json");
const RADAR_IA_FILE = path.join(DATA_DIR, "radar_ia.json");
const VENDEDORES_FILE = path.join(DATA_DIR, "vendedores_detectados.json");
const RADAR_LEADS_FILE = path.join(DATA_DIR, "radar_leads.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// =========================
// HELPERS
// =========================

function guardarJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function asegurarArrayJSON(file, arr) {
  if (!fs.existsSync(file)) return;
  try {
    const data = fs.readFileSync(file, "utf8");
    if (!data.trim()) return;
    const json = JSON.parse(data);
    if (Array.isArray(json)) arr.push(...json);
  } catch {}
}

function pushNotif(n) {
  notificaciones.push({ id: Date.now(), ts: Date.now(), ...n });
  if (notificaciones.length > 200) notificaciones.shift();
  guardarJSON(NOTIF_FILE, notificaciones);
}

function limpiarTexto(str) {
  return (str || "").replace(/[^\w\s.,-]/g, "").trim();
}

async function descargarImagen(url) {
  return new Promise((resolve) => {
    const cliente = url.startsWith("https") ? https : http;
    cliente.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", () => resolve(null));
  });
}

// =========================
// MULTER
// =========================

const upload = multer({ storage: multer.memoryStorage() });

async function subirASupabase(buffer, name, type) {
  const filename = `${Date.now()}-${name}`;
  const { error } = await supabase.storage
    .from("SUBIDAS")
    .upload(filename, buffer, { contentType: type });

  if (error) return null;

  const { data } = supabase.storage.from("SUBIDAS").getPublicUrl(filename);
  return data.publicUrl;
}

// =========================
// SUPABASE MAPPER
// =========================

function sbToInm(r) {
  return {
    id: r.id,
    titulo: r.titulo,
    zona: r.zona,
    tipoOperacion: r.tipo_operacion,
    tipoPropiedad: r.tipo_propiedad,
    direccion: r.direccion,
    precio: r.precio,
    moneda: r.moneda,
    dormitorios: r.dormitorios,
    banos: r.banos,
    descripcion: r.descripcion,
    imagenes: r.imagenes || [],
    estadoPublicacion: r.estado_publicacion
  };
}

function inmToSb(i) {
  return {
    titulo: i.titulo,
    zona: i.zona,
    tipo_operacion: i.tipoOperacion,
    tipo_propiedad: i.tipoPropiedad,
    direccion: i.direccion,
    precio: i.precio,
    moneda: i.moneda,
    dormitorios: i.dormitorios,
    banos: i.banos,
    descripcion: i.descripcion,
    imagenes: i.imagenes,
    estado_publicacion: i.estadoPublicacion
  };
}

// =========================
// USERS (simple)
// =========================

const usuarios = [
  { email: "admin@inmo.com", password: "1234" }
];

// =========================
// AUTH
// =========================

app.post("/login", (req, res) => {
  const u = usuarios.find(
    x => x.email === req.body.email && x.password === req.body.password
  );
  if (!u) return res.status(401).send("error");
  req.session.user = u;
  res.json({ ok: true });
});

// =========================
// INMUEBLES
// =========================

app.post("/guardar", upload.array("imagenes"), async (req, res) => {
  const imgs = [];

  for (const f of req.files || []) {
    const url = await subirASupabase(f.buffer, f.originalname, f.mimetype);
    if (url) imgs.push(url);
  }

  const data = {
    ...req.body,
    imagenes: imgs,
    estadoPublicacion: "borrador"
  };

  await supabase.from("inmuebles").insert([inmToSb(data)]);
  res.redirect("/dashboard.html");
});

app.get("/api/inmuebles", async (req, res) => {
  const { data } = await supabase.from("inmuebles").select("*");
  res.json((data || []).map(sbToInm));
});

app.get("/api/inmuebles-publicos", async (req, res) => {
  const { data } = await supabase
    .from("inmuebles")
    .select("*")
    .in("estado_publicacion", ["lista", "publicada"]);

  res.json((data || []).map(sbToInm));
});

// =========================
// LEADS (Bug #2 — faltaba GET)
// =========================

app.post("/api/leads", async (req, res) => {
  const { error } = await supabase.from("leads").insert([req.body]);
  res.json({ ok: !error });
});

// GET /api/leads — necesario para el dashboard
app.get("/api/leads", async (req, res) => {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json(data || []);
});

// =========================
// OPORTUNIDADES (Bug #4 — ruta GET faltante)
// =========================

app.post("/api/oportunidades", async (req, res) => {
  const { error } = await supabase.from("oportunidades").insert([req.body]);
  res.json({ ok: !error });
});

app.get("/api/oportunidades", async (req, res) => {
  const { data, error } = await supabase
    .from("oportunidades")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json(data || []);
});

// =========================
// MATCH SIMPLE
// =========================

app.get("/api/match-demanda/:id", async (req, res) => {
  const { data: d } = await supabase
    .from("demandas")
    .select("*")
    .eq("id", req.params.id)
    .single();

  const { data: inm } = await supabase.from("inmuebles").select("*");

  const matches = (inm || []).map(sbToInm).filter(i =>
    i.zona?.includes(d.zona || "")
  );

  res.json({ matches });
});

// =========================
// RATING
// =========================

app.post("/api/rating", async (req, res) => {
  const { propiedad_id, rating } = req.body;

  await supabase
    .from("inmuebles")
    .update({ rating })
    .eq("id", propiedad_id);

  res.json({ ok: true });
});

// =========================
// TRANSCRIPCIÓN
// =========================

app.post("/api/transcribir-audio", upload.single("audio"), async (req, res) => {
  try {
    const stream = require("stream").Readable.from(req.file.buffer);
    stream.path = "audio.webm";

    const r = await openai.audio.transcriptions.create({
      file: stream,
      model: "whisper-1",
      language: "es"
    });

    res.json({ ok: true, texto: r.text });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// =========================
// PDF FICHA
// =========================

app.get("/api/ficha-pdf/:id", async (req, res) => {
  const { data } = await supabase
    .from("inmuebles")
    .select("*")
    .eq("id", req.params.id)
    .single();

  const p = sbToInm(data);

  const doc = new PDFDocument();
  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);

  doc.fontSize(20).text(p.titulo || "");
  doc.text(p.zona || "");
  doc.text(p.precio || "");

  doc.end();
});

// =========================
// RADAR IA
// =========================

app.post("/api/radar-ia", (req, res) => {
  radarIA.push(req.body);
  res.json({ ok: true });
});

app.get("/api/radar-ia", (req, res) => {
  res.json(radarIA);
});

// =========================
// CATA CHAT (Bug #1 — ruta duplicada eliminada, queda una sola versión)
// Usa OpenAI GPT-4o-mini con contexto de propiedad
// =========================

app.post("/api/cata-chat", async (req, res) => {
  const { mensaje, historial, propiedad } = req.body || {};
  if (!mensaje) return res.status(400).json({ ok: false, error: "Sin mensaje" });

  try {
    const propCtx = propiedad
      ? `Propiedad consultada: ${propiedad.titulo || ""} · ${propiedad.zona || ""} · ${propiedad.moneda || "USD"} ${propiedad.precio || 0} · ${propiedad.tipoOperacion || ""}`
      : "Consulta general sobre propiedades";

    const messages = [
      ...(historial || []),
      { role: "user", content: mensaje }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Sos Cata, asistente de Vanina Buzzacchi Negocios Inmobiliarios en Río Cuarto, Argentina.
Respondés consultas sobre propiedades de manera amigable, breve y profesional.
${propCtx}
Si el cliente muestra interés concreto, pedile nombre y teléfono para que Vanina lo contacte.
Respondé siempre en español, máximo 3 oraciones.`
        },
        ...messages
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    const respuesta = completion.choices[0].message.content.trim();
    res.json({ ok: true, respuesta });

  } catch (e) {
    console.error("Error cata-chat:", e.message);
    res.status(500).json({ ok: false, error: "Error al procesar" });
  }
});

// =========================
// SERVER START
// =========================

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("SERVER OK EN PUERTO", PORT);
});


