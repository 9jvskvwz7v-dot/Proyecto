// gamepad.js
// Soporte para control de Xbox 360 (y cualquier control con mapeo "standard").
//
// Cómo funciona: el control maneja un CURSOR VIRTUAL. Cada movimiento/botón se
// traduce a eventos de mouse (mousemove / mousedown / mouseup) disparados sobre
// el canvas, así que Phaser los trata igual que al mouse real. Por eso todas
// las escenas (clics, hover, arrastrar y soltar, la sopa de letras, las
// burbujas...) funcionan sin tocar su lógica.
//
// Controles:
//   Stick izquierdo ....... mueve el cursor (rápido)
//   Stick derecho ......... mueve el cursor (preciso / lento)
//   A ..................... clic (mantenerlo apretado = arrastrar)
//   B ..................... volver atrás / saltar la intro
//   Cruceta ............... salta al botón más cercano en esa dirección
//                           (en la sopa de letras avanza casilla por casilla)
//
// Una escena puede ayudar con dos propiedades opcionales:
//   this.backButton ....... objeto interactivo que activa el botón B
//   gamepadDpad(dx,dy,c) .. método que decide a dónde va el cursor con la
//                           cruceta; devuelve {x,y} o null (comportamiento normal)

// Tamaño lógico del juego (el lienzo real es 1920x1080, pero las escenas usan 1280x720 y la cámara hace zoom 1.5)
const LOGICAL_W = 1280;
const LOGICAL_H = 720;
const DEADZONE = 0.30;        // zona muerta de los sticks (los de 360 "vibran")
const SPEED_FAST = 560;       // unidades de juego por segundo (stick izquierdo)
const SPEED_FINE = 200;       // stick derecho
const SMOOTHING = 0.05;       // segundos que tarda el cursor en acelerar/frenar (más alto = más suave)
// El pulgar suele rozar el stick al pulsar/soltar A y el cursor "saltaba". Por eso:
const CLICK_LOCK_MS = 220;    // tras soltar A el cursor se queda quieto este tiempo
const PRESS_GRACE_MS = 260;   // tras pulsar A, los roces suaves del stick se ignoran este tiempo...
const DELIBERATE_PUSH = 0.7;  // ...salvo que el stick se empuje más que esto (arrastre intencional)
const REPEAT_DELAY = 350;     // ms antes de repetir al mantener la cruceta
const REPEAT_RATE = 130;      // ms entre repeticiones

export function initGamepad(game) {
    return new GamepadCursor(game);
}

// Aplica zona muerta radial y una curva suave: poco recorrido = movimiento fino
function shapeStick(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < DEADZONE) return { x: 0, y: 0 };
    const k = (Math.min(mag, 1) - DEADZONE) / (1 - DEADZONE);
    const eased = Math.pow(k, 1.7); // curva gradual: medio stick = ~30% de la velocidad
    return { x: (x / mag) * eased, y: (y / mag) * eased };
}

function isShown(obj) {
    for (let n = obj; n; n = n.parentContainer) {
        if (!n.visible || !n.active || n.alpha === 0) return false;
    }
    return true;
}

const tmpMatrix = new Phaser.GameObjects.Components.TransformMatrix();

