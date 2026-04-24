// SERVER.JS
// EQUIPO BUZZACCHI
// ✅ MIGRADO A SUPABASE - inmuebles ya no usan JSON local

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

// ============================
// HELPERS
// ============================

function descargarImagen(url) {
  return new Promise((resolve) => {
    const cliente = url.startsWith("https") ? https : http;
    cliente
      .get(url, (resp) => {
        if (resp.statusCode !== 200) return resolve(null);
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => resolve(Buffer.concat(chunks)));
        resp.on("error", () => resolve(null));
      })
      .on("error", () => resolve(null));
  });
}

function asegurarArrayJSON(file, arr) {
  if (!fs.existsSync(file)) return;
  try {
    const data = fs.readFileSync(file, "utf8");
    if (!data.trim()) return;
    const json = JSON.parse(data);
    if (Array.isArray(json)) arr.push(...json);
  } catch (e) {
    console.log("Error cargando", file, e.message);
  }
}

function guardarJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function pushNotif(notificaciones, guardarNotificaciones, n) {
  const notif = { id: Date.now(), ts: Date.now(), ...n };
  notificaciones.push(notif);
  if (notificaciones.length > 200) {
    notificaciones.splice(0, notificaciones.length - 200);
  }
  guardarNotificaciones();
}

function limpiarTexto(str) {
  return (str || "")
    .replace(/\u00D0/g, "")
    .replace(/[^\x20-\x7EáéíóúÁÉÍÓÚñÑüÜ¿¡.,;:()\-\/°²³\n]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function generarThumbnail(nombreArchivo) {
  try {
    const inputPath = path.join(UPLOADS_DIR, nombreArchivo);
    const outputPath = path.join(THUMBS_DIR, nombreArchivo);

    await sharp(inputPath)
      .resize({ width: 700, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toFile(outputPath);

    return nombreArchivo;
  } catch (error) {
    console.log("Error thumbnail:", error.message);
    return null;
  }
}

// ============================
// MIDDLEWARES
// ============================

app.use(cors({
  origin: [
    "https://mariand33.github.io",
    "https://marianad33.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "P\u00FAblico")));
app.use(
  session({
    secret: "buzzacchi",
    resave: false,
    saveUninitialized: false
  })
);

// ============================
// CONFIG
// ============================

const usuarios = [
  { email: "mariano@inmo.com", password: "1234", rol: "admin" },
  { email: "vanina@inmo.com", password: "1234", rol: "admin" },
  { email: "cata@inmo.com", password: "1688", rol: "admin" },
  { email: "market@inmo.com", password: "1234", rol: "marketing" }
];

// ✅ Solo radar y notificaciones siguen en JSON local
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

const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const THUMBS_DIR = path.join(__dirname, "public", "uploads", "thumbs");
if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });

// ============================
// PERSISTENCIA (radar y notificaciones)
// ============================

function guardarNotificaciones() { guardarJSON(NOTIF_FILE, notificaciones); }
function guardarRadarIA() { guardarJSON(RADAR_IA_FILE, radarIA); }
function guardarVendedoresDetectados() { guardarJSON(VENDEDORES_FILE, vendedoresDetectados); }
function guardarRadarLeads() { guardarJSON(RADAR_LEADS_FILE, radarLeads); }

asegurarArrayJSON(NOTIF_FILE, notificaciones);
asegurarArrayJSON(RADAR_IA_FILE, radarIA);
asegurarArrayJSON(VENDEDORES_FILE, vendedoresDetectados);
asegurarArrayJSON(RADAR_LEADS_FILE, radarLeads);

// ============================
// MULTER
// ============================

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

// ============================
// SERVICIOS EXTERNOS
// ============================

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
    : null;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ""
});

// ============================
// HELPER SUPABASE — inmuebles
// ============================

// Convierte una fila de Supabase al formato que usa el frontend
function sbToInm(row) {
  return {
    id: row.id,
    titulo: row.titulo || "",
    zona: row.zona || "",
    tipoOperacion: row.tipo_operacion || "",
    tipoPropiedad: row.tipo_propiedad || "",
    direccion: row.direccion || "",
    precio: row.precio || 0,
    moneda: row.moneda || "USD",
    dormitorios: row.dormitorios || 0,
    banos: row.banos || 0,
    descripcion: row.descripcion || "",
    imagenes: row.imagenes || [],
    thumbnails: row.thumbnails || [],
    video: row.video || "",
    estadoPublicacion: row.estado_publicacion || "",
    cantidadPublicaciones: row.cantidad_publicaciones || 0,
    creadoPor: row.creado_por || "",
    rating: row.rating || 0,
    leads: row.leads || [],
    origen: row.origen || "",
    telefono: row.telefono || "",
    linkPublicacion: row.link_publicacion || "",
    fecha: row.fecha || ""
  };
}

// Convierte los campos JS a nombres de columnas Supabase
function inmToSb(inm) {
  const obj = {};
  if (inm.titulo !== undefined) obj.titulo = inm.titulo;
  if (inm.zona !== undefined) obj.zona = inm.zona;
  if (inm.tipoOperacion !== undefined) obj.tipo_operacion = inm.tipoOperacion;
  if (inm.tipoPropiedad !== undefined) obj.tipo_propiedad = inm.tipoPropiedad;
  if (inm.direccion !== undefined) obj.direccion = inm.direccion;
  if (inm.precio !== undefined) obj.precio = inm.precio;
  if (inm.moneda !== undefined) obj.moneda = inm.moneda;
  if (inm.dormitorios !== undefined) obj.dormitorios = inm.dormitorios;
  if (inm.banos !== undefined) obj.banos = inm.banos;
  if (inm.descripcion !== undefined) obj.descripcion = inm.descripcion;
  if (inm.imagenes !== undefined) obj.imagenes = inm.imagenes;
  if (inm.thumbnails !== undefined) obj.thumbnails = inm.thumbnails;
  if (inm.video !== undefined) obj.video = inm.video;
  if (inm.estadoPublicacion !== undefined) obj.estado_publicacion = inm.estadoPublicacion;
  if (inm.cantidadPublicaciones !== undefined) obj.cantidad_publicaciones = inm.cantidadPublicaciones;
  if (inm.creadoPor !== undefined) obj.creado_por = inm.creadoPor;
  if (inm.rating !== undefined) obj.rating = inm.rating;
  if (inm.leads !== undefined) obj.leads = inm.leads;
  if (inm.origen !== undefined) obj.origen = inm.origen;
  if (inm.telefono !== undefined) obj.telefono = inm.telefono;
  if (inm.linkPublicacion !== undefined) obj.link_publicacion = inm.linkPublicacion;
  if (inm.fecha !== undefined) obj.fecha = inm.fecha;
  return obj;
}

// ============================
// PAGINAS
// ============================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/demandas", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "demandas.html"));
});

app.get("/demandas.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "demandas.html"));
});

app.get("/radar-vendedores", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "radar-vendedores.html"));
});

