# INSTRUCCIONES PWA - CRM Vanina Buzzacchi

## Archivos a subir a GitHub (carpeta raíz del proyecto):

1. manifest.json
2. sw.js
3. Carpeta /icons/ con todos los íconos (icon-72x72.png hasta icon-512x512.png)

---

## Líneas a agregar en el <head> de CADA página HTML:

Pegá esto justo antes del </head> en estos archivos:
- dashboard.html
- editar.html
- ver.html
- login.html (o como se llame tu página de login)
- Y cualquier otro HTML que tengas

```html
<!-- PWA -->
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#c9a84c" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="VB Inmuebles" />
<link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
```

---

## Líneas a agregar al final del <body> de CADA página HTML:

Pegá esto justo antes del </body>:

```html
<!-- Registrar Service Worker -->
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
</script>
```

---

## Cómo instalar la app en el celular:

### Android (Chrome):
1. Abrí el CRM en Chrome
2. Tocá los 3 puntitos (⋮) arriba a la derecha
3. Tocá "Añadir a pantalla de inicio"
4. Confirmá → aparece el ícono dorado en la pantalla

### iPhone (Safari):
1. Abrí el CRM en Safari
2. Tocá el botón compartir (□↑) abajo al centro
3. Tocá "Añadir a pantalla de inicio"
4. Confirmá → aparece el ícono dorado

### Computadora (Chrome):
1. Abrí el CRM en Chrome
2. En la barra de URL aparece un ícono de instalación (⊕)
3. Clic → "Instalar"

---

## ¡Importante!
Una vez instalada, la app abre sola sin barra de navegador,
como una app nativa. El login sigue funcionando igual.
