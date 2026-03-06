// =========================
// SERVER.JS (COMPLETO)
// EQUIPO BUZZACCHI
// =========================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const archiver = require("archiver");

const app = express();

// =========================
// USUARIOS
// =========================
const usuarios = [
  { email: "mariano@inmo.com", password: "1234", rol: "admin" },
  { email: "vanina@inmo.com", password: "1234", rol: "admin" },
{ email: "cata@inmo.com", password: "1688", rol: "admin" },
  { email: "market@inmo.com", password: "1234", rol: "marketing" },
];

// =========================
// ARRAYS (MEMORIA)
// =========================
let inmuebles = [];
let compradores = [];
let demandas = [];
let notificaciones = [];
let radarIA = [];

// =========================
// PATHS (DATA)
// =========================
const INM_FILE = path.join(DATA_DIR, "inmuebles.json");
const COMPR_FILE = path.join(DATA_DIR, "compradores.json");
const DEM_FILE = path.join(DATA_DIR, "demandas.json");
const NOTIF_FILE = path.join(DATA_DIR, "notificaciones.json");
const RADAR_IA_FILE = path.join(DATA_DIR, "radar_ia.json");

// =========================
// CREAR DATA + UPLOADS SI NO EXISTE
// =========================
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// =========================
// HELPERS: CARGAR/GUARDAR JSON
// =========================
function cargarJSON(file, arr) {
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

function guardarInmuebles() { guardarJSON(INM_FILE, inmuebles); }
function guardarCompradores() { guardarJSON(COMPR_FILE, compradores); }
function guardarDemandas() { guardarJSON(DEM_FILE, demandas); }
function guardarNotificaciones() { guardarJSON(NOTIF_FILE, notificaciones); }
function guardarRadarIA() { guardarJSON(RADAR_IA_FILE, radarIA); }

// =========================
// CARGAR DATOS
// =========================
cargarJSON(INM_FILE, inmuebles);
cargarJSON(COMPR_FILE, compradores);
cargarJSON(DEM_FILE, demandas);
cargarJSON(NOTIF_FILE, notificaciones);
cargarJSON(RADAR_IA_FILE, radarIA);
// =========================
// PUSH NOTIFICACION
// =========================
function pushNotif(n) {
  const notif = { id: Date.now(), ts: Date.now(), ...n };
  notificaciones.push(notif);

  // mantiene últimas 200
  if (notificaciones.length > 200) {
    notificaciones.splice(0, notificaciones.length - 200);
  }

  guardarNotificaciones();
}

// =========================
// STATIC + PARSERS
// =========================
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// =========================
// SESION
// =========================
app.use(
  session({
    secret: "buzzacchi",
    resave: false,
    saveUninitialized: false,
  })
);

// =========================
// MULTER (UPLOADS)
// =========================
const storage = multer.diskStorage({
  destination: "./public/uploads",
  filename: (req, file, cb) => {
    cb(
      null,
      Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname)
    );
  },
});
const upload = multer({ storage });

// =========================
// LOGIN / LOGOUT
// =========================
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const user = usuarios.find((u) => u.email === email && u.password === password);
  if (!user) return res.status(401).send("Usuario incorrecto");

  req.session.user = user;

  if (user.rol === "marketing") res.redirect("/marketing.html");
  else res.redirect("/dashboard.html");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login.html"));
});

// =========================
// GUARDAR INMUEBLE (con fotos + video opcional)
// =========================
app.post(
  "/guardar",
  upload.fields([
    { name: "imagenes", maxCount: 20 },
    { name: "video", maxCount: 1 }
  ]),
  (req, res) => {

    // 1) FOTOS
    let fotos = [];
    if (req.files && req.files.imagenes && req.files.imagenes.length) {
      fotos = [...new Set(req.files.imagenes.map(f => f.filename))]; // sin duplicados
    }

    // 2) VIDEO
    let video = "";
    if (req.files && req.files.video && req.files.video.length) {
      video = req.files.video[0].filename;
    }

    // 3) OBJETO
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
      video: video, // ✅ nuevo

      creadoPor: req.session.user ? req.session.user.email : "desconocido",

      estadoPublicacion: "borrador",
      cantidadPublicificaciones: 0,

      leads: []
    };

    inmuebles.push(nuevo);
    guardarInmuebles();

    pushNotif({
      tipo: "nuevo_inmueble",
      titulo: nuevo.titulo,
      zona: nuevo.zona,
      precio: nuevo.precio,
      moneda: nuevo.moneda,
      operacion: nuevo.tipoOperacion,
      creadoPor: nuevo.creadoPor,
      indexInmueble: inmuebles.length - 1
    });

    res.redirect("/dashboard.html");
  }
);

