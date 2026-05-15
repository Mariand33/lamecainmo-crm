// services/events.service.js

export const addLeadEvent = async (leadId, eventType, metadata = {}) => {
    try {
        const response = await fetch('/api/leads/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                leadId,
                type: eventType, // ej: 'whatsapp_click', 'funnel_step_2'
                data: metadata,
                timestamp: new Date().toISOString()
            })
        });
        return await response.json();
    } catch (error) {
        console.error("Error registrando evento:", error);
    }
};
