const { supabase } = require("../core/config");
const { sbToInm } = require("./inmuebles.service");

// ===============================
// MATCH COMPRADOR → INMUEBLES
// ===============================
async function matchComprador(comprador) {
  const zonaD = (comprador.zona_preferida || "").toLowerCase();
  const opD = (comprador.tipo_operacion_buscada || "").toLowerCase();
  const tipoD = (comprador.tipo_propiedad || "").toLowerCase();
  const presD = Number(comprador.presupuesto_max || 0);
  const dormMin = Number(comprador.dormitorios_min || 0);

  const { data: rows } = await supabase.from("inmuebles").select("*");
  const inmuebles = (rows || []).map(sbToInm);

  const matches = [];

  inmuebles.forEach((inm) => {
    let score = 0;

    const estado = (inm.estadoPublicacion || "").toLowerCase();
    if (!["lista", "publicada", "oportunidad"].includes(estado)) return;

    const zonaI = (inm.zona || "").toLowerCase();
    const opI = (inm.tipoOperacion || "").toLowerCase();
    const tipoI = ((inm.tipoPropiedad || "") + " " + (inm.titulo || "")).toLowerCase();
    const precioI = Number(inm.precio || 0);
    const dormI = Number(inm.dormitorios || 0);

    // OPERACION
    if (opD && opI && opD === opI) score += 25;

    // ZONA
    if (zonaD && zonaI && zonaI.includes(zonaD)) score += 25;

    // TIPO
    if (tipoD && tipoI.includes(tipoD)) score += 20;

    // PRECIO
    if (presD > 0 && precioI > 0 && precioI <= presD * 1.15) score += 20;

    // DORMITORIOS
    if (dormMin > 0 && dormI >= dormMin) score += 10;

    // BONUS
    if (estado === "oportunidad") score += 5;

    if (score >= 30) {
      matches.push({
        inmuebleId: inm.id,
        score,
        inmueble: {
          titulo: inm.titulo || "",
          zona: inm.zona || "",
          precio: inm.precio || 0,
          moneda: inm.moneda || "USD",
          estadoPublicacion: inm.estadoPublicacion || ""
        }
      });
    }
  });

  return {
    totalMatches: matches.length,
    matches: matches.sort((a, b) => b.score - a.score)
  };
}

// ===============================
// MATCH INMUEBLE → COMPRADORES
// ===============================
async function matchInmueble(inmueble) {
  const zonaI = (inmueble.zona || "").toLowerCase();
  const opI = (inmueble.tipoOperacion || "").toLowerCase();
  const tipoI =
    ((inmueble.tipoPropiedad || "") +
      " " +
      (inmueble.titulo || "") +
      " " +
      (inmueble.descripcion || "")
    ).toLowerCase();

  const precioI = Number(inmueble.precio || 0);
  const dormI = Number(inmueble.dormitorios || 0);

  const { data: compradores } = await supabase.from("compradores").select("*");

  const matches = [];

  (compradores || []).forEach((c) => {
    let score = 0;

    const zonaC = (c.zona_preferida || "").toLowerCase();
    const opC = (c.tipo_operacion_buscada || "").toLowerCase();
    const tipoC = (c.tipo_propiedad || "").toLowerCase();
    const presC = Number(c.presupuesto_max || 0);
    const dormMin = Number(c.dormitorios_min || 0);

    if (opC && opI && opC === opI) score += 25;
    if (zonaC && zonaI && zonaI.includes(zonaC)) score += 25;
    if (tipoC && tipoI.includes(tipoC)) score += 20;
    if (presC > 0 && precioI > 0 && precioI <= presC) score += 25;
    if (dormMin > 0 && dormI >= dormMin) score += 10;

    if (score >= 30) {
      matches.push({
        compradorId: c.id,
        score,
        comprador: {
          nombre: c.nombre,
          telefono: c.telefono,
          zona: c.zona_preferida,
          presupuesto: c.presupuesto_max
        }
      });
    }
  });

  return {
    totalMatches: matches.length,
    matches: matches.sort((a, b) => b.score - a.score)
  };
}

module.exports = {
  matchComprador,
  matchInmueble
};