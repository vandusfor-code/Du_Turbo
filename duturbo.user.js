// ==UserScript==
// @name         DuTurbo Vigilante Multi-Chat
// @namespace    duacademy.site
// @version      3.9.4
// @description  v3.9.4: Herramienta de diagnostico — duTurbo.verHistorial('nombre o id') trae el historial REAL de un chat via API y muestra por consola, linea por linea, si cada mensaje del agente matchea esDespedida()/PATRONES_SOLUCION_DADA. Se agrega para depurar con datos reales (no adivinando) un reporte de que el bot sigue respondiendo despues de frases de cierre que, segun el codigo, deberian detenerlo. v3.9.3: FIX critico — el chat activo volvio a incluirse en la respuesta automatica (v3.9.0 lo habia dejado mudo por completo; la razon tecnica original ya no aplicaba). v3.9.2: auditoria exhaustiva completa. v3.9.1: chatsCriticos por NO TOCAR ahora es sticky; ciclo() refresca el panel siempre al final. v3.9.0: se elimina Modo Inteligente (IA) y Modo Gestion; el envio vuelve a ser 100% visible por UI real; la lectura sigue por la API directa de HeroCare; alerta sonora + indicador visual persistente cuando un chat queda critico.
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
        // 🆕 v3.9.0: vuelve al ritmo del modelo click-based (envío visible
        // por UI real). Los tiempos agresivos de v3.8.x eran solo válidos
        // cuando el envío era 100% por API sin tocar la pantalla.
        intervalo: 1500,
        cooldownChat: 8000,
        delayAntesDeEnviar: 500,
        delayCambioDeChat: 700, // 🆕 v3.9.0: restaurado — tiempo para que HeroCare renderice el chat tras clickearlo
        pausarSiAgenteEscribe: true,
        debug: true,
        activoInicio: false,
        nombreAgente: '',

        // Personalización
        maxUsosNombrePorChat: 2,
        probUsarNombre: 0.5,

        // 🆕 v3.8.7: cuántas respuestas del bot aguanta un chat antes de
        // escalar a "crítico" solo por cantidad (antes 4, hardcodeado y sin
        // conectar a este config). Es una red de seguridad para un chat
        // realmente olvidado — la razón real para escalar es quedarse sin
        // frase libre de repetición (regla de oro), no esto.
        umbralCritico: 20,
    };

    // ════════════════════════════════════════════════════════════
    // 🎯 SELECTORES DOM
    // ════════════════════════════════════════════════════════════
    // 🆕 v3.9.0: LEER mensajes sigue por la API interna de HeroCare (ver
    // sección "API DIRECTA" — más confiable que scrapear el DOM). ENVIAR
    // vuelve a ser por la UI real: se clickea el chat y se escribe en
    // textarea (ver enviarMensaje/procesarChat), por eso conversationContainer/
    // chatBubble/dividerNew ya no hacen falta pero textarea sí.
    const SEL = {
        chatItem: '.ant-list-item',
        unreadBadge: '.ant-scroll-number-only-unit.current',
        textarea: 'textarea[placeholder*="scribe"]',
        // 🆕 v3.6.2: el <li> trae data-testid="ticket-{uuid}" (id estable real)
        // y el nombre vive en un <span class="... name-..."> separado del
        // countdown que tickea cada segundo (class="... countdown-...").
        ticketIdAttr: /^ticket-(.+)$/,
        ticketName: '[class*="name-"]',
        handlingTime: '[data-testid="handling-time-label"]',
    };

    // ════════════════════════════════════════════════════════════
    // 🌐 API DIRECTA DE HEROCARE (v3.8.0, solo LECTURA desde v3.9.0)
    // Inspeccionando el Network tab se encontró la API interna que usa
    // HeroCare para leer una conversación sin necesidad de tenerla abierta:
    //   1. GET  /tickets/{ticketId}/room                → datos del room
    //   2. GET  /rooms/{roomId}/history?roomName=...     → últimos mensajes
    // 🆕 v3.9.0: el ENVÍO ya NO pasa por esta API (antes había un tercer
    // paso, POST /rooms/send-message) — volvió a ser por la UI real
    // (clickear el chat + escribir en el textarea, ver enviarMensaje/
    // procesarChat), porque HeroCare no refrescaba su propia vista cuando
    // se respondía por acá en silencio al chat que el agente tenía abierto.
    // La lectura se quedó por API porque es más confiable (identity_id del
    // servidor) y no tiene ningún efecto visual, así que no había motivo
    // para volver a scrapear el DOM para eso.
    // Ningún token se hardcodea: el Authorization Bearer de sesión se
    // captura en caliente interceptando el fetch()/XHR nativo que la propia
    // app ya dispara constantemente (polling), así sigue siendo válido
    // mientras el agente tenga la sesión iniciada normalmente.
    // ════════════════════════════════════════════════════════════
    const API_BASE = 'https://api-pedidosya-us.deliveryherocare.com/oneview/cs-chat-box/v1';

    let authCapturado = null;
    let identityIdCapturado = null;
    let usernameCapturado = null;
    const roomInfoPorTicket = new Map(); // ticketId -> {ticketId, id, name, entityId, gei}

    function decodificarJWT(token) {
        try {
            const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const json = decodeURIComponent(
                atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
            );
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    function identityIdEfectivo() {
        if (identityIdCapturado) return identityIdCapturado;
        if (authCapturado) {
            const payload = decodificarJWT(authCapturado.replace(/^Bearer\s+/i, ''));
            if (payload && payload.sub) return payload.sub;
        }
        return '';
    }

    function usernameEfectivo() {
        if (usernameCapturado) return usernameCapturado;
        if (CONFIG.nombreAgente) return CONFIG.nombreAgente;
        if (authCapturado) {
            const payload = decodificarJWT(authCapturado.replace(/^Bearer\s+/i, ''));
            if (payload && payload.name) return payload.name;
        }
        return 'Agente';
    }

    // Intercepta fetch() y XHR nativos para capturar el Authorization Bearer
    // y (de paso) identityId/username la primera vez que la propia app envía
    // un mensaje manualmente. Nunca bloquea ni altera la request real.
    function instalarInterceptorFetch() {
        if (window.__duTurboFetchHooked) return;
        window.__duTurboFetchHooked = true;
        const fetchOriginal = window.fetch;
        window.fetch = function(input, init) {
            try {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                const headersInit = (init && init.headers) || (input instanceof Request ? input.headers : null);
                let auth = null;
                if (headersInit instanceof Headers) {
                    auth = headersInit.get('authorization') || headersInit.get('Authorization');
                } else if (headersInit) {
                    auth = headersInit['authorization'] || headersInit['Authorization'];
                }
                if (auth && /^Bearer /i.test(auth)) authCapturado = auth;

                if (url.includes('/rooms/send-message') && init && typeof init.body === 'string') {
                    try {
                        const body = JSON.parse(init.body);
                        if (body.identityId) identityIdCapturado = body.identityId;
                        if (body.username) usernameCapturado = body.username;
                    } catch (e) { /* no-op */ }
                }
            } catch (e) { /* nunca romper el fetch real por un fallo acá */ }
            return fetchOriginal.apply(this, arguments);
        };
    }

    function instalarInterceptorXHR() {
        if (window.__duTurboXHRHooked) return;
        window.__duTurboXHRHooked = true;
        const abrirOriginal = XMLHttpRequest.prototype.open;
        const enviarOriginal = XMLHttpRequest.prototype.send;
        const setHeaderOriginal = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.setRequestHeader = function(nombre, valor) {
            try {
                if (/^authorization$/i.test(nombre) && /^Bearer /i.test(valor)) authCapturado = valor;
            } catch (e) { /* no-op */ }
            return setHeaderOriginal.apply(this, arguments);
        };
        XMLHttpRequest.prototype.open = function(method, url) {
            this.__duTurboUrl = url;
            return abrirOriginal.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function(body) {
            try {
                if (this.__duTurboUrl && String(this.__duTurboUrl).includes('/rooms/send-message') && typeof body === 'string') {
                    const parsed = JSON.parse(body);
                    if (parsed.identityId) identityIdCapturado = parsed.identityId;
                    if (parsed.username) usernameCapturado = parsed.username;
                }
            } catch (e) { /* no-op */ }
            return enviarOriginal.apply(this, arguments);
        };
    }

    async function obtenerRoomInfo(ticketId) {
        const cacheado = roomInfoPorTicket.get(ticketId);
        if (cacheado) return cacheado;
        if (!authCapturado) return null;
        try {
            const resp = await fetch(`${API_BASE}/tickets/${ticketId}/room`, {
                method: 'GET',
                headers: { 'Authorization': authCapturado, 'Accept': 'application/json' }
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            // 🐛 fix (auditoría v3.9.1): ya no se guarda agentJwt — era solo
            // para apiEnviarMensaje (removida en v3.9.0, el envío volvió a
            // ser por UI real). Guardarlo era dato muerto sin ningún lector.
            const info = {
                ticketId,
                id: data.id,
                name: data.name,
                entityId: data.entityId,
                gei: (data.helpcenter_context && data.helpcenter_context.gei) || data.entityId
            };
            roomInfoPorTicket.set(ticketId, info);
            return info;
        } catch (e) {
            log(`⚠️ Error obteniendo room de ${ticketId}: ${e.message}`, 'error');
            return null;
        }
    }

    async function obtenerHistorialCrudo(room) {
        if (!authCapturado) return null;
        try {
            const url = `${API_BASE}/rooms/${room.id}/history?roomName=${encodeURIComponent(room.name)}&entityId=${encodeURIComponent(room.entityId)}&geid=${encodeURIComponent(room.gei)}&department=CS`;
            const resp = await fetch(url, {
                method: 'GET',
                headers: { 'Authorization': authCapturado, 'Accept': 'application/json' }
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            return (data && data.data) || [];
        } catch (e) {
            log(`⚠️ Error leyendo historial: ${e.message}`, 'error');
            return null;
        }
    }

    // Convierte los mensajes crudos de /history en una forma simple para el
    // resto del script: identity_id === roomName ⇒ es del cliente; cualquier
    // otro identity_id (email del agente, GENERIC_SYSTEM, etc.) ⇒ es del
    // agente/sistema. Mucho más confiable que el color CSS que se usaba antes.
    function clasificarMensajesHistorial(crudos, roomName) {
        return (crudos || [])
            .filter(m => m.type === 'text' && m.content)
            .map(m => ({
                texto: m.content,
                esAgente: String(m.identity_id) !== String(roomName),
                sortId: m.sort_id
            }))
            .sort((a, b) => a.sortId - b.sortId);
    }

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

    // 🆕 v3.8.0: recibe el historial ya clasificado (ver clasificarMensajesHistorial)
    // en vez de scrapear el DOM de la conversación abierta.
    function agenteYaDioSolucion(historial) {
        return historial.some(m => m.esAgente && PATRONES_SOLUCION_DADA.some(rx => rx.test(m.texto)));
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

    // 🆕 v3.8.0: antes esto distinguía agente/cliente por el color CSS
    // computado de la burbuja (frágil ante cambios de tema). Ahora el
    // historial de la API ya trae identity_id, así que clasificarMensajesHistorial()
    // hace esta distinción de forma mucho más confiable — ver "API DIRECTA".
    function contarMensajesRealesDelAgente(historial) {
        return historial.filter(m => m.esAgente && !esSaludoProtocolario(m.texto)).length;
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

    // 🆕 v3.8.0: recibe el historial ya clasificado en vez de scrapear el DOM.
    function detectarPreguntaDevolucion(chatId, historial) {
        // 🆕 v3.5.3: Si ya fue respondida en este chat, NUNCA reactivar
        if (chatConDevolucionRespondida.has(chatId)) return false;

        for (const m of historial) {
            if (m.esAgente && REGEX_PREGUNTA_DEVOLUCION.test(m.texto)) {
                chatConPreguntaDevolucion.set(chatId, true);
                return true;
            }
        }
        return chatConPreguntaDevolucion.get(chatId) || false;
    }

    function clasificarRespuestaDevolucion(mensaje, chatId, nombreCliente, historial) {
        // 🆕 v3.5.3: No clasificar si ya fue respondida
        if (chatConDevolucionRespondida.has(chatId)) return null;

        // 🆕 v3.5.3: No clasificar si ya hay solución o despedida
        if (tieneSolucion(chatId) || estaDespedido(chatId)) return null;

        // Solo aplica si el agente ya hizo la pregunta de devolución
        if (!detectarPreguntaDevolucion(chatId, historial)) return null;

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

    // 🆕 v3.7.0: antes solo se rastreaba un puñado de palabras de una lista
    // fija (PALABRAS_SIGNIFICATIVAS), así que cualquier otra palabra podía
    // repetirse sin ser detectada. Ahora se rastrea CUALQUIER palabra de
    // contenido (>=4 letras) y solo se excluyen conectores/función.
    const PALABRAS_VACIAS = new Set([
        'que', 'para', 'con', 'por', 'esta', 'este', 'esto', 'estos', 'estas',
        'pero', 'como', 'cuando', 'donde', 'desde', 'hasta', 'entre', 'sobre',
        'tras', 'sino', 'porque', 'aunque', 'mientras', 'todo', 'toda', 'todos',
        'todas', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'cada',
        'algo', 'alguna', 'alguno', 'algunos', 'algunas', 'ninguna', 'ninguno',
        'nada', 'nadie', 'muy', 'mas', 'menos', 'tan', 'tanto', 'poco', 'mucho',
        'bastante', 'sido', 'ser', 'estar', 'estoy', 'estamos', 'estan', 'esta',
        'tengo', 'tienes', 'tiene', 'tenemos', 'tienen', 'haber', 'habia',
        'hola', 'buenas', 'buenos', 'usted', 'ustedes', 'ella', 'ellos', 'ellas',
        'nosotros', 'aqui', 'alli', 'ahi', 'ahora', 'luego', 'despues', 'antes',
        'permite', 'permiteme', 'dame', 'favor', 'para', 'quiero', 'puedo',
        'podemos', 'vamos', 'gracias'
    ]);

    function normalizarPalabra(p) {
        return (p || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function extraerPalabrasClave(texto) {
        const palabras = (texto || '').toLowerCase()
            .replace(/[.,!?¿¡;:()"'\n]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(normalizarPalabra);
        return palabras.filter(p => p.length >= 4 && !PALABRAS_VACIAS.has(p));
    }

    function registrarPalabrasUsadas(chatId, texto) {
        const set = palabrasUsadasPorChat.get(chatId) || new Set();
        extraerPalabrasClave(texto).forEach(p => set.add(p));
        palabrasUsadasPorChat.set(chatId, set);
    }

    function fueUsadaEnChat(chatId, palabra) {
        const set = palabrasUsadasPorChat.get(chatId) || new Set();
        return set.has(normalizarPalabra(palabra));
    }

    // 🆕 v3.7.0: chequeo único de "esta frase repite algo ya enviado en este chat"
    function fraseTieneRepeticion(chatId, texto) {
        return extraerPalabrasClave(texto).some(p => fueUsadaEnChat(chatId, p));
    }

    // 🆕 v3.7.0: regla de oro real — si no hay opción libre de repetición,
    // devuelve null en vez de forzar una repetición con elegirAleatorio(lista)
    function elegirVerboSinRepetir(chatId, forma = 'gerundio') {
        const lista = forma === 'gerundio' ? VERBOS_GESTION : VERBOS_INFINITIVO;
        const noUsados = lista.filter(v => !fueUsadaEnChat(chatId, v));
        if (noUsados.length === 0) return null;
        return elegirAleatorio(noUsados);
    }

    function elegirAgradecimientoSinRepetir(chatId) {
        const noUsados = AGRADECIMIENTOS.filter(a => !fraseTieneRepeticion(chatId, a));
        if (noUsados.length === 0) return null;
        return elegirAleatorio(noUsados);
    }

    function rotarVerbos(frase, chatId) {
        for (const verbo of VERBOS_GESTION) {
            const rx = new RegExp(`\\b${verbo}\\b`, 'i');
            if (rx.test(frase)) {
                const nuevoVerbo = elegirVerboSinRepetir(chatId, 'gerundio');
                return nuevoVerbo ? frase.replace(rx, nuevoVerbo) : frase;
            }
        }
        for (const verbo of VERBOS_INFINITIVO) {
            const rx = new RegExp(`\\b${verbo}\\b`, 'i');
            if (rx.test(frase)) {
                const nuevoVerbo = elegirVerboSinRepetir(chatId, 'infinitivo');
                return nuevoVerbo ? frase.replace(rx, nuevoVerbo) : frase;
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
                return nuevo ? frase.replace(rx, nuevo) : frase;
            }
        }
        return frase;
    }

    // 🆕 v3.4: Generador inteligente — corazón del modo Rápido Pro
    function generarFraseInteligente(mensaje, chatId, nombreCliente, historial) {
        // 🆕 v3.5.5: Leer SOLO la última burbuja para verificar confirmaciones
        // (el 'mensaje' concatena las últimas 3, lo cual hace fallar el regex)
        const ultimaBurbuja = nombreCliente ? leerSoloUltimaBurbujaCliente(historial, nombreCliente) : mensaje;

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
                if (!fraseTieneRepeticion(chatId, candidata)) {
                    frase = candidata;
                    indiceContinuacionPorChat.set(chatId, idx + i + 1);
                    break;
                }
            }
            // 🆕 v3.7.0: regla de oro real — si TODAS repiten algo, no forzamos
            // el envío; el llamador (generarRespuesta) decide cómo rescatar esto.
            if (!frase) return null;
            registrarPalabrasUsadas(chatId, frase);
            return frase;
        }

        // 1. Reconocimiento contextual si hay info nueva (opcional: si no hay
        // ninguno libre de repetición, seguimos sin reconocimiento en vez de repetir)
        let reconocimiento = '';
        if (tema) {
            const noUsadas = tema.frases.filter(f => !fraseTieneRepeticion(chatId, f));
            if (noUsadas.length > 0) reconocimiento = elegirAleatorio(noUsadas);
        }

        // 2. Frase secuencial de espera — recorrer TODO el banco (no solo 5)
        // buscando una sin palabras repetidas
        let indice = indiceSecuencialPorChat.get(chatId) || 0;
        let fraseEspera = null;
        const totalFrases = FRASES_SECUENCIALES.length;

        for (let intento = 0; intento < totalFrases; intento++) {
            const candidata = FRASES_SECUENCIALES[(indice + intento) % totalFrases];
            if (!fraseTieneRepeticion(chatId, candidata)) {
                fraseEspera = candidata;
                indiceSecuencialPorChat.set(chatId, indice + intento + 1);
                break;
            }
        }

        if (!fraseEspera) {
            // 🆕 v3.7.0: se agotó el banco entero sin encontrar una frase libre
            // de repetición. Si al menos el reconocimiento es fresco, se envía
            // solo (mejor que repetir); si no hay nada fresco, escalar (null).
            if (!reconocimiento) return null;
            registrarPalabrasUsadas(chatId, reconocimiento);
            return reconocimiento;
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

        // 6. Red de seguridad: si pese a todo lo anterior fraseFinal quedó
        // repitiendo algo (p. ej. rotarVerbos no encontró verbo libre y el
        // verbo original ya estaba usado), no la mandamos — escalar.
        if (fraseTieneRepeticion(chatId, fraseFinal)) return null;

        registrarPalabrasUsadas(chatId, fraseFinal);
        return fraseFinal;
    }

    // ════════════════════════════════════════════════════════════
    // 📦 STATE
    // ════════════════════════════════════════════════════════════
    let activo = CONFIG.activoInicio;
    let cicloEnCurso = false; // 🆕 v3.7.1: evita que se solape otro tick de ciclo() mientras el actual sigue en curso
    let logs = [];

    const ultimaRespuestaChat = new Map();
    const respuestasPorChat = new Map();
    const usosNombrePorChat = new Map();
    const frasesEnviadasPorChat = new Map();
    const chatsDespedidos = new Map();
    const chatsConSolucion = new Map();
    const chatsCriticos = new Map();
    const imagenesPorChat = new Map();    // 🆕 v3.2.1: rastrea cuántas imágenes envió el cliente
    const ultimoSortIdProcesado = new Map(); // 🆕 v3.8.0: último sort_id (API) ya respondido/visto por chat
    const chatsBloqueados = new Set(); // 🆕 v3.4.2: chats que están siendo procesados ahora mismo (lock estricto)
    const EXPIRACION_DESPEDIDA = 15 * 60 * 1000;

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
    let botCambiandoChat = false; // 🆕 v3.9.0: restaurado — evita que el listener de clicks confunda los clicks del propio bot con los del agente

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

    // 🆕 v3.7.0: chequea también contra palabrasUsadasPorChat (no solo el
    // texto exacto ya enviado) y devuelve null si no hay ninguna opción
    // libre de repetición, en vez de forzar una repetida.
    function elegirSinRepetir(arr, chatId) {
        const recientes = frasesEnviadasPorChat.get(chatId) || [];
        const disponibles = arr.filter(f => !recientes.includes(f) && !fraseTieneRepeticion(chatId, f));
        if (disponibles.length === 0) return null;
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

    // ════════════════════════════════════════════════════════════
    // 🧠 DECIDIR ETAPA (mejorado v3.2 con saludos protocolarios)
    // ════════════════════════════════════════════════════════════
    function obtenerEtapa(chatId, historial) {
        const nBot = respuestasPorChat.get(chatId) || 0;
        // Solo contamos mensajes REALES del agente (no protocolarios)
        const nAgenteReal = contarMensajesRealesDelAgente(historial);

        // Si el agente ya escribió mensajes REALES → saltar a etapa 2
        if (nAgenteReal > 0 && nBot === 0) {
            log(`📌 Agente ya escribió ${nAgenteReal} msg real(es) — etapa 2`, 'info');
            return 2;
        }

        if (nBot === 0) return 1;
        if (nBot <= 2) return 2;
        // 🆕 v3.8.7: antes escalaba a "crítico" (etapa 4) a partir de la 5ta
        // respuesta — pensado para no dejar un chat abandonado, pero rompe
        // el propósito real del bot (sostener al cliente mientras el agente
        // gestiona varios chats a la vez, aunque mande 7+ mensajes seguidos).
        // La razón real para escalar ya no es "cuántos mensajes van" sino
        // quedarse sin una frase libre de repetición (regla de oro, ver
        // fraseTieneRepeticion) — eso pasa en generarRespuesta()/procesarChat.
        // Se deja un techo bien alto como red de seguridad final, para un
        // chat realmente olvidado por mucho tiempo.
        if (nBot <= CONFIG.umbralCritico) return 3;
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
    function generarRespuestaRapida(mensaje, etapa, chatId, nombreCliente, historial) {
        let frase;
        // 🆕 v3.4: Usar generador inteligente para etapas 2+ (gestión en curso)
        // Etapa 1 mantiene apertura empática + espera (chat virgen)
        if (etapa === 1) {
            const empatia = elegirSinRepetir(FRASES.apertura_empatia, chatId);
            const espera = elegirSinRepetir(FRASES.apertura_espera, chatId);
            // 🆕 v3.7.0: si se agotaron las frases de apertura sin repetir,
            // no forzamos el envío — el llamador decide cómo rescatar esto.
            if (!empatia || !espera) return null;
            frase = `${empatia} ${espera}`;
            registrarFraseEnviada(chatId, empatia);
            registrarFraseEnviada(chatId, espera);
            registrarPalabrasUsadas(chatId, frase);
        } else {
            // 🆕 v3.4: Generador inteligente con reconocimiento contextual
            frase = generarFraseInteligente(mensaje, chatId, nombreCliente, historial);
            // 🆕 v3.8.0: fix — si generarFraseInteligente devolvió null (regla
            // de oro agotada), no había que registrar "null" como frase enviada.
            if (frase) registrarFraseEnviada(chatId, frase);
        }
        return frase;
    }

    // ════════════════════════════════════════════════════════════
    // 🎯 GENERAR RESPUESTA (dispatcher)
    // PRIORIDAD: imagen primera vez > saludo espejeado > generación normal
    // ════════════════════════════════════════════════════════════
    async function generarRespuesta(mensaje, etapa, chatId, nombreCliente, historial) {
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
                // 🆕 v3.7.0: si el índice cíclico cae en una frase que ya
                // repite algo (chat con muchas imágenes), buscar la primera
                // libre; si ninguna lo está, escalar en vez de repetir.
                const inicio = imagenesPorChat.get(chatId) % frasesImgExtra.length;
                let fraseImg = null;
                for (let i = 0; i < frasesImgExtra.length; i++) {
                    const candidata = frasesImgExtra[(inicio + i) % frasesImgExtra.length];
                    if (!fraseTieneRepeticion(chatId, candidata)) { fraseImg = candidata; break; }
                }
                if (!fraseImg) {
                    log('🚨 Sin frase de imagen libre de repetición — escalar', 'warn');
                    return null;
                }
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
                registrarPalabrasUsadas(chatId, saludo);  // 🆕 v3.7.0: antes no se registraba
                return saludo;
            }
        }

        // 💳 PRIORIDAD 3: ¿El agente preguntó cómo quiere la devolución?
        // Si sí, clasificar la respuesta del cliente (elige método o no)
        const respuestaDevolucion = clasificarRespuestaDevolucion(mensaje, chatId, nombreCliente, historial);
        if (respuestaDevolucion) {
            log(`💳 Respuesta a pregunta de devolución detectada`, 'info');
            registrarFraseEnviada(chatId, respuestaDevolucion);
            registrarPalabrasUsadas(chatId, respuestaDevolucion);
            return respuestaDevolucion;
        }

        // 🆕 v3.9.0: sin IA — solo Modo Rápido. Si se quedó sin frase libre
        // de repetición (regla de oro), se escala al agente en vez de repetir.
        let frase = generarRespuestaRapida(mensaje, etapa, chatId, nombreCliente, historial);

        if (!frase) {
            log('🚨 Sin frase libre de repetición (regla de oro) — escalar', 'warn');
            return null;
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
            // 🆕 v3.9.0: restaurado — ignora los clicks que hace el propio bot
            // al abrir un chat para responder (ver procesarChat/volverAChat).
            if (botCambiandoChat) return;

            const item = e.target.closest(SEL.chatItem);
            if (!item) return;

            // 🆕 v3.6.2: id estable real (data-testid="ticket-{uuid}") en vez
            // de derivarlo del nombre + texto que incluye el countdown
            const id = extraerIdTicket(item);
            const nombre = extraerNombreCliente(item);
            if (!id || !nombre) return;

            chatActivoActual = { id, nombre };
            resetChatLigero(id, nombre);
            log(`👤 Chat activo: ${nombre}`, 'info');
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
    // 🆕 v3.8.0: ambas reciben el historial ya clasificado (ver
    // clasificarMensajesHistorial) en vez de scrapear la conversación
    // abierta — así funcionan igual esté el chat abierto o no.
    // ════════════════════════════════════════════════════════════
    function leerUltimoMensajeCliente(historial, nombreCliente) {
        // 🆕 v3.2.1: un link suelto que NO sea una imagen de HeroCare se
        // ignora como "mensaje" (evita respuestas confusas a un link random)
        const delCliente = historial.filter(m => !m.esAgente).filter(m => {
            const textoLimpio = limpiarTextoBurbuja(m.texto, nombreCliente);
            if (/^https?:\/\/\S+$/i.test(textoLimpio) && !REGEX_IMAGEN.test(textoLimpio)) return false;
            return true;
        });
        if (delCliente.length === 0) return '';

        const ultimas = delCliente.slice(-3);
        const textos = ultimas
            .map(m => limpiarTextoBurbuja(m.texto, nombreCliente))
            .filter(t => t.length > 0);

        return textos.join('. ');
    }

    // 🆕 v3.4.4: Lee SOLO la última burbuja del cliente (para detección estable de mensaje nuevo)
    function leerSoloUltimaBurbujaCliente(historial, nombreCliente) {
        const delCliente = historial.filter(m => !m.esAgente);
        if (delCliente.length === 0) return '';
        return limpiarTextoBurbuja(delCliente[delCliente.length - 1].texto, nombreCliente).trim();
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
    // 🆕 v3.8.0: recibe el historial ya clasificado en vez de scrapear el DOM.
    function agenteYaSeDespidio(historial) {
        return historial.some(m => m.esAgente && esDespedida(m.texto));
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

    // 🆕 v3.8.8: FIX — chatsCriticos nunca expiraba (a diferencia de
    // despedido/solución, que sí). Una vez marcado crítico por CUALQUIER
    // motivo (filtro NO TOCAR, 20+ respuestas, o quedarse sin frase libre de
    // repetición), el bot dejaba de responder ese chat PARA SIEMPRE hasta
    // que alguien lo reseteara a mano — rompe la regla de "nunca dejar de
    // responder". Ahora expira a los 2 minutos: si fue algo transitorio
    // (p. ej. la IA falló una vez, o se quedó sin variedad momentáneamente)
    // el bot vuelve a intentar solo. Si el motivo real sigue ahí (cliente
    // sigue diciendo lo mismo), se vuelve a marcar — no se pierde la alerta,
    // solo deja de ser un bloqueo eterno.
    const EXPIRACION_CRITICO = 2 * 60 * 1000;

    // 🐛 fix (auditoría v3.9.0): la expiración a 2 min (v3.8.8) se aplicaba
    // por igual a los TRES motivos de "crítico" — pero uno de ellos es el
    // filtro NO TOCAR (estafa, pedido de supervisor, amenaza legal/denuncia).
    // Si el agente tardaba más de 2 min en atenderlo y el cliente escribía
    // de nuevo sin repetir la MISMA frase gatillo, el bot podía volver a
    // auto-responder con una frase genérica a un cliente que ya había
    // pedido escalar — justo lo que este filtro existe para evitar. Ahora
    // NO TOCAR queda "pegado" (sticky) hasta que el agente lo atienda de
    // verdad (click manual en el chat limpia chatsCriticos vía
    // resetChatLigero); los otros dos motivos (etapa crítica, sin frase
    // libre de repetición) siguen expirando a los 2 min como antes.
    function estaCritico(chatId) {
        const entry = chatsCriticos.get(chatId);
        if (!entry) return false;
        if (!entry.sticky && Date.now() - entry.ts > EXPIRACION_CRITICO) {
            chatsCriticos.delete(chatId);
            return false;
        }
        return true;
    }

    // 🆕 v3.9.0: la alerta de crítico antes era pasiva — una fila roja en
    // el panel que solo se nota si estás mirando el panel expandido. Ahora
    // suena de inmediato y deja el botón flotante marcado (ver
    // actualizarPanelEstado), así se nota incluso con el panel minimizado.
    // sticky=true (NO TOCAR) no expira solo — ver estaCritico() arriba.
    function marcarCritico(chatId, nombre, razon, sticky = false) {
        chatsCriticos.set(chatId, { ts: Date.now(), sticky });
        log(`🚨 CRÍTICO (${razon}): ${nombre} — necesita tu atención${sticky ? ' (no se reintenta solo)' : ''}`, 'error');
        playAlertSound();
    }

    // ════════════════════════════════════════════════════════════
    // ✉️ ENVIAR MENSAJE A HEROCARE — escribe en el textarea real y aprieta
    // Enviar. La usan tanto el botón manual de "pegar template" como
    // procesarChat() (ver abajo) para el chat que ya está abierto/clickeado
    // en pantalla — así HeroCare siempre refresca solo, es una acción real
    // de UI, no una llamada silenciosa por API.
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

    // Busca en vivo el <li> del sidebar por ticket-id (nunca reutiliza una
    // referencia vieja capturada al principio del tick — evita clickear un
    // nodo que ya no es el correcto si el DOM se reordenó mientras tanto).
    function buscarElementoChat(id) {
        const items = document.querySelectorAll(SEL.chatItem);
        for (const item of items) {
            if (extraerIdTicket(item) === id) return item;
        }
        return null;
    }

    // 🆕 v3.9.0: restaurado — después de responder un chat en segundo plano,
    // vuelve a clickear el chat que el agente tenía abierto antes.
    async function volverAChat(chatPrevio, chatActual) {
        if (!chatPrevio || chatPrevio.id === chatActual.id) return;
        await sleep(400);
        const el = buscarElementoChat(chatPrevio.id);
        if (el) {
            el.click();
            log(`↩️ Volviendo a ${chatPrevio.nombre}`, 'info');
        }
    }

    // ════════════════════════════════════════════════════════════
    // ⚙️ PROCESAR UN CHAT
    // 🆕 v3.9.0: la LECTURA sigue por la API directa de HeroCare (más
    // confiable que scrapear el DOM: identity_id del servidor en vez de
    // heurísticas de color/estructura). El ENVÍO vuelve a ser 100% visible
    // por UI real — abre el chat (click), escribe y manda por el botón
    // Enviar, y vuelve al chat donde estaba el agente. Esto es lo que hace
    // que HeroCare refresque solo (a diferencia de mandar por API en
    // silencio, que dejaba el mensaje "invisible" hasta F5).
    // ════════════════════════════════════════════════════════════
    async function procesarChat(chat) {
        if (chatsBloqueados.has(chat.id)) return;
        chatsBloqueados.add(chat.id);
        const chatPrevio = chatActivoActual; // snapshot para volver después

        try {
            const room = await obtenerRoomInfo(chat.id);
            if (!room) {
                log(`❌ ${chat.nombre}: no pude obtener datos del room (API)`, 'error');
                ultimaRespuestaChat.set(chat.id, Date.now());
                return;
            }

            const crudos = await obtenerHistorialCrudo(room);
            if (!crudos) {
                log(`❌ ${chat.nombre}: no pude leer el historial (API)`, 'error');
                ultimaRespuestaChat.set(chat.id, Date.now());
                return;
            }

            const historial = clasificarMensajesHistorial(crudos, room.name);
            const ultimo = historial[historial.length - 1];

            // 🆕 v3.8.5: re-sincronizar la "regla de oro" contra el historial
            // REAL de la API en cada procesamiento, en vez de confiar solo en
            // que el script haya registrado bien cada palabra en el momento
            // (un fix reciente encontró un hueco justo ahí). El historial es
            // la fuente de verdad — así el sistema se autocorrige solo.
            historial.filter(m => m.esAgente).forEach(m => registrarPalabrasUsadas(chat.id, m.texto));

            // Nada pendiente: badge desactualizado, o el agente ya respondió
            // manualmente desde la UI (esto también cuenta como "esAgente").
            if (!ultimo || ultimo.esAgente) return;

            // Ya procesamos este mismo mensaje (protege contra reintentos
            // mientras el envío anterior todavía no se refleja en el historial).
            const sortIdVisto = ultimoSortIdProcesado.get(chat.id);
            if (sortIdVisto != null && ultimo.sortId <= sortIdVisto) return;

            log(`🔄 ${chat.nombre}: mensaje nuevo del cliente`, 'info');

            // CHECK 1: ¿Ya se despidió?
            if (agenteYaSeDespidio(historial)) {
                marcarDespedido(chat.id);
                log(`🚫 ${chat.nombre}: ya despedido`, 'warn');
                ultimoSortIdProcesado.set(chat.id, ultimo.sortId);
                return;
            }

            // CHECK 2: ¿Ya hay solución entregada?
            if (agenteYaDioSolucion(historial)) {
                marcarConSolucion(chat.id);
                log(`💰 ${chat.nombre}: ya hay solución — no respondo`, 'warn');
                ultimoSortIdProcesado.set(chat.id, ultimo.sortId);
                return;
            }

            // Leer mensaje
            const mensaje = leerUltimoMensajeCliente(historial, chat.nombre);
            if (!mensaje) {
                log(`⚠️ No leí mensaje en ${chat.nombre}`, 'warn');
                ultimaRespuestaChat.set(chat.id, Date.now());
                return;
            }
            log(`📩 Cliente: "${mensaje.slice(0, 60)}..."`, 'info');

            // CHECK 3: Filtro NO TOCAR
            const razonNoTocar = esClienteNoTocar(mensaje);
            if (razonNoTocar) {
                marcarCritico(chat.id, chat.nombre, razonNoTocar, true);
                ultimoSortIdProcesado.set(chat.id, ultimo.sortId);
                return;
            }

            // Etapa
            const etapa = obtenerEtapa(chat.id, historial);
            log(`🏷️ Etapa: ${etapa}`, 'info');

            // CHECK 4: ¿Etapa crítica?
            if (etapa === 4) {
                marcarCritico(chat.id, chat.nombre, 'etapa crítica');
                ultimoSortIdProcesado.set(chat.id, ultimo.sortId);
                return;
            }

            // Generar respuesta (saludos espejeados tienen prioridad)
            const frase = await generarRespuesta(mensaje, etapa, chat.id, chat.nombre, historial);
            if (!frase) {
                marcarCritico(chat.id, chat.nombre, 'sin frase libre de repetición');
                ultimoSortIdProcesado.set(chat.id, ultimo.sortId);
                return;
            }

            // 🆕 v3.4.2: Marcar cooldown ANTES de enviar (no después)
            // Esto evita que otro ciclo procese el mismo chat mientras estamos enviando
            ultimaRespuestaChat.set(chat.id, Date.now());

            // Abrir el chat (visible) y enviar por la UI real. 🆕 v3.9.3: si
            // ya es el chat activo (el agente lo tiene abierto), no hace
            // falta clickearlo de nuevo — ya está mostrando la conversación
            // correcta, así que se ahorra el click y el delay de cambio.
            const yaEsElActivo = chatActivoActual && chatActivoActual.id === chat.id;
            if (!yaEsElActivo) {
                botCambiandoChat = true;
                const elChat = buscarElementoChat(chat.id);
                if (!elChat) {
                    log(`❌ ${chat.nombre}: no encontré el chat en el sidebar para abrirlo`, 'error');
                    ultimaRespuestaChat.set(chat.id, Date.now() - CONFIG.cooldownChat - 1000);
                    return;
                }
                elChat.click();
                await sleep(CONFIG.delayCambioDeChat);
            }

            const ok = await enviarMensaje(frase);
            if (ok) {
                ultimaRespuestaChat.set(chat.id, Date.now());
                ultimoSortIdProcesado.set(chat.id, ultimo.sortId);
                incrementarRespuestas(chat.id);
                log(`✅ Enviado a ${chat.nombre}: "${frase.slice(0, 50)}${frase.length > 50 ? '...' : ''}"`, 'success');
            } else {
                log(`❌ ${chat.nombre}: falló el envío`, 'error');
                // Si falló el envío, liberar el cooldown (poner timestamp antiguo)
                ultimaRespuestaChat.set(chat.id, Date.now() - CONFIG.cooldownChat - 1000);
            }

            await volverAChat(chatPrevio, chat);
        } catch (err) {
            log(`💥 Error: ${err.message}`, 'error');
            console.error(err);
        } finally {
            // 🆕 v3.4.3: Lock por chat MUCHO más largo (3 segundos)
            // para evitar que un ciclo entre antes de que el envío anterior se "asiente"
            setTimeout(() => {
                chatsBloqueados.delete(chat.id);
                botCambiandoChat = false;
            }, 3000);
        }
    }

    // ════════════════════════════════════════════════════════════
    // 🔁 CICLO PRINCIPAL
    // ════════════════════════════════════════════════════════════
    // 🆕 v3.9.3: el chat activo (el que el agente tiene abierto en pantalla)
    // vuelve a incluirse. La razón original para excluirlo (v3.9.0) era que
    // HeroCare no refrescaba su vista cuando el bot respondía por API en
    // silencio — pero desde v3.9.0 el envío YA es 100% visible (click +
    // escribir + Enviar reales) para todos los chats, así que esa razón dejó
    // de existir: no hay ningún costo técnico en incluirlo. El chat activo no
    // tiene badge de no-leído (ya está "visto"), así que se lo deja pasar
    // siempre y procesarChat() decide si hay algo realmente nuevo (por
    // sort_id, vía la API — no depende de leer el DOM). Los demás chats
    // siguen requiriendo badge. Sin estado de activación/desactivación
    // manual como el viejo Modo Gestión — es automático y uniforme.
    function buscarChatsElegibles(chats, chatActivo, activoEscribiendo, maxCantidad) {
        const elegibles = [];
        for (const chat of chats) {
            if (elegibles.length >= maxCantidad) break;

            const esElActivo = chatActivo && (chat.id === chatActivo.id);

            // Si el agente está escribiendo un borrador manual en el chat
            // activo, no lo tratamos como candidato este tick — no queremos
            // que el bot le gane de mano con una respuesta automática.
            if (esElActivo && activoEscribiendo) continue;

            if (chatsBloqueados.has(chat.id)) continue;
            if (!esElActivo && !chat.tieneNuevos) continue;
            if (estaDespedido(chat.id)) continue;
            if (tieneSolucion(chat.id)) continue;
            if (estaCritico(chat.id)) continue;

            const ultimoEnvio = ultimaRespuestaChat.get(chat.id) || 0;
            if (Date.now() - ultimoEnvio < CONFIG.cooldownChat) continue;

            elegibles.push(chat);
        }
        return elegibles;
    }

    // Máximo de chats a drenar en un mismo tick (activo + segundo plano).
    const MAX_CHATS_POR_TICK = 5;

    async function ciclo() {
        if (!activo || cicloEnCurso) return;
        cicloEnCurso = true;
        try {
            const chats = leerChats();
            if (chats.length === 0) return;

            let activoEscribiendo = false;
            if (CONFIG.pausarSiAgenteEscribe) {
                const taActivo = document.querySelector(SEL.textarea);
                activoEscribiendo = !!(taActivo && taActivo.value && taActivo.value.trim().length > 0);
            }

            const chatActivo = obtenerChatActivo(chats);
            const candidatos = buscarChatsElegibles(chats, chatActivo, activoEscribiendo, MAX_CHATS_POR_TICK);

            // 🆕 v3.9.0: secuencial de nuevo — cada respuesta implica clickear
            // un chat de verdad, así que no se pueden procesar dos a la vez.
            for (const c of candidatos) {
                await procesarChat(c);
            }

            // 🐛 fix (auditoría v3.9.0): antes solo se refrescaba el panel
            // (lista de chats, timers, indicador de crítico) cuando NO había
            // nada para procesar en este tick. Con la cola llena, el panel
            // quedaba desactualizado hasta el próximo tick ocioso — ahora
            // siempre se refresca al final, haya procesado algo o no.
            actualizarPanelEstado(chats, chatActivo);
        } finally {
            cicloEnCurso = false;
        }
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
                    <span id="dt-title">🤖 DuTurbo v3.9.4</span>
                    <button id="dt-min" title="Minimizar a botón">✕</button>
                </div>
                <div id="dt-body">
                    <button id="dt-toggle">⚫ OFF</button>
                    <div id="dt-config">
                        <label>Tu nombre:
                            <input id="dt-agente" type="text" placeholder="Ej: Duvan Ramos" value="${CONFIG.nombreAgente || ''}">
                        </label>
                    </div>
                    <div id="dt-estado">Esperando...</div>
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
            /* 🆕 v3.9.0: crítico pisa el punto verde — imposible no notarlo,
               incluso con el panel minimizado, hasta que se resuelva. */
            .dt-fb-status.critico {
                background: #dc2626 !important;
                width: 14px;
                height: 14px;
                top: 2px;
                right: 2px;
                animation: pulseCriticoDot 0.9s infinite;
            }
            @keyframes pulseCriticoDot {
                0%, 100% { box-shadow: 0 0 10px #dc2626; }
                50% { box-shadow: 0 0 20px #ef4444; }
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
        let hayCritico = false; // 🆕 v3.9.0: para marcar el botón flotante

        chats.forEach(c => {
            const esActivo = chatActivo && c.id === chatActivo.id;
            const despedido = estaDespedido(c.id);
            const conSolucion = tieneSolucion(c.id);
            const critico = estaCritico(c.id);
            const etapa = respuestasPorChat.get(c.id) || 0;
            if (critico) hayCritico = true;

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
            else if (esActivo) { cls = 'active'; tag = '👤'; }
            else if (despedido) { tag = '🚫'; }
            else if (conSolucion) { cls = 'solucion'; tag = '💰'; }
            else if (c.tieneNuevos) { cls = 'urgent'; tag = `🟢${c.mensajesSinLeer}`; }
            else { tag = '⚪'; }
            const etapaStr = etapa > 0 ? ` [#${etapa}]` : '';
            html += `<div class="chat-row ${cls}"><span>${tag} ${c.nombre}${etapaStr}${timerStr}</span></div>`;
        });
        div.innerHTML = html;

        // 🆕 v3.5.6: Sonar si hay alerta de timer. 🆕 v3.9.0: marcar el
        // botón flotante en rojo mientras haya algún chat crítico — visible
        // incluso con el panel minimizado, hasta que se resuelva.
        if (hayAlerta) playAlertSound();
        const status = document.querySelector('.dt-fb-status');
        if (status) status.classList.toggle('critico', hayCritico);
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
        // 🆕 v3.8.0: instalar los interceptores ANTES que nada — cuanto antes
        // queden instalados, antes se captura el Authorization Bearer del
        // propio polling de la app (necesario para toda la API directa).
        instalarInterceptorFetch();
        instalarInterceptorXHR();
        crearPanel();
        actualizarPanelToggle();
        inicializarTrackingClicks();
        log('🚀 DuTurbo v3.9.4 cargado (agrega duTurbo.verHistorial para diagnóstico)', 'success');
        log('💡 Pon tu nombre y click en un chat antes de activar', 'info');
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
        estado: () => ({
            activo,
            chatActivo: chatActivoActual,
            respuestas: Object.fromEntries(respuestasPorChat),
            despedidos: Object.fromEntries(chatsDespedidos),
            conSolucion: Object.fromEntries(chatsConSolucion),
            criticos: Object.fromEntries(chatsCriticos),
            imagenes: Object.fromEntries(imagenesPorChat),
            // 🆕 v3.8.0: diagnóstico de la API directa (solo lectura)
            apiAuthCapturado: !!authCapturado,
            apiIdentityId: identityIdEfectivo(),
            apiUsername: usernameEfectivo(),
            apiRoomsEnCache: Array.from(roomInfoPorTicket.keys())
        }),
        // 🆕 v3.9.4: diagnóstico — trae el historial REAL de un chat (por id
        // o por nombre) y muestra, línea por línea, si cada mensaje del
        // agente matchea esDespedida()/PATRONES_SOLUCION_DADA. Para
        // depurar "el bot sigue respondiendo después de X frase" con datos
        // reales en vez de adivinar. Ejemplo: await duTurbo.verHistorial('ambar')
        verHistorial: async (idOChatNombre) => {
            const chats = leerChats();
            const chat = chats.find(c => c.id === idOChatNombre || c.nombre.toLowerCase() === String(idOChatNombre).toLowerCase());
            if (!chat) {
                console.log('[DuTurbo] No encontré ese chat. Disponibles:', chats.map(c => ({ id: c.id, nombre: c.nombre })));
                return null;
            }
            const room = await obtenerRoomInfo(chat.id);
            if (!room) {
                console.log('[DuTurbo] No pude obtener room info (¿ya se capturó el token de sesión?)');
                return null;
            }
            const crudos = await obtenerHistorialCrudo(room);
            if (!crudos) {
                console.log('[DuTurbo] No pude leer el historial.');
                return null;
            }
            const historial = clasificarMensajesHistorial(crudos, room.name);
            const tabla = historial.map(m => ({
                sortId: m.sortId,
                quien: m.esAgente ? 'AGENTE' : 'cliente',
                texto: m.texto,
                esDespedida: m.esAgente ? esDespedida(m.texto) : null,
                esSolucion: m.esAgente ? PATRONES_SOLUCION_DADA.some(rx => rx.test(m.texto)) : null
            }));
            console.table(tabla);
            console.log('agenteYaSeDespidio(historial completo):', agenteYaSeDespidio(historial));
            console.log('agenteYaDioSolucion(historial completo):', agenteYaDioSolucion(historial));
            console.log('estaDespedido (caché local):', estaDespedido(chat.id));
            console.log('tieneSolucion (caché local):', tieneSolucion(chat.id));
            return { room, historialCrudo: crudos, tabla };
        }
    };
})();
