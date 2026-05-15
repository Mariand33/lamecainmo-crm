import { addLeadEvent } from './services/events.service.js';

// 1. Identificar al Lead (Persistencia en el navegador)
const leadId = new URLSearchParams(window.location.search).get('leadId') || 
               localStorage.getItem('crm_lead_id') || 
               'anonimo_' + Math.random().toString(36).substr(2, 9);

localStorage.setItem('crm_lead_id', leadId);

// 2. Escuchar clics en todo el funnel
document.addEventListener('click', async (e) => {
    
    // CASO A: Es un Vendedor (clic en Tasaciones o Vender)
    // Asegúrate de que tus botones de tasación tengan la clase 'btn-tasar'
    if (e.target.closest('.btn-tasar')) {
        await addLeadEvent(leadId, 'solicitud_tasacion', {
            perfil: 'vendedor',
            prioridad: 'alta',
            ubicacion: 'Rio Cuarto'
        });
        console.log('✅ Evento Vendedor enviado');
    }
    
    // CASO B: Es un Comprador (clic en WhatsApp)
    if (e.target.closest('a[href*="wa.me"]')) {
        await addLeadEvent(leadId, 'clic_whatsapp_funnel', {
            perfil: 'comprador',
            url_propiedad: window.location.href
        });
        console.log('✅ Evento Comprador enviado');
    }
});

    
