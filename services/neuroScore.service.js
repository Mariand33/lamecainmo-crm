const { supabase } = require('../lib/supabase'); // Ajusta la ruta si es necesario

const BASE_SCORE = 30;

const POINTS = {
  view_property: 8,
  same_property_bonus: 22,
  whatsapp_reply: 20,
  fast_reply: 15,
  has_questions: 18,
  visit_request: 35,
  funnel_complete: 25,
  financing_link: 15,
};

// ======================
// FUNCIÓN PARA INSERTAR EVENTOS (MUY IMPORTANTE)
// ======================
async function addLeadEvent(leadId, eventType, metadata = {}, propertyId = null, source = null) {
  try {
    const { error } = await supabase
      .from('lead_events')
      .insert({
        lead_id: leadId,
        event_type: eventType,
        property_id: propertyId,
        source: source,
        metadata: metadata
      });

    if (error) throw error;

    // Después de insertar el evento, recalculamos el NeuroScore
    await calculateNeuroScore(leadId);

    return true;
  } catch (error) {
    console.error('Error addLeadEvent:', error);
    return false;
  }
}

// ======================
// CALCULAR NEUROSCORE
// ======================
async function calculateNeuroScore(leadId) {
  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('neuro_score, neuro_history')
      .eq('id', leadId)
      .single();

    const { data: events } = await supabase
      .from('lead_events')
      .select('*')
      .eq('lead_id', leadId)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    let score = BASE_SCORE;
    const propertyCount = {};

    events?.forEach(event => {
      if (event.event_type === 'view_property' && event.property_id) {
        score += POINTS.view_property;
        propertyCount[event.property_id] = (propertyCount[event.property_id] || 0) + 1;
        if (propertyCount[event.property_id] >= 3) score += POINTS.same_property_bonus;
      }

      if (event.event_type === 'whatsapp_reply') {
        score += POINTS.whatsapp_reply;
        if (event.metadata?.fastReply === true) score += POINTS.fast_reply;
        if (event.metadata?.hasQuestions === true) score += POINTS.has_questions;
      }

      if (event.event_type === 'visit_request') score += POINTS.visit_request;
      if (event.event_type === 'funnel_complete') score += POINTS.funnel_complete;
      if (event.event_type === 'financing_link') score += POINTS.financing_link;
    });

    score = Math.min(Math.max(Math.round(score), 0), 100);

    const neuroLevel = score >= 75 ? 'Hot' : score >= 45 ? 'Warm' : 'Cold';

    const historyEntry = {
      date: new Date().toISOString(),
      scoreChange: score - (lead?.neuro_score || BASE_SCORE),
      reason: 'Actualización automática',
      totalScore: score
    };

    const newHistory = [...(lead?.neuro_history || []), historyEntry];

    await supabase
      .from('leads')
      .update({
        neuro_score: score,
        neuro_level: neuroLevel,
        neuro_history: newHistory
      })
      .eq('id', leadId);

    console.log(`✅ NeuroScore | Lead ${leadId} → \( {score} ( \){neuroLevel})`);
    return { score, level: neuroLevel };

  } catch (error) {
    console.error('❌ Error calculateNeuroScore:', error);
    return null;
  }
}

module.exports = { 
  calculateNeuroScore, 
  addLeadEvent 
};