// =========================
// GUARDAR OPORTUNIDAD (con foto 1 thumb opcional)
// =========================
app.post("/oportunidad", upload.single("thumb"), (req, res) => {
  const body = req.body || {};
  const img = req.file ? [req.file.filename] : [];

  const nueva = {
    titulo: (body.titulo && String(body.titulo).trim()) ? String(body.titulo).trim() : "Oportunidad",
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

    imagenes: img,
    leads: [],
  };

  inmuebles.push(nueva);
  guardarInmuebles();

  pushNotif({
    tipo: "nueva_oportunidad",
    titulo: nueva.titulo,
    zona: nueva.zona,
    precio: nueva.precio,
    moneda: nueva.moneda,
    origen: nueva.origen,
    indexInmueble: inmuebles.length - 1,
  });

  res.redirect("/dashboard.html");
});

// =========================
// RADAR CALLE (POST) - usa "thumb" (coincide con radar.html)
// =========================
app.post("/radar", upload.single("thumb"), (req, res) => {
  const body = req.body || {};

  const nuevo = {
    titulo: String(body.titulo || "").trim() || "Radar Calle",
    zona: String(body.zona || "").trim(),

    tipoOperacion: String(body.tipoOperacion || "").trim().toLowerCase(), // venta/alquiler
    tipoPropiedad: String(body.tipoPropiedad || "").trim().toLowerCase(), // casa/depto/local/...

    direccion: String(body.direccion || "").trim(),
    telefono: String(body.telefono || "").trim(),

    descripcion: String(body.nota || "").trim(),

    precio: Number(body.precio || 0),
    moneda: String(body.moneda || "ARS").trim().toUpperCase(),
    dormitorios: Number(body.dormitorios || 0),
    banos: Number(body.banos || 0),

    origen: "calle",
    estadoPublicacion: "radar",
    cantidadPublicificaciones: 0,

    creadoPor: req.session.user ? req.session.user.email : "desconocido",
    fecha: new Date().toISOString(),

    imagenes: req.file ? [req.file.filename] : [],
    leads: [],
  };

  inmuebles.push(nuevo);
  guardarInmuebles();

  pushNotif({
    tipo: "nuevo_radar",
    titulo: nuevo.titulo,
    zona: nuevo.zona,
    operacion: nuevo.tipoOperacion,
    indexInmueble: inmuebles.length - 1,
  });

  res.redirect("/dashboard.html");
});

// =========================
// EDITAR INMUEBLE
// - actualiza campos
// - reordena fotos por hidden inputs
// - suma fotos nuevas sin duplicar
// =========================
app.post("/editar/:index", upload.array("imagenes", 20), (req, res) => {
  const idx = Number(req.params.index);
  if (isNaN(idx) || !inmuebles[idx]) return res.redirect("/dashboard.html");

  const inm = inmuebles[idx];

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

  // reordenar fotos existentes si vienen inputs
  const nombres = req.body.nombresImagenes;
  const ordenes = req.body.ordenImagenes;

  if (nombres && ordenes) {
    const arrN = Array.isArray(nombres) ? nombres : [nombres];
    const arrO = Array.isArray(ordenes) ? ordenes : [ordenes];

    const pares = arrN.map((nombre, i) => ({
      nombre: String(nombre || "").trim(),
      orden: Number(arrO[i] || 9999),
    }));

    pares.sort((a, b) => a.orden - b.orden);
    inm.imagenes = pares.map((p) => p.nombre).filter(Boolean);
  }

  // sumar fotos nuevas
  if (req.files && req.files.length) {
    const nuevas = req.files.map((f) => f.filename);
    if (!Array.isArray(inm.imagenes)) inm.imagenes = [];
    inm.imagenes = [...new Set(inm.imagenes.concat(nuevas))];
  }

  guardarInmuebles();

  pushNotif({
    tipo: "inmueble_editado",
    titulo: inm.titulo,
    indexInmueble: idx,
  });

  res.redirect("/ver.html?index=" + idx);
});

