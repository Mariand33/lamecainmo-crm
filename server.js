// SERVER.JS
// EQUIPO BUZZACCHI - SUPABASE SOLO PARA INMUEBLES

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

// Convierte fila de Supabase al formato que usan tus frontends
function sbToInm(row) {
  if (!row) return null;
  return {
    id: row.id,
    titulo: row.titulo || "",
    zona: row.zona || "",
    tipoOperacion: row.tipo_operacion || "",
    precio: Number(row.precio || 0),
    moneda: row.moneda || "USD",
    dormitorios: Number(row.dormitorios || 0),
    banos: Number(row.banos || 0),
    direccion: row.direccion || "",
    tipoPropiedad: row.tipo_propiedad || "",
    descripcion: row.descripcion || "",
    imagenes: Array.isArray(row.imagenes) ? row.imagenes : [],
    thumbnails: Array.isArray(row.thumbnails) ? row.thumbnails : [],
    video: row.video || "",
    creadoPor: row.creado_por || "",
    estadoPublicacion: row.estado_publicacion || "borrador",
    cantidadPublicaciones: Number(row.cantidad_publicaciones || 0),
    leads: Array.isArray(row.leads) ? row.leads : [],
    fechaCreacion: row.fecha_creacion || null,
    rating: Number(row.rating || 0)
  };
}

// Convierte payload del frontend al formato Supabase
function inmToSb(inm) {
  return {
    titulo: inm.titulo || "",
    zona: inm.zona || "",
    tipo_operacion: inm.tipoOperacion || "",
    precio: Number(inm.precio || 0),
    moneda: inm.moneda || "USD",
    dormitorios: Number(inm.dormitorios || 0),
    banos: Number(inm.banos || 0),
    direccion: inm.direccion || "",
    tipo_propiedad: inm.tipoPropiedad || "",
    descripcion: inm.descripcion || "",
    imagenes: Array.isArray(inm.imagenes) ? inm.imagenes : [],
    thumbnails: Array.isArray(inm.thumbnails) ? inm.thumbnails : [],
    video: inm.video || "",
    creado_por: inm.creadoPor || "",
    estado_publicacion: inm.estadoPublicacion || "borrador",
    cantidad_publicaciones: Number(inm.cantidadPublicaciones || 0),
    leads: Array.isArray(inm.leads) ? inm.leads : [],
    rating: Number(inm.rating || 0)
  };
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
app.use(express.static(path.join(__dirname, "public")));

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

// JSON locales SOLO para módulos no migrados
let compradores = [];
let demandas = [];
let notificaciones = [];
let radarIA = [];
let vendedoresDetectados = [];
let radarLeads = [];

const DATA_DIR = path.join(__dirname, "data");
const COMPR_FILE = path.join(DATA_DIR, "compradores.json");
const DEM_FILE = path.join(DATA_DIR, "demandas.json");
const NOTIF_FILE = path.join(DATA_DIR, "notificaciones.json");
const RADAR_IA_FILE = path.join(DATA_DIR, "radar_ia.json");
const VENDEDORES_FILE = path.join(DATA_DIR, "vendedores_detectados.json");
const RADAR_LEADS_FILE = path.join(DATA_DIR, "radar_leads.json");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const THUMBS_DIR = path.join(__dirname, "public", "uploads", "thumbs");
if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });

// ============================
// PERSISTENCIA JSON
// ============================

function guardarCompradores() {
  guardarJSON(COMPR_FILE, compradores);
}
function guardarDemandas() {
  guardarJSON(DEM_FILE, demandas);
}
function guardarNotificaciones() {
  guardarJSON(NOTIF_FILE, notificaciones);
}
function guardarRadarIA() {
  guardarJSON(RADAR_IA_FILE, radarIA);
}
function guardarVendedoresDetectados() {
  guardarJSON(VENDEDORES_FILE, vendedoresDetectados);
}
function guardarRadarLeads() {
  guardarJSON(RADAR_LEADS_FILE, radarLeads);
}

asegurarArrayJSON(COMPR_FILE, compradores);
asegurarArrayJSON(DEM_FILE, demandas);
asegurarArrayJSON(NOTIF_FILE, notificaciones);
asegurarArrayJSON(RADAR_IA_FILE, radarIA);
asegurarArrayJSON(VENDEDORES_FILE, vendedoresDetectados);
asegurarArrayJSON(RADAR_LEADS_FILE, radarLeads);

function leerLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) {
      fs.writeFileSync(LEADS_FILE, "[]", "utf8");
    }
    return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8") || "[]");
  } catch (e) {
    console.log("Error leyendo leads:", e.message);
    return [];
  }
}

function guardarLeads(leads) {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), "utf8");
  } catch (e) {
    console.log("Error guardando leads:", e.message);
  }
}

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
  res.send("TEST RENDER OK");
});

// ============================
// AUTH
// ============================

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = usuarios.find((u) => u.email === email && u.password === password);

  if (!user) {
    return res.status(401).send("Usuario incorrecto");
  }

  req.session.user = user;

  if (user.rol === "marketing") {
    return res.redirect("/marketing.html");
  }

  return res.redirect("/dashboard.html");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login.html"));
});

// ============================
// INMUEBLES (SUPABASE)
// ============================