app.get("/radar-leads", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "radar-leads.html"));
});

app.get("/radar-ia", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "radar-ia.html"));
});

app.get("/funnel", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "funnel-publico.html"));
});

app.get("/funnel.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "funnel-publico.html"));
});

app.get("/funnel-publico.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "funnel-publico.html"));
});

app.get("/test-render", (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ============================
// AUTH
// ============================

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = usuarios.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).send("Usuario incorrecto");
  req.session.user = user;
  res.redirect("/dashboard.html");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login.html"));
});

// ============================
// INMUEBLES — SUPABASE ✅
// ============================

// CREAR — borrador completo
app.post(
  "/guardar",
  upload.fields([
    { name: "imagenes", maxCount: 20 },
    { name: "video", maxCount: 1 }
  ]),
  async (req, res) => {
    let fotos = [];
    let thumbnails = [];

    if (req.files && req.files.imagenes) {
      fotos = [...new Set(req.files.imagenes.map((f) => f.filename))];
      for (const foto of fotos) {
        const thumb = await generarThumbnail(foto);
        if (thumb) thumbnails.push(thumb);
      }
    }

    let video = "";
    if (req.files && req.files.video && req.files.video.length) {
      video = req.files.video[0].filename;
    }

    const nuevo = {
      titulo: String(req.body.titulo || "").trim(),
      zona: String(req.body.zona || "").trim(),
      tipoOperacion: String(req.body.tipoOperacion || "venta").trim(),
      precio: Number(req.body.precio || 0),
      moneda: String(req.body.moneda || "USD").trim(),
      dormitorios: Number(req.body.dormitorios || 0),
      banos: Number(req.body.banos || 0),
      direccion: String(req.body.direccion || "").trim(),
      tipoPropiedad: String(req.body.tipoPropiedad || "").trim(),
      descripcion: String(req.body.descripcion || "").trim(),
      imagenes: fotos,
      thumbnails,
      video,
      creadoPor: req.session.user ? req.session.user.email : "desconocido",
      estadoPublicacion: "borrador",
      cantidadPublicaciones: 0,
      leads: []
    };

    const { data, error } = await supabase.from("inmuebles").insert([inmToSb(nuevo)]).select().single();

    if (error) {
      console.error("Error guardando en Supabase:", error.message);
      return res.status(500).send("Error al guardar propiedad");
    }

    pushNotif(notificaciones, guardarNotificaciones, {
      tipo: "nuevo_inmueble",
      titulo: nuevo.titulo,
      zona: nuevo.zona,
      precio: nuevo.precio,
      moneda: nuevo.moneda,
      operacion: nuevo.tipoOperacion,
      creadoPor: nuevo.creadoPor,
      inmuebleId: data.id
    });

    res.redirect("/dashboard.html");
  }
);

// CREAR — oportunidad
app.post("/oportunidad", upload.single("thumb"), async (req, res) => {
  const body = req.body || {};
  const imagenes = req.file ? [req.file.filename] : [];
  const thumbnails = [];

  if (req.file) {
    const thumb = await generarThumbnail(req.file.filename);
    if (thumb) thumbnails.push(thumb);
  }

  const nueva = {
    titulo: body.titulo && String(body.titulo).trim() ? String(body.titulo).trim() : "Oportunidad",
    zona: String(body.zona || "").trim(),
    tipoOperacion: String(body.tipoOperacion || "venta").trim(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "USD").trim(),
    descripcion: String(body.descripcion || "").trim(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim(),
    direccion: String(body.direccion || "").trim(),
    origen: String(body.origen || "marketplace").trim(),
    linkPublicacion: String(body.linkPublicacion || "").trim(),
    estadoPublicacion: "oportunidad",
    creadoPor: req.session.user ? req.session.user.email : "sistema",
    imagenes,
    thumbnails,
    leads: []
  };

  const { data, error } = await supabase.from("inmuebles").insert([inmToSb(nueva)]).select().single();

  if (error) {
    console.error("Error guardando oportunidad:", error.message);
    return res.status(500).send("Error al guardar oportunidad");
  }

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "nueva_oportunidad",
    titulo: nueva.titulo,
    zona: nueva.zona,
    precio: nueva.precio,
    moneda: nueva.moneda,
    origen: nueva.origen,
    inmuebleId: data.id
  });

  res.redirect("/dashboard.html");
});

