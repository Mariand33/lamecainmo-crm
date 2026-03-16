function analizarMensaje() {
  let mensaje = document.getElementById("mensajeCliente").value.toLowerCase();

  let tipo = "";
  let zona = "";
  let dormitorios = "";
  let precio = "";
  let operacion = "";

  // operación
  if (mensaje.includes("alquilar") || mensaje.includes("alquiler")) operacion = "alquiler";
  if (mensaje.includes("comprar") || mensaje.includes("compra") || mensaje.includes("venta")) operacion = "venta";

  // tipo
  if (mensaje.includes("casa")) tipo = "casa";
  if (mensaje.includes("departamento") || mensaje.includes("depto") || mensaje.includes("dpto")) tipo = "departamento";
  if (mensaje.includes("lote") || mensaje.includes("terreno")) tipo = "lote";
  if (mensaje.includes("local")) tipo = "local";

  // zona
  if (mensaje.includes("banda norte")) zona = "banda norte";
  if (mensaje.includes("centro")) zona = "centro";
  if (mensaje.includes("alberdi")) zona = "alberdi";
  if (mensaje.includes("macrocentro")) zona = "macrocentro";

  // dormitorios
  if (mensaje.includes("1 dormitorio") || mensaje.includes("1 dorm")) dormitorios = 1;
  if (mensaje.includes("2 dormitorios") || mensaje.includes("2 dorm")) dormitorios = 2;
  if (mensaje.includes("3 dormitorios") || mensaje.includes("3 dorm")) dormitorios = 3;
  if (mensaje.includes("4 dormitorios") || mensaje.includes("4 dorm")) dormitorios = 4;

  // precio
  let numero = mensaje.match(/\d{5,6}/);
  if (numero) precio = Number(numero[0]);

  let html = `
    <h3>Búsqueda detectada</h3>
    Operación: ${operacion || "-"}<br>
    Tipo: ${tipo || "-"}<br>
    Zona: ${zona || "-"}<br>
    Dormitorios: ${dormitorios || "-"}<br>
    Precio máximo: ${precio || "-"}<br><br>
    <h3>Buscando propiedades...</h3>
  `;

  document.getElementById("resultado").innerHTML = html;

  fetch("/api/inmuebles")
    .then(res => res.json())
    .then(inmuebles => {
      let coincidencias = inmuebles.filter(i => {
        return (
          (!operacion || (i.tipoOperacion || "").toLowerCase() === operacion) &&
          (!tipo || (i.tipo || "").toLowerCase() === tipo) &&
          (!zona || (i.zona || "").toLowerCase().includes(zona)) &&
          (!dormitorios || Number(i.dormitorios) >= dormitorios) &&
          (!precio || Number(i.precio) <= precio)
        );
      });

      mostrarCoincidencias(coincidencias, {
        operacion,
        tipo,
        zona,
        dormitorios,
        precio
      });
    })
    .catch(error => {
      console.error("Error al consultar inmuebles:", error);
      document.getElementById("resultado").innerHTML =
        "<b>Error al consultar inmuebles.</b>";
    });
}

function mostrarCoincidencias(coincidencias, busqueda) {
  let html = `
    <h3>Búsqueda detectada</h3>
    Operación: ${busqueda.operacion || "-"}<br>
    Tipo: ${busqueda.tipo || "-"}<br>
    Zona: ${busqueda.zona || "-"}<br>
    Dormitorios: ${busqueda.dormitorios || "-"}<br>
    Precio máximo: ${busqueda.precio || "-"}<br><br>
  `;

  if (coincidencias.length === 0) {
    html += `
      <b>No encontré propiedades exactas.</b><br>
      Podemos guardar la búsqueda del cliente para seguimiento.<br><br>
      <button type="button" onclick='guardarLead(${JSON.stringify(busqueda)})'>
        Guardar búsqueda como lead
      </button>
    `;
  } else {
    html += `<h3>Propiedades encontradas:</h3>`;

    coincidencias.forEach((p, index) => {
      html += `
        <div style="border:1px solid #ddd;padding:10px;margin:10px 0;border-radius:8px;">
          <b>${p.titulo}</b><br>
          Operación: ${p.tipoOperacion || "-"}<br>
          Zona: ${p.zona || "-"}<br>
          Dormitorios: ${p.dormitorios || "-"}<br>
          Precio: USD ${p.precio || "-"}<br><br>
          <button type="button" onclick="copiarRespuesta(${index})">Copiar respuesta</button>
        </div>
      `;
    });

    html += `
      <br><button type="button" onclick='guardarLead(${JSON.stringify(busqueda)})'>
        Guardar búsqueda como lead
      </button>
    `;

    window.coincidenciasActuales = coincidencias;
  }

  document.getElementById("resultado").innerHTML = html;
}
function guardarLead(busqueda) {
  fetch("/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(busqueda)
  })
    .then(res => res.json())
    .then(data => {
      if (data.ok) {
        alert("Búsqueda guardada como lead.");
      } else {
        alert("No se pudo guardar el lead.");
      }
    })
    .catch(error => {
      console.error("Error guardando lead:", error);
      alert("Error guardando lead.");
    });
}