// =========================
// ELIMINAR FOTO (AJAX)
// =========================
app.post("/editar/:index/fotos/eliminar", (req, res) => {
  const idx = Number(req.params.index);
  const nombreFoto = String(req.body.nombreFoto || "").trim();

  if (isNaN(idx) || !inmuebles[idx] || !nombreFoto) {
    return res.status(400).send("Parámetros inválidos");
  }

  const inm = inmuebles[idx];
  if (!Array.isArray(inm.imagenes)) inm.imagenes = [];

  inm.imagenes = inm.imagenes.filter((f) => f !== nombreFoto);

  // borrar archivo físico
  try {
    const filePath = path.join(__dirname, "public", "uploads", nombreFoto);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.log("No se pudo borrar archivo:", e.message);
  }

  guardarInmuebles();

  pushNotif({
    tipo: "foto_eliminada",
    titulo: inm.titulo,
    indexInmueble: idx,
  });

  res.json({ ok: true });
});

// =========================
// API INMUEBLES / COMPRADORES / DEMANDAS
// =========================
app.get("/api/inmuebles", (req, res) => res.json(inmuebles));
app.get("/api/compradores", (req, res) => res.json(compradores));
app.get("/api/demandas", (req, res) => res.json(demandas));

// =========================
// ANALIZAR MENSAJE (PRO local) - UNICO ENDPOINT
// POST /api/analizar-mensaje { texto }
// =========================
app.post("/api/analizar-mensaje", (req, res) => {
  const textoOriginal = String((req.body && req.body.texto) || "").trim();
  const t0 = textoOriginal.toLowerCase();

  const stripAccents = (s) =>
    (s || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const t = stripAccents(t0);

  const has = (re) => re.test(t);
  const pick = (re) => {
    const m = t.match(re);
    return m ? (m[1] || "").trim() : "";
  };

  const parseNumero = (s) => {
    if (!s) return 0;
    const clean = String(s).replace(/[.\s]/g, "");
    const n = Number(clean);
    return Number.isFinite(n) ? n : 0;
  };

  // Distancia de Levenshtein para tolerancia básica
  const levenshtein = (a, b) => {
    a = a || ""; b = b || "";
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  };

  const bestFuzzyMatch = (text, options) => {
    const words = stripAccents(text).toLowerCase().split(/[^a-z0-9ñ]+/).filter(Boolean);
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

  // 1) operación
  let tipoOperacion = "";
  if (has(/(alquil|alquiler|arriendo|renta)/)) tipoOperacion = "alquiler";
  if (!tipoOperacion && has(/(vendo|venta|vend[eé]|compra|comprar|inversion|u\$s|usd)/)) tipoOperacion = "venta";

  // 2) tipo propiedad
  let tipoPropiedad = "";
  if (has(/(depto|departamento|dpto)/)) tipoPropiedad = "depto";
  else if (has(/\bcasa\b/)) tipoPropiedad = "casa";
  else if (has(/(terreno|lote|loteo)/)) tipoPropiedad = "terreno";
  else if (has(/(local|comercial|galpon|deposito)/)) tipoPropiedad = "local";

  // 3) moneda + precio
  let moneda = "ARS";
  if (has(/(usd|u\$s|dolar|dolares)/)) moneda = "USD";
  if (has(/\bars\b|\bpesos\b/)) moneda = "ARS";

  const nRaw = pick(/(\d{1,3}(?:[.\s]\d{3})+|\d{4,})/);
  let precio = parseNumero(nRaw);

  // 4) dormitorios
  const dormRaw = pick(/(\d+)\s*(dorm|dormitorio|habit|hab)/);
  const dormitoriosMin = dormRaw ? Number(dormRaw) : 0;

  // 5) barrios Río Cuarto
  const BARRIOS_RIO_CUARTO = [
    "Centro","Macrocentro","Banda Norte","Alberdi","Las Quintas","Las Delicias","Fénix","Pizarro",
    "San Martín","Bimaco","Jardín","Barrio Universidad","Golf","Las Ferias","Ameghino","Abilene",
    "Industrial","El Rosal","Intendente Mestre","Villa Dalcar",
  ];

  let zonaTxt = pick(/(?:\ben\b|\bzona\b|\bbarrio\b)\s+([a-z0-9ñ\s]{3,50})/);
  zonaTxt = (zonaTxt || "").replace(/(hasta|max|aprox|cerca|con|sin|de|por).*/g, "").trim();

  let zona = "";
  let zonaScore = 0;
  if (zonaTxt) {
    const best = bestFuzzyMatch(zonaTxt, BARRIOS_RIO_CUARTO);
    zona = best.value || zonaTxt;
    zonaScore = best.score || 55;
  }

  // 6) DEMANDA vs OFERTA
  const esDemanda = has(/(busco|necesito|se solicita|alguien tiene|quien tiene|requiero|anda buscando)/);
  const esOferta  = has(/(tengo|ofrezco|disponible|vendo|alquilo|en alquiler|se vende)/);

  let tipo = "ambigua";
  if (esDemanda && !esOferta) tipo = "demanda";
  else if (esOferta && !esDemanda) tipo = "oferta";

  // 7) hasta / aprox / rango + márgenes
  const tieneHasta = has(/(hasta|maximo|max|tope|no pase de|no supere)/);
  const tieneAprox = has(/(aprox|aproximad|alrededor|cerca de|mas o menos|m[aá]s\/?menos)/);
  const rangoA = pick(/entre\s+(\d{1,3}(?:[.\s]\d{3})+|\d{4,})\s+y\s+(\d{1,3}(?:[.\s]\d{3})+|\d{4,})/);

  let margenAbajo = 30;
  let margenArriba = 20;
  let permitirSinPrecio = "no";
  let monedaEstricta = "no";
  let toleranteTipo = "si";

  if (!precio) permitirSinPrecio = "si";

  if (tieneHasta) { margenArriba = 5; margenAbajo = 25; }
  else if (tieneAprox) { margenArriba = 20; margenAbajo = 30; }

  if (rangoA) {
    const m = t.match(/entre\s+(\d{1,3}(?:[.\s]\d{3})+|\d{4,})\s+y\s+(\d{1,3}(?:[.\s]\d{3})+|\d{4,})/);
    if (m && m[1] && m[2]) {
      const lo = parseNumero(m[1]);
      const hi = parseNumero(m[2]);
      if (hi > 0) precio = hi;
      if (lo > 0 && hi > 0 && hi >= lo) {
        const drop = Math.round(((hi - lo) / hi) * 100);
        margenAbajo = Math.max(10, Math.min(60, drop));
        margenArriba = 10;
      }
    }
  }

  if (has(/(usd|u\$s|dolar)/) && has(/(ars|pesos)/)) monedaEstricta = "si";
  if (has(/(solo|excluyente|si o si)\s+(depto|departamento|casa|terreno|local)/)) toleranteTipo = "no";

  // 8) confianza
  let confianza = 40;
  if (tipo !== "ambigua") confianza += 25;
  if (tipoOperacion) confianza += 10;
  if (tipoPropiedad) confianza += 10;
  if (precio) confianza += 10;
  if (zonaTxt) confianza += 5;
  if (zonaScore >= 80) confianza += 5;
  confianza = Math.min(confianza, 95);

  // 9) sugerencia
  const sugerencia = (tipo === "oferta") ? "crear_oportunidad" : "crear_demanda";

  const tel = pick(/(\+?\d[\d\s-]{6,})/);

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
      toleranteTipo,
    },
    confianza,
    sugerencia,
  });
});