// CREAR — radar calle
app.post("/radar", upload.single("thumb"), async (req, res) => {
  const body = req.body || {};
  const imagenes = req.file ? [req.file.filename] : [];
  const thumbnails = [];

  if (req.file) {
    const thumb = await generarThumbnail(req.file.filename);
    if (thumb) thumbnails.push(thumb);
  }

  const nuevo = {
    titulo: String(body.titulo || "").trim() || "Radar Calle",
    zona: String(body.zona || "").trim(),
    tipoOperacion: String(body.tipoOperacion || "").trim().toLowerCase(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim().toLowerCase(),
    direccion: String(body.direccion || "").trim(),
    telefono: String(body.telefono || "").trim(),
    descripcion: String(body.nota || "").trim(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "ARS").trim().toUpperCase(),
    dormitorios: Number(body.dormitorios || 0),
    banos: Number(body.banos || 0),
    origen: "calle",
    estadoPublicacion: "radar",
    cantidadPublicaciones: 0,
    creadoPor: req.session.user ? req.session.user.email : "desconocido",
    fecha: new Date().toISOString(),
    imagenes,
    thumbnails,
    leads: []
  };

  const { data, error } = await supabase.from("inmuebles").insert([inmToSb(nuevo)]).select().single();

  if (error) {
    console.error("Error guardando radar:", error.message);
    return res.status(500).send("Error al guardar radar");
  }

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "nuevo_radar",
    titulo: nuevo.titulo,
    zona: nuevo.zona,
    operacion: nuevo.tipoOperacion,
    inmuebleId: data.id
  });

  res.redirect("/dashboard.html");
});

// EDITAR
app.post("/editar/:id", upload.array("imagenes", 20), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.redirect("/dashboard.html");

  // Traer actual desde Supabase
  const { data: current, error: fetchErr } = await supabase
    .from("inmuebles").select("*").eq("id", id).single();

  if (fetchErr || !current) return res.redirect("/dashboard.html");

  const inm = sbToInm(current);

  const updates = {
    titulo: String(req.body.titulo || inm.titulo || "").trim(),
    zona: String(req.body.zona || inm.zona || "").trim(),
    tipoOperacion: String(req.body.tipoOperacion || inm.tipoOperacion || "").trim(),
    tipoPropiedad: String(req.body.tipoPropiedad || inm.tipoPropiedad || "").trim(),
    direccion: String(req.body.direccion || inm.direccion || "").trim(),
    precio: Number(req.body.precio || inm.precio || 0),
    moneda: String(req.body.moneda || inm.moneda || "USD").trim(),
    dormitorios: Number(req.body.dormitorios || inm.dormitorios || 0),
    banos: Number(req.body.banos || inm.banos || 0),
    descripcion: String(req.body.descripcion || inm.descripcion || "").trim(),
  };

  // Reordenar imágenes existentes
  let imagenesActuales = inm.imagenes || [];
  let thumbnailsActuales = inm.thumbnails || [];

  const nombres = req.body.nombresImagenes;
  const ordenes = req.body.ordenImagenes;

  if (nombres && ordenes) {
    const arrN = Array.isArray(nombres) ? nombres : [nombres];
    const arrO = Array.isArray(ordenes) ? ordenes : [ordenes];
    const pares = arrN.map((nombre, i) => ({
      nombre: String(nombre || "").trim(),
      orden: Number(arrO[i] || 9999)
    }));
    pares.sort((a, b) => a.orden - b.orden);
    imagenesActuales = pares.map((p) => p.nombre).filter(Boolean);
  }

  // Agregar fotos nuevas
  if (req.files && req.files.length) {
    const nuevas = req.files.map((f) => f.filename);
    imagenesActuales = [...new Set(imagenesActuales.concat(nuevas))];
    for (const foto of nuevas) {
      const thumb = await generarThumbnail(foto);
      if (thumb) thumbnailsActuales.push(thumb);
    }
    thumbnailsActuales = [...new Set(thumbnailsActuales)];
  }

  updates.imagenes = imagenesActuales;
  updates.thumbnails = thumbnailsActuales;

  const { error: updateErr } = await supabase
    .from("inmuebles").update(inmToSb(updates)).eq("id", id);

  if (updateErr) {
    console.error("Error editando:", updateErr.message);
    return res.status(500).send("Error al editar propiedad");
  }

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "inmueble_editado",
    titulo: updates.titulo,
    inmuebleId: id
  });

  res.redirect("/ver.html?id=" + id);
});

// ELIMINAR FOTO
app.post("/editar/:id/fotos/eliminar", async (req, res) => {
  const id = Number(req.params.id);
  const nombreFoto = String(req.body.foto || "").trim();

  if (isNaN(id) || !nombreFoto) {
    return res.status(400).json({ ok: false, error: "Parámetros inválidos" });
  }

  const { data: current, error: fetchErr } = await supabase
    .from("inmuebles").select("imagenes, thumbnails, titulo").eq("id", id).single();

  if (fetchErr || !current) return res.status(404).json({ ok: false });

  const imagenes = (current.imagenes || []).filter(f => f !== nombreFoto);
  const thumbnails = (current.thumbnails || []).filter(f => f !== nombreFoto);

  try {
    const file = path.join(UPLOADS_DIR, nombreFoto);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const thumb = path.join(THUMBS_DIR, nombreFoto);
    if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
  } catch {}

  await supabase.from("inmuebles").update({ imagenes, thumbnails }).eq("id", id);

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "foto_eliminada",
    titulo: current.titulo,
    inmuebleId: id
  });

  res.json({ ok: true });
});

