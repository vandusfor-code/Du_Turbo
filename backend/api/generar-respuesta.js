// Función serverless de Vercel: POST /api/generar-respuesta
// Recibe { mensaje, etapa, frasesEnviadas } desde duturbo.user.js (modo Inteligente),
// llama a Claude Haiku 4.5 con el SYSTEM_PROMPT del bot, y loguea cada llamada en
// la tabla `duturbo_logs` de Supabase.
//
// Variables de entorno requeridas (Vercel > Settings > Environment Variables):
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Esquema esperado de la tabla duturbo_logs:
//   timestamp   timestamptz
//   mensaje     text
//   respuesta   text (null si la llamada a Claude falló)
//   latencia_ms integer
//   escalo      boolean

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 60;

// Copiado tal cual desde duturbo.user.js (constante SYSTEM_PROMPT, conservada
// allí como referencia). Si se ajusta el comportamiento del bot, actualizar
// ambos lados o mover la fuente de verdad a un solo lugar.
const SYSTEM_PROMPT = `Eres un asistente que SOLO compra tiempo en chats de atención al cliente de PedidosYa.
NO eres agente. NO resuelves nada. NO prometes nada.
Tu única tarea: mantener al cliente atendido mientras el agente humano está ocupado en otro chat.

REGLAS ESTRICTAS:
1. Respuestas MÁXIMO 12 palabras
2. NUNCA prometas acciones ("devolveré", "escalaré", "enviaré cupón", "realizaré", "verificaré con")
3. NUNCA des información específica (montos, plazos, productos, números de orden)
4. SOLO frases de espera, reconocimiento, paciencia, empatía
5. Si el cliente exige solución concreta, escalamiento, está furioso, pregunta algo técnico, o pide reposición/cambio → responde EXACTAMENTE: {ESCALAR}

VOCABULARIO PROHIBIDO:
- "Te leo"
- "Anotado" (suena indiferente)
- "Uy", "Qué mal", "Caray", "Vaya"
- "Entiendo lo frustrante"
- "Comprendo cuán"
- "Lo siento profundamente"
- "Escalaré", "Ya realicé", "Te enviaré"
- Promesas con plazos ("en 5 minutos", "en breve")

EJEMPLOS DE RESPUESTAS CORRECTAS (calcadas de agentes top reales):
Cliente: "me llegó la comida fría" → "Lamento mucho lo sucedido. Permíteme verificar tu caso."
Cliente: "ok" → "Perfecto, sigo gestionando."
Cliente: "gracias" → "Con gusto, sigo con tu caso."
Cliente: "todavía estás?" → "Aquí sigo, ya casi termino."
Cliente: "es que estaba con mis hijos" → "Comprendo, sigo revisando."
Cliente: "cuánto demoras?" → "Ya casi termino la revisión."
Cliente: "mira lo que me llegó" → "Comprendo, lo estoy revisando con atención."
Cliente: "no es la primera vez que pasa" → "Lo lamento mucho. Sigo trabajando en tu caso."
Cliente: "me cobraron de más" → "Comprendo, sigo revisando los detalles."

CASOS QUE DEVUELVEN {ESCALAR}:
Cliente: "quiero hablar con un supervisor" → {ESCALAR}
Cliente: "esto es una estafa" → {ESCALAR}
Cliente: "necesito que me envíen otro" → {ESCALAR}
Cliente: "no me sirve esa solución" → {ESCALAR}
Cliente: "voy a denunciar" → {ESCALAR}
Cliente: "Rappi me trata mejor" → {ESCALAR}
Cliente: "cuánto me devuelven exactamente?" → {ESCALAR}

CONTEXTO QUE RECIBES:
- Etapa del chat (1=apertura, 2=escucha, 3=tranquiliza)
- Si el agente ya escribió mensajes previos REALES (no protocolarios)
- Respuestas previas del bot (NO REPITAS)
- La CONVERSACIÓN RECIENTE completa (últimos turnos, cliente y vos) — leela
  para responder con contexto real, no como si fuera el primer mensaje
- El último mensaje del cliente (a ese es al que tenés que responder)

INSTRUCCIÓN POR ETAPA:
- Etapa 1: empatía corta + pedir espera
- Etapa 2: acuse cálido en 2 partes (reconocimiento + acción), NO repitas "espera"
- Etapa 3: muestra que ya casi terminas

Si el agente YA escribió mensajes reales (no solo saludos), NUNCA respondas con apertura empática.
Usa siempre respuesta de etapa 2 o 3.

RECORDATORIO FINAL (esto se verifica automáticamente, no lo ignores):
NUNCA incluyas montos, plazos concretos ("mañana", "en 10 minutos"), cupones,
ni verbos de promesa ("realizaré", "enviaré", "acreditaré") — si tu respuesta
tiene algo de esto, se descarta entera y no llega al cliente.

Responde SOLO con el texto a enviar, sin comillas ni explicaciones.`;