// =========================
// NUEVA DEMANDA (POST)
// =========================
app.post("/demandas/nuevo", (req, res) => {
  const nueva = {
    tipoOperacion: (req.body.tipoOperacion || "").toLowerCase(),
    tipoPropiedad: (req.body.tipoPropiedad || "").toLowerCase(),
    zona: (req.body.zona || "").toLowerCase(),

    presupuestoMax: Number(req.body.presupuestoMax || 0),
    moneda: (req.body.moneda || "ARS").toUpperCase(),
    dormitoriosMin: Number(req.body.dormitoriosMin || 0),

    // campos avanzados del analizador (si vienen)
    margenAbajo: Number(req.body.margenAbajo || 30),
    margenArriba: Number(req.body.margenArriba || 20),
    monedaEstricta: String(req.body.monedaEstricta || "no").toLowerCase(),
    permitirSinPrecio: String(req.body.permitirSinPrecio || "no").toLowerCase(),
    toleranteTipo: String(req.body.toleranteTipo || "si").toLowerCase(),

    notas: req.body.notas || "",
    contacto: req.body.contacto || "",
    creadoPor: req.session.user ? req.session.user.email : "desconocido",
    fecha: new Date().toISOString(),
    estado: "demanda",
  };

  demandas.push(nueva);
  guardarDemandas();

  pushNotif({
    tipo: "nueva_demanda",
    titulo: `Demanda: ${(nueva.tipoPropiedad || "propiedad")} ${(nueva.tipoOperacion || "")}`.trim(),
    zona: nueva.zona,
    precio: nueva.presupuestoMax,
    moneda: nueva.moneda,
  });

  res.redirect("/demandas.html");
});

