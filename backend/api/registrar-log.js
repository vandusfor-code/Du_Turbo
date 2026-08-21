// Función serverless de Vercel: POST /api/registrar-log
// "Flight recorder" del bot — recibe cada respuesta real o escalación desde
// duturbo.user.js y la guarda en la tabla `duturbo_logs` de Supabase. NO
// llama a ninguna IA (a diferencia de generar-respuesta.js, que ya no se
// usa desde que se eliminó Modo Inteligente): es solo un insert, así que no
// agrega latencia ni riesgo al flujo real de respuesta del bot. El
// userscript la llama en segundo plano, sin esperar el resultado.
//
// Variables de entorno requeridas (Vercel > Settings > Environment Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Reutiliza la tabla duturbo_logs ya creada:
//   id           bigint identity primary key
//   created_at   timestamptz default now()
//   mensaje      text
//   respuesta    text (null si fue una escalación, no una respuesta real)
//   latencia_ms  integer (null si fue una escalación)
//   escalo       boolean default false
//   razon        text (null si no escaló — agregar con:
//                 ALTER TABLE public.duturbo_logs ADD COLUMN razon text;)

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { mensaje, respuesta, latenciaMs, escalo, razon } = body;

    if (!mensaje) {
        return res.status(400).json({ error: 'Falta mensaje' });
    }

    let supabase;
    try {
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    } catch (err) {
        console.error('[registrar-log] Config faltante:', err.message);
        return res.status(500).json({ error: 'Backend mal configurado (revisar variables de entorno)' });
    }

    try {
        const { error } = await supabase.from('duturbo_logs').insert({
            mensaje,
            respuesta: respuesta || null,
            latencia_ms: typeof latenciaMs === 'number' ? Math.round(latenciaMs) : null,
            escalo: !!escalo,
            razon: razon || null
        });
        if (error) {
            console.error('[registrar-log] Insert falló:', error.message);
            return res.status(502).json({ error: error.message });
        }
    } catch (err) {
        console.error('[registrar-log] Excepción:', err.message);
        return res.status(500).json({ error: err.message });
    }

    return res.status(200).json({ ok: true });
};