app.post(
  "/guardar",
  upload.fields([
    { name: "imagenes", maxCount: 20 },
    { name: "video", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      if (!supabase) return res.status(500).send("Supabase no configurado");

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

      const { data, error } = await supabase
        .from("inmuebles")
        .insert([inmToSb(nuevo)])
        .select()
        .single();

      if (error) {
        console.error("Error Supabase /guardar:", error);
        return res.status(500).send("No se pudo guardar el inmueble");
      }

      pushNotif(notificaciones, guardarNotificaciones, {
        tipo: "nuevo_inmueble",
        titulo: nuevo.titulo,
        zona: nuevo.zona,
        precio: nuevo.precio,
        moneda: nuevo.moneda,
        operacion: nuevo.tipoOperacion,
        creadoPor: nuevo.creadoPor,
        idInmueble: data.id
      });

      res.redirect("/dashboard.html");
    } catch (e) {
      console.error(e);
      res.status(500).send("Error interno");
    }
  }
);

app.post("/oportunidad", upload.single("thumb"), async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

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
      imagenes,
      thumbnails,
      creadoPor: req.session.user ? req.session.user.email : "sistema",
      estadoPublicacion: "oportunidad",
      cantidadPublicaciones: 0,
      leads: []
    };

    const { data, error } = await supabase
      .from("inmuebles")
      .insert([inmToSb(nueva)])
      .select()
      .single();

    if (error) {
      console.error("Error Supabase /oportunidad:", error);
      return res.status(500).send("No se pudo guardar la oportunidad");
    }

    pushNotif(notificaciones, guardarNotificaciones, {
      tipo: "nueva_oportunidad",
      titulo: nueva.titulo,
      zona: nueva.zona,
      precio: nueva.precio,
      moneda: nueva.moneda,
      idInmueble: data.id
    });

    res.redirect("/dashboard.html");
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

app.post("/radar", upload.single("thumb"), async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

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
      descripcion: String(body.nota || "").trim(),
      precio: Number(body.precio || 0),
      moneda: String(body.moneda || "ARS").trim().toUpperCase(),
      dormitorios: Number(body.dormitorios || 0),
      banos: Number(body.banos || 0),
      imagenes,
      thumbnails,
      creadoPor: req.session.user ? req.session.user.email : "desconocido",
      estadoPublicacion: "radar",
      cantidadPublicaciones: 0,
      leads: []
    };

    const { data, error } = await supabase
      .from("inmuebles")
      .insert([inmToSb(nuevo)])
      .select()
      .single();

    if (error) {
      console.error("Error Supabase /radar:", error);
      return res.status(500).send("No se pudo guardar el radar");
    }

    pushNotif(notificaciones, guardarNotificaciones, {
      tipo: "nuevo_radar",
      titulo: nuevo.titulo,
      zona: nuevo.zona,
      operacion: nuevo.tipoOperacion,
      idInmueble: data.id
    });

    res.redirect("/dashboard.html");
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

app.post("/editar/:id", upload.array("imagenes", 20), async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/dashboard.html");

    const { data: current, error: fetchError } = await supabase
      .from("inmuebles")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !current) return res.redirect("/dashboard.html");

    const inm = sbToInm(current);

    inm.titulo = String(req.body.titulo || inm.titulo || "").trim();
    inm.zona = String(req.body.zona || inm.zona || "").trim();
    inm.tipoOperacion = String(req.body.tipoOperacion || inm.tipoOperacion || "").trim();
    inm.tipoPropiedad = String(req.body.tipoPropiedad || inm.tipoPropiedad || "").trim();
    inm.direccion = String(req.body.direccion || inm.direccion || "").trim();
    inm.precio = Number(req.body.precio || inm.precio || 0);
    inm.moneda = String(req.body.moneda || inm.moneda || "USD").trim();
    inm.dormitorios = Number(req.body.dormitorios || inm.dormitorios || 0);
    inm.banos = Number(req.body.banos || inm.banos || 0);
    inm.descripcion = String(req.body.descripcion || inm.descripcion || "").trim();

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
      inm.imagenes = pares.map((p) => p.nombre).filter(Boolean);
    }

    if (!Array.isArray(inm.thumbnails)) inm.thumbnails = [];

    if (req.files && req.files.length) {
      const nuevas = req.files.map((f) => f.filename);
      inm.imagenes = [...new Set((inm.imagenes || []).concat(nuevas))];

      for (const foto of nuevas) {
        const thumb = await generarThumbnail(foto);
        if (thumb) inm.thumbnails.push(thumb);
      }

      inm.thumbnails = [...new Set(inm.thumbnails)];
    }

    const { error: updateError } = await supabase
      .from("inmuebles")
      .update(inmToSb(inm))
      .eq("id", id);

    if (updateError) {
      console.error("Error Supabase /editar:", updateError);
      return res.status(500).send("No se pudo editar el inmueble");
    }

    pushNotif(notificaciones, guardarNotificaciones, {
      tipo: "inmueble_editado",
      titulo: inm.titulo,
      idInmueble: id
    });

    res.redirect("/ver.html?id=" + id);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