// =========================
// MATCH: DEMANDA -> INMUEBLES (incluye oportunidad/radar)
// =========================
app.get("/api/match-demanda/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (isNaN(idx) || !demandas[idx]) {
    return res.json({ totalMatches: 0, matches: [] });
  }

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
  const toleranteTipo = String(d.toleranteTipo || "si").toLowerCase() === "si";

  const matches = [];

  inmuebles.forEach((inm, i) => {
    let score = 0;

    const estado = (inm.estadoPublicacion || inm.estado || "").toLowerCase();
    const opI = (inm.tipoOperacion || "").toLowerCase();
    const zonaI = (inm.zona || "").toLowerCase();
    const precioI = Number(inm.precio || 0);
    const dormI = Number(inm.dormitorios || 0);
    const monI = String(inm.moneda || "").toUpperCase();
    const monD = String(d.moneda || "").toUpperCase();

    // 1) Filtro duro: operación si está seteada
    if (opD && opI && opD !== opI) return;

    // 2) Moneda estricta (si hay presupuesto)
    if (monedaEstricta && presD > 0) {
      if (monD && monI && monD !== monI) return;
    }

    // 3) Precio con rango (si hay presupuesto)
    if (!permitirSinPrecio && presD > 0 && (!precioI || precioI <= 0)) return;

    if (presD > 0 && precioI > 0) {
      const minOk = presD * (1 - mDown / 100);
      const maxOk = presD * (1 + mUp / 100);
      if (precioI < minOk || precioI > maxOk) return;
    }

    const textoI = (
      (inm.titulo || "") + " " +
      (inm.descripcion || "") + " " +
      (inm.direccion || "") + " " +
      (inm.tipoPropiedad || "") + " " +
      (inm.tipo || "") + " " +
      (inm.nota || "")
    ).toLowerCase();

    // Operación (si coincide suma)
    if (opD && opI && opD === opI) score += 25;

    // Zona (inclusión)
    if (zonaD && zonaI) {
      if (zonaI.includes(zonaD)) score += 25;
      else if (textoI.includes(zonaD)) score += 12;
    }

    // Tipo
    if (tipoD) {
      const okTipo = textoI.includes(tipoD);
      if (okTipo) score += 15;
      else if (!toleranteTipo) score -= 25; // estricto: castiga fuerte
      else score += 3; // tolerante: no castiga, apenas suma poco
    }

    // Presupuesto (puntos por cercanía si hay precio+pres)
    if (presD > 0 && precioI > 0) {
      const diff = Math.abs(precioI - presD);
      const span = Math.max(1, (presD * (mUp / 100)) + (presD * (mDown / 100)));
      const closeness = 1 - Math.min(1, diff / span); // 0..1
      score += Math.round(5 + closeness * 20); // 5..25
    } else if (presD === 0) {
      score += 5; // no hay presupuesto en demanda
    } else if (precioI === 0 && permitirSinPrecio) {
      score += 6; // entra pero con score bajo
    }

    // Dorms
    if (dormMin > 0) {
      if (dormI >= dormMin) score += 10;
      else score -= 8;
    }

    // Bonus si es oportunidad/radar
    if (estado === "oportunidad") score += 5;
    if (estado === "radar") score += 3;

    if (score >= 30) {
      matches.push({
        indexInmueble: i,
        score,
        inmueble: {
          titulo: inm.titulo || inm.tipo || "Radar",
          zona: inm.zona || "",
          precio: inm.precio || 0,
          moneda: inm.moneda || "ARS",
          estadoPublicacion: inm.estadoPublicacion || inm.estado || "",
          origen: inm.origen || "",
        },
      });
    }
  });

  matches.sort((a, b) => b.score - a.score);
  res.json({ totalMatches: matches.length, matches });
});