// MARCAR LISTA (listo para publicar)
app.post("/publicar/:id", async (req, res) => {
  const id = Number(req.params.id);

  const { data: current } = await supabase
    .from("inmuebles").select("titulo, cantidad_publicaciones").eq("id", id).single();

  if (!current) return res.redirect("/dashboard.html");

  const { error } = await supabase.from("inmuebles").update({
    estado_publicacion: "lista",
    cantidad_publicaciones: Number(current.cantidad_publicaciones || 0) + 1
  }).eq("id", id);

  if (error) console.error("Error publicar:", error.message);

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "inmueble_lista",
    titulo: current.titulo,
    inmuebleId: id
  });

  res.redirect("/dashboard.html");
});

// MARCAR PUBLICADA
app.post("/publicada/:id", async (req, res) => {
  const id = Number(req.params.id);

  const { data: current } = await supabase
    .from("inmuebles").select("titulo").eq("id", id).single();

  if (!current) return res.redirect("/marketing.html");

  await supabase.from("inmuebles").update({ estado_publicacion: "publicada" }).eq("id", id);

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "inmueble_publicada",
    titulo: current.titulo,
    inmuebleId: id
  });

  res.redirect("/marketing.html");
});

// ELIMINAR INMUEBLE
app.post("/eliminar/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!isNaN(id)) {
    const { data: inm } = await supabase
      .from("inmuebles").select("imagenes, thumbnails").eq("id", id).single();

    if (inm) {
      (inm.imagenes || []).forEach((f) => {
        try {
          const file = path.join(UPLOADS_DIR, f);
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch {}
      });
      (inm.thumbnails || []).forEach((f) => {
        try {
          const file = path.join(THUMBS_DIR, f);
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch {}
      });
    }

    await supabase.from("inmuebles").delete().eq("id", id);
  }

  res.redirect("/dashboard.html");
});

// ZIP DE FOTOS
app.get("/marketing/zip/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { data: inm } = await supabase
    .from("inmuebles").select("imagenes").eq("id", id).single();

  if (!inm || !Array.isArray(inm.imagenes) || inm.imagenes.length === 0) {
    return res.status(400).send("Sin fotos");
  }

  const archive = archiver("zip");
  res.attachment("fotos.zip");
  archive.pipe(res);

  inm.imagenes.forEach((f) => {
    const file = path.join(UPLOADS_DIR, f);
    if (fs.existsSync(file)) archive.file(file, { name: f });
  });

  archive.finalize();
});

// ============================
// APIS BASICAS
// ============================

// ✅ ÚNICA ruta de inmuebles públicos — lee de Supabase
app.get("/api/inmuebles-publicos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .in("estado_publicacion", ["lista", "publicada"])
      .order("id", { ascending: false });

    if (error) throw error;

    res.json((data || []).map(sbToInm));
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

// ✅ Detalle de un inmueble público por ID
// Alias para el dashboard
app.get("/api/inmuebles", async (req, res) => {
  const { data, error } = await supabase.from("inmuebles").select("*").order("id", { ascending: false });
  if (error) return res.status(500).json([]);
  res.json((data || []).map(sbToInm));
});
app.get("/api/inmuebles-publicos/:id", async (req, res) => {
  try {
// Para ver cualquier inmueble desde el dashboard (sin filtro de estado)

app.get("/api/inmueble/:id", async (req, res) => {

  const id = Number(req.params.id);

  const { data, error } = await supabase.from("inmuebles").select("*").eq("id", id).single();

  if (error || !data) return res.status(404).json({ ok: false, error: "No encontrado" });

  res.json(sbToInm(data));

});
    
    const id = Number(req.params.id);

    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ ok: false, error: "Propiedad no encontrada" });
    }

    const inm = sbToInm(data);
    const estado = inm.estadoPublicacion.toLowerCase();

    if (estado !== "lista" && estado !== "publicada") {
      return res.status(403).json({ ok: false, error: "Propiedad no pública" });
    }

    res.json(inm);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

app.get("/api/compradores", async (req, res) => {
  const { data, error } = await supabase.from("compradores").select("*").order("id", { ascending: false });
  if (error) return res.status(500).json([]);
  // Mapear nombres de columnas a camelCase para el frontend
  res.json((data || []).map(c => ({
    id: c.id,
    nombre: c.nombre,
    telefono: c.telefono,
    email: c.email,
    zonaPreferida: c.zona_preferida,
    tipoOperacionBuscada: c.tipo_operacion_buscada,
    tipoPropiedad: c.tipo_propiedad,
    presupuestoMax: c.presupuesto_max,
    moneda: c.moneda,
    dormitoriosMin: c.dormitorios_min,
    estado: c.estado,
    notas: c.notas,
    fechaCreacion: c.fecha_creacion
  })));
});

app.get("/api/demandas", async (req, res) => {
  const { data, error } = await supabase.from("demandas").select("*").order("id", { ascending: false });
  if (error) return res.status(500).json([]);
  res.json((data || []).map(d => ({
    id: d.id,
    tipoOperacion: d.tipo_operacion,
    tipoPropiedad: d.tipo_propiedad,
    zona: d.zona,
    presupuestoMax: d.presupuesto_max,
    moneda: d.moneda,
    dormitoriosMin: d.dormitorios_min,
    margenAbajo: d.margen_abajo,
    margenArriba: d.margen_arriba,
    permitirSinPrecio: d.permitir_sin_precio,
    monedaEstricta: d.moneda_estricta,
    notas: d.notas,
    contacto: d.contacto,
    nombre: d.nombre,
    telefono: d.telefono,
    estado: d.estado,
    fecha: d.fecha
  })));
});

app.get("/api/notificaciones", (req, res) => {
  res.json(notificaciones);
});

app.get("/api/leads", async (req, res) => {
  const { data, error } = await supabase.from("leads").select("*").order("id", { ascending: false });
  if (error) return res.status(500).json([]);
  res.json(data || []);
});

app.post("/api/leads", async (req, res) => {
  const body = req.body || {};
  const lead = {
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    email: String(body.email || "").trim(),
    mensaje: String(body.mensaje || body.mensajeOriginal || "").trim(),
    propiedad_id: body.propiedadId || null,
    propiedad_titulo: String(body.propiedadTitulo || "").trim(),
    origen: String(body.origen || "funnel").trim(),
    estado: "nuevo"
  };

  const { data, error } = await supabase.from("leads").insert([lead]).select().single();
  if (error) {
    console.error("Error leads:", error.message);
    return res.status(500).json({ ok: false });
  }

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "nuevo_lead",
    nombre: lead.nombre,
    telefono: lead.telefono,
    propiedadTitulo: lead.propiedad_titulo
  });

  res.json({ ok: true, id: data.id });
});

