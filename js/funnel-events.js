import { addLeadEvent } from './services/events.service.js';

/**
 * LÓGICA DE CAPTACIÓN DE EVENTOS - INMOCREADOR
 * Este script identifica al lead y registra sus interacciones 
 * para alimentar el NeuroScore en el CRM.
 */

// 1. Identificar al Lead (desde la URL o anónimo)
const urlParams = new URLSearchParams(window.location.search);
const currentLeadId = urlParams.get('leadId') || 'lead_anonimo_' + Date.now();

// Guardamos en localStorage para persistencia durante la navegación
if (!localStorage.getItem('crm_lead_id')) {
    localStorage.setItem('crm_lead_id', currentLeadId);
}

const activeLeadId = localStorage.getItem('crm_lead_id');

// 2. Trackear clics a WhatsApp (Botones y enlaces)
document.addEventListener('click', (e) => {
    const waLink = e.target.closest('a[href*="wa.me"]');
    if (waLink) {
        addLeadEvent(activeLeadId, 'clic_whatsapp_funnel', {
            pagina: document.title,
            url: window.location.href,
            texto_boton: waLink.innerText.trim() || 'Botón flotante',
            timestamp: new Date().toISOString()
        });
        console.log('✅ Evento WhatsApp enviado al CRM');
    }
});

// 3. Función para trackear cuando ven una propiedad específica
// Usala en tu lógica de "Ver detalle" o "Abrir Modal"
export const trackPropiedadVista = (idInmueble, tituloInmueble) => {
    addLeadEvent(activeLeadId, 'propiedad_vista', {
        inmuebleId: idInmueble,
        titulo: tituloInmueble,
        timestamp: new Date().toISOString()
    });
    console.log(`🏠 Interés registrado: ${tituloInmueble}`);
};

// 4. Evento de "Permanencia" (opcional, suma al NeuroScore si se queda > 30s)
setTimeout(() => {
    addLeadEvent(activeLeadId, 'lead_lectura_profunda', {
        tiempo: '30s',
        url: window.location.href
    });
}, 30000);