// =========================
// ELIMINAR DEMANDA
// =========================
app.post("/demandas/eliminar/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (!isNaN(idx) && demandas[idx]) {
    demandas.splice(idx, 1);
    guardarDemandas();
  }
  res.redirect("/demandas.html");
});

// =========================
// API MATCH INMUEBLE → COMPRADORES
// =========================
app.get("/api/match-inmueble/:index", (req, res) => {
  const idx = Number(req.params.index);

  if (isNaN(idx) || !inmuebles[idx]) {
    return res.json({ totalMatches: 0, matches: [] });
  }

  const inm = inmuebles[idx];

  const zonaInm = (inm.zona || "").toLowerCase();
  const opInm = (inm.tipoOperacion || "").toLowerCase();
  const precioInm = Number(inm.precio || 0);
  const dormInm = Number(inm.dormitorios || 0);

  const textoInm = (
    (inm.titulo || "") + " " +
    (inm.descripcion || "") + " " +
    (inm.direccion || "") + " " +
    (inm.tipoPropiedad || "")
  ).toLowerCase();

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
          moneda: c.moneda,
        },
        score,
      });
    }
  });

  matches.sort((a, b) => b.score - a.score);
  res.json({ totalMatches: matches.length, matches });
});

// =========================
// API NOTIFICACIONES
// =========================
app.get("/api/notificaciones", (req, res) => {
  const since = Number(req.query.since || 0);
  const nuevas = notificaciones.filter((n) => Number(n.ts || 0) > since);
  res.json({ items: nuevas });
});

// =========================
// MARCAR LISTA
// =========================
app.post("/publicar/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (!inmuebles[idx]) return res.redirect("/dashboard.html");

  const i = inmuebles[idx];
  i.estadoPublicacion = "lista";
  i.cantidadPublicificaciones = Number(i.cantidadPublicificaciones || 0) + 1;

  guardarInmuebles();
  pushNotif({ tipo: "inmueble_lista", titulo: i.titulo, indexInmueble: idx });

  res.redirect("/dashboard.html");
});

// =========================
// MARCAR PUBLICADA
// =========================
app.post("/publicada/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (!inmuebles[idx]) return res.redirect("/marketing.html");

  const i = inmuebles[idx];
  i.estadoPublicacion = "publicada";

  guardarInmuebles();
  pushNotif({ tipo: "inmueble_publicada", titulo: i.titulo, indexInmueble: idx });

  res.redirect("/marketing.html");
});

// =========================
// ELIMINAR INMUEBLE
// =========================
app.post("/eliminar/:index", (req, res) => {
  const idx = Number(req.params.index);
  if (inmuebles[idx]) {
    inmuebles.splice(idx, 1);
    guardarInmuebles();
  }
  res.redirect("/dashboard.html");
});

// =========================
// ZIP DE FOTOS
// =========================
app.get("/marketing/zip/:index", (req, res) => {
  const idx = Number(req.params.index);
  const i = inmuebles[idx];

  if (!i || !Array.isArray(i.imagenes) || i.imagenes.length === 0) {
    return res.status(400).send("Sin fotos");
  }

  const archive = archiver("zip");
  res.attachment("fotos.zip");
  archive.pipe(res);

  i.imagenes.forEach((f) => {
    const file = path.join(__dirname, "public", "uploads", f);
    if (fs.existsSync(file)) archive.file(file, { name: f });
  });

  archive.finalize();
});

// =========================
// NUEVO COMPRADOR (POST)
// =========================
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
    fechaAlta: new Date().toLocaleString(),
  };

  compradores.push(nuevo);
  guardarCompradores();

  res.redirect("/compradores.html");
});
// =========================
// RADAR IA - GUARDAR DETECCION
// =========================
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

  // mantener últimos 500
  if (radarIA.length > 500) {
    radarIA = radarIA.slice(0, 500);
  }

  guardarRadarIA();

  pushNotif({
    tipo: "nuevo_radar_ia",
    titulo: item.tipoPropiedad || "Publicación detectada",
    zona: item.zona,
    precio: item.precio,
    moneda: item.moneda
  });

  res.json({ ok: true, total: radarIA.length });
});
// =========================
// RADAR IA - LISTADO
// =========================
app.get("/api/radar-ia", (req, res) => {
  res.json(radarIA);
});
// =========================
// SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});