// ============================
// COMPRADORES — Supabase ✅
// ============================

app.post("/compradores/nuevo", async (req, res) => {
  const body = req.body || {};
  const { error } = await supabase.from("compradores").insert([{
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    email: String(body.email || "").trim(),
    zona_preferida: String(body.zonaPreferida || "").trim(),
    tipo_operacion_buscada: String(body.tipoOperacionBuscada || "venta").trim(),
    tipo_propiedad: String(body.tipoPropiedad || "").trim(),
    presupuesto_max: Number(body.presupuestoMax || 0),
    moneda: String(body.moneda || "USD").trim(),
    dormitorios_min: Number(body.dormitoriosMin || 0),
    notas: String(body.notas || "").trim(),
    estado: "nuevo"
  }]);
  if (error) console.error("Error compradores/nuevo:", error.message);
  res.redirect("/dashboard.html");
});

app.post("/compradores/editar/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.redirect("/dashboard.html");

  const body = req.body || {};
  const { error } = await supabase.from("compradores").update({
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    email: String(body.email || "").trim(),
    zona_preferida: String(body.zonaPreferida || "").trim(),
    tipo_operacion_buscada: String(body.tipoOperacionBuscada || "").trim(),
    tipo_propiedad: String(body.tipoPropiedad || "").trim(),
    presupuesto_max: Number(body.presupuestoMax || 0),
    moneda: String(body.moneda || "USD").trim(),
    dormitorios_min: Number(body.dormitoriosMin || 0),
    notas: String(body.notas || "").trim(),
    estado: String(body.estado || "tibio").trim()
  }).eq("id", id);
  if (error) console.error("Error compradores/editar:", error.message);
  res.redirect("/dashboard.html");
});

// ============================
// DEMANDAS — Supabase ✅
// ============================

app.post("/demandas/nuevo", async (req, res) => {
  const body = req.body || {};
  const { error } = await supabase.from("demandas").insert([{
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    email: String(body.email || "").trim(),
    zona: String(body.zona || "").trim(),
    tipo_operacion: String(body.tipoOperacion || "venta").trim(),
    tipo_propiedad: String(body.tipoPropiedad || "").trim(),
    presupuesto_max: Number(body.presupuestoMax || 0),
    moneda: String(body.moneda || "USD").trim(),
    dormitorios_min: Number(body.dormitoriosMin || 0),
    margen_abajo: Number(body.margenAbajo || 30),
    margen_arriba: Number(body.margenArriba || 20),
    permitir_sin_precio: String(body.permitirSinPrecio || "no").trim(),
    moneda_estricta: String(body.monedaEstricta || "no").trim(),
    notas: String(body.notas || "").trim(),
    estado: "demanda"
  }]);
  if (error) console.error("Error demandas/nuevo:", error.message);
  res.redirect("/demandas.html");
});

app.post("/demandas/eliminar/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!isNaN(id)) {
    const { error } = await supabase.from("demandas").delete().eq("id", id);
    if (error) console.error("Error demandas/eliminar:", error.message);
  }
  res.redirect("/demandas.html");
});

// ============================
// MATCHING — Supabase ✅
// ============================

