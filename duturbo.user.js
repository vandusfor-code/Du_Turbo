// ==UserScript==
// @name         DuTurbo Vigilante Multi-Chat
// @namespace    duacademy.site
// @version      3.6.2
// @description  v3.6.2: Fix critico — el id de cada chat se derivaba del nombre + texto del sidebar, que incluye un countdown que tickea cada segundo. Eso hacia que el bot perdiera el chat activo constantemente. Ahora usa el data-testid="ticket-{uuid}" real del <li> como id estable. v3.6.1: backendURL apunta al deploy real en Vercel.
// @author       Duvan Ramos
// @match        *://pedidosya-us.deliveryherocare.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/vandusfor-code/Du_Turbo/main/duturbo.user.js
// @downloadURL  https://raw.githubusercontent.com/vandusfor-code/Du_Turbo/main/duturbo.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ════════════════════════════════════════════════════════════
    // ⚙️ CONFIGURACIÓN
    // ════════════════════════════════════════════════════════════
    const CONFIG = {
        intervalo: 1500,
        cooldownChat: 8000,
        delayAntesDeEnviar: 500,
        delayCambioDeChat: 700,
        pausarSiAgenteEscribe: true,
        debug: true,
        activoInicio: false,
        nombreAgente: '',

        // 🤖 Modo Inteligente — vía backend propio (Claude Haiku 4.5)
        // La API key vive en el servidor (variable de entorno), nunca en este archivo.
        backendURL: 'https://du-turbo-backend.vercel.app/api/generar-respuesta',

        modoIA: 'rapido',
        timeoutIA: 4000,

        // Personalización
        maxUsosNombrePorChat: 2,
        probUsarNombre: 0.5,

        // Etapas del chat
        umbralCritico: 6,
    };

    // ════════════════════════════════════════════════════════════
    // 🎯 SELECTORES DOM
    // ════════════════════════════════════════════════════════════
    const SEL = {
        chatItem: '.ant-list-item',
        unreadBadge: '.ant-scroll-number-only-unit.current',
        conversationContainer: '[data-testid="conversation-container"]',
        chatBubble: '[data-testid="chat-bubble"]',
        dividerNew: '.ant-divider-with-text',
        textarea: 'textarea[placeholder*="scribe"]',
        // 🆕 v3.6.2: el <li> trae data-testid="ticket-{uuid}" (id estable real)
        // y el nombre vive en un <span class="... name-..."> separado del
        // countdown que tickea cada segundo (class="... countdown-...").
        ticketIdAttr: /^ticket-(.+)$/,
        ticketName: '[class*="name-"]',
        handlingTime: '[data-testid="handling-time-label"]',
    };

    // ════════════════════════════════════════════════════════════
    // 🚨 FILTRO DE SEGURIDAD — Cliente "NO TOCAR"
    // ════════════════════════════════════════════════════════════
    const PATRONES_NO_TOCAR = [
        /\b(estafa|estafad)/i,
        /\bcargad[ao]\b/i,
        /falta de respeto/i,
        /\bdenuncia\b/i,
        /\babogad[oa]\b/i,
        /defensa al consumidor/i,
        /\bprocon\b/i,
        /inaceptable/i,
        /esto es un (robo|abuso)/i,
        /\bverg[uü]enza\b/i,
        /p[eé]simo servicio/i,
        /horrible servicio/i,
        /mal servicio/i,
        /\bsupervisor/i,
        /gerente/i,
        /tu jefe/i,
        /superior/i,
        /\bescal[ae]r?\b/i,
        /(env[ií]en|env[ií]ame|env[ií]arme).*(nuevo|otro|de nuevo|otra vez|nuevamente)/i,
        /reposici[oó]n/i,
        /me lo cambien/i,
        /(quiero|necesito) (otro|que me env[ií]en|reposici[oó]n)/i,
        /\brappi\b/i,
        /uber\s?eats?/i,
        /didi\s?food/i,
        /\bglovo\b/i,
        /otra app/i,
        /no me sirve/i,
        /no es justo/i,
        /es muy poco/i,
        /no estoy de acuerdo/i,
        /no me parece/i,
        /no me alcanza/i,
        /quiero (más|mas) /i,
        /resoluci[oó]n\?/i,
        /\bn[uú]mero de orden\b/i,
        /por qu[eé] (me llegó|cobraron|tardó)/i,
    ];

    function esClienteNoTocar(texto) {
        if (!texto) return null;
        for (const rx of PATRONES_NO_TOCAR) {
            if (rx.test(texto)) return rx.source.slice(0, 30);
        }
        return null;
    }

    // ════════════════════════════════════════════════════════════
    // 🚫 PATRONES DE DESPEDIDA / CIERRE (AMPLIADO v3.2)
    // ════════════════════════════════════════════════════════════
    const PATRONES_DESPEDIDA = [
        // Encuestas
        /encuesta (de satisfacci[oó]n|para calificar|breve|de calidad)/i,
        /breve encuesta/i,
        /calificar mi atenci[oó]n/i,

        // Cierres explícitos
        /cerrar[eé] el chat/i,
        /como no he recibido respuesta/i,
        /chat terminado/i,
        /finalizo (el|la|nuestro|nuestra)/i,
        /doy por finalizad/i,
        /cierro (el|la) (chat|gesti[oó]n|conversaci[oó]n)/i,

        // Cierres cálidos (todos los agentes top)
        /ha sido un gusto/i,
        /fue un gusto/i,
        /ha sido un placer/i,
        /placer poder ayudarte/i,
        /placer poder acompañarte/i,
        /gusto acompañarte/i,
        /gusto poder atenderte/i,
        /gusto atenderte/i,
        /me dio mucho gusto atenderte/i,        // 🆕
        /verdadero gusto haberte atendido/i,    // 🆕
        /placer ayudarte/i,                     // 🆕
        /placer atenderte/i,                    // 🆕
        /con mucho gusto/i,                     // 🆕

        // Despedidas temporales (TODAS las variantes encontradas)
        /excelente fin de semana/i,
        /excelente d[ií]a/i,
        /excelente noche/i,
        /excelente semana/i,                    // 🆕
        /excelente tarde/i,                     // 🆕
        /excelente resto/i,                     // 🆕
        /feliz d[ií]a/i,
        /feliz tarde/i,
        /feliz noche/i,
        /feliz resto de d[ií]a/i,
        /bonita noche/i,                        // 🆕
        /bonita tarde/i,                        // 🆕
        /bonito d[ií]a/i,                       // 🆕
        /buena (noche|tarde|d[ií]a)/i,          // 🆕 "Ten una buena noche"
        /que tengas un excelente/i,
        /que tengas una excelente/i,
        /ten una buena/i,                       // 🆕
        /ten una excelente/i,                   // 🆕

        // Cierre con expectativa
        /espero haber podido ayudarte/i,
        /espero haber podido ser de ayuda/i,
        /espero haber sido de ayuda/i,          // 🆕
        /haber resuelto tu/i,
        /espero que no vuelvas a tener/i,
        /espero sinceramente que no tengas/i,
        /hasta pronto/i,

        // Cierre por correo / acción
        /te env[ií]é al (mail|correo|email) asociado/i,
        /los pasos que debes seguir/i,
        /revisa tu (correo|mail|bandeja)/i,

        // Gestión finalizada
        /por mi parte, te he ayudado/i,
        /ya se aplicó la gesti[oó]n más favorable/i,
        /no contamos con (más|mas|otra) (alternativa|v[ií]a)/i,
        /gracias a ti por comunicarte/i,
        /no puedo ofrecerte una respuesta diferente/i,    // 🆕
        /he aplicado todos los recursos autorizados/i,    // 🆕
        /sé que no es la respuesta que esperabas/i,       // 🆕
        /tendremos muy en cuenta eso que nos indicas/i,   // 🆕
        /trataremos de tomar las precauciones/i,          // 🆕

        // Cierres muy comunes detectados
        /es con mucho gusto/i,                  // 🆕
        /es un placer/i,                        // 🆕
        /igualmente\W*$/i,                      // 🆕
        /saludos\W*$/i,

        // 🆕 v3.5.4: Cierres específicos del agente (Duvan)
        /espero que la soluci[oó]n brindada/i,
        /al cerrar el chat encontrar[áa]s/i,
        /muy amable/i,
        /que (tengas|tenga) (una )?muy buena/i
    ];

    function esDespedida(texto) {
        if (!texto) return false;
        return PATRONES_DESPEDIDA.some(rx => rx.test(texto));
    }

    // ════════════════════════════════════════════════════════════
    // 💰 PATRONES DE "SOLUCIÓN DADA"
    // ════════════════════════════════════════════════════════════
    const PATRONES_SOLUCION_DADA = [
        // Cupones (todas las variantes)
        /te (cargué|cargue|acredité|acredite) un cup[oó]n/i,
        /te (cargué|cargue) (un|los) cup[oó]n(es)?/i,
        /cup[oó]n de \$?\d+/i,
        /cup[oó]n de [A-Z]{3}\s?\d+/i,
        /tambi[eé]n te acredité/i,
        /tambi[eé]n te cargué/i,
        /te he acreditado en tu cuenta un cup[oó]n/i,    // 🆕

        // Devoluciones (todas las variantes)
        /ya realicé la devoluci[oó]n/i,
        /se realizó la devoluci[oó]n/i,
        /te confirmo que (ya )?(se )?realiz[oó]/i,
        /te comento que (ya )?realicé/i,
        /devoluci[oó]n de \$\d+/i,
        /devoluci[oó]n por \$?\d+/i,
        /devoluci[oó]n de [A-Z]{3}\s?\d+/i,
        /devolverá.{0,30}d[ií]as h[áa]biles/i,            // 🆕
        /la devoluci[oó]n demora aproximadamente/i,       // 🆕
        /devoluci[oó]n.{0,15}tarjeta.{0,15}terminada/i,   // 🆕

        // Reembolsos
        /(reembolso|reintegro) (de|por|del)/i,
        /te he ayudado haciéndote un reembolso/i,

        // Saldo / wallet
        /como saldo en pedidosya/i,
        /a pedidosya pagos/i,
        /cr[eé]ditos de pedidosya/i,
        /a tu billetera pedidosya/i,                      // 🆕
        /quedó anulado el cobro/i,                        // 🆕
    ];

    function agenteYaDioSolucion() {
        const cont = document.querySelector(SEL.conversationContainer);
        if (!cont) return false;
        // 🆕 v3.5.4: Usar esBurbujaDelAgente (no depender del nombre)
        const burbujasAgente = Array.from(cont.querySelectorAll(SEL.chatBubble))
            .filter(b => esBurbujaDelAgente(b));
        return burbujasAgente.some(b => {
            const txt = b.textContent || '';
            return PATRONES_SOLUCION_DADA.some(rx => rx.test(txt));
        });
    }

    // ════════════════════════════════════════════════════════════
    // 🙏 CIERRE DEL CLIENTE
    // ════════════════════════════════════════════════════════════
    function esCierreDelCliente(texto) {
        const t = (texto || '').toLowerCase().trim();
        return /^(ok|okey|listo|perfecto|dale|bueno|vale|excelente|genial|bien)[,.\s]*(gracias|grax|grasias|graciaz|grcias|muchas gracias|mil gracias|te agradezco)/i.test(t) ||
               /^(gracias|grax|grasias|graciaz|grcias|muchas gracias|mil gracias|te agradezco|agradecido)/i.test(t) ||
               /^(perfecto|excelente|listo|igualmente|genial)\W*$/i.test(t) ||
               /^(eso es todo|nada m[áa]s|no nada m[áa]s)\.?$/i.test(t) ||
               /\b(gracias?|grax|grasias) (por )?(la |tu )?(atenci[oó]n|ayuda|gesti[oó]n|tiempo)/i.test(t) ||
               /^finalizar\W*$/i.test(t) ||
               /^(ya est[áa]|ya qued[oó]|todo bien|todo claro)\W*$/i.test(t) ||
               /^(ok eso ser[ií]a todo|eso ser[ií]a todo)\W*$/i.test(t) ||
               /^dale\W*$/i.test(t) ||
               /^(gracias?|grax|grasias|graciaz)\s+\w+\W*$/i.test(t);  // "gracias Duvan", "gracias amigo", etc.
    }

    // ════════════════════════════════════════════════════════════
    // 👋 SALUDOS DEL CLIENTE (NUEVO v3.2)
    // Detecta saludos y devuelve el espejeado + nombre
    // ════════════════════════════════════════════════════════════
    function detectarSaludo(mensaje, nombreCliente) {
        if (!mensaje) return null;
        const t = mensaje.toLowerCase().trim();
        const primerNombre = nombreCliente ? nombreCliente.split(' ')[0] : '';
        const sufNombre = primerNombre ? `, ${primerNombre}` : '';

        // Patrones específicos por tipo de saludo
        const patrones = [
            // Horarios completos
            { rx: /buen[oa]s noches/i,             resp: `Buenas noches${sufNombre}.` },
            { rx: /buen[oa]s tardes/i,             resp: `Buenas tardes${sufNombre}.` },
            { rx: /buen[oa]s d[ií]as/i,            resp: `Buenos días${sufNombre}.` },
            { rx: /buena tarde\b/i,                resp: `Buena tarde${sufNombre}.` },
            { rx: /buen d[ií]a\b/i,                resp: `Buen día${sufNombre}.` },

            // Saludo + pregunta de cortesía → respuesta más completa
            { rx: /(c[oó]mo (est[áa]s|andas)|qu[eé] tal)/i,
              resp: `Hola${sufNombre}, muy bien. ¿En qué te puedo ayudar?` },

            // Saludo simple "buenas" o "hola"
            { rx: /^buenas?\b/i,                   resp: `Buenas${sufNombre}.` },
            { rx: /^hola\b/i,                      resp: `Hola${sufNombre}.` },
            { rx: /^holi\b/i,                      resp: `Hola${sufNombre}.` },
        ];

        for (const p of patrones) {
            if (p.rx.test(t)) {
                return p.resp;
            }
        }
        return null;
    }

    // ════════════════════════════════════════════════════════════
    // 📌 DETECTAR SALUDOS PROTOCOLARIOS DEL AGENTE (NUEVO v3.2)
    // Los saludos automáticos no cuentan como "gestión empezada"
    // ════════════════════════════════════════════════════════════
    const PATRONES_SALUDO_PROTOCOLARIO = [
        /^¡?hola,?\s+.+!?\s*gracias por comunicarte/i,
        /soy\s+.+,?\s*es un gusto saludarte/i,
        /me ocupar[eé] personalmente de este asunto/i,
        /estar[eé] acompañ[áa]ndote durante esta gesti[oó]n/i,
        /^estoy aqu[ií] para/i,
        /quedo a tu disposici[oó]n/i,
        /es un placer ayudarte/i,
        /aqu[ií] estoy para hacer lo que mejor pueda/i,
    ];

    function esSaludoProtocolario(texto) {
        if (!texto) return false;
        return PATRONES_SALUDO_PROTOCOLARIO.some(rx => rx.test(texto));
    }

    // ════════════════════════════════════════════════════════════
    // 🧑‍💼 DETECTOR DE BURBUJAS DEL AGENTE
    // 🆕 v3.6.0: Fix selector frágil — antes solo dependía de una clase
    // hasheada de styled-components (`bubbleContainer` + `timestampWrapper`
    // en el primer hijo). Verificamos ahora con Claude en Chrome contra 7
    // mensajes reales que el `background-color` computado de
    // [data-testid="chat-bubble-container"] es un indicador confiable:
    //   Asesora: rgb(186, 231, 255) (celeste) — Cliente: rgb(255, 255, 255) (blanco)
    // Si el color no coincide con ninguno de los dos (p.ej. HeroCare cambia
    // el tema visual), cae al heurístico estructural anterior como red de
    // seguridad, en vez de fallar en silencio.
    // ════════════════════════════════════════════════════════════
    const COLOR_ASESORA = 'rgb(186, 231, 255)';
    const COLOR_CLIENTE = 'rgb(255, 255, 255)';

    function esBurbujaDelAgentePorEstructura(burbuja) {
        const bubbleContainer = burbuja.querySelector('[class*="bubbleContainer"]');
        if (!bubbleContainer) return false;
        const primerHijo = bubbleContainer.firstElementChild;
        if (!primerHijo) return false;
        const claseDelPrimero = (primerHijo.className || '').toString();
        return claseDelPrimero.includes('timestampWrapper');
    }

    function esBurbujaDelAgente(burbuja) {
        const bc = burbuja.querySelector('[data-testid="chat-bubble-container"]');
        if (bc) {
            const color = getComputedStyle(bc).backgroundColor;
            if (color === COLOR_ASESORA) return true;
            if (color === COLOR_CLIENTE) return false;
            // Color no reconocido — posible cambio de tema, cae al heurístico anterior
        }
        return esBurbujaDelAgentePorEstructura(burbuja);
    }

    function contarMensajesRealesDelAgente() {
        const cont = document.querySelector(SEL.conversationContainer);
        if (!cont) return 0;
        const burbujas = Array.from(cont.querySelectorAll(SEL.chatBubble));

        // Detectar burbujas del agente por estructura/color (esBurbujaDelAgente)
        // No solo por el nombre, ya que las respuestas del bot NO contienen el nombre del agente
        const delAgente = burbujas.filter(b => esBurbujaDelAgente(b));

        // Solo cuenta las que NO son saludos protocolarios
        return delAgente.filter(b => !esSaludoProtocolario(b.textContent || '')).length;
    }

    // ════════════════════════════════════════════════════════════
    // 💬 BANCO DE FRASES POR ETAPA (ENRIQUECIDO v3.2)
    // ════════════════════════════════════════════════════════════
    const FRASES = {
        // 🟢 ETAPA 1 — APERTURA: empatía + espera (legacy, sigue funcionando)
        apertura_empatia: [
            "Lamento mucho lo sucedido.",
            "Lamento eso.",
            "Te pido mil disculpas.",
            "Siento mucho que la experiencia no haya sido lo esperado.",
            "Veo que tu pedido no llegó en buenas condiciones.",
            "Acabo de visualizar lo sucedido.",
            "Ofrecemos una disculpa sincera por este momento incómodo."
        ],
        apertura_espera: [
            "Permíteme unos minutos mientras reviso la información de tu caso.",
            "Dame un momento, por favor.",
            "Permíteme verificar tu caso.",
            "En este momento revisaré tu caso, mantente en línea.",
            "Aguárdame un momento en línea."
        ],
        // Genérico fallback
        generico: [
            "Sigo trabajando en tu solicitud. Te agradezco mantenerte en línea.",
            "Continúo con la revisión correspondiente.",
            "Permíteme un momento mientras avanzo."
        ]
    };

    // ════════════════════════════════════════════════════════════
    // 🆕 v3.5: FRASES DE ESPERA PERSONALIZADAS (30 frases)
    // Cuando el cliente sigue escribiendo y el bot ya pidió un momento,
    // estas frases reconocen lo que dice y mantienen al cliente tranquilo.
    // Se usan en ORDEN SECUENCIAL por chat, una por cada mensaje del cliente.
    // ════════════════════════════════════════════════════════════
    const FRASES_SECUENCIALES = [
        "Permíteme unos minutos mientras reviso la información de tu caso.",
        "Continúo validando los detalles correspondientes. En breve te brindaré una actualización.",
        "Entiendo lo que me indicas. Permíteme avanzar un poco más con la gestión para brindarte una respuesta adecuada.",
        "Comprendo lo que me comentas. Permíteme un momento para revisar todo correctamente.",
        "Entiendo el punto que señalas. Voy a tenerlo presente mientras continúo con la revisión.",
        "Comprendo la situación que describes. Continúo trabajando sobre tu solicitud.",
        "Entiendo tu comentario. Permíteme seguir avanzando para poder orientarte correctamente.",
        "Comprendo lo que mencionas. Continúo avanzando con las verificaciones necesarias.",
        "Entiendo tu observación. Sigo reuniendo información relacionada con tu consulta.",
        "Comprendo lo ocurrido según me indicas. Permíteme avanzar un poco más con la gestión.",
        "Entiendo el escenario que me describes. Sigo trabajando sobre la solicitud.",
        "Comprendo tu comentario. Permíteme profundizar un poco más en la revisión.",
        "Sigo revisando los detalles de tu caso. En un momento te actualizo.",
        "Continúo con la gestión correspondiente. Pronto te daré una respuesta.",
        "Me encuentro aún verificando la información. Permíteme un poco más.",
        "Sigo adelante con la revisión de tu solicitud.",
        "Continúo analizando los detalles para brindarte una orientación adecuada.",
        "Me encuentro trabajando en tu caso. En breve continuaré contigo.",
        "Sigo avanzando con las validaciones necesarias para tu solicitud.",
        "Continúo revisando la información relacionada con tu caso.",
        "Me encuentro finalizando la revisión de los detalles correspondientes.",
        "Sigo gestionando tu solicitud. Pronto te compartiré una respuesta.",
        "Continúo con el proceso de revisión. Permíteme un momento más.",
        "Me encuentro verificando los últimos detalles de tu caso.",
        "Sigo trabajando para brindarte la mejor orientación posible.",
        "Continúo con las comprobaciones correspondientes a tu solicitud.",
        "Me encuentro avanzando con la gestión. En breve te actualizo.",
        "Sigo revisando todo lo necesario para darte una respuesta correcta.",
        "Continúo evaluando la información disponible sobre tu caso.",
        "Me encuentro en la parte final de la revisión. Un momento más."
    ];

    // Verbos rotables
    const VERBOS_GESTION = [
        'revisando', 'validando', 'verificando', 'gestionando',
        'comprobando', 'analizando', 'consultando', 'recopilando',
        'corroborando', 'procesando'
    ];
    const VERBOS_INFINITIVO = [
        'revisar', 'validar', 'verificar', 'gestionar',
        'comprobar', 'analizar', 'consultar', 'recopilar',
        'corroborar', 'procesar'
    ];

    // Agradecimientos rotables
    const AGRADECIMIENTOS = [
        'Gracias por la espera.',
        'Gracias por mantenerte en línea.',
        'Agradezco tu paciencia.',
        'Valoro tu comprensión.',
        'Gracias por aguardar.',
        'Gracias por tu tiempo.'
    ];

    // ════════════════════════════════════════════════════════════
    // 🆕 v3.5: RECONOCIMIENTO CONTEXTUAL — 11 CATEGORÍAS (10 frases c/u)
    // Cuando el cliente reporta un problema específico, el bot lo
    // reconoce con una frase adecuada ANTES de la frase de espera.
    // Solo aplica si el cliente aporta info NUEVA (Opción C).
    // ════════════════════════════════════════════════════════════
    const TEMAS_CLIENTE = [
        {
            tema: 'comida_fria',
            patrones: [
                /\b(fr[ií][oa]s?|helad[oa]s?|tibi[oa]s?|congelad[oa]s?)\b/i,
                /no (est[áa]|llegó|lleg[oó]) caliente/i,
                /\btemperatura\b/i,
                /\bno calent/i
            ],
            frases: [
                "Lamento que los alimentos no hayan llegado a la temperatura esperada.",
                "Comprendo lo que nos comentas sobre las condiciones en las que recibiste la comida.",
                "Siento que tu pedido no se haya conservado como esperabas al momento de la entrega.",
                "Entiendo el inconveniente relacionado con la temperatura de los productos recibidos.",
                "Lamento que la preparación no haya llegado en las mejores condiciones para su consumo.",
                "Gracias por informarnos esta situación. Comprendo tu observación respecto al estado de la comida.",
                "Siento que los alimentos no hayan mantenido las condiciones esperadas durante el traslado.",
                "Entiendo lo que nos indicas sobre cómo recibiste tu pedido.",
                "Lamento que la experiencia con los productos entregados no haya sido la esperada.",
                "Comprendo la situación que reportas respecto a la calidad con la que llegó tu pedido."
            ]
        },
        {
            tema: 'comida_derramada',
            patrones: [
                /\b(derramad[oa]s?|volcad[oa]s?|regad[oa]s?|chorre[oó]|chorread[oa])\b/i,
                /se (derram[oó]|volc[oó]|reg[oó]|sali[oó])/i,
                /\b(líquido|salsa|jugo).*(por todos?|encima|fuera)/i
            ],
            frases: [
                "Lamento que los productos no hayan llegado en el estado esperado.",
                "Comprendo lo que nos informas sobre las condiciones en las que recibiste tu pedido.",
                "Siento que parte del contenido se haya visto afectado durante la entrega.",
                "Entiendo el inconveniente que presentaron los artículos al momento de recibirlos.",
                "Lamento que la presentación de los productos no haya sido la adecuada.",
                "Comprendo tu observación respecto al estado en que llegó la orden.",
                "Siento que el pedido no haya conservado sus condiciones originales durante el traslado.",
                "Entiendo la situación que nos comentas sobre los productos recibidos.",
                "Lamento que la entrega no haya llegado en las condiciones esperadas.",
                "Comprendo lo ocurrido con el estado de los artículos al momento de la recepción."
            ]
        },
        {
            tema: 'comida_aplastada',
            patrones: [
                /\b(aplastad[oa]s?|prensad[oa]s?|machucad[oa]s?|destrozad[oa]s?)\b/i,
                /\b(aplast|deform|chafad)\b/i,
                /lleg[oó] (todo )?aplast/i
            ],
            frases: [
                "Lamento que los productos hayan llegado con su presentación afectada.",
                "Comprendo lo que nos indicas sobre las condiciones en las que recibiste tu pedido.",
                "Siento que los alimentos no hayan mantenido su forma durante el traslado.",
                "Entiendo el inconveniente relacionado con la presentación de los productos.",
                "Lamento que la entrega no haya llegado como esperabas.",
                "Comprendo tu observación respecto al estado de los artículos recibidos.",
                "Siento que la calidad visual de los productos se haya visto afectada.",
                "Entiendo la situación que nos reportas sobre la condición de los alimentos.",
                "Lamento que los productos no hayan llegado en las mejores condiciones.",
                "Comprendo lo que nos comentas acerca de la presentación de tu pedido."
            ]
        },
        {
            tema: 'pedido_diferente',
            patrones: [
                /no es (lo que|el que|la que) (ped[ií]|orden[eé]|solic)/i,
                /me (mandaron|enviaron|trajeron|lleg[oó]) (otro|otra|distinto)/i,
                /pedido (equivocado|diferente|incorrecto)/i,
                /otra cosa/i,
                /no (era|fue) (lo que|esto)/i
            ],
            frases: [
                "Lamento que los productos recibidos no coincidan con los solicitados.",
                "Comprendo lo que nos indicas respecto al contenido de tu pedido.",
                "Siento que hayas recibido artículos distintos a los seleccionados.",
                "Entiendo el inconveniente relacionado con los productos entregados.",
                "Lamento la diferencia encontrada entre tu compra y lo recibido.",
                "Comprendo tu observación sobre los artículos que llegaron en la orden.",
                "Siento que el contenido entregado no corresponda con tu solicitud.",
                "Entiendo la situación que nos reportas respecto a los productos recibidos.",
                "Lamento que tu pedido no haya llegado conforme a lo solicitado.",
                "Comprendo lo ocurrido con los artículos entregados en esta ocasión."
            ]
        },
        {
            tema: 'producto_faltante',
            patrones: [
                /\b(falt[oóaó]|faltan|faltaron|faltante)\b/i,
                /no (me )?(llegó|trajeron|enviaron|vino|vinieron)/i,
                /\bincompleto\b/i,
                /\bvino solo\b/i,
                /no recibi[ró]/i,
                /pedido.*(incompleto|completo)/i
            ],
            frases: [
                "Lamento que tu pedido no haya llegado completo.",
                "Comprendo lo que nos indicas sobre los artículos que no recibiste.",
                "Siento que parte de tu compra no haya sido entregada.",
                "Entiendo el inconveniente relacionado con los productos ausentes en tu orden.",
                "Lamento que no hayas recibido todos los artículos solicitados.",
                "Comprendo tu observación respecto al contenido de la entrega.",
                "Siento que algunos productos no hayan llegado junto con el resto del pedido.",
                "Entiendo la situación que nos comentas sobre los artículos pendientes.",
                "Lamento la diferencia encontrada entre lo solicitado y lo recibido.",
                "Comprendo lo ocurrido con los productos que no fueron entregados."
            ]
        },
        {
            tema: 'producto_incorrecto',
            patrones: [
                /producto (incorrecto|equivocado|diferente)/i,
                /art[ií]culo (incorrecto|equivocado|diferente|distinto)/i,
                /no (es|era) el (producto|art[ií]culo)/i,
                /me dieron otro/i
            ],
            frases: [
                "Lamento que hayas recibido un artículo distinto al solicitado.",
                "Comprendo lo que nos informas sobre el producto entregado.",
                "Siento que el artículo recibido no coincida con tu selección.",
                "Entiendo el inconveniente relacionado con el producto entregado.",
                "Lamento la diferencia encontrada en el artículo recibido.",
                "Comprendo tu observación respecto al producto que llegó.",
                "Siento que el contenido de tu pedido no corresponda completamente a tu compra.",
                "Entiendo la situación que nos reportas sobre el artículo recibido.",
                "Lamento que el producto entregado no sea el esperado.",
                "Comprendo lo ocurrido con el artículo incluido en tu pedido."
            ]
        },
        {
            tema: 'mal_sabor',
            patrones: [
                /\b(sabor|sabe)\b.*(mal|feo|horrible|raro|extra[ñn]o)/i,
                /\b(feo|horrible|asqueros[oa]|incomible)\b/i,
                /no (sabe|sab[ií]a) bien/i,
                /no se puede comer/i,
                /no me voy a comer/i,
                /\bincomible\b/i,
                /\bpodr/i
            ],
            frases: [
                "Lamento que el producto no haya cumplido con tus expectativas.",
                "Comprendo lo que nos comentas sobre la calidad del alimento recibido.",
                "Siento que tu experiencia con este producto no haya sido satisfactoria.",
                "Entiendo la observación que realizas sobre el alimento recibido.",
                "Lamento que el producto no haya sido de tu agrado.",
                "Comprendo tu comentario respecto a las características del alimento.",
                "Siento que la preparación no haya cumplido con lo esperado.",
                "Entiendo la situación que nos informas sobre el producto consumido.",
                "Lamento que la calidad percibida no haya sido la adecuada.",
                "Comprendo tu observación sobre el estado del producto recibido."
            ]
        },
        {
            tema: 'mal_olor',
            patrones: [
                /\b(olor|huele|apesta|hediond[oa]|pestilente|peste)\b/i,
                /mal olor/i,
                /olor (feo|horrible|raro|extra[ñn]o|fuerte)/i,
                /huele (mal|feo|raro)/i
            ],
            frases: [
                "Lamento que el producto no haya llegado en las condiciones esperadas.",
                "Comprendo lo que nos informas sobre el estado del alimento recibido.",
                "Siento que hayas tenido este inconveniente con el producto.",
                "Entiendo la situación que nos comentas respecto al artículo entregado.",
                "Lamento que la calidad percibida no haya sido la adecuada.",
                "Comprendo tu observación sobre las condiciones del producto.",
                "Siento que tu experiencia con este alimento no haya sido la esperada.",
                "Entiendo lo que nos reportas acerca del estado del producto recibido.",
                "Lamento el inconveniente que presentas con este artículo.",
                "Comprendo tu comentario sobre las características del producto entregado."
            ]
        },
        {
            tema: 'comida_quemada',
            patrones: [
                /\b(quemad[oa]s?|carbonizad[oa]s?|negr[oa]s?|tostado en exceso)\b/i,
                /se (quem[oó]|pas[oó])/i,
                /muy (quemad|tostado|cocido)/i
            ],
            frases: [
                "Lamento que la preparación no haya llegado como esperabas.",
                "Comprendo lo que nos indicas sobre el estado de los alimentos recibidos.",
                "Siento que el producto no haya cumplido con las condiciones esperadas.",
                "Entiendo la situación que nos comentas respecto a la preparación.",
                "Lamento que la calidad del alimento no haya sido la adecuada.",
                "Comprendo tu observación sobre el producto recibido.",
                "Siento que tu experiencia con esta preparación no haya sido satisfactoria.",
                "Entiendo el inconveniente que presentas con los alimentos entregados.",
                "Lamento que el producto no haya llegado en las mejores condiciones.",
                "Comprendo lo que nos informas sobre el estado de la preparación."
            ]
        },
        {
            tema: 'comida_revuelta',
            patrones: [
                /\b(revuelt[oa]s?|mezclad[oa]s?|desordenad[oa]s?|desarmad[oa]s?)\b/i,
                /presentaci[oó]n.*(afectad|mal|fea|horrible)/i,
                /todo (revuelto|mezclado|desarmado|junto)/i,
                /lleg[oó] todo (junto|revuelto|mezclado)/i
            ],
            frases: [
                "Lamento que la presentación de los productos no haya sido la esperada.",
                "Comprendo lo que nos comentas sobre las condiciones de tu pedido.",
                "Siento que los alimentos no hayan llegado correctamente organizados.",
                "Entiendo el inconveniente relacionado con la presentación de la entrega.",
                "Lamento que el contenido no haya conservado su apariencia habitual.",
                "Comprendo tu observación respecto al estado de los productos recibidos.",
                "Siento que la preparación no haya llegado en condiciones óptimas.",
                "Entiendo la situación que nos reportas sobre la presentación del pedido.",
                "Lamento que los alimentos no hayan llegado como esperabas.",
                "Comprendo lo ocurrido con la presentación de los productos entregados."
            ]
        },
        {
            tema: 'pedido_no_entregado',
            patrones: [
                /no (me )?entregaron/i,
                /nunca (me )?(lleg[oó]|entregaron|recibi)/i,
                /no recibi[ró]? (mi |el )?pedido/i,
                /no (ha )?llegado/i,
                /pedido.*(no lleg|sin entregar|perdido)/i,
                /\bno lleg[oó]\b/i
            ],
            frases: [
                "Lamento que no hayas recibido tu pedido.",
                "Comprendo la situación que nos informas respecto a la entrega.",
                "Siento el inconveniente relacionado con la recepción de tu orden.",
                "Entiendo lo que nos comentas sobre tu pedido pendiente.",
                "Lamento que la entrega no se haya concretado como correspondía.",
                "Comprendo tu reporte sobre la falta de recepción del pedido.",
                "Siento que esta experiencia no haya resultado como esperabas.",
                "Entiendo el inconveniente que presentas con la entrega de tu orden.",
                "Lamento la situación relacionada con tu pedido.",
                "Comprendo lo que nos indicas acerca de la entrega no recibida."
            ]
        },
        {
            tema: 'frustracion_repetida',
            patrones: [
                /no es (la )?primera vez/i,
                /ya van varios/i,
                /siempre (me )?pasa/i,
                /cada vez/i,
                /segunda vez/i, /tercera vez/i
            ],
            frases: [
                "Comprendo que esta no sea la primera vez.",
                "Lamento mucho que estas situaciones se repitan.",
                "Es comprensible tu reacción tras varias situaciones similares.",
                "Entiendo perfectamente lo frustrante de que se repita."
            ]
        },
        {
            tema: 'dinero',
            patrones: [
                /\b(plata|dinero|pesos|gast[eé]|pagu[eé]|costó|cuesta)\b/i,
                /\b(precio|caro|mucho dinero)\b/i,
                /por (lo que )?pagu[eé]/i,
                /me sali[oó] (muy )?caro/i
            ],
            frases: [
                "Comprendo tu observación respecto al monto involucrado.",
                "Lamento la situación considerando lo que pagaste por el pedido.",
                "Entiendo tu molestia respecto al valor del pedido."
            ]
        },
        {
            tema: 'contexto_personal',
            patrones: [
                /\b(mis hijos?|mi familia|mi pareja|mi esposo|mi esposa|mis padres|los ni[ñn]os)\b/i,
                /\b(invitados|celebraci[oó]n|cumpleaños|reuni[oó]n)\b/i,
                /estaba con/i,
                /\bpara mi familia\b/i
            ],
            frases: [
                "Comprendo lo que significa para ti y los tuyos.",
                "Lamento que la situación haya afectado tu momento.",
                "Es entendible la molestia, especialmente en ese contexto.",
                "Comprendo lo importante del momento."
            ]
        },
        {
            tema: 'hambre',
            patrones: [
                /\b(hambre|sin comer)\b/i,
                /no pude (comer|cenar|almorzar|desayunar)/i,
                /tuve que (pedir|comprar) otro/i
            ],
            frases: [
                "Lamento profundamente que hayas quedado sin tu pedido.",
                "Comprendo lo molesto que es quedarse sin la comida esperada.",
                "Es totalmente entendible la situación."
            ]
        }
    ];

    function detectarTemaCliente(mensaje) {
        if (!mensaje) return null;
        for (const t of TEMAS_CLIENTE) {
            for (const rx of t.patrones) {
                if (rx.test(mensaje)) return t;
            }
        }
        return null;
    }

    function esConfirmacionCorta(mensaje) {
        const t = (mensaje || '').toLowerCase().trim();
        return /^(ok|okey|okay|oka|dale|ya|s[ií]|sip|sep|listo|bueno|vale|claro|perfecto|entendido|espero|esperando|bien|va|ta|gracias|grax|grasias|graciaz|grcias|muchas gracias|mil gracias|👍|🙏|✅|😊|🙌|\.+|\?+|eh\??|ah\??|ajá|aja|mm+|jaja[ja]*|jeje[je]*)$/i.test(t);
    }

    // 🆕 v3.5.4: ¿El cliente solo está diciendo "ok, espero"?
    function esAcuseDeEspera(mensaje) {
        const t = (mensaje || '').toLowerCase().trim();
        return /^(ok|oka|okey|okay|dale|bueno|listo|ya|bien|si|sí)[,.\s]*(gracias|grax|grasias|espero|esperaré|esperare|aguardo|ya espero|te espero|aqui espero|aquí espero|está bien|esta bien)\W*$/i.test(t) ||
               /^(ok|oka|okey|okay|dale|bueno|listo|ya|bien)[,.\s]*(ya|ok|listo|dale)\W*$/i.test(t) ||
               /^(espero|esperaré|esperare|aguardo|ya espero)\W*$/i.test(t) ||
               /^(oka|okey|okay)\s+(gracias|espero)\W*$/i.test(t) ||
               /^(si|sí)[,.\s]*(espero|dale|ok|ya)\W*$/i.test(t) ||
               /^(ok|oka) no hay (problema|lío|lio)\W*$/i.test(t) ||
               /^(tranquilo|tranquila|no te preocupes|no hay apuro|sin apuro)\W*$/i.test(t);
    }

    // 🆕 v3.5.4: Frases SIMPLES de continuación (para cuando el cliente solo dice "ok/espero")
    // No dicen "agradezco que me hayas comentado" porque el cliente no comentó nada
    const FRASES_CONTINUACION_SIMPLE = [
        "Continúo trabajando en tu solicitud.",
        "Sigo avanzando con la revisión.",
        "Me encuentro aún en la gestión correspondiente.",
        "Sigo adelante con las verificaciones.",
        "Continúo con el proceso, gracias por aguardar.",
        "Sigo en la revisión de tu caso.",
        "Aún me encuentro trabajando en ello.",
        "Continúo avanzando para brindarte una respuesta.",
        "Sigo gestionando, en breve te actualizo.",
        "Me encuentro finalizando la revisión."
    ];
    const indiceContinuacionPorChat = new Map();

    // ════════════════════════════════════════════════════════════
    // 🆕 v3.5.1: DETECCIÓN DE PREGUNTA DE DEVOLUCIÓN
    // Cuando el agente pregunta cómo quiere la devolución (cupón o tarjeta),
    // el bot clasifica la respuesta del cliente:
    //   → Si elige método → confirma
    //   → Si NO elige → pide respuesta con nombre
    // ════════════════════════════════════════════════════════════

    // Regex para detectar que el agente YA hizo la pregunta de devolución
    const REGEX_PREGUNTA_DEVOLUCION = /te gustar[ií]a recibirla como cup[oó]n.*tarjeta.*d[ií]as h[aá]biles/i;

    // Regex para respuestas ESPERADAS (cliente elige método)
    const REGEX_ELIGE_METODO = /\b(cup[oó]n|inmediata|tarjeta|d[eé]bito|cr[eé]dito|al d[eé]bito|al cr[eé]dito|a la tarjeta|a mi tarjeta|7 d[ií]as|siete d[ií]as|a plazo|forma inmediata|de forma inmediata)\b/i;

    // Frases de confirmación (rotan)
    const FRASES_CONFIRMACION_DEVOLUCION = [
        "Confirmado, gestionaré para realizar el proceso a través del medio que me indicas.",
        "Perfecto, procederé con la gestión por el medio que me señalas.",
        "Listo, realizaré el proceso correspondiente al medio que seleccionaste."
    ];

    // Frases para cuando NO elige método (con nombre)
    const FRASES_ESPERA_RESPUESTA = [
        "{nombre}, estoy atento a tu respuesta para poder avanzar.",
        "{nombre}, quedo a la espera de tu indicación para continuar con el proceso.",
        "{nombre}, cuando me confirmes el medio de tu preferencia, procederé con la gestión."
    ];

    // Mapa para trackear qué chats tienen pregunta de devolución activa
    const chatConPreguntaDevolucion = new Map(); // chatId -> true
    const chatConDevolucionRespondida = new Set(); // 🆕 v3.5.3: chats donde la pregunta YA fue contestada

    function detectarPreguntaDevolucion(chatId) {
        // 🆕 v3.5.3: Si ya fue respondida en este chat, NUNCA reactivar
        if (chatConDevolucionRespondida.has(chatId)) return false;

        // Buscar en las burbujas del agente si ya hizo la pregunta
        const cont = document.querySelector(SEL.conversationContainer);
        if (!cont) return false;

        const burbujas = Array.from(cont.querySelectorAll('[data-testid="chat-bubble"]'));
        const delAgente = burbujas.filter(b => esBurbujaDelAgente(b));

        for (const b of delAgente) {
            const txt = b.textContent || '';
            if (REGEX_PREGUNTA_DEVOLUCION.test(txt)) {
                chatConPreguntaDevolucion.set(chatId, true);
                return true;
            }
        }
        return chatConPreguntaDevolucion.get(chatId) || false;
    }

    function clasificarRespuestaDevolucion(mensaje, chatId, nombreCliente) {
        // 🆕 v3.5.3: No clasificar si ya fue respondida
        if (chatConDevolucionRespondida.has(chatId)) return null;

        // 🆕 v3.5.3: No clasificar si ya hay solución o despedida
        if (tieneSolucion(chatId) || estaDespedido(chatId)) return null;

        // Solo aplica si el agente ya hizo la pregunta de devolución
        if (!detectarPreguntaDevolucion(chatId)) return null;

        const msgLimpio = (mensaje || '').toLowerCase().trim();

        // 🆕 v3.5.3: Si es cierre del cliente ("gracias", "ok gracias", "finalizar"), NO es respuesta a devolución
        if (esCierreDelCliente(msgLimpio)) return null;

        if (REGEX_ELIGE_METODO.test(msgLimpio)) {
            // Cliente eligió método → confirmar
            log(`💳 ${nombreCliente}: eligió método de devolución`, 'success');
            chatConPreguntaDevolucion.delete(chatId);
            chatConDevolucionRespondida.add(chatId);  // 🆕 v3.5.3: marcar como respondida permanentemente
            const frase = elegirAleatorio(FRASES_CONFIRMACION_DEVOLUCION);
            return frase;
        } else {
            // Cliente NO eligió método → pedir respuesta con nombre
            log(`⏳ ${nombreCliente}: no eligió método, pidiendo respuesta`, 'info');
            const nombre = nombreCliente.split(' ')[0]; // solo primer nombre
            const frase = elegirAleatorio(FRASES_ESPERA_RESPUESTA).replace('{nombre}', nombre);
            return frase;
        }
    }

    // ════════════════════════════════════════════════════════════
    // 🆕 v3.4: GESTOR DE PALABRAS USADAS POR CHAT (regla de oro)
    // ════════════════════════════════════════════════════════════
    const palabrasUsadasPorChat = new Map();
    const indiceSecuencialPorChat = new Map();

    const PALABRAS_SIGNIFICATIVAS = [
        // Verbos de gestión
        'revisando', 'validando', 'verificando', 'gestionando',
        'comprobando', 'analizando', 'consultando', 'recopilando',
        'corroborando', 'procesando', 'revisar', 'validar', 'verificar',
        'gestionar', 'comprobar', 'analizar', 'consultar', 'recopilar',
        'avanzando', 'reuniendo', 'evaluando', 'profundizar',
        // Empatía
        'lamento', 'comprendo', 'entiendo', 'siento', 'disculpa', 'aprecio',
        // Sustantivos clave
        'paciencia', 'espera', 'momento', 'tiempo', 'detalles',
        'información', 'caso', 'solicitud', 'gestión', 'situación',
        'observación', 'comentario', 'revisión', 'comprobaciones',
        'antecedentes', 'validaciones', 'verificaciones',
        // Agradecimientos
        'mantenerte', 'aguardar', 'agradezco', 'valoro', 'permíteme',
        // Verbos de reconocimiento
        'indicas', 'comentas', 'reportas', 'informas', 'señalas', 'mencionas',
        'describes', 'compartes'
    ];

    function extraerPalabrasClave(texto) {
        const palabras = (texto || '').toLowerCase()
            .replace(/[.,!?¿¡;:()"'\n]/g, ' ')
            .split(/\s+/);
        return palabras.filter(p => PALABRAS_SIGNIFICATIVAS.includes(p));
    }

    function registrarPalabrasUsadas(chatId, texto) {
        const set = palabrasUsadasPorChat.get(chatId) || new Set();
        extraerPalabrasClave(texto).forEach(p => set.add(p));
        palabrasUsadasPorChat.set(chatId, set);
    }

    function fueUsadaEnChat(chatId, palabra) {
        const set = palabrasUsadasPorChat.get(chatId) || new Set();
        return set.has(palabra.toLowerCase());
    }

    function elegirVerboSinRepetir(chatId, forma = 'gerundio') {
        const lista = forma === 'gerundio' ? VERBOS_GESTION : VERBOS_INFINITIVO;
        const noUsados = lista.filter(v => !fueUsadaEnChat(chatId, v));
        if (noUsados.length === 0) return elegirAleatorio(lista);
        return elegirAleatorio(noUsados);
    }

    function elegirAgradecimientoSinRepetir(chatId) {
        const noUsados = AGRADECIMIENTOS.filter(a => {
            const palabras = extraerPalabrasClave(a);
            return !palabras.some(p => fueUsadaEnChat(chatId, p));
        });
        if (noUsados.length === 0) return elegirAleatorio(AGRADECIMIENTOS);
        return elegirAleatorio(noUsados);
    }

    function rotarVerbos(frase, chatId) {
        for (const verbo of VERBOS_GESTION) {
            const rx = new RegExp(`\\b${verbo}\\b`, 'i');
            if (rx.test(frase)) {
                const nuevoVerbo = elegirVerboSinRepetir(chatId, 'gerundio');
                return frase.replace(rx, nuevoVerbo);
            }
        }
        for (const verbo of VERBOS_INFINITIVO) {
            const rx = new RegExp(`\\b${verbo}\\b`, 'i');
            if (rx.test(frase)) {
                const nuevoVerbo = elegirVerboSinRepetir(chatId, 'infinitivo');
                return frase.replace(rx, nuevoVerbo);
            }
        }
        return frase;
    }

    function rotarAgradecimiento(frase, chatId) {
        const patrones = [
            /Gracias por la espera\./i,
            /Gracias por mantenerte en línea\./i,
            /Agradezco tu paciencia\./i,
            /Gracias por aguardar\./i,
            /Gracias por tu tiempo\./i,
            /Valoro tu comprensión\./i
        ];
        for (const rx of patrones) {
            if (rx.test(frase)) {
                const nuevo = elegirAgradecimientoSinRepetir(chatId);
                return frase.replace(rx, nuevo);
            }
        }
        return frase;
    }

    // 🆕 v3.4: Generador inteligente — corazón del modo Rápido Pro
    function generarFraseInteligente(mensaje, chatId, nombreCliente) {
        // 🆕 v3.5.5: Leer SOLO la última burbuja para verificar confirmaciones
        // (el 'mensaje' concatena las últimas 3, lo cual hace fallar el regex)
        const ultimaBurbuja = nombreCliente ? leerSoloUltimaBurbujaCliente(nombreCliente) : mensaje;

        const tema = detectarTemaCliente(mensaje);
        const esConfirmacion = esConfirmacionCorta(ultimaBurbuja);
        const esAcuse = esAcuseDeEspera(ultimaBurbuja);

        // 🆕 v3.5.4: Si es confirmación/acuse ("ok", "oka gracias", "espero")
        // usar frase SIMPLE de continuación (no "agradezco que me hayas comentado")
        if (esConfirmacion || esAcuse) {
            let idx = indiceContinuacionPorChat.get(chatId) || 0;
            // Buscar frase sin palabras repetidas
            let frase = null;
            for (let i = 0; i < FRASES_CONTINUACION_SIMPLE.length; i++) {
                const candidata = FRASES_CONTINUACION_SIMPLE[(idx + i) % FRASES_CONTINUACION_SIMPLE.length];
                const palabras = extraerPalabrasClave(candidata);
                if (!palabras.some(p => fueUsadaEnChat(chatId, p))) {
                    frase = candidata;
                    indiceContinuacionPorChat.set(chatId, idx + i + 1);
                    break;
                }
            }
            if (!frase) {
                frase = FRASES_CONTINUACION_SIMPLE[idx % FRASES_CONTINUACION_SIMPLE.length];
                indiceContinuacionPorChat.set(chatId, idx + 1);
            }
            registrarPalabrasUsadas(chatId, frase);
            return frase;
        }

        // 1. Reconocimiento contextual si hay info nueva
        let reconocimiento = '';
        if (tema) {
            const noUsadas = tema.frases.filter(f => {
                const palabras = extraerPalabrasClave(f);
                return !palabras.some(p => fueUsadaEnChat(chatId, p));
            });
            reconocimiento = noUsadas.length > 0
                ? elegirAleatorio(noUsadas)
                : elegirAleatorio(tema.frases);
        }

        // 2. Frase secuencial de espera — buscar una SIN palabras repetidas
        let indice = indiceSecuencialPorChat.get(chatId) || 0;
        let fraseEspera = null;
        const totalFrases = FRASES_SECUENCIALES.length;

        for (let intento = 0; intento < Math.min(5, totalFrases); intento++) {
            const candidata = FRASES_SECUENCIALES[(indice + intento) % totalFrases];
            const palabrasCandidatas = extraerPalabrasClave(candidata);
            const tieneOverlap = palabrasCandidatas.some(p => fueUsadaEnChat(chatId, p));

            if (!tieneOverlap) {
                fraseEspera = candidata;
                indiceSecuencialPorChat.set(chatId, indice + intento + 1);
                break;
            }
        }

        if (!fraseEspera) {
            fraseEspera = FRASES_SECUENCIALES[indice % totalFrases];
            indiceSecuencialPorChat.set(chatId, indice + 1);
        }

        // 3. Rotar verbos (regla de oro)
        fraseEspera = rotarVerbos(fraseEspera, chatId);

        // 4. Rotar agradecimiento
        fraseEspera = rotarAgradecimiento(fraseEspera, chatId);

        // 5. Si hubo reconocimiento, la frase de espera debe ser corta
        let fraseFinal;
        if (reconocimiento) {
            const partes = fraseEspera.split(/\.\s+/);
            const accion = partes[partes.length - 1] || fraseEspera;
            fraseFinal = `${reconocimiento} ${accion}`;
        } else {
            fraseFinal = fraseEspera;
        }

        // 6. Registrar para la regla de oro
        registrarPalabrasUsadas(chatId, fraseFinal);

        return fraseFinal;
    }

    // ════════════════════════════════════════════════════════════
    // 📦 STATE
    // ════════════════════════════════════════════════════════════
    let activo = CONFIG.activoInicio;
    let procesando = false;
    let logs = [];

    const ultimaRespuestaChat = new Map();
    const respuestasPorChat = new Map();
    const usosNombrePorChat = new Map();
    const frasesEnviadasPorChat = new Map();
    const chatsDespedidos = new Map();
    const chatsConSolucion = new Map();
    const chatsCriticos = new Map();
    const imagenesPorChat = new Map();    // 🆕 v3.2.1: rastrea cuántas imágenes envió el cliente
    const chatsEnModoGestion = new Map(); // 🆕 v3.2.2: chats donde el bot ayuda activamente { chatId: timestamp }
    const chatsGestionDesactivadaManual = new Set(); // 🆕 v3.5.6: chats donde el usuario desactivó manualmente
    const ultimoMensajeClientePorChat = new Map(); // 🆕 v3.4.1: último mensaje del cliente visto en chat con Modo Gestión
    const chatsBloqueados = new Set(); // 🆕 v3.4.2: chats que están siendo procesados ahora mismo (lock estricto)
    const EXPIRACION_DESPEDIDA = 15 * 60 * 1000;
    const TIMEOUT_MODO_GESTION = 60 * 60 * 1000;  // 🆕 v3.5.6: 60 min (antes 5 min)
    const COOLDOWN_MODO_GESTION = 10000;          // v3.3.2: 10s entre respuestas en modo gestión (más responsivo)

    // 🆕 v3.5.6: Timer por chat + sonido de alerta
    const tiempoInicioPorChat = new Map();
    const UMBRAL_ALERTA = 210000;              // 3:30 = 210 segundos
    const INTERVALO_SONIDO = 15000;            // beep cada 15s
    let sonidoActivo = localStorage.getItem('duturbo_sonido') !== '0';
    let ultimoSonido = 0;

    // 🆕 v3.2.1: Frase fija para agradecer primera imagen
    const FRASE_PRIMERA_IMAGEN = "Agradezco que me hayas enviado la imagen. Estoy revisándola para dar una respuesta adecuada a tu caso.";

    // 🆕 v3.2.1: Regex que detecta links de imágenes de HeroCare
    const REGEX_IMAGEN = /https?:\/\/helpcenter-us\.usehurrier\.com\/files-api\/files\//i;

    let chatActivoActual = null;
    let botCambiandoChat = false;

    // ════════════════════════════════════════════════════════════
    // 🛠 UTILS
    // ════════════════════════════════════════════════════════════
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function log(msg, tipo = 'info') {
        const entrada = { hora: new Date().toLocaleTimeString(), msg, tipo };
        logs.unshift(entrada);
        if (logs.length > 30) logs.pop();
        if (CONFIG.debug) console.log(`[DuTurbo] ${msg}`);
        actualizarPanelLogs();
    }

    function elegirAleatorio(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function elegirSinRepetir(arr, chatId) {
        const recientes = frasesEnviadasPorChat.get(chatId) || [];
        const disponibles = arr.filter(f => !recientes.includes(f));
        if (disponibles.length === 0) return elegirAleatorio(arr);
        return elegirAleatorio(disponibles);
    }

    function registrarFraseEnviada(chatId, frase) {
        const lista = frasesEnviadasPorChat.get(chatId) || [];
        lista.push(frase);
        if (lista.length > 5) lista.shift();
        frasesEnviadasPorChat.set(chatId, lista);
    }

    function resetChatLigero(chatId, nombre) {
        respuestasPorChat.delete(chatId);
        usosNombrePorChat.delete(chatId);
        chatsCriticos.delete(chatId);
        // 🆕 v3.4: NO borramos palabrasUsadasPorChat ni indiceSecuencialPorChat
        // Eso mantiene la memoria de no-repetir y la secuencia de frases
        log(`🔄 Click manual en ${nombre || chatId} — contador reseteado`, 'info');
    }

    // ════════════════════════════════════════════════════════════
    // 🖼️ DETECCIÓN DE IMAGEN (NUEVO v3.2.1)
    // Si el cliente envía un link de imagen y es la PRIMERA del chat,
    // bot responde con frase de agradecimiento.
    // Si ya envió otras antes, se trata como mensaje normal.
    // ════════════════════════════════════════════════════════════
    function mensajeTieneImagen(mensaje) {
        return REGEX_IMAGEN.test(mensaje || '');
    }

    function esPrimeraImagenDelChat(chatId) {
        const previas = imagenesPorChat.get(chatId) || 0;
        return previas === 0;
    }

    function registrarImagenEnviada(chatId) {
        const previas = imagenesPorChat.get(chatId) || 0;
        imagenesPorChat.set(chatId, previas + 1);
        log(`🖼️ Imagen #${previas + 1} en ${chatId}`, 'info');
    }

    // ════════════════════════════════════════════════════════════
    // 👁️ MODO GESTIÓN (NUEVO v3.2.2)
    // El bot ayuda al agente respondiendo en el chat ACTIVO también,
    // mientras el agente está gestionando una devolución/cupón.
    // Se desactiva automáticamente cuando:
    // - Agente da solución (cupón/devolución)
    // - Agente se despide
    // - Agente cambia a otro chat activo
    // - Pasan TIMEOUT_MODO_GESTION sin mensajes del cliente
    // - Click manual en el botón
    // ════════════════════════════════════════════════════════════
    // ════════════════════════════════════════════════════════════
    // 🆕 v3.5.6: SONIDO Y TIMER POR CHAT
    // ════════════════════════════════════════════════════════════
    function playAlertSound() {
        if (!sonidoActivo) return;
        if (Date.now() - ultimoSonido < INTERVALO_SONIDO) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 800;
            gain.gain.value = 0.3;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            setTimeout(() => { gain.gain.value = 0; }, 150);
            setTimeout(() => { gain.gain.value = 0.3; }, 250);
            setTimeout(() => { osc.stop(); ctx.close(); }, 400);
            ultimoSonido = Date.now();
        } catch (e) { /* AudioContext no disponible */ }
    }

    function iniciarTimerChat(chatId) {
        if (!tiempoInicioPorChat.has(chatId)) {
            tiempoInicioPorChat.set(chatId, Date.now());
        }
    }

    function detenerTimerChat(chatId) {
        tiempoInicioPorChat.delete(chatId);
    }

    function formatearTimer(ms) {
        const seg = Math.floor(ms / 1000);
        return `${Math.floor(seg / 60)}:${(seg % 60).toString().padStart(2, '0')}`;
    }

    function activarModoGestion(chatId, nombre) {
        chatsEnModoGestion.set(chatId, Date.now());
        log(`👁️ Modo Gestión ACTIVADO: ${nombre}`, 'success');
    }

    function desactivarModoGestion(chatId, motivo = 'manual') {
        if (!chatsEnModoGestion.has(chatId)) return;
        chatsEnModoGestion.delete(chatId);
        // 🆕 v3.5.6: NO borrar ultimoMensajeClientePorChat
        // para que al volver al chat, el bot recuerde qué ya respondió
        log(`🛑 Modo Gestión desactivado (${motivo}): ${chatId}`, 'warn');
    }

    function estaEnModoGestion(chatId) {
        const ts = chatsEnModoGestion.get(chatId);
        if (!ts) return false;
        // Timeout automático: sin actividad por TIMEOUT_MODO_GESTION (60 min)
        if (Date.now() - ts > TIMEOUT_MODO_GESTION) {
            desactivarModoGestion(chatId, 'timeout 60min');
            return false;
        }
        return true;
    }

    function refrescarModoGestion(chatId) {
        // Renueva el timestamp para que no expire mientras hay actividad
        if (chatsEnModoGestion.has(chatId)) {
            chatsEnModoGestion.set(chatId, Date.now());
        }
    }

    function toggleModoGestion(chatId, nombre) {
        if (estaEnModoGestion(chatId)) {
            desactivarModoGestion(chatId, 'manual');
            chatsGestionDesactivadaManual.add(chatId);  // 🆕 v3.5.6: marcar como desactivado manual
        } else {
            activarModoGestion(chatId, nombre);
            chatsGestionDesactivadaManual.delete(chatId);  // 🆕 v3.5.6: quitar marca si reactiva
        }
    }

    // ════════════════════════════════════════════════════════════
    // 🧠 DECIDIR ETAPA (mejorado v3.2 con saludos protocolarios)
    // ════════════════════════════════════════════════════════════
    function obtenerEtapa(chatId) {
        const nBot = respuestasPorChat.get(chatId) || 0;
        // Solo contamos mensajes REALES del agente (no protocolarios)
        const nAgenteReal = contarMensajesRealesDelAgente();

        // Si el agente ya escribió mensajes REALES → saltar a etapa 2
        if (nAgenteReal > 0 && nBot === 0) {
            log(`📌 Agente ya escribió ${nAgenteReal} msg real(es) — etapa 2`, 'info');
            return 2;
        }

        if (nBot === 0) return 1;
        if (nBot <= 2) return 2;
        if (nBot <= 4) return 3;
        return 4;
    }

    function incrementarRespuestas(chatId) {
        const n = (respuestasPorChat.get(chatId) || 0) + 1;
        respuestasPorChat.set(chatId, n);
        iniciarTimerChat(chatId);  // 🆕 v3.5.6: iniciar timer
        return n;
    }

    // ════════════════════════════════════════════════════════════
    // 👤 PERSONALIZACIÓN CON NOMBRE
    // ════════════════════════════════════════════════════════════
    function personalizarFrase(frase, nombreCliente, chatId) {
        if (!nombreCliente) return frase;
        const usos = usosNombrePorChat.get(chatId) || 0;
        if (usos >= CONFIG.maxUsosNombrePorChat) return frase;
        if (Math.random() > CONFIG.probUsarNombre) return frase;

        const primerNombre = nombreCliente.split(' ')[0];
        if (frase.includes(primerNombre)) return frase;

        if (/^(Perm[ií]teme|Dame|Esp[eé]rame|Aguárdame|Por favor)/i.test(frase)) {
            usosNombrePorChat.set(chatId, usos + 1);
            return `${primerNombre}, ${frase.charAt(0).toLowerCase()}${frase.slice(1)}`;
        }
        if (frase.length < 60) {
            usosNombrePorChat.set(chatId, usos + 1);
            return frase.replace(/\.$/, `, ${primerNombre}.`);
        }
        return frase;
    }

    // ════════════════════════════════════════════════════════════
    // 🚀 GENERAR RESPUESTA — MODO RÁPIDO
    // ════════════════════════════════════════════════════════════
    function generarRespuestaRapida(mensaje, etapa, chatId, nombreCliente) {
        let frase;
        // 🆕 v3.4: Usar generador inteligente para etapas 2+ (gestión en curso)
        // Etapa 1 mantiene apertura empática + espera (chat virgen)
        if (etapa === 1) {
            const empatia = elegirSinRepetir(FRASES.apertura_empatia, chatId);
            const espera = elegirSinRepetir(FRASES.apertura_espera, chatId);
            frase = `${empatia} ${espera}`;
            registrarFraseEnviada(chatId, empatia);
            registrarFraseEnviada(chatId, espera);
            registrarPalabrasUsadas(chatId, frase);
        } else {
            // 🆕 v3.4: Generador inteligente con reconocimiento contextual
            frase = generarFraseInteligente(mensaje, chatId, nombreCliente);
            registrarFraseEnviada(chatId, frase);
        }
        return frase;
    }

    // ════════════════════════════════════════════════════════════
    // 🧠 PROMPT PARA MODO INTELIGENTE (usado por el backend, Claude Haiku 4.5)
    // 🆕 v3.6.0: Ya no se usa directamente en este archivo — la llamada al
    // modelo ahora vive en backend/server.js. Se conserva aquí como
    // referencia para cuando construyamos ese endpoint en el siguiente paso.
    // ════════════════════════════════════════════════════════════
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
- Mensaje actual del cliente

INSTRUCCIÓN POR ETAPA:
- Etapa 1: empatía corta + pedir espera
- Etapa 2: acuse cálido en 2 partes (reconocimiento + acción), NO repitas "espera"
- Etapa 3: muestra que ya casi terminas

Si el agente YA escribió mensajes reales (no solo saludos), NUNCA respondas con apertura empática.
Usa siempre respuesta de etapa 2 o 3.

Responde SOLO con el texto a enviar, sin comillas ni explicaciones.`;

    // ════════════════════════════════════════════════════════════
    // 🧠 GENERAR RESPUESTA — MODO INTELIGENTE (Claude Haiku 4.5 vía backend)
    // 🆕 v3.6.0: Ya no se llama a OpenAI directo desde el navegador (la key
    // ya no vive en este archivo). Se hace fetch al backend propio, que es
    // el único que conoce la API key de Claude (como variable de entorno
    // del servidor) y arma el prompt. backend/server.js aún no existe —
    // esta URL es un placeholder hasta el siguiente paso.
    // ════════════════════════════════════════════════════════════
    async function generarRespuestaIA(mensaje, etapa, chatId) {
        const recientes = frasesEnviadasPorChat.get(chatId) || [];

        try {
            const ctrl = new AbortController();
            const timeoutId = setTimeout(() => ctrl.abort(), CONFIG.timeoutIA);

            const resp = await fetch(CONFIG.backendURL, {
                method: 'POST',
                signal: ctrl.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mensaje,
                    etapa,
                    frasesEnviadas: recientes
                })
            });

            clearTimeout(timeoutId);

            if (!resp.ok) {
                log(`⚠️ Backend IA error ${resp.status}, fallback rápido`, 'warn');
                return null;
            }

            const data = await resp.json();
            const texto = (data?.respuesta || '').trim();

            if (!texto) return null;

            if (texto.includes('{ESCALAR}')) {
                log('🚨 Backend IA solicitó ESCALAR — no envío', 'warn');
                return '{ESCALAR}';
            }

            if (texto.length > 120) {
                log('⚠️ Respuesta IA muy larga, fallback rápido', 'warn');
                return null;
            }

            registrarFraseEnviada(chatId, texto);
            return texto;
        } catch (err) {
            log(`⚠️ Backend IA excepción: ${err.message}, fallback`, 'warn');
            return null;
        }
    }

    // ════════════════════════════════════════════════════════════
    // 🎯 GENERAR RESPUESTA (dispatcher)
    // PRIORIDAD: imagen primera vez > saludo espejeado > generación normal
    // ════════════════════════════════════════════════════════════
    async function generarRespuesta(mensaje, etapa, chatId, nombreCliente) {
        // 🖼️ PRIORIDAD 1: ¿Mensaje contiene imagen?
        if (mensajeTieneImagen(mensaje)) {
            // 🆕 v3.4.2: VERIFICAR si ya enviamos la frase de imagen en este chat
            // (Aunque el contador esté en 0 por bug, si ya enviamos la frase, NO la repetimos)
            const yaEnviadaFraseImagen = (frasesEnviadasPorChat.get(chatId) || [])
                .some(f => f && f.includes('Agradezco que me hayas enviado la imagen'));

            if (esPrimeraImagenDelChat(chatId) && !yaEnviadaFraseImagen) {
                log(`🖼️ Primera imagen del chat — agradeciendo`, 'info');
                registrarImagenEnviada(chatId);
                registrarFraseEnviada(chatId, FRASE_PRIMERA_IMAGEN);
                registrarPalabrasUsadas(chatId, FRASE_PRIMERA_IMAGEN);  // 🆕 v3.5.2: regla de oro
                return FRASE_PRIMERA_IMAGEN;
            } else {
                // Ya envió imágenes antes → frase específica para imagen adicional
                registrarImagenEnviada(chatId);
                log(`🖼️ Imagen adicional — frase de imagen`, 'info');
                const frasesImgExtra = [
                    "Recibí la imagen. La estoy revisando junto con la información anterior.",
                    "Imagen recibida. La tendré en cuenta en la revisión.",
                    "Ya vi la imagen que enviaste. Continúo con la gestión.",
                    "Recibí la foto. Sigo revisando tu caso.",
                    "Imagen recibida. Permíteme continuar con la revisión."
                ];
                const fraseImg = frasesImgExtra[imagenesPorChat.get(chatId) % frasesImgExtra.length];
                registrarFraseEnviada(chatId, fraseImg);
                registrarPalabrasUsadas(chatId, fraseImg);
                return fraseImg;
            }
        }

        // 👋 PRIORIDAD 2: ¿es un saludo simple? → respuesta espejeada con regex
        // (no llama a la IA, ahorra latencia y costo)
        if (etapa === 1) {
            const saludo = detectarSaludo(mensaje, nombreCliente);
            if (saludo) {
                log(`👋 Saludo detectado, devolviendo espejeado`, 'info');
                registrarFraseEnviada(chatId, saludo);
                return saludo;
            }
        }

        // 💳 PRIORIDAD 3: ¿El agente preguntó cómo quiere la devolución?
        // Si sí, clasificar la respuesta del cliente (elige método o no)
        const respuestaDevolucion = clasificarRespuestaDevolucion(mensaje, chatId, nombreCliente);
        if (respuestaDevolucion) {
            log(`💳 Respuesta a pregunta de devolución detectada`, 'info');
            registrarFraseEnviada(chatId, respuestaDevolucion);
            registrarPalabrasUsadas(chatId, respuestaDevolucion);
            return respuestaDevolucion;
        }

        let frase;
        if (CONFIG.modoIA === 'inteligente') {
            frase = await generarRespuestaIA(mensaje, etapa, chatId);
            if (frase === '{ESCALAR}') return null;
            if (!frase) frase = generarRespuestaRapida(mensaje, etapa, chatId, nombreCliente);
        } else {
            frase = generarRespuestaRapida(mensaje, etapa, chatId, nombreCliente);
        }

        frase = personalizarFrase(frase, nombreCliente, chatId);
        return frase;
    }

    // ════════════════════════════════════════════════════════════
    // 📋 LEER CHATS DEL SIDEBAR
    // ════════════════════════════════════════════════════════════
    // 🆕 v3.6.0: Fix — antes usaba querySelector (solo el primer dígito)
    // para leer el badge de no leídos. Ant Design renderiza cada dígito
    // del contador como un <span> independiente (animación de "rodillo"),
    // así que un badge de "12" devolvía "1". Ahora se leen y concatenan
    // TODOS los dígitos con querySelectorAll.
    function leerNumeroBadge(item) {
        const unidades = item.querySelectorAll(SEL.unreadBadge);
        if (!unidades.length) return 0;
        const texto = Array.from(unidades).map(u => u.textContent.trim()).join('');
        const n = parseInt(texto, 10);
        return (!isNaN(n) && n > 0) ? n : 0;
    }

    // 🆕 v3.6.2: extraen datos del item por selector dedicado, NO por texto
    // concatenado del <li> completo (ese texto incluye un countdown que
    // tickea cada segundo — usarlo para armar el id causaba que cada chat
    // pareciera "otro chat" en cada poll, rompiendo Modo Gestión).
    function extraerIdTicket(item) {
        const testId = item.getAttribute('data-testid') || '';
        const m = testId.match(SEL.ticketIdAttr);
        return m ? m[1] : null;
    }

    function extraerNombreCliente(item) {
        const nameEl = item.querySelector(SEL.ticketName);
        return nameEl ? (nameEl.textContent || '').trim() : '';
    }

    function extraerMinutosAbierto(item) {
        const el = item.querySelector(SEL.handlingTime);
        if (!el) return 0;
        const m = (el.textContent || '').match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function leerChats() {
        const items = document.querySelectorAll(SEL.chatItem);
        const chats = [];

        items.forEach((item) => {
            const id = extraerIdTicket(item);
            const nombre = extraerNombreCliente(item);
            if (!id || !nombre) return;

            const minutosAbierto = extraerMinutosAbierto(item);
            const mensajesSinLeer = leerNumeroBadge(item);

            chats.push({
                id, nombre, minutosAbierto, mensajesSinLeer,
                tieneNuevos: mensajesSinLeer > 0,
                elemento: item
            });
        });

        return chats;
    }

    // ════════════════════════════════════════════════════════════
    // 👤 TRACKING CHAT ACTIVO POR CLICK
    // ════════════════════════════════════════════════════════════
    function inicializarTrackingClicks() {
        document.addEventListener('click', (e) => {
            if (botCambiandoChat) return;
            const item = e.target.closest(SEL.chatItem);
            if (!item) return;

            // 🆕 v3.6.2: id estable real (data-testid="ticket-{uuid}") en vez
            // de derivarlo del nombre + texto que incluye el countdown
            const id = extraerIdTicket(item);
            const nombre = extraerNombreCliente(item);
            if (!id || !nombre) return;

            // 🆕 v3.2.2: Si cambiamos a otro chat → desactivar Modo Gestión del anterior
            if (chatActivoActual && chatActivoActual.id !== id) {
                desactivarModoGestion(chatActivoActual.id, 'cambio de chat activo');
            }

            chatActivoActual = { id, nombre };
            resetChatLigero(id, nombre);

            // 🆕 v3.5.6: Auto-activar Modo Gestión al abrir un chat
            // SOLO si el usuario no lo desactivó manualmente
            if (!chatsGestionDesactivadaManual.has(id)) {
                activarModoGestion(id, nombre);
                // 🆕 v3.5.6: Capturar último mensaje del cliente como "ya visto"
                // para NO re-responder un mensaje viejo al regresar al chat
                setTimeout(() => {
                    const ultimaBurbuja = leerSoloUltimaBurbujaCliente(nombre);
                    if (ultimaBurbuja) {
                        ultimoMensajeClientePorChat.set(id, ultimaBurbuja);
                    }
                }, 800);
            }

            log(`👤 Chat activo: ${nombre}${chatsGestionDesactivadaManual.has(id) ? ' (manual OFF)' : ' (ayuda activada)'}`, 'info');
        }, true);
    }

    function obtenerChatActivo(chats) {
        if (chatActivoActual) {
            const match = chats.find(c => c.id === chatActivoActual.id);
            if (match) return match;
        }
        return null;
    }

    // ════════════════════════════════════════════════════════════
    // 📩 LEER MENSAJES NUEVOS DEL CLIENTE
    // ════════════════════════════════════════════════════════════
    function leerUltimoMensajeCliente(nombreCliente) {
        const cont = document.querySelector(SEL.conversationContainer);
        if (!cont) return '';

        const hijos = Array.from(cont.children);

        let idxNew = -1;
        hijos.forEach((h, i) => {
            if (h.classList.contains('ant-divider') && /new/i.test(h.textContent || '')) {
                idxNew = i;
            }
        });

        let burbujas;
        if (idxNew >= 0) {
            burbujas = hijos.slice(idxNew + 1)
                .filter(h => h.getAttribute('data-testid') === 'chat-bubble');
        } else {
            burbujas = hijos.filter(h => h.getAttribute('data-testid') === 'chat-bubble');
        }

        if (burbujas.length === 0) return '';

        // 🆕 v3.4.5: Fix definitivo — usar esBurbujaDelAgente
        const delCliente = burbujas.filter(b => {
            if (esBurbujaDelAgente(b)) return false;
            const txt = b.textContent || '';
            if (/\bsystem\b/i.test(txt)) return false;
            // 🆕 v3.2.1: Las imágenes de HeroCare SÍ pasan
            const textoLimpio = limpiarTextoBurbuja(txt, nombreCliente);
            if (/^https?:\/\/\S+$/i.test(textoLimpio) && !REGEX_IMAGEN.test(textoLimpio)) return false;
            return true;
        });

        if (delCliente.length === 0) return '';

        const ultimas = delCliente.slice(-3);
        const textos = ultimas
            .map(b => limpiarTextoBurbuja(b.textContent || '', nombreCliente))
            .filter(t => t.length > 0);

        return textos.join('. ');
    }

    // 🆕 v3.4.4: Lee SOLO la última burbuja del cliente (para detección estable de mensaje nuevo)
    // 🆕 v3.4.5: usa esBurbujaDelAgente (definido arriba) para identificar correctamente al cliente
    function leerSoloUltimaBurbujaCliente(nombreCliente) {
        const cont = document.querySelector(SEL.conversationContainer);
        if (!cont) return '';

        const todasBurbujas = Array.from(cont.querySelectorAll('[data-testid="chat-bubble"]'));
        if (todasBurbujas.length === 0) return '';

        // 🆕 v3.4.5: Filtrar usando esBurbujaDelAgente (fix definitivo)
        const delCliente = todasBurbujas.filter(b => !esBurbujaDelAgente(b));

        if (delCliente.length === 0) return '';

        // Devolver SOLO el texto de la última burbuja del cliente
        const ultima = delCliente[delCliente.length - 1];
        return limpiarTextoBurbuja(ultima.textContent || '', nombreCliente).trim();
    }

    function limpiarTextoBurbuja(texto, nombreCliente) {
        let t = texto;
        t = t.replace(/\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM|a\.?\s?m\.?|p\.?\s?m\.?)?/gi, ' ');
        if (CONFIG.nombreAgente) t = t.split(CONFIG.nombreAgente).join(' ');
        if (nombreCliente) t = t.split(nombreCliente).join(' ');
        return t.replace(/\s+/g, ' ').trim();
    }

    // ════════════════════════════════════════════════════════════
    // 🚫 ¿AGENTE YA SE DESPIDIÓ?
    // ════════════════════════════════════════════════════════════
    function agenteYaSeDespidio() {
        const cont = document.querySelector(SEL.conversationContainer);
        if (!cont) return false;
        // 🆕 v3.5.4: Usar esBurbujaDelAgente (no depender del nombre)
        const burbujasAgente = Array.from(cont.querySelectorAll(SEL.chatBubble))
            .filter(b => esBurbujaDelAgente(b));
        return burbujasAgente.some(b => esDespedida(b.textContent || ''));
    }

    function marcarDespedido(chatId) {
        chatsDespedidos.set(chatId, Date.now());
        detenerTimerChat(chatId);  // 🆕 v3.5.6
    }

    function estaDespedido(chatId) {
        const ts = chatsDespedidos.get(chatId);
        if (!ts) return false;
        if (Date.now() - ts > EXPIRACION_DESPEDIDA) {
            chatsDespedidos.delete(chatId);
            return false;
        }
        return true;
    }

    function marcarConSolucion(chatId) {
        chatsConSolucion.set(chatId, Date.now());
        detenerTimerChat(chatId);  // 🆕 v3.5.6
    }

    function tieneSolucion(chatId) {
        const ts = chatsConSolucion.get(chatId);
        if (!ts) return false;
        if (Date.now() - ts > EXPIRACION_DESPEDIDA) {
            chatsConSolucion.delete(chatId);
            return false;
        }
        return true;
    }

    // ════════════════════════════════════════════════════════════
    // ✉️ ENVIAR MENSAJE A HEROCARE
    // ════════════════════════════════════════════════════════════
    async function enviarMensaje(texto) {
        const ta = document.querySelector(SEL.textarea);
        if (!ta) {
            log('❌ Textarea no encontrado', 'error');
            return false;
        }
        if (CONFIG.pausarSiAgenteEscribe && ta.value && ta.value.trim().length > 0) {
            log('⏸️ Agente escribiendo, no envío', 'warn');
            return false;
        }
        ta.focus();
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(ta, texto);
        ta.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: texto }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(CONFIG.delayAntesDeEnviar);
        const botones = Array.from(document.querySelectorAll('button'));
        const btn = botones.find(b => /enviar|send/i.test(b.textContent.trim()) && !b.disabled);
        if (!btn) {
            log('❌ Botón Enviar no disponible', 'error');
            return false;
        }
        btn.click();
        log(`✅ Enviado: "${texto.slice(0, 50)}${texto.length > 50 ? '...' : ''}"`, 'success');
        return true;
    }

    // ════════════════════════════════════════════════════════════
    // ⚙️ PROCESAR UN CHAT
    // ════════════════════════════════════════════════════════════
    async function procesarChat(chat, chatPrevio) {
        if (procesando) return;
        // 🆕 v3.4.2: Lock estricto por chat individual
        if (chatsBloqueados.has(chat.id)) return;
        chatsBloqueados.add(chat.id);
        procesando = true;
        botCambiandoChat = true;

        try {
            log(`🔄 ${chat.nombre} tiene ${chat.mensajesSinLeer} mensaje(s) nuevo(s)`, 'info');
            chat.elemento.click();
            await sleep(CONFIG.delayCambioDeChat);

            // CHECK 1: ¿Ya se despidió?
            if (agenteYaSeDespidio()) {
                marcarDespedido(chat.id);
                desactivarModoGestion(chat.id, 'agente se despidió');  // 🆕 v3.2.2
                log(`🚫 ${chat.nombre}: ya despedido`, 'warn');
                await volverAChat(chatPrevio, chat);
                return;
            }

            // CHECK 2: ¿Ya hay solución entregada?
            if (agenteYaDioSolucion()) {
                marcarConSolucion(chat.id);
                desactivarModoGestion(chat.id, 'solución entregada');  // 🆕 v3.2.2
                log(`💰 ${chat.nombre}: ya hay solución — no respondo`, 'warn');
                await volverAChat(chatPrevio, chat);
                return;
            }

            // Leer mensaje
            const mensaje = leerUltimoMensajeCliente(chat.nombre);
            if (!mensaje) {
                log(`⚠️ No leí mensaje en ${chat.nombre}`, 'warn');
                await volverAChat(chatPrevio, chat);
                return;
            }
            log(`📩 Cliente: "${mensaje.slice(0, 60)}..."`, 'info');

            // 🆕 v3.4.3: Marcar mensaje como "siendo procesado" INMEDIATAMENTE
            // Si otro ciclo llega aquí con el mismo mensaje, sabrá que ya se está respondiendo
            // 🆕 v3.4.4: Usar leerSoloUltimaBurbujaCliente (estable, no las 3 últimas)
            if (estaEnModoGestion(chat.id)) {
                const ultimaBurbuja = leerSoloUltimaBurbujaCliente(chat.nombre);
                if (ultimaBurbuja) {
                    ultimoMensajeClientePorChat.set(chat.id, ultimaBurbuja);
                }
            }

            // CHECK 3: ¿Es cierre del cliente?
            // 🆕 v3.5.4: SOLO considerar cierre si el agente YA dio solución o se despidió
            // Si NO hay solución/despedida, "Gracias" es cortesía, NO cierre
            const ultimaBurbuja = leerSoloUltimaBurbujaCliente(chat.nombre);
            const agenteCerroConversacion = agenteYaDioSolucion() || agenteYaSeDespidio();

            if (agenteCerroConversacion && (esCierreDelCliente(ultimaBurbuja) || esCierreDelCliente(mensaje))) {
                log(`🙏 ${chat.nombre}: cierre del cliente (post-solución) — no respondo`, 'warn');
                marcarConSolucion(chat.id);
                await volverAChat(chatPrevio, chat);
                return;
            }

            // CHECK 4: Filtro NO TOCAR
            const razonNoTocar = esClienteNoTocar(mensaje);
            if (razonNoTocar) {
                log(`🚨 CLIENTE NO TOCAR (${razonNoTocar}) — alerta`, 'error');
                chatsCriticos.set(chat.id, Date.now());
                await volverAChat(chatPrevio, chat);
                return;
            }

            // Etapa
            const etapa = obtenerEtapa(chat.id);
            log(`🏷️ Etapa: ${etapa}`, 'info');

            // CHECK 5: ¿Etapa crítica?
            if (etapa === 4) {
                log(`🔴 ${chat.nombre}: CRÍTICO — alerta`, 'error');
                chatsCriticos.set(chat.id, Date.now());
                await volverAChat(chatPrevio, chat);
                return;
            }

            // Generar respuesta (saludos espejeados tienen prioridad)
            const frase = await generarRespuesta(mensaje, etapa, chat.id, chat.nombre);
            if (!frase) {
                log(`🚨 Respuesta vetada (escalar)`, 'warn');
                chatsCriticos.set(chat.id, Date.now());
                await volverAChat(chatPrevio, chat);
                return;
            }

            // 🆕 v3.4.2: Marcar cooldown ANTES de enviar (no después)
            // Esto evita que otro ciclo procese el mismo chat mientras estamos enviando
            ultimaRespuestaChat.set(chat.id, Date.now());

            // Enviar
            const ok = await enviarMensaje(frase);
            if (ok) {
                // Re-actualizar timestamp con el momento real de envío exitoso
                ultimaRespuestaChat.set(chat.id, Date.now());
                incrementarRespuestas(chat.id);
                refrescarModoGestion(chat.id);  // 🆕 v3.2.2: renovar timeout
                // 🆕 v3.4.4: Registrar la última burbuja del cliente como "ya respondida"
                if (estaEnModoGestion(chat.id)) {
                    const ultimaBurbuja = leerSoloUltimaBurbujaCliente(chat.nombre);
                    if (ultimaBurbuja) {
                        ultimoMensajeClientePorChat.set(chat.id, ultimaBurbuja);
                    }
                }
            } else {
                // Si falló el envío, liberar el cooldown (poner timestamp antiguo)
                ultimaRespuestaChat.set(chat.id, Date.now() - COOLDOWN_MODO_GESTION - 1000);
            }

            await volverAChat(chatPrevio, chat);
        } catch (err) {
            log(`💥 Error: ${err.message}`, 'error');
            console.error(err);
        } finally {
            procesando = false;
            // 🆕 v3.4.3: Lock por chat MUCHO más largo (3 segundos)
            // para evitar que un ciclo entre antes de que el envío anterior se "asiente"
            setTimeout(() => {
                chatsBloqueados.delete(chat.id);
                botCambiandoChat = false;
            }, 3000);
        }
    }

    async function volverAChat(chatPrevio, chatActual) {
        if (!chatPrevio || chatPrevio.id === chatActual.id) return;
        await sleep(400);
        const chatsAhora = leerChats();
        const previo = chatsAhora.find(c => c.nombre === chatPrevio.nombre);
        if (previo) {
            previo.elemento.click();
            log(`↩️ Volviendo a ${chatPrevio.nombre}`, 'info');
        }
    }

    // ════════════════════════════════════════════════════════════
    // 🔁 CICLO PRINCIPAL
    // ════════════════════════════════════════════════════════════
    async function ciclo() {
        if (!activo || procesando) return;
        const chats = leerChats();
        if (chats.length === 0) return;
        const chatActivo = obtenerChatActivo(chats);

        // 🆕 v3.5.6: NO detenerse si no hay chat activo
        // Los chats con badge verde SIEMPRE se procesan

        for (const chat of chats) {
            const esElActivo = chatActivo && (chat.id === chatActivo.id);
            const enModoGestion = estaEnModoGestion(chat.id);

            // 🆕 v3.4.2: Si este chat ya está siendo procesado, saltar
            if (chatsBloqueados.has(chat.id)) continue;

            // v3.3.2: Si es el chat activo, solo procesa si está en Modo Gestión
            if (esElActivo && !enModoGestion) continue;

            // 🆕 v3.4.1: Detección diferenciada según contexto
            // - Chat activo + Modo Gestión: detecta por CONTENIDO del último mensaje del cliente (sin badge)
            // - Otros chats: detecta por badge verde (como siempre)
            if (esElActivo && enModoGestion) {
                // 🆕 v3.4.4: Solo la ÚLTIMA burbuja del cliente (no las 3 últimas concatenadas)
                // Esto da estabilidad para la comparación de "¿es mensaje nuevo?"
                const mensajeActual = leerSoloUltimaBurbujaCliente(chat.nombre);
                const mensajeVisto = ultimoMensajeClientePorChat.get(chat.id) || '';

                // Si no hay mensaje del cliente o ya respondimos a ese mensaje, saltar SILENCIOSAMENTE
                if (!mensajeActual) continue;
                if (mensajeActual === mensajeVisto) continue;
                // Hay mensaje nuevo del cliente → seguir con los demás checks
                log(`🆕 ${chat.nombre}: mensaje nuevo detectado en chat activo`, 'info');
            } else {
                // Para los demás chats: badge verde como siempre
                if (!chat.tieneNuevos) continue;
            }

            // v3.3.2: Logs explícitos sobre por qué NO se procesa (solo en modo gestion)
            if (estaDespedido(chat.id)) {
                if (enModoGestion) log(`⏭️ ${chat.nombre}: despedido (skip)`, 'info');
                continue;
            }
            if (tieneSolucion(chat.id)) {
                if (enModoGestion) log(`⏭️ ${chat.nombre}: solución dada (skip)`, 'info');
                continue;
            }
            if (chatsCriticos.has(chat.id)) {
                if (enModoGestion) log(`⏭️ ${chat.nombre}: crítico (skip)`, 'info');
                continue;
            }

            // v3.3.2: Cooldown más relajado en modo gestión + log explícito
            const cooldownAplicar = enModoGestion ? COOLDOWN_MODO_GESTION : CONFIG.cooldownChat;
            const ultimoEnvio = ultimaRespuestaChat.get(chat.id) || 0;
            const transcurrido = Date.now() - ultimoEnvio;
            if (transcurrido < cooldownAplicar) {
                if (enModoGestion) {
                    const restante = Math.ceil((cooldownAplicar - transcurrido) / 1000);
                    log(`⏰ ${chat.nombre}: cooldown (faltan ${restante}s)`, 'info');
                }
                continue;
            }

            await procesarChat(chat, chatActivo);
            break;
        }
        actualizarPanelEstado(chats, chatActivo);
    }

    // ════════════════════════════════════════════════════════════
    // 🎨 PANEL FLOTANTE
    // ════════════════════════════════════════════════════════════
    function crearPanel() {
        if (document.getElementById('duturbo-wrapper')) return;

        // Leer posición y estado guardados
        const posGuardada = JSON.parse(localStorage.getItem('duturbo_pos') || 'null');
        const expandidoGuardado = localStorage.getItem('duturbo_expandido') === '1';

        // Wrapper que contiene tanto el botoncito como el panel
        const wrapper = document.createElement('div');
        wrapper.id = 'duturbo-wrapper';
        wrapper.innerHTML = `
            <!-- Botoncito flotante (visible cuando está minimizado) -->
            <div id="dt-floating-btn" title="Abrir DuTurbo (click) — arrastra para mover">
                <span class="dt-fb-icon">🤖</span>
                <span class="dt-fb-status"></span>
            </div>

            <!-- Panel completo (visible cuando está expandido) -->
            <div id="duturbo-panel">
                <div id="dt-header">
                    <span id="dt-title">🤖 DuTurbo v3.6.2</span>
                    <button id="dt-min" title="Minimizar a botón">✕</button>
                </div>
                <div id="dt-body">
                    <button id="dt-toggle">⚫ OFF</button>
                    <div id="dt-config">
                        <label>Tu nombre:
                            <input id="dt-agente" type="text" placeholder="Ej: Duvan Ramos" value="${CONFIG.nombreAgente || ''}">
                        </label>
                        <label style="margin-top:6px;">Modo de respuesta:
                            <select id="dt-modo">
                                <option value="rapido"${CONFIG.modoIA === 'rapido' ? ' selected' : ''}>🚀 Rápido (regex)</option>
                                <option value="inteligente"${CONFIG.modoIA === 'inteligente' ? ' selected' : ''}>🧠 Inteligente (Claude vía backend)</option>
                            </select>
                        </label>
                    </div>
                    <div id="dt-estado">Esperando...</div>
                    <div id="dt-atajo" style="font-size:10px; color:#94a3b8; padding:4px 6px; margin-bottom:6px; background:rgba(192,223,22,.05); border-radius:4px;">💡 Ctrl+Shift+A = desactivar ayuda en chat activo</div>
                    <button id="dt-sonido" style="width:100%;padding:5px;border:1px solid rgba(255,255,255,0.1);border-radius:5px;background:rgba(255,255,255,0.05);color:#94a3b8;font-size:11px;cursor:pointer;">🔊 Sonido ON</button>
                    <div id="dt-templates" style="display:flex;gap:4px;flex-wrap:wrap;">
                        <input id="dt-monto" type="text" placeholder="Monto: ARS 5200" style="width:100%;box-sizing:border-box;background:#0f172a;color:#C0DF16;border:1px solid rgba(192,223,22,0.3);border-radius:5px;padding:5px 8px;font-size:11px;margin-bottom:4px;">
                        <button class="dt-tpl-btn" data-tpl="cupon">💳 Cupón</button>
                        <button class="dt-tpl-btn" data-tpl="tarjeta">💳 Tarjeta</button>
                        <button class="dt-tpl-btn" data-tpl="wallet">💳 Wallet</button>
                    </div>
                    <div id="dt-logs"></div>
                </div>
            </div>
        `;

        const css = `
            /* Wrapper contenedor */
            #duturbo-wrapper { position: fixed; bottom: 20px; right: 20px; z-index: 999999; font-family: system-ui, -apple-system, sans-serif; }

            /* Botoncito flotante minimizado */
            #dt-floating-btn {
                width: 52px;
                height: 52px;
                background: linear-gradient(135deg, #2F2951 0%, #1e1838 100%);
                border: 2px solid rgba(192,223,22,0.3);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: grab;
                box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                position: relative;
                transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
                user-select: none;
            }
            #dt-floating-btn:hover {
                transform: scale(1.08);
                box-shadow: 0 6px 24px rgba(192,223,22,0.4);
                border-color: #C0DF16;
            }
            #dt-floating-btn:active { cursor: grabbing; }
            #dt-floating-btn.dragging { transform: scale(1.1); cursor: grabbing; }
            .dt-fb-icon {
                font-size: 24px;
                line-height: 1;
                filter: drop-shadow(0 0 4px rgba(192,223,22,0.4));
            }
            .dt-fb-status {
                position: absolute;
                top: 4px;
                right: 4px;
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: #ef4444;
                border: 2px solid #1e1838;
                transition: background 0.2s, box-shadow 0.2s;
            }
            .dt-fb-status.on {
                background: #10b981;
                box-shadow: 0 0 10px #10b981;
                animation: pulseDot 2s infinite;
            }
            @keyframes pulseDot {
                0%, 100% { box-shadow: 0 0 10px #10b981; }
                50% { box-shadow: 0 0 18px #10b981; }
            }

            /* Panel expandido */
            #duturbo-panel {
                position: absolute;
                bottom: 0;
                right: 0;
                width: 300px;
                background: linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(20,28,52,0.98) 100%);
                color: #fff;
                font-size: 12px;
                border-radius: 12px;
                box-shadow: 0 12px 40px rgba(0,0,0,0.5);
                border: 1px solid rgba(192,223,22,0.2);
                overflow: hidden;
                display: none;
            }
            #duturbo-wrapper.expanded #duturbo-panel { display: block; }
            #duturbo-wrapper.expanded #dt-floating-btn { display: none; }

            /* Header del panel */
            #dt-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 14px;
                background: linear-gradient(90deg, #2F2951 0%, #1e1838 100%);
                border-bottom: 1px solid rgba(192,223,22,0.15);
                cursor: move;
            }
            #dt-title { font-weight: 700; font-size: 13px; letter-spacing: 0.3px; }
            #dt-min {
                background: rgba(255,255,255,0.05);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.1);
                cursor: pointer;
                font-size: 12px;
                padding: 3px 9px;
                border-radius: 5px;
                transition: all 0.2s;
            }
            #dt-min:hover { background: rgba(220,38,38,0.5); border-color: #fca5a5; }

            /* Body del panel */
            #dt-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 9px; }

            /* Toggle ON/OFF */
            #dt-toggle {
                width: 100%;
                padding: 9px;
                border: none;
                border-radius: 7px;
                background: #ef4444;
                color: white;
                font-weight: 700;
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s;
            }
            #dt-toggle:hover { transform: translateY(-1px); }
            #dt-toggle.on {
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                box-shadow: 0 0 16px rgba(16,185,129,0.4);
            }

            /* Config */
            #dt-config {
                font-size: 11px;
                padding: 9px;
                background: rgba(192,223,22,0.06);
                border: 1px solid rgba(192,223,22,0.15);
                border-radius: 7px;
            }
            #dt-config label { display: block; color: #cbd5e1; font-weight: 500; }
            #dt-config input, #dt-config select {
                width: 100%;
                box-sizing: border-box;
                background: #0f172a;
                color: #C0DF16;
                border: 1px solid rgba(192,223,22,0.3);
                border-radius: 5px;
                padding: 5px 8px;
                margin-top: 3px;
                font-size: 11px;
                outline: none;
                transition: border-color 0.2s;
            }
            #dt-config input:focus, #dt-config select:focus { border-color: #C0DF16; }

            /* Estado (lista de chats) */
            #dt-estado {
                font-size: 11px;
                padding: 7px 9px;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.05);
                border-radius: 6px;
                min-height: 30px;
                line-height: 1.5;
                max-height: 180px;
                overflow-y: auto;
            }

            /* Logs */
            #dt-logs {
                max-height: 160px;
                overflow-y: auto;
                font-size: 10px;
                line-height: 1.4;
                background: rgba(0,0,0,0.2);
                border-radius: 6px;
                padding: 5px;
            }
            #dt-logs::-webkit-scrollbar, #dt-estado::-webkit-scrollbar { width: 5px; }
            #dt-logs::-webkit-scrollbar-thumb, #dt-estado::-webkit-scrollbar-thumb {
                background: rgba(255,255,255,0.1);
                border-radius: 3px;
            }
            .dt-log { padding: 2px 5px; border-bottom: 1px solid rgba(255,255,255,0.04); }
            .dt-log:last-child { border-bottom: none; }
            .dt-log .h { color: #64748b; margin-right: 3px; }
            .dt-log.error { color: #fca5a5; }
            .dt-log.success { color: #86efac; }
            .dt-log.warn { color: #fcd34d; }

            /* Filas de chat */
            .chat-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 3px 5px;
                font-size: 10px;
                border-radius: 4px;
                margin: 1px 0;
            }
            .chat-row:hover { background: rgba(255,255,255,0.03); }
            .chat-row.urgent { color: #fca5a5; font-weight: 700; }
            .chat-row.active { color: #C0DF16; font-weight: 600; }
            .chat-row.solucion { color: #67e8f9; }
            .chat-row.gestion {
                color: #fde047;
                font-weight: 700;
                background: rgba(253,224,71,0.1);
                border-left: 2px solid #fde047;
                padding: 4px 6px;
            }
            .chat-row.critico {
                color: #fff;
                background: #dc2626;
                padding: 4px;
                animation: pulseCritico 1s infinite;
                font-weight: 700;
            }
            @keyframes pulseCritico {
                0%, 100% { background: #dc2626; }
                50% { background: #b91c1c; box-shadow: 0 0 12px #dc2626; }
            }
            /* 🆕 v3.5.6: Timer */
            .dt-timer { font-size: 9px; margin-left: 3px; }
            .dt-timer.ok { color: #86efac; }
            .dt-timer.warn { color: #fcd34d; }
            .dt-timer.alert { color: #ef4444; font-weight: 700; animation: pulseCritico 1s infinite; background: none; }

            /* 🆕 v3.5.6: Botones templates */
            .dt-tpl-btn {
                flex: 1;
                padding: 5px 4px;
                border: 1px solid rgba(59,130,246,0.3);
                border-radius: 5px;
                background: rgba(59,130,246,0.1);
                color: #93c5fd;
                font-size: 10px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                white-space: nowrap;
            }
            .dt-tpl-btn:hover { background: rgba(59,130,246,0.3); color: #fff; }
            .dt-btn-gestion {
                background: rgba(192,223,22,0.15);
                color: #C0DF16;
                border: 1px solid #C0DF16;
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 10px;
                cursor: pointer;
                margin-left: 4px;
                font-weight: 700;
                transition: all 0.2s;
            }
            .dt-btn-gestion:hover { background: #C0DF16; color: #000; }
            .dt-btn-gestion.off {
                background: rgba(220,38,38,0.2);
                color: #fca5a5;
                border-color: #fca5a5;
            }
            .dt-btn-gestion.off:hover { background: #dc2626; color: #fff; }
        `;

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        document.body.appendChild(wrapper);

        // Restaurar posición guardada del wrapper
        if (posGuardada) {
            wrapper.style.left = posGuardada.left + 'px';
            wrapper.style.top = posGuardada.top + 'px';
            wrapper.style.right = 'auto';
            wrapper.style.bottom = 'auto';
        }

        // Restaurar estado expandido/minimizado
        if (expandidoGuardado) wrapper.classList.add('expanded');

        // ──────────────────────────────────────────
        // EXPANDIR / MINIMIZAR
        // ──────────────────────────────────────────
        const expandir = () => {
            wrapper.classList.add('expanded');
            localStorage.setItem('duturbo_expandido', '1');
        };
        const minimizar = () => {
            wrapper.classList.remove('expanded');
            localStorage.setItem('duturbo_expandido', '0');
        };

        const floatingBtn = document.getElementById('dt-floating-btn');
        floatingBtn.addEventListener('click', (e) => {
            // Solo expandir si NO se acaba de hacer drag
            if (!floatingBtn.dataset.justDragged) {
                expandir();
            }
            delete floatingBtn.dataset.justDragged;
        });

        document.getElementById('dt-min').onclick = minimizar;

        // ──────────────────────────────────────────
        // DRAG DEL BOTONCITO
        // ──────────────────────────────────────────
        let dragBtn = false, btnStartX, btnStartY, btnInitialX, btnInitialY, btnMoved;

        floatingBtn.addEventListener('mousedown', (e) => {
            dragBtn = true;
            btnMoved = false;
            btnStartX = e.clientX;
            btnStartY = e.clientY;
            const rect = wrapper.getBoundingClientRect();
            btnInitialX = rect.left;
            btnInitialY = rect.top;
            floatingBtn.classList.add('dragging');
            e.preventDefault();
        });

        // ──────────────────────────────────────────
        // DRAG DEL HEADER DEL PANEL (cuando está expandido)
        // ──────────────────────────────────────────
        let dragHeader = false, headerStartX, headerStartY, headerInitialX, headerInitialY;
        const header = document.getElementById('dt-header');
        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'dt-min') return;
            dragHeader = true;
            headerStartX = e.clientX;
            headerStartY = e.clientY;
            const rect = wrapper.getBoundingClientRect();
            headerInitialX = rect.left;
            headerInitialY = rect.top;
            e.preventDefault();
        });

        // Movement universal (cubre ambos drags)
        document.addEventListener('mousemove', (e) => {
            if (dragBtn) {
                const dx = e.clientX - btnStartX;
                const dy = e.clientY - btnStartY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) btnMoved = true;
                const newLeft = btnInitialX + dx;
                const newTop = btnInitialY + dy;
                // Mantener dentro de la pantalla
                const maxX = window.innerWidth - 60;
                const maxY = window.innerHeight - 60;
                wrapper.style.left = Math.max(0, Math.min(maxX, newLeft)) + 'px';
                wrapper.style.top = Math.max(0, Math.min(maxY, newTop)) + 'px';
                wrapper.style.right = 'auto';
                wrapper.style.bottom = 'auto';
            }
            if (dragHeader) {
                const dx = e.clientX - headerStartX;
                const dy = e.clientY - headerStartY;
                const newLeft = headerInitialX + dx;
                const newTop = headerInitialY + dy;
                const maxX = window.innerWidth - 320;
                const maxY = window.innerHeight - 100;
                wrapper.style.left = Math.max(0, Math.min(maxX, newLeft)) + 'px';
                wrapper.style.top = Math.max(0, Math.min(maxY, newTop)) + 'px';
                wrapper.style.right = 'auto';
                wrapper.style.bottom = 'auto';
            }
        });

        document.addEventListener('mouseup', () => {
            if (dragBtn) {
                dragBtn = false;
                floatingBtn.classList.remove('dragging');
                if (btnMoved) floatingBtn.dataset.justDragged = '1';
                // Guardar posición
                const rect = wrapper.getBoundingClientRect();
                localStorage.setItem('duturbo_pos', JSON.stringify({
                    left: rect.left,
                    top: rect.top
                }));
            }
            if (dragHeader) {
                dragHeader = false;
                const rect = wrapper.getBoundingClientRect();
                localStorage.setItem('duturbo_pos', JSON.stringify({
                    left: rect.left,
                    top: rect.top
                }));
            }
        });

        // ──────────────────────────────────────────
        // HANDLERS DEL PANEL
        // ──────────────────────────────────────────
        document.getElementById('dt-toggle').onclick = () => {
            activo = !activo;
            actualizarPanelToggle();
            log(activo ? '👁️ ACTIVADO' : '⏸️ DESACTIVADO', activo ? 'success' : 'warn');
        };
        document.getElementById('dt-agente').onchange = (e) => {
            CONFIG.nombreAgente = e.target.value.trim();
            log(`👤 Agente: "${CONFIG.nombreAgente}"`, 'info');
        };
        document.getElementById('dt-modo').onchange = (e) => {
            CONFIG.modoIA = e.target.value;
            log(`🔀 Modo: ${CONFIG.modoIA === 'rapido' ? '🚀 Rápido' : '🧠 Inteligente'}`, 'info');
        };

        // Atajo Ctrl+Shift+A para Modo Gestión
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                if (chatActivoActual) {
                    toggleModoGestion(chatActivoActual.id, chatActivoActual.nombre);
                } else {
                    log('⚠️ Atajo: primero haz click en un chat', 'warn');
                }
            }
        });

        // 🆕 v3.5.6: Toggle sonido
        document.getElementById('dt-sonido').onclick = () => {
            sonidoActivo = !sonidoActivo;
            localStorage.setItem('duturbo_sonido', sonidoActivo ? '1' : '0');
            const btn = document.getElementById('dt-sonido');
            btn.textContent = sonidoActivo ? '🔊 Sonido ON' : '🔇 Sonido OFF';
        };
        const btnS = document.getElementById('dt-sonido');
        btnS.textContent = sonidoActivo ? '🔊 Sonido ON' : '🔇 Sonido OFF';

        // 🆕 v3.5.6: Templates de devolución
        const TEMPLATES = {
            cupon: (monto) => `Te cargué un cupón de ${monto} por este inconveniente. Te recuerdo que es de único uso y que ingresando a 'Mi perfil' > 'Cupones', encontrarás toda la información sobre el mismo.`,
            tarjeta: (monto) => `Te confirmo que se hizo la devolución de ${monto} a la tarjeta con la que hiciste el pago.\nLa devolución puede tardar unos 7 días hábiles en reflejarse en tu resumen de cuenta.`,
            wallet: (monto) => `Ya realicé la devolución de ${monto} como saldo en PedidosYa. Recuerda que el mismo tiene validez por 2 años. Puedes corroborarlo ingresando desde el menú principal de la app a tu billetera PedidosYa\nPuedes encontrar toda la información de tu devolución ingresando a 'Pedidos' desde la app y seleccionando este pedido.`
        };

        // 🆕 v3.5.6: Guardar último monto detectado del popup de Éxito
        let ultimoMontoDetectado = null;

        // Observar el DOM para detectar el popup de "Éxito" con el monto
        setInterval(() => {
            const textoBody = document.body.textContent || '';
            // Buscar "XXX 000 reembolsado" o "XXX 000.00 reembolsado"
            const m = textoBody.match(/([A-Z]{2,4}\s+[\d,.]+)\s+reembolsado/i);
            if (m) {
                const nuevoMonto = m[1].trim();
                if (nuevoMonto !== ultimoMontoDetectado) {
                    ultimoMontoDetectado = nuevoMonto;
                    log(`💰 Monto detectado: ${nuevoMonto}`, 'success');
                    // Poner en el input también
                    const input = document.getElementById('dt-monto');
                    if (input) input.value = nuevoMonto;
                }
            }
        }, 2000);

        async function pegarTemplate(tipo) {
            // Prioridad 1: monto detectado del popup
            let monto = ultimoMontoDetectado;

            // Prioridad 2: input manual
            if (!monto) {
                const inputMonto = document.getElementById('dt-monto');
                monto = (inputMonto?.value || '').trim();
            }

            // Prioridad 3: buscar en contentBottom (Actividad)
            if (!monto) {
                document.querySelectorAll('[class*="contentBottom"], [class*="content-"]').forEach(el => {
                    const txt = el.textContent || '';
                    const m = txt.match(/Emitido\s+([A-Z]{2,4}\s+[\d,.]+)/i) ||
                              txt.match(/Creado\s+([A-Z]{2,4}\s+[\d,.]+)/i);
                    if (m) monto = m[1].trim();
                });
            }

            if (!monto) {
                log('⚠️ No encontré monto. Escríbelo en el campo.', 'warn');
                document.getElementById('dt-monto')?.focus();
                return;
            }

            const texto = TEMPLATES[tipo](monto);
            const ok = await enviarMensaje(texto);
            if (ok) {
                log(`💳 ${tipo}: ${monto} — enviado`, 'success');
                ultimoMontoDetectado = null;  // limpiar para el siguiente
                const inputMonto = document.getElementById('dt-monto');
                if (inputMonto) inputMonto.value = '';
            }
        }

        document.querySelectorAll('.dt-tpl-btn').forEach(btn => {
            btn.onclick = () => pegarTemplate(btn.getAttribute('data-tpl'));
        });
    }

    function actualizarPanelToggle() {
        const btn = document.getElementById('dt-toggle');
        if (!btn) return;
        btn.textContent = activo ? '🟢 VIGILANTE ON' : '⚫ OFF';
        btn.classList.toggle('on', activo);
        // v3.3.2: También actualizar el puntito del botoncito flotante
        const status = document.querySelector('.dt-fb-status');
        if (status) status.classList.toggle('on', activo);
    }

    function actualizarPanelEstado(chats, chatActivo) {
        const div = document.getElementById('dt-estado');
        if (!div) return;
        if (!chats || chats.length === 0) {
            div.textContent = 'Sin chats abiertos';
            return;
        }
        let html = '';
        let hayAlerta = false;  // 🆕 v3.5.6: para sonido

        if (!chatActivo && activo) {
            html += `<div style="color:#fcd34d; padding:4px; margin-bottom:4px; background:rgba(252,211,77,.1); border-radius:3px; font-size:10px;">⚠️ Click en un chat para identificarlo</div>`;
        }
        chats.forEach(c => {
            const esActivo = chatActivo && c.id === chatActivo.id;
            const despedido = estaDespedido(c.id);
            const conSolucion = tieneSolucion(c.id);
            const critico = chatsCriticos.has(c.id);
            const enGestion = estaEnModoGestion(c.id);
            const etapa = respuestasPorChat.get(c.id) || 0;

            // 🆕 v3.5.6: Timer
            const inicio = tiempoInicioPorChat.get(c.id);
            let timerStr = '';
            if (inicio && !despedido && !conSolucion) {
                const elapsed = Date.now() - inicio;
                const tiempo = formatearTimer(elapsed);
                if (elapsed > UMBRAL_ALERTA) {
                    timerStr = ` <span class="dt-timer alert">⏱️${tiempo} 🔔</span>`;
                    hayAlerta = true;
                } else if (elapsed > 150000) { // > 2:30
                    timerStr = ` <span class="dt-timer warn">⏱️${tiempo}</span>`;
                } else {
                    timerStr = ` <span class="dt-timer ok">⏱️${tiempo}</span>`;
                }
            }

            let cls = '', tag = '';
            if (critico && !esActivo) { cls = 'critico'; tag = `🔴 ATENDER YA`; }
            else if (esActivo && enGestion) { cls = 'gestion'; tag = '👁️'; }
            else if (esActivo) { cls = 'active'; tag = '👤'; }
            else if (despedido) { tag = '🚫'; }
            else if (conSolucion) { cls = 'solucion'; tag = '💰'; }
            else if (c.tieneNuevos) { cls = 'urgent'; tag = `🟢${c.mensajesSinLeer}`; }
            else { tag = '⚪'; }
            const etapaStr = etapa > 0 ? ` [#${etapa}]` : '';
            const botonGestion = esActivo
                ? (enGestion
                    ? `<button class="dt-btn-gestion off" data-chat="${c.id}" data-nombre="${c.nombre}" title="Desactivar ayuda">🛑</button>`
                    : `<button class="dt-btn-gestion" data-chat="${c.id}" data-nombre="${c.nombre}" title="Activar ayuda">🤝</button>`)
                : '';
            const gestionLabel = enGestion ? ' <span style="color:#fde047; font-size:9px;">MODO</span>' : '';
            html += `<div class="chat-row ${cls}"><span>${tag} ${c.nombre}${etapaStr}${timerStr}${gestionLabel}</span>${botonGestion}</div>`;
        });
        div.innerHTML = html;

        // 🆕 v3.5.6: Sonar si hay alerta
        if (hayAlerta) playAlertSound();

        // Bind clicks de los botones de Modo Gestión
        div.querySelectorAll('.dt-btn-gestion').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const chatId = btn.getAttribute('data-chat');
                const nombre = btn.getAttribute('data-nombre');
                toggleModoGestion(chatId, nombre);
            };
        });
    }

    function actualizarPanelLogs() {
        const div = document.getElementById('dt-logs');
        if (!div) return;
        div.innerHTML = logs.slice(0, 15).map(l =>
            `<div class="dt-log ${l.tipo}"><span class="h">${l.hora}</span> ${l.msg}</div>`
        ).join('');
    }

    // ════════════════════════════════════════════════════════════
    // 🚀 INIT
    // ════════════════════════════════════════════════════════════
    function init() {
        crearPanel();
        actualizarPanelToggle();
        inicializarTrackingClicks();
        log('🚀 DuTurbo v3.6.2 cargado (fix id de chat estable)', 'success');
        log('💡 Pon tu nombre y click en un chat antes de activar', 'info');
        log(`🧠 Modo Inteligente vía backend: ${CONFIG.backendURL}`, 'info');
        setInterval(ciclo, CONFIG.intervalo);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.duTurbo = {
        toggle: () => { activo = !activo; actualizarPanelToggle(); },
        chats: leerChats,
        config: CONFIG,
        logs: () => logs,
        reset: (id) => resetChatLigero(id),
        testSaludo: (msg, nombre) => detectarSaludo(msg, nombre),
        testImagen: (msg) => mensajeTieneImagen(msg),
        gestion: {
            activar: (id, nombre) => activarModoGestion(id, nombre),
            desactivar: (id) => desactivarModoGestion(id, 'manual via API'),
            toggle: (id, nombre) => toggleModoGestion(id, nombre),
            activos: () => Array.from(chatsEnModoGestion.keys())
        },
        estado: () => ({
            activo,
            chatActivo: chatActivoActual,
            respuestas: Object.fromEntries(respuestasPorChat),
            despedidos: Object.fromEntries(chatsDespedidos),
            conSolucion: Object.fromEntries(chatsConSolucion),
            criticos: Object.fromEntries(chatsCriticos),
            imagenes: Object.fromEntries(imagenesPorChat),
            modoGestion: Object.fromEntries(chatsEnModoGestion),
            mensajesAgenteReales: contarMensajesRealesDelAgente()
        })
    };
})();