app.post("/editar/:id/fotos/eliminar", async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

    const id = Number(req.params.id);
    const nombreFoto = String(req.body.nombreFoto || "").trim();

    if (Number.isNaN(id) || !nombreFoto) {
      return res.status(400).send("Parametros invalidos");
    }

    const { data: current, error: fetchError } = await supabase
      .from("inmuebles")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !current) {
      return res.status(404).send("Inmueble no encontrado");
    }

    const inm = sbToInm(current);
    inm.imagenes = (inm.imagenes || []).filter((f) => f !== nombreFoto);
    inm.thumbnails = (inm.thumbnails || []).filter((f) => f !== nombreFoto);

    try {
      const fp = path.join(__dirname, "public", "uploads", nombreFoto);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (e) {
      console.log("No se pudo borrar foto original:", e.message);
    }

    try {
      const tp = path.join(__dirname, "public", "uploads", "thumbs", nombreFoto);
      if (fs.existsSync(tp)) fs.unlinkSync(tp);
    } catch (e) {
      console.log("No se pudo borrar thumbnail:", e.message);
    }

    const { error: updateError } = await supabase
      .from("inmuebles")
      .update({
        imagenes: inm.imagenes,
        thumbnails: inm.thumbnails
      })
      .eq("id", id);

    if (updateError) {
      console.error("Error Supabase /fotos/eliminar:", updateError);
      return res.status(500).send("No se pudo eliminar la foto");
    }

    pushNotif(notificaciones, guardarNotificaciones, {
      tipo: "foto_eliminada",
      titulo: inm.titulo,
      idInmueble: id
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

app.post("/publicar/:id", async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/dashboard.html");

    const { data: current, error: fetchError } = await supabase
      .from("inmuebles")
      .select("cantidad_publicaciones,titulo")
      .eq("id", id)
      .single();

    if (fetchError || !current) return res.redirect("/dashboard.html");

    const { error } = await supabase
      .from("inmuebles")
      .update({
        estado_publicacion: "lista",
        cantidad_publicaciones: Number(current.cantidad_publicaciones || 0) + 1
      })
      .eq("id", id);

    if (error) {
      console.error("Error Supabase /publicar:", error);
      return res.status(500).send("No se pudo publicar");
    }

    pushNotif(notificaciones, guardarNotificaciones, {
      tipo: "inmueble_lista",
      titulo: current.titulo,
      idInmueble: id
    });

    res.redirect("/dashboard.html");
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

app.post("/publicada/:id", async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/marketing.html");

    const { data: current, error: fetchError } = await supabase
      .from("inmuebles")
      .select("titulo")
      .eq("id", id)
      .single();

    if (fetchError || !current) return res.redirect("/marketing.html");

    const { error } = await supabase
      .from("inmuebles")
      .update({ estado_publicacion: "publicada" })
      .eq("id", id);

    if (error) {
      console.error("Error Supabase /publicada:", error);
      return res.status(500).send("No se pudo marcar publicada");
    }

    pushNotif(notificaciones, guardarNotificaciones, {
      tipo: "inmueble_publicada",
      titulo: current.titulo,
      idInmueble: id
    });

    res.redirect("/marketing.html");
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

app.post("/eliminar/:id", async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/dashboard.html");

    const { data: current, error: fetchError } = await supabase
      .from("inmuebles")
      .select("imagenes,thumbnails")
      .eq("id", id)
      .single();

    if (!fetchError && current) {
      const row = sbToInm(current);

      if (Array.isArray(row.imagenes)) {
        row.imagenes.forEach((f) => {
          try {
            const file = path.join(__dirname, "public", "uploads", f);
            if (fs.existsSync(file)) fs.unlinkSync(file);
          } catch {}
        });
      }

      if (Array.isArray(row.thumbnails)) {
        row.thumbnails.forEach((f) => {
          try {
            const file = path.join(__dirname, "public", "uploads", "thumbs", f);
            if (fs.existsSync(file)) fs.unlinkSync(file);
          } catch {}
        });
      }
    }

    const { error } = await supabase
      .from("inmuebles")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error Supabase /eliminar:", error);
      return res.status(500).send("No se pudo eliminar");
    }

    res.redirect("/dashboard.html");
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

app.get("/marketing/zip/:id", async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

    const id = Number(req.params.id);
    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).send("Inmueble no encontrado");

    const inm = sbToInm(data);

    if (!Array.isArray(inm.imagenes) || inm.imagenes.length === 0) {
      return res.status(400).send("Sin fotos");
    }

    const archive = archiver("zip");
    res.attachment("fotos.zip");
    archive.pipe(res);

    inm.imagenes.forEach((f) => {
      const file = path.join(__dirname, "public", "uploads", f);
      if (fs.existsSync(file)) archive.file(file, { name: f });
    });

    archive.finalize();
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

// ============================
// APIS BASICAS
// ============================

// Devuelve todos los inmuebles (dashboard / editar / ver)
app.get("/api/inmuebles", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Supabase no configurado" });
    }

    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error("Supabase error /api/inmuebles:", error);
      return res.status(500).json({ ok: false, error: "Error cargando inmuebles" });
    }

    res.json((data || []).map(sbToInm));
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});
// ✅ Ruta interna — devuelve TODOS los inmuebles (para el dashboard)
app.get("/api/inmuebles", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .order("id", { ascending: false });

    if (error) throw error;

    res.json((data || []).map(sbToInm));
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});
// Solo públicos para funnel
app.get("/api/inmuebles-publicos", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Supabase no configurado" });
    }

    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .in("estado_publicacion", ["lista", "publicada"])
      .order("id", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ ok: false, error: "Error cargando inmuebles" });
    }

    res.json((data || []).map(sbToInm));
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