app.get("/api/match-demanda/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.json({ totalMatches: 0, matches: [] });

  const { data: demandaRow } = await supabase.from("demandas").select("*").eq("id", id).single();
  if (!demandaRow) return res.json({ totalMatches: 0, matches: [] });

  const d = {
    tipoOperacion: demandaRow.tipo_operacion,
    zona: demandaRow.zona,
    tipoPropiedad: demandaRow.tipo_propiedad,
    presupuestoMax: demandaRow.presupuesto_max,
    dormitoriosMin: demandaRow.dormitorios_min,
    margenAbajo: demandaRow.margen_abajo,
    margenArriba: demandaRow.margen_arriba,
    permitirSinPrecio: demandaRow.permitir_sin_precio,
    monedaEstricta: demandaRow.moneda_estricta,
    moneda: demandaRow.moneda
  };

  const opD = (d.tipoOperacion || "").toLowerCase();
  const zonaD = (d.zona || "").toLowerCase();
  const tipoD = (d.tipoPropiedad || "").toLowerCase();
  const presD = Number(d.presupuestoMax || 0);
  const dormMin = Number(d.dormitoriosMin || 0);
  const mDown = Number(d.margenAbajo || 30);
  const mUp = Number(d.margenArriba || 20);
  const permitirSinPrecio = String(d.permitirSinPrecio || "no").toLowerCase() === "si";
  const monedaEstricta = String(d.monedaEstricta || "no").toLowerCase() === "si";

  const { data: rows } = await supabase.from("inmuebles").select("*");
  const inmuebles = (rows || []).map(sbToInm);
  const matches = [];

  inmuebles.forEach((inm) => {
    let score = 0;
    const estado = (inm.estadoPublicacion || "").toLowerCase();
    const opI = (inm.tipoOperacion || "").toLowerCase();
    const zonaI = (inm.zona || "").toLowerCase();
    const precioI = Number(inm.precio || 0);
    const dormI = Number(inm.dormitorios || 0);
    const monI = String(inm.moneda || "").toUpperCase();
    const monD = String(d.moneda || "").toUpperCase();

    if (opD && opI && opD !== opI) return;
    if (monedaEstricta && presD > 0 && monD && monI && monD !== monI) return;
    if (!permitirSinPrecio && presD > 0 && (!precioI || precioI <= 0)) return;

    if (presD > 0 && precioI > 0) {
      const minOk = presD * (1 - mDown / 100);
      const maxOk = presD * (1 + mUp / 100);
      if (precioI < minOk || precioI > maxOk) return;
    }

    const textoI = ((inm.titulo || "") + " " + (inm.descripcion || "") + " " + (inm.tipoPropiedad || "")).toLowerCase();

    if (opD && opI && opD === opI) score += 25;
    if (zonaD && zonaI && zonaI.includes(zonaD)) score += 25;
    if (tipoD && textoI.includes(tipoD)) score += 15;

    if (presD > 0 && precioI > 0) {
      const diff = Math.abs(precioI - presD);
      const span = Math.max(1, presD * (mUp / 100) + presD * (mDown / 100));
      score += Math.round(5 + (1 - Math.min(1, diff / span)) * 20);
    } else if (presD === 0) {
      score += 5;
    }

    if (dormMin > 0) {
      if (dormI >= dormMin) score += 10;
      else score -= 8;
    }

    if (estado === "oportunidad") score += 5;

    if (score >= 30) {
      matches.push({
        inmuebleId: inm.id,
        score,
        inmueble: {
          titulo: inm.titulo || "Radar",
          zona: inm.zona || "",
          precio: inm.precio || 0,
          moneda: inm.moneda || "ARS",
          estadoPublicacion: estado
        }
      });
    }
  });

  matches.sort((a, b) => b.score - a.score);
  res.json({ totalMatches: matches.length, matches });
});

app.get("/api/match-inmueble/:id", async (req, res) => {
  const id = Number(req.params.id);

  const { data: row } = await supabase.from("inmuebles").select("*").eq("id", id).single();
  if (!row) return res.json({ totalMatches: 0, matches: [] });

  const inm = sbToInm(row);
  const zonaInm = (inm.zona || "").toLowerCase();
  const opInm = (inm.tipoOperacion || "").toLowerCase();
  const precioInm = Number(inm.precio || 0);
  const dormInm = Number(inm.dormitorios || 0);
  const textoInm = ((inm.titulo || "") + " " + (inm.descripcion || "") + " " + (inm.tipoPropiedad || "")).toLowerCase();

  const { data: compradores } = await supabase.from("compradores").select("*");
  const matches = [];

  (compradores || []).forEach((c, i) => {
    let score = 0;
    const zonaC = (c.zona_preferida || "").toLowerCase();
    const opC = (c.tipo_operacion_buscada || "").toLowerCase();
    const tipoC = (c.tipo_propiedad || "").toLowerCase();
    const presC = Number(c.presupuesto_max || 0);
    const dormMin = Number(c.dormitorios_min || 0);

    if (opC && opInm && opC === opInm) score += 25;
    if (zonaC && zonaInm && zonaInm.includes(zonaC)) score += 25;
    if (tipoC && textoInm.includes(tipoC)) score += 15;
    if (presC > 0 && precioInm > 0 && precioInm <= presC) score += 25;
    if (dormMin > 0 && dormInm >= dormMin) score += 10;

    if (score >= 30) {
      matches.push({
        compradorId: c.id,
        comprador: {
          nombre: c.nombre,
          telefono: c.telefono,
          email: c.email,
          zonaPreferida: c.zona_preferida,
          tipoOperacionBuscada: c.tipo_operacion_buscada,
          tipoPropiedad: c.tipo_propiedad,
          presupuestoMax: c.presupuesto_max,
          moneda: c.moneda
        },
        score
      });
    }
  });

  matches.sort((a, b) => b.score - a.score);
  res.json({ totalMatches: matches.length, matches });
});

// ============================
// RADAR IA / VENDEDORES / LEADS
// ============================

app.post("/api/radar-ia/guardar", (req, res) => {
  const body = req.body || {};
  const item = {
    textoOriginal: String(body.textoOriginal || "").trim(),
    tipo: String(body.tipo || "ambigua").trim().toLowerCase(),
    zona: String(body.zona || "").trim(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "ARS").trim().toUpperCase(),
    dormitorios: Number(body.dormitorios || 0),
    tipoPropiedad: String(body.tipoPropiedad || "").trim(),
    tipoOperacion: String(body.tipoOperacion || "").trim(),
    contacto: String(body.contacto || "").trim(),
    fuente: String(body.fuente || "").trim(),
    ts: Date.now()
  };
  radarIA.push(item);
  guardarRadarIA();
  res.json({ ok: true });
});

app.get("/api/radar-ia", (req, res) => res.json(radarIA));