// Caja (en coordenadas del juego) del área que responde al clic de un objeto
function getHitBox(obj) {
    const area = obj.input && obj.input.hitArea;
    if (!area) return null;

    const ox = obj.displayOriginX || 0;
    const oy = obj.displayOriginY || 0;
    let lx, ly, w, h;

    if (area instanceof Phaser.Geom.Rectangle) {
        lx = area.x - ox; ly = area.y - oy; w = area.width; h = area.height;
    } else if (area instanceof Phaser.Geom.Circle) {
        lx = area.x - area.radius - ox; ly = area.y - area.radius - oy;
        w = h = area.radius * 2;
    } else {
        return null;
    }

    const m = obj.getWorldTransformMatrix(tmpMatrix);
    const xs = [];
    const ys = [];
    [[lx, ly], [lx + w, ly], [lx, ly + h], [lx + w, ly + h]].forEach(([px, py]) => {
        const p = m.transformPoint(px, py);
        xs.push(p.x);
        ys.push(p.y);
    });

    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

class GamepadCursor {

    constructor(game) {
        this.game = game;
        this.x = 640;
        this.y = 360;
        this.visible = false;
        this.aDown = false;
        this.prev = {};
        this.dpadHeld = null;
        this.dpadNextAt = 0;
        this.vx = 0;           // velocidad actual del cursor (suavizada)
        this.vy = 0;
        this.lockUntil = 0;    // hasta cuándo el cursor está congelado tras soltar A
        this.pressAt = 0;      // momento en que se pulsó A
        this.lastTime = performance.now();

        this.createCursorElement();

        // Si se usa el mouse real (o la pantalla táctil), el cursor del control se esconde
        window.addEventListener('mousemove', (e) => {
            if (!e.isTrusted) return; // ignora los eventos que dispara este mismo módulo
            const g = this.fromClient(e.clientX, e.clientY);
            this.x = g.x;
            this.y = g.y;
            this.setVisible(false);
        }, { passive: true });
        window.addEventListener('touchstart', () => this.setVisible(false), { passive: true });

        requestAnimationFrame((t) => this.tick(t));
    }

    // ---------- Cursor visual (un div encima del canvas) ----------

    createCursorElement() {
        const el = document.createElement('div');
        el.id = 'gamepad-cursor';
        el.innerHTML =
            '<svg viewBox="0 0 64 64" width="100%" height="100%">' +
            '<circle class="gp-ring" cx="32" cy="32" r="22" fill="rgba(255,221,85,0.18)" stroke="#1b1b2f" stroke-width="12"/>' +
            '<circle cx="32" cy="32" r="22" fill="none" stroke="#ffdd55" stroke-width="6"/>' +
            '<circle cx="32" cy="32" r="5" fill="#ffdd55" stroke="#1b1b2f" stroke-width="3"/>' +
            '</svg>';
        Object.assign(el.style, {
            position: 'fixed',
            left: '0',
            top: '0',
            pointerEvents: 'none',
            zIndex: '9999',
            display: 'none',
            transition: 'scale 80ms ease-out',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))'
        });
        document.body.appendChild(el);
        this.el = el;
    }

    setVisible(v) {
        if (this.visible === v) return;
        this.visible = v;
        this.el.style.display = v ? 'block' : 'none';
        if (v) this.updateCursorElement();
    }

    updateCursorElement() {
        const canvas = this.game.canvas;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const size = Math.max(28, rect.width * 0.04);
        const p = this.toClient(this.x, this.y);
        this.el.style.width = size + 'px';
        this.el.style.height = size + 'px';
        this.el.style.transform = `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`;
        this.el.style.scale = this.aDown ? '0.75' : '1';
    }

    // ---------- Conversión entre coordenadas del juego y de la pantalla ----------

    toClient(gx, gy) {
        const rect = this.game.canvas.getBoundingClientRect();
        return {
            x: rect.left + (gx / LOGICAL_W) * rect.width,
            y: rect.top + (gy / LOGICAL_H) * rect.height
        };
    }

    fromClient(cx, cy) {
        const canvas = this.game.canvas;
        if (!canvas) return { x: this.x, y: this.y };
        const rect = canvas.getBoundingClientRect();
        return {
            x: Phaser.Math.Clamp((cx - rect.left) / rect.width * LOGICAL_W, 0, LOGICAL_W),
            y: Phaser.Math.Clamp((cy - rect.top) / rect.height * LOGICAL_H, 0, LOGICAL_H)
        };
    }

    // ---------- Lectura del control ----------

    readPads() {
        const s = {
            lx: 0, ly: 0, rx: 0, ry: 0,
            a: false, b: false,
            up: false, down: false, left: false, right: false,
            connected: false, anyInput: false
        };
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];

        for (const p of pads) {
            if (!p || !p.connected) continue;
            s.connected = true;

            const standard = p.mapping === 'standard';
            const btn = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
            const axis = (i) => p.axes[i] || 0;

            // Mapeo "standard" (Chrome/Edge y Firefox reciente). Si el navegador no lo
            // reconoce (algunos Firefox/Linux con el 360): sticks derechos en ejes 3-4
            // y cruceta en los ejes 6-7.
            const lx = axis(0), ly = axis(1);
            const rx = standard ? axis(2) : axis(3);
            const ry = standard ? axis(3) : axis(4);

            if (Math.abs(lx) > Math.abs(s.lx)) s.lx = lx;
            if (Math.abs(ly) > Math.abs(s.ly)) s.ly = ly;
            if (Math.abs(rx) > Math.abs(s.rx)) s.rx = rx;
            if (Math.abs(ry) > Math.abs(s.ry)) s.ry = ry;

            s.a = s.a || btn(0);
            s.b = s.b || btn(1);

            if (standard) {
                s.up = s.up || btn(12);
                s.down = s.down || btn(13);
                s.left = s.left || btn(14);
                s.right = s.right || btn(15);
            } else {
                s.up = s.up || axis(7) < -0.5;
                s.down = s.down || axis(7) > 0.5;
                s.left = s.left || axis(6) < -0.5;
                s.right = s.right || axis(6) > 0.5;
            }

            if (p.buttons.some(b => b && b.pressed)) s.anyInput = true;
        }

        if (Math.hypot(s.lx, s.ly) > DEADZONE || Math.hypot(s.rx, s.ry) > DEADZONE) s.anyInput = true;
        return s;
    }

    // ---------- Bucle principal ----------

    tick(time) {
        requestAnimationFrame((t) => this.tick(t));

        const dt = Math.min((time - this.lastTime) / 1000, 0.05);
        this.lastTime = time;

        if (!this.game.canvas) return;

        const s = this.readPads();

        if (!s.connected) {
            if (this.aDown) this.release();
            this.setVisible(false);
            return;
        }

        if (s.anyInput) this.setVisible(true);

        // A = clic. Mantenerlo apretado permite arrastrar.
        // Al pulsar y al soltar, el cursor se congela un instante (ver CLICK_LOCK_MS).
        if (s.a && !this.prev.a) { this.press(); this.pressAt = time; }
        if (!s.a && this.prev.a) { this.release(); this.lockUntil = time + CLICK_LOCK_MS; }

        // Mientras A acaba de pulsarse, los roces suaves del stick se ignoran; para arrastrar
        // basta con empujar el stick con decisión (o esperar un instante).
        const push = Math.max(Math.hypot(s.lx, s.ly), Math.hypot(s.rx, s.ry));
        const justPressed = s.a && (time - this.pressAt) < PRESS_GRACE_MS && push < DELIBERATE_PUSH;

        // Movimiento con los sticks, con la velocidad suavizada (sin arranques ni frenazos bruscos)
        let targetVx = 0, targetVy = 0;
        if (time < this.lockUntil || justPressed) {
            this.vx = 0;
            this.vy = 0;
        } else {
            const l = shapeStick(s.lx, s.ly);
            const r = shapeStick(s.rx, s.ry);
            targetVx = l.x * SPEED_FAST + r.x * SPEED_FINE;
            targetVy = l.y * SPEED_FAST + r.y * SPEED_FINE;
            const blend = 1 - Math.exp(-dt / SMOOTHING);
            this.vx += (targetVx - this.vx) * blend;
            this.vy += (targetVy - this.vy) * blend;
            if (targetVx === 0 && Math.abs(this.vx) < 2) this.vx = 0;
            if (targetVy === 0 && Math.abs(this.vy) < 2) this.vy = 0;
        }
        if (this.vx !== 0 || this.vy !== 0) {
            this.moveTo(this.x + this.vx * dt, this.y + this.vy * dt);
        }

        // B = volver
        if (s.b && !this.prev.b) this.back();

        // Cruceta (con repetición al mantenerla)
        this.handleDpad(s, time);

        this.prev = { a: s.a, b: s.b };
        if (this.visible) this.updateCursorElement();
    }

    handleDpad(s, time) {
        let dir = null;
        if (s.up) dir = 'up';
        else if (s.down) dir = 'down';
        else if (s.left) dir = 'left';
        else if (s.right) dir = 'right';

        if (!dir) {
            this.dpadHeld = null;
            return;
        }

        if (dir !== this.dpadHeld) {
            this.dpadHeld = dir;
            this.dpadNextAt = time + REPEAT_DELAY;
            this.dpad(dir);
        } else if (time >= this.dpadNextAt) {
            this.dpadNextAt = time + REPEAT_RATE;
            this.dpad(dir);
        }
    }

    // ---------- Acciones ----------

    moveTo(x, y) {
        this.x = Phaser.Math.Clamp(x, 0, LOGICAL_W);
        this.y = Phaser.Math.Clamp(y, 0, LOGICAL_H);
        this.fire('mousemove');
    }

    press() {
        this.aDown = true;
        this.fire('mousedown');

        // Algunos navegadores bloquean el audio hasta la primera interacción
        try {
            const ctx = this.game.sound && this.game.sound.context;
            if (ctx && ctx.state === 'suspended') ctx.resume();
        } catch (e) { /* sin audio, no pasa nada */ }
    }

    release() {
        this.aDown = false;
        this.fire('mouseup');
    }

    back() {
        const scenes = this.game.scene.getScenes(true).reverse(); // la de más arriba primero
        for (const scene of scenes) {
            const btn = scene.backButton;
            if (btn && btn.active && btn.input && btn.input.enabled) {
                btn.emit('pointerdown', this.game.input.activePointer, 0, 0, {});
                return;
            }
        }
    }

    // Convierte el movimiento en un evento de mouse real sobre el canvas
    fire(type) {
        const canvas = this.game.canvas;
        if (!canvas) return;
        const p = this.toClient(this.x, this.y);
        canvas.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: p.x,
            clientY: p.y,
            screenX: p.x,
            screenY: p.y,
            button: 0,
            buttons: type !== 'mouseup' && this.aDown ? 1 : 0
        }));
    }

    // ---------- Cruceta: salto entre elementos ----------

    dpad(dir) {
        const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;

        // 1) La escena puede decidir (por ejemplo la sopa de letras, casilla por casilla)
        const scenes = this.game.scene.getScenes(true);
        const top = scenes[scenes.length - 1];
        if (top && typeof top.gamepadDpad === 'function') {
            const p = top.gamepadDpad(dx, dy, { x: this.x, y: this.y });
            if (p) {
                this.moveTo(p.x, p.y);
                return;
            }
        }

        // 2) Por defecto: el elemento interactivo más cercano en esa dirección
        const t = this.findTarget(dx, dy);
        if (t) this.moveTo(t.cx, t.cy);
    }

    collectTargets() {
        const targets = [];
        const dragging = this.aDown;

        const visit = (list) => {
            for (const obj of list) {
                if (obj.input && obj.input.enabled && isShown(obj)) {
                    // Las casillas donde se suelta una pieza solo cuentan mientras se arrastra
                    if (!obj.input.dropZone || dragging) {
                        const box = getHitBox(obj);
                        if (box) targets.push(box);
                    }
                }
                if (obj.list) visit(obj.list); // contenedores
            }
        };

        for (const scene of this.game.scene.getScenes(true)) {
            if (scene.input && scene.input.enabled) visit(scene.children.list);
        }
        return targets;
    }

    findTarget(dx, dy) {
        const targets = this.collectTargets();
        if (targets.length === 0) return null;

        const cx = this.x, cy = this.y;
        const inside = (t) => cx >= t.left && cx <= t.right && cy >= t.top && cy <= t.bottom;

        // Si el cursor no está sobre nada, entra al elemento más cercano
        if (!targets.some(inside)) {
            return targets.reduce((best, t) =>
                Math.hypot(t.cx - cx, t.cy - cy) < Math.hypot(best.cx - cx, best.cy - cy) ? t : best);
        }

        // Si ya está sobre algo, busca hacia la dirección pedida (sin repetir el actual)
        const score = (t, strictCone) => {
            const vx = t.cx - cx, vy = t.cy - cy;
            const along = vx * dx + vy * dy;
            const across = Math.abs(vx * dy - vy * dx);
            if (along < 8) return Infinity;
            if (strictCone && across > along * 1.5) return Infinity;
            return along + across * 2;
        };

        const pick = (strictCone) => {
            let best = null, bestScore = Infinity;
            for (const t of targets) {
                if (inside(t)) continue;
                const sc = score(t, strictCone);
                if (sc < bestScore) { best = t; bestScore = sc; }
            }
            return best;
        };

        return pick(true) || pick(false);
    }
}