app.get("/api/inmuebles-publicos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!supabase) {
      return res.status(500).json({ ok: false, error: "Supabase no configurado" });
    }

    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ ok: false, error: "Propiedad no encontrada" });
    }

    const inm = sbToInm(data);
    const estado = String(inm.estadoPublicacion || "").toLowerCase();

    if (estado !== "lista" && estado !== "publicada") {
      return res.status(403).json({ ok: false, error: "Propiedad no pública" });
    }

    res.json(inm);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

app.get("/api/compradores", (req, res) => {
  res.json(compradores);
});

app.get("/api/demandas", (req, res) => {
  res.json(demandas);
});

app.get("/api/notificaciones", (req, res) => {
  const since = Number(req.query.since || 0);
  res.json({
    items: notificaciones.filter((n) => Number(n.ts || 0) > since)
  });
});

// ============================
// LEADS PUBLICOS
// ============================

app.get("/api/leads", (req, res) => {
  res.json(leerLeads());
});

app.post("/api/leads", (req, res) => {
  const leads = leerLeads();

  const nuevoLead = {
    id: Date.now(),
    mensajeOriginal: req.body.mensajeOriginal || "",
    tipoLead: req.body.tipoLead || "comprador",
    operacion: req.body.operacion || "",
    tipo: req.body.tipo || "",
    zona: req.body.zona || "",
    dormitorios: req.body.dormitorios || "",
    precio: req.body.precio || "",
    estado: "nuevo",
    origen: req.body.origen || "funnel",
    nombre: req.body.nombre || "",
    telefono: req.body.telefono || "",
    asesor: req.body.asesor || "",
    fecha: new Date().toISOString()
  };

  leads.push(nuevoLead);
  guardarLeads(leads);

  res.json({ ok: true, lead: nuevoLead });
});

// ============================
// COMPRADORES
// ============================

app.post("/compradores/nuevo", (req, res) => {
  const nuevo = {
    nombre: (req.body.nombre || "Sin nombre").trim(),
    telefono: (req.body.telefono || "").trim(),
    email: (req.body.email || "").trim(),
    tipoOperacionBuscada: (req.body.tipoOperacionBuscada || "").trim(),
    tipoPropiedad: (req.body.tipoPropiedad || "").trim(),
    zonaPreferida: (req.body.zonaPreferida || "").trim(),
    presupuestoMax: Number(req.body.presupuestoMax || 0),
    moneda: (req.body.moneda || "USD").trim(),
    dormitoriosMin: Number(req.body.dormitoriosMin || 0),
    estado: (req.body.estado || "tibio").trim(),
    notas: (req.body.notas || "").trim(),
    creadoPor: req.session.user ? req.session.user.email : "desconocido",
    fechaAlta: new Date().toLocaleString()
  };

  compradores.push(nuevo);
  guardarCompradores();
  res.redirect("/compradores.html");
});

app.post("/compradores/editar/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (Number.isNaN(idx) || !compradores[idx]) return res.redirect("/compradores.html");

  compradores[idx] = {
    ...compradores[idx],
    nombre: (req.body.nombre || "Sin nombre").trim(),
    telefono: (req.body.telefono || "").trim(),
    email: (req.body.email || "").trim(),
    tipoOperacionBuscada: (req.body.tipoOperacionBuscada || "").trim(),
    tipoPropiedad: (req.body.tipoPropiedad || "").trim(),
    zonaPreferida: (req.body.zonaPreferida || "").trim(),
    presupuestoMax: Number(req.body.presupuestoMax || 0),
    moneda: (req.body.moneda || "USD").trim(),
    dormitoriosMin: Number(req.body.dormitoriosMin || 0),
    estado: (req.body.estado || "tibio").trim(),
    notas: (req.body.notas || "").trim()
  };

  guardarCompradores();
  res.redirect("/compradores.html");
});

// ============================
// DEMANDAS
// ============================

app.post("/demandas/nuevo", (req, res) => {
  const nueva = {
    tipoOperacion: (req.body.tipoOperacion || "").toLowerCase(),
    tipoPropiedad: (req.body.tipoPropiedad || "").toLowerCase(),
    zona: (req.body.zona || "").toLowerCase(),
    presupuestoMax: Number(req.body.presupuestoMax || 0),
    moneda: (req.body.moneda || "ARS").toUpperCase(),
    dormitoriosMin: Number(req.body.dormitoriosMin || 0),
    margenAbajo: Number(req.body.margenAbajo || 30),
    margenArriba: Number(req.body.margenArriba || 20),
    monedaEstricta: String(req.body.monedaEstricta || "no").toLowerCase(),
    permitirSinPrecio: String(req.body.permitirSinPrecio || "no").toLowerCase(),
    toleranteTipo: String(req.body.toleranteTipo || "si").toLowerCase(),
    notas: req.body.notas || "",
    contacto: req.body.contacto || "",
    creadoPor: req.session.user ? req.session.user.email : "desconocido",
    fecha: new Date().toISOString(),
    estado: "demanda"
  };

  demandas.push(nueva);
  guardarDemandas();

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "nueva_demanda",
    titulo: "Demanda: " + (nueva.tipoPropiedad || "propiedad"),
    zona: nueva.zona,
    precio: nueva.presupuestoMax,
    moneda: nueva.moneda
  });

  res.redirect("/demandas.html");
});

