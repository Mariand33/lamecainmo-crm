function analizarMensaje(){

let mensaje = document.getElementById("mensajeCliente").value.toLowerCase()

let tipo = ""
let zona = ""
let dormitorios = ""
let precio = ""

if(mensaje.includes("casa")) tipo="casa"
if(mensaje.includes("departamento") || mensaje.includes("depto")) tipo="departamento"
if(mensaje.includes("lote") || mensaje.includes("terreno")) tipo="lote"

if(mensaje.includes("banda norte")) zona="banda norte"
if(mensaje.includes("centro")) zona="centro"
if(mensaje.includes("alberdi")) zona="alberdi"

if(mensaje.includes("1 dormitorio")) dormitorios=1
if(mensaje.includes("2 dormitorios")) dormitorios=2
if(mensaje.includes("3 dormitorios")) dormitorios=3
if(mensaje.includes("4 dormitorios")) dormitorios=4

let numero = mensaje.match(/\d{5,6}/)

if(numero) precio = numero[0]

mostrarResultado(tipo,zona,dormitorios,precio)

}

function mostrarResultado(tipo,zona,dormitorios,precio){

let html = ""

html += "<h3>Búsqueda detectada</h3>"

html += "Tipo: "+tipo+"<br>"
html += "Zona: "+zona+"<br>"
html += "Dormitorios: "+dormitorios+"<br>"
html += "Precio máximo: "+precio+"<br><br>"

html += "<h3>Buscando propiedades...</h3>"

fetch("/api/inmuebles")
.then(res => res.json())
.then(inmuebles => {

let coincidencias = inmuebles.filter(i => {

return (
(!tipo || i.tipo==tipo) &&
(!zona || i.zona.toLowerCase().includes(zona)) &&
(!dormitorios || i.dormitorios>=dormitorios) &&
(!precio || i.precio<=precio)

)

})

mostrarCoincidencias(coincidencias)

})

let coincidencias = inmuebles.filter(i => {

return (
(!tipo || i.tipo==tipo) &&
(!zona || i.zona.toLowerCase().includes(zona)) &&
(!dormitorios || i.dormitorios>=dormitorios) &&
(!precio || i.precio<=precio)
)

})

if(coincidencias.length==0){

html += "No encontré propiedades exactas.<br>"
html += "Podemos guardar la búsqueda del cliente."

}else{

coincidencias.forEach(p=>{

html += `
<div style="border:1px solid #ddd;padding:10px;margin:10px 0">
<b>${p.titulo}</b><br>
${p.zona}<br>
${p.dormitorios} dormitorios<br>
USD ${p.precio}
</div>
`

})

}

document.getElementById("resultado").innerHTML = html

}
function mostrarCoincidencias(coincidencias){

let html=""

if(coincidencias.length==0){

html+="No encontré propiedades exactas.<br>"
html+="Podemos guardar la búsqueda del cliente."

}else{

coincidencias.forEach(p=>{

html+=`
<div style="border:1px solid #ddd;padding:10px;margin:10px 0">
<b>${p.titulo}</b><br>
${p.zona}<br>
${p.dormitorios} dormitorios<br>
USD ${p.precio}
</div>
`

})

}

document.getElementById("resultado").innerHTML=html

}