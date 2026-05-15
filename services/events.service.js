// services/events.service.js
import { updateNeuroScore } from './neuroScore.service.js';

export const addLeadEvent = async (leadId, eventType, metadata = {}) => {
    try {
        const response = await fetch('/api/leads/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                leadId,
                type: eventType,
                data: metadata,
                timestamp: new Date().toISOString()
            })
        });

        const result = await response.json();

        // Si el evento se guardó bien, disparamos la actualización del puntaje
        if (response.ok) {
            await updateNeuroScore(leadId, eventType);
        }

        return result;
    } catch (error) {
        console.error("Error registrando evento:", error);
    }
};

