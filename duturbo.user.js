// ==UserScript==
// @name         DuTurbo Templates — Barra Rápida
// @namespace    duacademy.site
// @version      1.0.0
// @description  Botones de templates rápidos para HeroCare. Cupón, Tarjeta, Imagen, Despedidas, Encuesta.
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
    // 📋 TEMPLATES
    // ════════════════════════════════════════════════════════════
    function obtenerSaludoHora() {
        const h = new Date().getHours();
        if (h >= 6 && h < 12) return 'muy buen día';
        if (h >= 12 && h < 18) return 'muy buena tarde';
        return 'muy buena noche';
    }

    const TEMPLATES = {
        cupon: (monto) =>
            `Te cargué un cupón de ${monto} por este inconveniente. Te recuerdo que es de único uso y que ingresando a 'Mi perfil' > 'Cupones', encontrarás toda la información sobre el mismo.`,

        tarjeta: (monto) =>
            `Te confirmo que se hizo la devolución de ${monto} a la tarjeta con la que hiciste el pago.\nLa devolución puede tardar unos 7 días hábiles en reflejarse en tu resumen de cuenta.`,

        wallet: (monto) =>
            `Ya realicé la devolución de ${monto} como saldo en PedidosYa. Recuerda que el mismo tiene validez por 2 años. Puedes corroborarlo ingresando desde el menú principal de la app a tu billetera PedidosYa\nPuedes encontrar toda la información de tu devolución ingresando a 'Pedidos' desde la app y seleccionando este pedido.`,

        imagen:
            `Agradezco que me hayas enviado la imagen. Estoy revisándola para dar una respuesta adecuada a tu caso.`,

        despedida1:
            `Espero que la solución brindada ayude a compensar lo sucedido. Te agradezco por tu paciencia y por comunicarte con nosotros.`,

        encuesta:
            `Por último, ¿sería posible que me ayudes respondiendo una breve encuesta para calificar mi atención? ¡Gracias!`,

        despedida2: () =>
            `Ha sido un placer poder atenderte. Espero que tengas una ${obtenerSaludoHora()}. 🎉`,

        despedida3:
            `Muy amable. Al cerrar el chat encontrarás mi encuesta.`,

        devolucion:
            `¿En caso de una devolución, te gustaría recibirla como cupón de forma inmediata o a tu tarjeta con un plazo de 7 días hábiles?`,

        free:
            `También te acredité un cupón en compensación por los problemas ocasionados con tu pedido. Lo encuentras en la sección cupones de tu perfil.`
    };

    // ════════════════════════════════════════════════════════════
    // 🛠️ UTILIDADES
    // ════════════════════════════════════════════════════════════
    function tpl_clickReact(el) {
        ['mousedown', 'mouseup', 'click'].forEach(t => {
            el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        });
    }

    async function tpl_enviarMensaje(texto) {
        const ta = document.querySelector('textarea[data-testid="chat-form-input"]')
                || document.querySelector('textarea[placeholder*="scribe"]');
        if (!ta) return false;

        ta.focus();
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        setter.call(ta, texto);
        ta.dispatchEvent(new InputEvent('input', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: texto
        }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 500));

        const botones = Array.from(document.querySelectorAll('button'));
        const btn = botones.find(b => /enviar|send/i.test(b.textContent.trim()) && !b.disabled);
        if (btn) {
            tpl_clickReact(btn);
            return true;
        }
        return false;
    }

    // ════════════════════════════════════════════════════════════
    // 🎨 CREAR BARRA DE TEMPLATES
    // ════════════════════════════════════════════════════════════
    function crearBarra() {
        if (document.getElementById('tpl-bar')) return;

        const bar = document.createElement('div');
        bar.id = 'tpl-bar';
        bar.innerHTML = `
            <div id="tpl-grip" title="Arrastra para mover"></div>
            <div id="tpl-monto-row">
                <input id="tpl-monto" type="text" placeholder="Monto: ARS 5200">
            </div>
            <div id="tpl-acciones-row">
                <button class="tpl-btn tpl-cupon" data-tpl="cupon">💳Cupón</button>
                <button class="tpl-btn tpl-tarjeta" data-tpl="tarjeta">💳Tarjeta</button>
                <button class="tpl-btn tpl-wallet" data-tpl="wallet">💳Wallet</button>
                <button class="tpl-btn tpl-enc" data-tpl="encuesta">📊Encuesta</button>
                <button class="tpl-btn tpl-d1" data-tpl="despedida1">👋Desp1</button>
                <button class="tpl-btn tpl-d2" data-tpl="despedida2">🎉Desp2</button>
                <button class="tpl-btn tpl-d3" data-tpl="despedida3">🙏Desp3</button>
                <button class="tpl-btn tpl-free" data-tpl="free">🎁Free</button>
            </div>
        `;

        const css = document.createElement('style');
        css.textContent = `
            #tpl-bar {
                position: fixed;
                z-index: 999998;
                background: #f0f2f5;
                border: 1px solid #d9d9d9;
                border-radius: 10px;
                padding: 4px 10px 6px;
                display: flex;
                flex-direction: column;
                gap: 5px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                font-family: system-ui, -apple-system, sans-serif;
                user-select: none;
                width: 700px;
                min-width: 400px;
                max-width: 95vw;
                resize: horizontal;
                overflow: hidden;
            }
            #tpl-grip {
                width: 60px;
                height: 5px;
                background: #bfbfbf;
                border-radius: 3px;
                margin: 0 auto 2px;
                cursor: move;
            }
            #tpl-grip:hover { background: #8c8c8c; }
            #tpl-monto-row, #tpl-acciones-row {
                display: flex;
                gap: 4px;
                align-items: center;
                flex-wrap: nowrap;
                width: 100%;
            }
            #tpl-acciones-row .tpl-btn {
                flex: 1;
                text-align: center;
            }
            #tpl-monto {
                width: 100%;
                padding: 5px 10px;
                background: #fff;
                color: #333;
                border: 1px solid #d9d9d9;
                border-radius: 16px;
                font-size: 11px;
                outline: none;
            }
            #tpl-monto:focus { border-color: #4096ff; }
            #tpl-monto::placeholder { color: #bfbfbf; }
            .tpl-btn {
                padding: 3px 10px;
                border: 1px solid #91caff;
                border-radius: 16px;
                font-size: 10px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s;
                white-space: nowrap;
                color: #1677ff;
                background: #e6f4ff;
            }
            .tpl-btn:hover { background: #bae0ff; border-color: #69b1ff; }
            .tpl-btn:active { background: #91caff; }

            /* Sin colores diferentes — todos iguales tipo HeroCare */
            .tpl-cupon, .tpl-tarjeta, .tpl-wallet,
            .tpl-img, .tpl-dev, .tpl-enc,
            .tpl-d1, .tpl-d2, .tpl-d3, .tpl-free {
                background: #e6f4ff;
                color: #1677ff;
                border-color: #91caff;
            }
        `;
        document.head.appendChild(css);
        document.body.appendChild(bar);

        // ── Posición guardada ──
        const posGuardada = JSON.parse(localStorage.getItem('tpl_bar_pos') || 'null');
        if (posGuardada) {
            bar.style.left = posGuardada.left + 'px';
            bar.style.top = posGuardada.top + 'px';
        } else {
            bar.style.bottom = '10px';
            bar.style.left = '50%';
            bar.style.transform = 'translateX(-50%)';
        }

        // ── Drag solo desde el grip ──
        let tplDrag = false, tplStartX, tplStartY, tplInitX, tplInitY;
        const grip = document.getElementById('tpl-grip');

        grip.addEventListener('mousedown', (e) => {
            tplDrag = true;
            tplStartX = e.clientX;
            tplStartY = e.clientY;
            const rect = bar.getBoundingClientRect();
            tplInitX = rect.left;
            tplInitY = rect.top;
            bar.style.transform = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!tplDrag) return;
            const dx = e.clientX - tplStartX;
            const dy = e.clientY - tplStartY;
            bar.style.left = Math.max(0, tplInitX + dx) + 'px';
            bar.style.top = Math.max(0, tplInitY + dy) + 'px';
            bar.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (!tplDrag) return;
            tplDrag = false;
            const rect = bar.getBoundingClientRect();
            localStorage.setItem('tpl_bar_pos', JSON.stringify({ left: rect.left, top: rect.top }));
        });

        // ── Handlers ──
        bar.querySelectorAll('.tpl-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tipo = btn.getAttribute('data-tpl');
                const input = document.getElementById('tpl-monto');
                const monto = (input?.value || '').trim();

                let texto = '';

                switch (tipo) {
                    case 'cupon':
                    case 'tarjeta':
                    case 'wallet':
                        if (!monto) {
                            input?.focus();
                            input.style.borderColor = '#ef4444';
                            setTimeout(() => { input.style.borderColor = 'rgba(192,223,22,0.3)'; }, 1500);
                            return;
                        }
                        texto = TEMPLATES[tipo](monto);
                        break;
                    case 'despedida2':
                        texto = TEMPLATES.despedida2();
                        break;
                    default:
                        texto = TEMPLATES[tipo];
                        break;
                }

                if (!texto) return;

                const ok = await tpl_enviarMensaje(texto);
                if (ok) {
                    // Flash verde en el botón
                    btn.style.boxShadow = '0 0 12px #10b981';
                    setTimeout(() => { btn.style.boxShadow = ''; }, 800);
                    // Limpiar monto si era cupón/tarjeta/wallet
                    if (['cupon', 'tarjeta', 'wallet'].includes(tipo) && input) {
                        input.value = '';
                    }
                }
            });
        });
    }

    // ════════════════════════════════════════════════════════════
    // 🚀 INIT — Esperar a que HeroCare cargue
    // ════════════════════════════════════════════════════════════
    function init() {
        const check = setInterval(() => {
            const ta = document.querySelector('textarea[data-testid="chat-form-input"]')
                    || document.querySelector('textarea[placeholder*="scribe"]');
            if (ta) {
                clearInterval(check);
                crearBarra();
                console.log('[Templates] ⚡ Barra de templates v1.0.0 cargada');
            }
        }, 2000);
    }

    init();

})();