function etiquetaEtapa(etapa) {
    if (etapa === 1) return 'apertura';
    if (etapa === 2) return 'escucha';
    return 'tranquiliza';
}

function construirUserPrompt(mensaje, etapa, frasesEnviadas, palabrasUsadas, transcript) {
    const recienteText = Array.isArray(frasesEnviadas) && frasesEnviadas.length > 0
        ? `\nNO REPITAS estas frases ya enviadas: ${frasesEnviadas.map(f => `"${f}"`).join(', ')}`
        : '';

    // Regla de oro: ni una palabra repetida en el mismo chat. El cliente
    // (duturbo.user.js) acumula TODAS las palabras significativas ya usadas
    // en el chat (no solo las últimas frases) y las manda acá.
    const palabrasText = Array.isArray(palabrasUsadas) && palabrasUsadas.length > 0
        ? `\nREGLA DE ORO: no uses NINGUNA de estas palabras, ya se usaron en este chat: ${palabrasUsadas.join(', ')}`
        : '';

    // 🆕 v3.8.9: antes solo se mandaba el último mensaje del cliente aislado,
    // sin ver el ida y vuelta real — en chats largos (varios turnos durante
    // 2+ minutos) eso podía sonar incoherente. Ahora se manda la
    // transcripción reciente completa para responder con contexto real.
    const transcriptText = Array.isArray(transcript) && transcript.length > 0
        ? `\n\nCONVERSACIÓN RECIENTE (de más vieja a más nueva):\n${transcript.map(m => `${m.quien === 'agente' ? 'Vos' : 'Cliente'}: "${m.texto}"`).join('\n')}`
        : '';

    return `ETAPA: ${etapa} (${etiquetaEtapa(etapa)})${recienteText}${palabrasText}${transcriptText}

Último mensaje del cliente (a esto tenés que responder): "${mensaje}"

Tu respuesta:`;
}

async function registrarLog(supabase, fila) {
    try {
        const { error } = await supabase.from('duturbo_logs').insert(fila);
        if (error) console.error('[duturbo_logs] Insert falló:', error.message);
    } catch (err) {
        console.error('[duturbo_logs] Excepción al loguear:', err.message);
    }
}

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
    const { mensaje, etapa, frasesEnviadas, palabrasUsadas, transcript } = body;

    if (!mensaje || !etapa) {
        return res.status(400).json({ error: 'Faltan mensaje o etapa' });
    }

    let anthropic, supabase;
    try {
        anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    } catch (err) {
        console.error('[generar-respuesta] Config faltante:', err.message);
        return res.status(500).json({ error: 'Backend mal configurado (revisar variables de entorno)' });
    }

    const inicio = Date.now();
    let texto = '';
    let escalo = false;
    let errorLlamada = null;

    try {
        const completion = await anthropic.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            temperature: 0.7,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: construirUserPrompt(mensaje, etapa, frasesEnviadas, palabrasUsadas, transcript) }]
        });

        texto = (completion.content?.[0]?.text || '').trim();
        escalo = texto.includes('{ESCALAR}');
    } catch (err) {
        errorLlamada = err.message || 'Error desconocido llamando a Claude';
        console.error('[generar-respuesta] Error Claude:', errorLlamada);
    }

    const latenciaMs = Date.now() - inicio;

    // En Vercel, una promesa disparada sin `await` se congela apenas se envía
    // la respuesta (fire-and-forget no funciona en serverless). Por eso el
    // log se espera ANTES de responder, no después.
    await registrarLog(supabase, {
        timestamp: new Date().toISOString(),
        mensaje,
        respuesta: errorLlamada ? null : texto,
        latencia_ms: latenciaMs,
        escalo
    });

    if (errorLlamada) {
        return res.status(502).json({ error: errorLlamada });
    }

    return res.status(200).json({ respuesta: texto });
};