app.get("/api/radar-vendedores", (req, res) => res.json(vendedoresDetectados));

app.post("/api/radar-vendedores/guardar", (req, res) => {
  const body = req.body || {};
  const item = {
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    zona: String(body.zona || "").trim(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "ARS").trim().toUpperCase(),
    descripcion: String(body.descripcion || "").trim(),
    fuente: String(body.fuente || "").trim(),
    estado: "nuevo",
    ts: Date.now()
  };
  vendedoresDetectados.push(item);
  guardarVendedoresDetectados();
  res.json({ ok: true });
});

app.post("/api/radar-vendedores/editar/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (isNaN(idx) || !vendedoresDetectados[idx]) return res.status(404).json({ ok: false });

  const v = vendedoresDetectados[idx];
  const body = req.body || {};

  if (body.nombre !== undefined) v.nombre = String(body.nombre).trim();
  if (body.telefono !== undefined) v.telefono = String(body.telefono).trim();
  if (body.zona !== undefined) v.zona = String(body.zona).trim();
  if (body.tipoPropiedad !== undefined) v.tipoPropiedad = String(body.tipoPropiedad).trim();
  if (body.precio !== undefined) v.precio = Number(body.precio);
  if (body.moneda !== undefined) v.moneda = String(body.moneda).trim().toUpperCase();
  if (body.descripcion !== undefined) v.descripcion = String(body.descripcion).trim();
  if (body.estado !== undefined) v.estado = String(body.estado).trim();

  guardarVendedoresDetectados();
  res.json({ ok: true });
});

app.post("/api/vendedores-detectados/guardar", (req, res) => {
  const body = req.body || {};
  if (!body.telefono) return res.status(400).json({ ok: false, error: "Telefono requerido" });

  const item = {
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    zona: String(body.zona || "").trim(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "ARS").trim().toUpperCase(),
    descripcion: String(body.descripcion || "").trim(),
    fuente: String(body.fuente || "whatsapp").trim(),
    estado: "nuevo",
    ts: Date.now()
  };
  vendedoresDetectados.push(item);
  guardarVendedoresDetectados();
  res.json({ ok: true });
});

app.get("/api/vendedores-detectados", (req, res) => res.json(vendedoresDetectados));

app.get("/api/radar-leads", (req, res) => res.json(radarLeads));

app.post("/api/radar-leads/editar/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (isNaN(idx) || !radarLeads[idx]) return res.status(404).json({ ok: false });

  const lead = radarLeads[idx];
  const body = req.body || {};

  if (body.nombre !== undefined) lead.nombre = String(body.nombre).trim();
  if (body.telefono !== undefined) lead.telefono = String(body.telefono).trim();
  if (body.zona !== undefined) lead.zona = String(body.zona).trim();
  if (body.tipoPropiedad !== undefined) lead.tipoPropiedad = String(body.tipoPropiedad).trim();
  if (body.presupuesto !== undefined) lead.presupuesto = Number(body.presupuesto);
  if (body.moneda !== undefined) lead.moneda = String(body.moneda).trim().toUpperCase();
  if (body.notas !== undefined) lead.notas = String(body.notas).trim();
  if (body.estado !== undefined) lead.estado = String(body.estado).trim();

  guardarRadarLeads();
  res.json({ ok: true });
});

app.post("/api/radar-leads/guardar", async (req, res) => {
  const body = req.body || {};

  const lead = {
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    zona: String(body.zona || "").trim(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim(),
    tipoOperacion: String(body.tipoOperacion || "").trim(),
    presupuesto: Number(body.presupuesto || 0),
    moneda: String(body.moneda || "ARS").trim().toUpperCase(),
    dormitoriosMin: Number(body.dormitoriosMin || 0),
    notas: String(body.notas || "").trim(),
    fuente: String(body.fuente || "whatsapp").trim(),
    estado: "nuevo",
    ts: Date.now()
  };

  radarLeads.push(lead);
  guardarRadarLeads();
  res.json({ ok: true });
});

app.post("/api/radar-leads/pasar-comprador/:index", async (req, res) => {
  const idx = Number(req.params.index);
  if (isNaN(idx) || !radarLeads[idx]) return res.status(404).json({ ok: false });

  const lead = radarLeads[idx];
  const comprador = {
    nombre: lead.nombre,
    telefono: lead.telefono,
    email: lead.email || "",
    zonaPreferida: lead.zona,
    tipoOperacionBuscada: lead.tipoOperacion || "venta",
    tipoPropiedad: lead.tipoPropiedad,
    presupuestoMax: lead.presupuesto || 0,
    moneda: lead.moneda || "ARS",
    dormitoriosMin: lead.dormitoriosMin || 0,
    notas: lead.notas || "",
    estado: "nuevo",
    ts: Date.now()
  };

  await supabase.from("compradores").insert([{
    nombre: comprador.nombre,
    telefono: comprador.telefono,
    email: comprador.email || "",
    zona_preferida: comprador.zonaPreferida,
    tipo_operacion_buscada: comprador.tipoOperacionBuscada,
    tipo_propiedad: comprador.tipoPropiedad,
    presupuesto_max: comprador.presupuestoMax,
    moneda: comprador.moneda,
    dormitorios_min: comprador.dormitoriosMin,
    notas: comprador.notas,
    estado: "nuevo"
  }]);
  lead.estado = "pasado_comprador";
  guardarRadarLeads();

  res.json({ ok: true });
});

app.get("/api/radar-leads/match/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (isNaN(idx) || !radarLeads[idx]) return res.json({ totalMatches: 0, matches: [] });

  const lead = radarLeads[idx];
  res.json({ totalMatches: 0, matches: [], nota: "Match desde Supabase pendiente" });
});