app.post("/demandas/eliminar/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (!Number.isNaN(idx) && demandas[idx]) {
    demandas.splice(idx, 1);
    guardarDemandas();
  }
  res.redirect("/demandas.html");
});

// ============================
// MATCHING
// ============================

app.get("/api/match-demanda/:index", async (req, res) => {
  try {
    const idx = Number(req.params.index);
    if (Number.isNaN(idx) || !demandas[idx]) return res.json({ totalMatches: 0, matches: [] });

    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase no configurado" });

    const d = demandas[idx];
    const opD = (d.tipoOperacion || "").toLowerCase();
    const zonaD = (d.zona || "").toLowerCase();
    const tipoD = (d.tipoPropiedad || "").toLowerCase();
    const presD = Number(d.presupuestoMax || 0);
    const dormMin = Number(d.dormitoriosMin || 0);
    const mDown = Number(d.margenAbajo || 30);
    const mUp = Number(d.margenArriba || 20);
    const permitirSinPrecio = String(d.permitirSinPrecio || "no").toLowerCase() === "si";
    const monedaEstricta = String(d.monedaEstricta || "no").toLowerCase() === "si";

    const { data, error } = await supabase.from("inmuebles").select("*");
    if (error) return res.status(500).json({ ok: false, error: "Error cargando inmuebles" });

    const inmuebles = (data || []).map(sbToInm);
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
          idInmueble: inm.id,
          score,
          inmueble: {
            id: inm.id,
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

app.get("/api/match-inmueble/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.json({ totalMatches: 0, matches: [] });
    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase no configurado" });

    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return res.json({ totalMatches: 0, matches: [] });

    const inm = sbToInm(data);
    const zonaInm = (inm.zona || "").toLowerCase();
    const opInm = (inm.tipoOperacion || "").toLowerCase();
    const precioInm = Number(inm.precio || 0);
    const dormInm = Number(inm.dormitorios || 0);
    const textoInm = ((inm.titulo || "") + " " + (inm.descripcion || "") + " " + (inm.tipoPropiedad || "")).toLowerCase();

    const matches = [];

    compradores.forEach((c, i) => {
      let score = 0;
      const zonaC = (c.zonaPreferida || "").toLowerCase();
      const opC = (c.tipoOperacionBuscada || "").toLowerCase();
      const tipoC = (c.tipoPropiedad || "").toLowerCase();
      const presC = Number(c.presupuestoMax || 0);
      const dormMin = Number(c.dormitoriosMin || 0);

      if (opC && opInm && opC === opInm) score += 25;
      if (zonaC && zonaInm && zonaInm.includes(zonaC)) score += 25;
      if (tipoC && textoInm.includes(tipoC)) score += 15;
      if (presC > 0 && precioInm > 0 && precioInm <= presC) score += 25;
      if (dormMin > 0 && dormInm >= dormMin) score += 10;

      if (score >= 30) {
        matches.push({
          indexComprador: i,
          comprador: {
            nombre: c.nombre,
            telefono: c.telefono,
            email: c.email,
            zonaPreferida: c.zonaPreferida,
            tipoOperacionBuscada: c.tipoOperacionBuscada,
            tipoPropiedad: c.tipoPropiedad,
            presupuestoMax: c.presupuestoMax,
            moneda: c.moneda
          },
          score
        });
      }
    });

    matches.sort((a, b) => b.score - a.score);
    res.json({ totalMatches: matches.length, matches });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

// ============================
// RADAR IA / VENDEDORES / LEADS
// ============================

app.post("/api/radar-ia/guardar", (req, res) => {
  const body = req.body || {};

  const item = {
    textoOriginal: String(body.textoOriginal || "").trim(),
    tipo: String(body.tipo || "ambigua").trim().toLowerCase(),
    tipoOperacion: String(body.tipoOperacion || "").trim().toLowerCase(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim().toLowerCase(),
    zona: String(body.zona || "").trim(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "ARS").trim().toUpperCase(),
    dormitoriosMin: Number(body.dormitoriosMin || 0),
    confianza: Number(body.confianza || 0),
    sugerencia: String(body.sugerencia || "").trim(),
    estado: "nuevo",
    fecha: new Date().toISOString()
  };

  radarIA.unshift(item);
  if (radarIA.length > 500) radarIA = radarIA.slice(0, 500);
  guardarRadarIA();

  pushNotif(notificaciones, guardarNotificaciones, {
    tipo: "nuevo_radar_ia",
    titulo: item.tipoPropiedad || "Publicacion detectada",
    zona: item.zona,
    precio: item.precio,
    moneda: item.moneda
  });

  res.json({ ok: true, total: radarIA.length });
});

app.get("/api/radar-ia", (req, res) => res.json(radarIA));
app.get("/api/radar-vendedores", (req, res) => res.json(vendedoresDetectados));
app.get("/api/vendedores-detectados", (req, res) => res.json(vendedoresDetectados));
app.get("/api/radar-leads", (req, res) => res.json(radarLeads));

app.post("/api/radar-vendedores/guardar", (req, res) => {
  const body = req.body || {};

  vendedoresDetectados.unshift({
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    direccion: String(body.direccion || "").trim(),
    zona: String(body.zona || "").trim(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim().toLowerCase(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "USD").trim().toUpperCase(),
    origen: String(body.origen || "facebook").trim().toLowerCase(),
    nivel: String(body.nivel || "posible").trim().toLowerCase(),
    notas: String(body.notas || "").trim(),
    fecha: new Date().toISOString()
  });

  if (vendedoresDetectados.length > 1000) vendedoresDetectados = vendedoresDetectados.slice(0, 1000);
  guardarVendedoresDetectados();
  res.json({ ok: true, total: vendedoresDetectados.length });
});

app.post("/api/radar-vendedores/editar/:index", (req, res) => {
  const idx = Number(req.params.index);
  const body = req.body || {};

  if (Number.isNaN(idx) || !vendedoresDetectados[idx]) {
    return res.status(400).json({ ok: false, error: "Vendedor no encontrado" });
  }

  vendedoresDetectados[idx] = {
    ...vendedoresDetectados[idx],
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    direccion: String(body.direccion || "").trim(),
    zona: String(body.zona || "").trim(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim().toLowerCase(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "USD").trim().toUpperCase(),
    origen: String(body.origen || "facebook").trim().toLowerCase(),
    nivel: String(body.nivel || "posible").trim().toLowerCase(),
    notas: String(body.notas || "").trim(),
    fechaActualizacion: new Date().toISOString()
  };

  guardarVendedoresDetectados();
  res.json({ ok: true, vendedor: vendedoresDetectados[idx] });
});

app.post("/api/vendedores-detectados/guardar", (req, res) => {
  const body = req.body || {};
  const telefono = String(body.telefono || "").trim();

  if (!telefono) {
    return res.status(400).json({ ok: false, error: "Telefono requerido" });
  }

  const existe = vendedoresDetectados.find((v) => String(v.telefono || "").trim() === telefono);
  if (existe) {
    return res.json({ ok: true, duplicado: true, total: vendedoresDetectados.length });
  }

  vendedoresDetectados.unshift({
    nombre: String(body.nombre || "Vendedor detectado").trim(),
    telefono,
    zona: String(body.zona || "").trim(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim(),
    tipoOperacion: String(body.tipoOperacion || "").trim(),
    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "ARS").trim().toUpperCase(),
    textoOriginal: String(body.textoOriginal || "").trim(),
    origen: "radar ia",
    estado: "nuevo",
    fecha: new Date().toISOString()
  });

  if (vendedoresDetectados.length > 1000) vendedoresDetectados = vendedoresDetectados.slice(0, 1000);
  guardarVendedoresDetectados();
  res.json({ ok: true, total: vendedoresDetectados.length });
});

app.post("/api/radar-leads/editar/:index", (req, res) => {
  const idx = Number(req.params.index);
  const body = req.body || {};

  if (Number.isNaN(idx) || !radarLeads[idx]) {
    return res.status(400).json({ ok: false, error: "Lead no encontrado" });
  }

  radarLeads[idx] = {
    ...radarLeads[idx],
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    instagram: String(body.instagram || "").trim(),
    origen: String(body.origen || "instagram").trim().toLowerCase(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim().toLowerCase(),
    tipoOperacion: String(body.tipoOperacion || "").trim().toLowerCase(),
    zona: String(body.zona || "").trim(),
    presupuestoMax: Number(body.presupuestoMax || 0),
    moneda: String(body.moneda || "USD").trim().toUpperCase(),
    dormitoriosMin: Number(body.dormitoriosMin || 0),
    nivel: String(body.nivel || "activo").trim().toLowerCase(),
    notas: String(body.notas || "").trim(),
    fechaActualizacion: new Date().toISOString()
  };

  guardarRadarLeads();
  res.json({ ok: true, lead: radarLeads[idx] });
});

app.post("/api/radar-leads/guardar", (req, res) => {
  const body = req.body || {};

  const nuevo = {
    nombre: String(body.nombre || "").trim(),
    telefono: String(body.telefono || "").trim(),
    instagram: String(body.instagram || "").trim(),
    origen: String(body.origen || "instagram").trim().toLowerCase(),
    tipoLead: String(body.tipoLead || "indefinido").trim().toLowerCase(),
    tipoPropiedad: String(body.tipoPropiedad || "").trim().toLowerCase(),
    tipoOperacion: String(body.tipoOperacion || "").trim().toLowerCase(),
    zona: String(body.zona || "").trim(),
    presupuestoMax: Number(body.presupuestoMax || 0),
    moneda: String(body.moneda || "USD").trim().toUpperCase(),
    dormitoriosMin: Number(body.dormitoriosMin || 0),
    nivel: String(body.nivel || "activo").trim().toLowerCase(),
    notas: String(body.notas || "").trim(),
    fecha: new Date().toISOString()
  };

  radarLeads.unshift(nuevo);
  if (radarLeads.length > 1000) radarLeads = radarLeads.slice(0, 1000);
  guardarRadarLeads();

  res.json({ ok: true, total: radarLeads.length });
});

app.post("/api/radar-leads/pasar-comprador/:index", (req, res) => {
  const idx = Number(req.params.index);

  if (Number.isNaN(idx) || !radarLeads[idx]) {
    return res.status(400).json({ ok: false, error: "Lead no encontrado" });
  }

  const lead = radarLeads[idx];

  const nuevoComprador = {
    nombre: lead.nombre || "Sin nombre",
    telefono: lead.telefono || "",
    email: "",
    tipoOperacionBuscada: lead.tipoOperacion || "",
    tipoPropiedad: lead.tipoPropiedad || "",
    zonaPreferida: lead.zona || "",
    presupuestoMax: Number(lead.presupuestoMax || 0),
    moneda: lead.moneda || "USD",
    dormitoriosMin: Number(lead.dormitoriosMin || 0),
    estado: "nuevo",
    notas: lead.notas || "",
    creadoPor: req.session.user ? req.session.user.email : "radar",
    fechaAlta: new Date().toLocaleString()
  };

  compradores.push(nuevoComprador);
  guardarCompradores();
  res.json({ ok: true, comprador: nuevoComprador });
});

app.get("/api/radar-leads/match/:index", async (req, res) => {
  try {
    const idx = Number(req.params.index);
    if (Number.isNaN(idx) || !radarLeads[idx]) return res.json({ totalMatches: 0, matches: [] });
    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase no configurado" });

    const lead = radarLeads[idx];
    const zonaL = (lead.zona || "").toLowerCase();
    const opL = (lead.tipoOperacion || "").toLowerCase();
    const tipoL = (lead.tipoPropiedad || "").toLowerCase();
    const presL = Number(lead.presupuestoMax || 0);
    const dormL = Number(lead.dormitoriosMin || 0);

    const { data, error } = await supabase.from("inmuebles").select("*");
    if (error) return res.status(500).json({ ok: false, error: "Error cargando inmuebles" });

    const inmuebles = (data || []).map(sbToInm);
    const matches = [];

    inmuebles.forEach((inm) => {
      let score = 0;
      const zonaI = (inm.zona || "").toLowerCase();
      const opI = (inm.tipoOperacion || "").toLowerCase();
      const tipoI = ((inm.tipoPropiedad || "") + " " + (inm.titulo || "")).toLowerCase();
      const precioI = Number(inm.precio || 0);
      const dormI = Number(inm.dormitorios || 0);

      if (opL && opI && opL === opI) score += 25;
      if (zonaL && zonaI && zonaI.includes(zonaL)) score += 25;
      if (tipoL && tipoI.includes(tipoL)) score += 20;
      if (presL > 0 && precioI > 0 && precioI <= presL * 1.15) score += 20;
      if (dormL > 0 && dormI >= dormL) score += 10;

      if (score >= 30) {
        matches.push({
          idInmueble: inm.id,
          score,
          inmueble: {
            id: inm.id,
            titulo: inm.titulo || "Sin titulo",
            zona: inm.zona || "",
            precio: inm.precio || 0,
            moneda: inm.moneda || "USD"
          }
        });
      }
    });

    matches.sort((a, b) => b.score - a.score);
    res.json({ totalMatches: matches.length, matches });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Error interno" });
  }
});

// ============================
// ANALISIS MENSAJE
// ============================

app.post("/api/analizar-mensaje", (req, res) => {
  const textoOriginal = String((req.body && req.body.texto) || "").trim();
  const t0 = textoOriginal.toLowerCase();

  const stripAccents = (s) =>
    (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const t = stripAccents(t0);
  const has = (re) => re.test(t);

  const parseNumero = (s) => {
    if (!s) return 0;
    const n = Number(String(s).replace(/[.\s]/g, "").replace(/,/g, "."));
    return Number.isFinite(n) ? n : 0;
  };

  const levenshtein = (a, b) => {
    a = a || "";
    b = b || "";
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  };

  const bestFuzzyMatch = (text, options) => {
    const words = stripAccents(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let best = { value: "", score: 0 };

    options.forEach((opt) => {
      const o = stripAccents(opt).toLowerCase();
      if (stripAccents(text).includes(o)) {
        best = { value: opt, score: Math.max(best.score, 95) };
        return;
      }

      words.forEach((w) => {
        const dist = levenshtein(w, o);
        const maxLen = Math.max(w.length, o.length);
        const sim = maxLen ? (1 - dist / maxLen) : 0;
        const score = Math.round(sim * 100);
        if (score > best.score && score >= 72) best = { value: opt, score };
      });
    });

    return best;
  };

  const BARRIOS = [
    "Centro", "Macrocentro", "Banda Norte", "Alberdi", "Las Quintas", "Las Delicias",
    "Fenix", "Pizarro", "San Martin", "Bimaco", "Jardin", "Barrio Universidad",
    "Golf", "Las Ferias", "Ameghino", "Abilene", "Industrial", "El Rosal",
    "Intendente Mestre", "Villa Dalcar"
  ];

  let tipoOperacion = "";
  if (has(/(alquil|alquiler|arriendo|renta)/)) tipoOperacion = "alquiler";
  if (!tipoOperacion && has(/(compra|comprar|vendo|venta|usd|dolar|dolares|inversion)/)) tipoOperacion = "venta";

  let tipoPropiedad = "";
  if (has(/(depto|departamento|dpto)/)) tipoPropiedad = "depto";
  else if (has(/\bcasa\b/)) tipoPropiedad = "casa";
  else if (has(/(terreno|lote|loteo)/)) tipoPropiedad = "terreno";
  else if (has(/(local|comercial|galpon|deposito)/)) tipoPropiedad = "local";

  let moneda = "ARS";
  if (has(/(usd|dolar|dolares)/)) moneda = "USD";
  if (has(/\bpesos\b/)) moneda = "ARS";

  let precio = 0;
  const rango = t.match(/entre\s+(\d[\d.\s]*)\s+y\s+(\d[\d.\s]*)/);
  if (rango && rango[2]) precio = parseNumero(rango[2]);

  if (!precio) {
    const hasta = t.match(/(?:hasta|maximo|max|tope)\s+(\d[\d.\s]*)/);
    if (hasta && hasta[1]) precio = parseNumero(hasta[1]);
  }

  if (!precio) {
    const mil = t.match(/(\d+)\smil/);
    if (mil && mil[1]) precio = Number(mil[1]) * 1000;
  }

  if (!precio) {
    const suelto = t.match(/(\d{4,})/);
    if (suelto && suelto[1]) precio = parseNumero(suelto[1]);
  }

  let dormitoriosMin = 0;
  const dormRaw = t.match(/(\d+)\s(?:dorm|dormitorio|dormitorios|habit)/);
  if (dormRaw && dormRaw[1]) dormitoriosMin = Number(dormRaw[1]);

  let zonaTxt = "";
  const zonaMatch = t.match(/(?:\ben\b|\bzona\b|\bbarrio\b)\s+([a-z0-9\s]{3,40})/);
  if (zonaMatch && zonaMatch[1]) {
    zonaTxt = zonaMatch[1].replace(/(hasta|max|aprox|cerca|con|sin|de|por).*/g, "").trim();
  }

  let zona = "";
  if (zonaTxt) {
    const best = bestFuzzyMatch(zonaTxt, BARRIOS);
    zona = best.value || zonaTxt;
  }

  const esDemanda = has(/(busco|necesito|requiero|estoy buscando)/);
  const esOferta = has(/(tengo|ofrezco|disponible|vendo|alquilo|se vende)/);

  let tipo = "ambigua";
  if (esDemanda && !esOferta) tipo = "demanda";
  else if (esOferta && !esDemanda) tipo = "oferta";
  else if (esDemanda) tipo = "demanda";

  let margenAbajo = 30;
  let margenArriba = 20;
  let permitirSinPrecio = precio ? "no" : "si";
  let monedaEstricta = "no";
  let toleranteTipo = "si";

  if (has(/(hasta|maximo|max|tope)/)) {
    margenArriba = 5;
    margenAbajo = 25;
  }

  let confianza = 40;
  if (tipo !== "ambigua") confianza += 25;
  if (tipoOperacion) confianza += 10;
  if (tipoPropiedad) confianza += 10;
  if (precio) confianza += 10;
  if (zonaTxt) confianza += 5;
  confianza = Math.min(confianza, 98);

  const telMatch = t.match(/(\+?\d[\d\s-]{6,})/);
  const tel = telMatch ? telMatch[1].trim() : "";

  res.json({
    tipo,
    campos: {
      tipoOperacion,
      tipoPropiedad,
      zona,
      precio,
      moneda,
      dormitoriosMin,
      contacto: tel || "",
      notas: textoOriginal,
      margenAbajo,
      margenArriba,
      permitirSinPrecio,
      monedaEstricta,
      toleranteTipo
    },
    confianza,
    sugerencia: tipo === "oferta" ? "crear_oportunidad" : "crear_demanda"
  });
});

// ============================
// AUDIO OPENAI
// ============================

app.post("/api/transcribir-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.json({ error: "no audio" });
    if (!process.env.OPENAI_API_KEY) return res.json({ error: "falta OPENAI_API_KEY" });

    const transcripcion = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1"
    });

    res.json({ texto: transcripcion.text || "" });
  } catch (err) {
    console.log("Error transcribiendo:", err);
    res.json({ error: "error transcripcion" });
  }
});

// ============================
// RATING PUBLICO
// ============================

app.post("/api/rating", async (req, res) => {
  try {
    const { propiedad_id, rating } = req.body;
    const id = Number(propiedad_id);

    if (!supabase || Number.isNaN(id)) {
      return res.json({ ok: false });
    }

    const { error } = await supabase
      .from("inmuebles")
      .update({ rating: Number(rating || 0) })
      .eq("id", id);

    if (error) {
      console.error("Error Supabase rating:", error);
      return res.json({ ok: false });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.json({ ok: false });
  }
});

// ============================
// PDF FICHA
// ============================

app.get("/api/ficha-pdf/:id", async (req, res) => {
  try {
    if (!supabase) return res.status(500).send("Supabase no configurado");

    const id = Number(req.params.id);
    const { data, error } = await supabase
      .from("inmuebles")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).send("Propiedad no encontrada");

    const p = sbToInm(data);

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
      50,
      pageH - 38,
      { width: W, align: "center" }
    );
    doc.fillColor(VERDE).fontSize(9).font("Helvetica-Bold").text(
      "Vanina Buzzacchi Negocios Inmobiliarios - Rio Cuarto, Cordoba",
      50,
      pageH - 24,
      { width: W, align: "center" }
    );

    doc.end();
  } catch (e) {
    console.error(e);
    res.status(500).send("Error interno");
  }
});

// ============================
// SERVER
// ============================

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