app.post("/api/analizar-mensaje", (req, res) => {
  res.json({ ok: true, analisis: "pendiente" });
});

app.post("/api/transcribir-audio", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Sin audio" });

  try {
    const transcripcion = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1",
      language: "es"
    });
    res.json({ ok: true, texto: transcripcion.text });
  } catch (e) {
    console.error("Error transcripción:", e.message);
    res.status(500).json({ ok: false, error: "Error al transcribir" });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});

// RATING
app.post("/api/rating", async (req, res) => {
  const { propiedad_id, rating } = req.body;
  const id = Number(propiedad_id);

  if (!isNaN(id)) {
    await supabase.from("inmuebles").update({ rating: Number(rating) }).eq("id", id);
  }

  res.json({ ok: true });
});

// ============================
// PDF FICHA — lee de Supabase
// ============================

app.get("/api/ficha-pdf/:id", async (req, res) => {
  const id = Number(req.params.id);

  const { data: row } = await supabase.from("inmuebles").select("*").eq("id", id).single();
  if (!row) return res.status(404).send("Propiedad no encontrada");

  const p = sbToInm(row);

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="ficha-${id}.pdf"`);
  doc.pipe(res);

  const VERDE = "#1a3a2a";
  const DORADO = "#c9a96e";
  const W = 495;

  doc.rect(0, 0, 595, 80).fill(VERDE);
  doc.fillColor("white").fontSize(22).font("Helvetica-Bold").text("Vanina Buzzacchi", 50, 20, { width: W });
  doc.fontSize(11).font("Helvetica").text("Negocios Inmobiliarios - Rio Cuarto, Cordoba", 50, 48);

  doc.fillColor(VERDE).fontSize(18).font("Helvetica-Bold").text(limpiarTexto(p.titulo), 50, 100, { width: W });
  doc.moveTo(50, 125).lineTo(545, 125).strokeColor(DORADO).lineWidth(2).stroke();

  let posY = 140;
  const badge = p.tipoOperacion === "venta" ? "VENTA" : "ALQUILER";
  doc.roundedRect(50, posY, 70, 20, 4).fill(DORADO);
  doc.fillColor(VERDE).fontSize(10).font("Helvetica-Bold").text(badge, 50, posY + 4, { width: 70, align: "center" });
  posY += 32;

  const fila = (label, valor) => {
    if (!valor || valor === "-" || valor === "0") return;
    doc.fillColor("#555").fontSize(10).font("Helvetica-Bold").text(label, 50, posY);
    doc.fillColor("#111").fontSize(10).font("Helvetica").text(limpiarTexto(String(valor)), 180, posY);
    posY += 20;
  };

  fila("Tipo:", p.tipoPropiedad || "-");
  fila("Zona:", p.zona);
  fila("Direccion:", p.direccion);
  fila("Precio:", `${p.moneda || "USD"} ${Number(p.precio || 0).toLocaleString("es-AR")}`);
  fila("Dormitorios:", p.dormitorios ? String(p.dormitorios) : null);
  fila("Banos:", p.banos ? String(p.banos) : null);

  posY += 8;
  doc.moveTo(50, posY).lineTo(545, posY).strokeColor("#ddd").lineWidth(1).stroke();
  posY += 16;

  const imagenes = (p.imagenes || []).slice(0, 4);
  if (imagenes.length > 0) {
    doc.fillColor(VERDE).fontSize(12).font("Helvetica-Bold").text("Fotos", 50, posY);
    posY += 16;

    const fotoW = 220;
    const fotoH = 150;
    const gap = 15;
    const BASE = "https://inmocreador-crm.onrender.com";

    for (let fi = 0; fi < imagenes.length; fi++) {
      const fx = fi % 2 === 0 ? 50 : 50 + fotoW + gap;
      if (fi % 2 === 0 && fi > 0) posY += fotoH + gap;

      const buffer = await descargarImagen(`${BASE}/uploads/${imagenes[fi]}`);
      if (buffer) {
        try {
          doc.image(buffer, fx, posY, { width: fotoW, height: fotoH, cover: [fotoW, fotoH] });
        } catch (e) {
          doc.rect(fx, posY, fotoW, fotoH).fill("#eee");
        }
      } else {
        doc.rect(fx, posY, fotoW, fotoH).fill("#eee");
      }
    }

    posY += fotoH + gap + 10;
  }

  doc.moveTo(50, posY).lineTo(545, posY).strokeColor("#ddd").lineWidth(1).stroke();
  posY += 14;
  doc.fillColor(VERDE).fontSize(12).font("Helvetica-Bold").text("Descripcion", 50, posY);
  posY += 18;

  const descLimpia = limpiarTexto(p.descripcion || "Sin descripcion disponible.")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");

  doc.fillColor("#333").fontSize(10).font("Helvetica").text(descLimpia, 50, posY, {
    width: W,
    lineGap: 3
  });

  const pageH = doc.page.height;
  doc.rect(0, pageH - 50, 595, 50).fill("#f5f5f5");
  doc.fillColor("#888").fontSize(9).font("Helvetica").text(
    "Documento informativo. Precios sujetos a modificacion.",
    50, pageH - 38, { width: W, align: "center" }
  );
  doc.fillColor(VERDE).fontSize(9).font("Helvetica-Bold").text(
    "Vanina Buzzacchi Negocios Inmobiliarios - Rio Cuarto, Cordoba",
    50, pageH - 24, { width: W, align: "center" }
  );

  doc.end();
});

// ============================
// SERVER
// ============================

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
