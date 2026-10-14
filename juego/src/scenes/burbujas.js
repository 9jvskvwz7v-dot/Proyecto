import { activities } from './activities.js';
import { preloadStars, showResults } from '../stars.js';

// =============================================================================
// BurbujasLetras — "Burbujas de Letras"
// =============================================================================

const BUBBLE_CONFIG = {
    letters: 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split(''),
    correctNeededPerRound: 3,
    startLives: 3,
    spawnIntervalMs: 900,
    correctBubbleChance: 0.42,
    bubbleRadiusRange: [34, 46],
    hitAreaPadding: 1.45,
    minFallSpeedDuration: 2500, // Duración mínima (máxima velocidad)
    baseFallDuration: 7000,     // Duración inicial en ronda 1
    speedRampAmount: 500,       // Milisegundos menos por cada ronda ganada
    bubbleColors: [0x1AA7C2, 0xFFD166, 0x06D6A0, 0x7C6BFF, 0xEF476F],
};

export class BurbujasLetras extends Phaser.Scene {

    constructor() {
        super('BurbujasLetras');
    }

    init(data) {
        this.activityId = data ? data.activityId : null;
        this.score = 0;
        this.lives = BUBBLE_CONFIG.startLives;
        this.round = 0;
        this.correctPopped = 0;
        this.currentTargetLetter = null;
        this.bubbles = [];
        this.gameActive = false;
        this.lastWasTarget = false; // Control para evitar letras repetidas seguidas
    }

    preload() {
        this.load.image('fondo_B', 'assets/Abc/fondo_B.png');
        this.load.image('control', 'assets/Abc/control.png');
        this.load.image('puntos', 'assets/Abc/puntos.png');
        this.load.image('vidas', 'assets/Abc/vidas.png');
        this.load.image('abc_T', 'assets/Abc/ABC_T.png');
        preloadStars(this);
        BUBBLE_CONFIG.letters.forEach(letter => {
            this.load.image('bubble_' + letter, `assets/Abc/${letter}.png`);
        });
    }

    create() {
        this.activity = activities.find(a => a.id === this.activityId);
        this.letterPool = (this.activity && this.activity.letters) ? this.activity.letters : BUBBLE_CONFIG.letters;

        this.cameras.main.fadeIn(400, 0, 0, 0);
        this.add.image(640, 360, 'fondo_B').setScale(0.23);
        this.add.image(1100, 20, 'puntos').setScale(0.4);
        this.add.image(130, 20, 'vidas').setScale(0.4);
        this.add.image(640, 75, 'abc_T').setScale(0.14);


        this.livesText = this.add.text(120, 90, '', {
            fontFamily: 'Arial',
            fontSize: '26px',
        }).setOrigin(0.5);

        this.scoreText = this.add.text(1105, 85, '', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#000000',
            fontStyle: 'bold'
        }).setOrigin(1, 0.5);

        this.feedbackText = this.add.text(640, 650, '', {
            fontFamily: 'Arial',
            fontSize: '26px',
            color: '#7CFC00',
            fontStyle: 'bold'
        }).setOrigin(0.5);


        this.createTargetCard();
        this.createBackButton();

        this.updateHUD();
        this.startRound();

        this.spawnEvent = this.time.addEvent({
            delay: BUBBLE_CONFIG.spawnIntervalMs,
            loop: true,
            callback: () => this.spawnBubble()
        });

        this.events.once('shutdown', () => this.cleanup());
        this.events.once('destroy', () => this.cleanup());
    }

    // ---------- Tarjeta de letra objetivo ----------

    createTargetCard() {
        const cardX = 640, cardY = 145, cardW = 220, cardH = 100;

        this.targetPanel = this.add.graphics();
        this.drawTargetPanel(cardX, cardY, cardW, cardH);

        this.add.text(cardX, cardY - 30, 'BUSCA LA LETRA', {
            fontFamily: 'Arial',
            fontSize: '15px',
            color: '#000000',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.targetLetterText = this.add.text(cardX, cardY + 12, '?', {
            fontFamily: 'Arial',
            fontSize: '52px',
            color: '#EF476F',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.createSpeakButton(cardX + 150, cardY);
    }

    drawTargetPanel(x, y, w, h) {
        this.targetPanel.clear();
        this.targetPanel.fillStyle(0xffffff, 0.95);
        this.targetPanel.lineStyle(3, 0xffdd55, 0.8);
        this.targetPanel.fillRoundedRect(x - w / 2, y - h / 2, w, h, 20);
        this.targetPanel.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 20);
    }

    createSpeakButton(x, y) {
        const size = 56;
        const btn = this.add.graphics();
        btn.fillStyle(0x1AA7C2, 1);
        btn.lineStyle(3, 0xffffff, 0.9);
        btn.fillCircle(0, 0, size / 2);
        btn.strokeCircle(0, 0, size / 2);

        const label = this.add.text(0, 0, '🔊', { fontSize: '26px' }).setOrigin(0.5);

        const container = this.add.container(x, y, [btn, label]);
        container.setSize(size, size);
        container.setInteractive({ useHandCursor: true });

        container.on('pointerover', () => this.tweens.add({ targets: container, scale: 1.1, duration: 100 }));
        container.on('pointerout', () => this.tweens.add({ targets: container, scale: 1, duration: 100 }));
        container.on('pointerdown', () => this.speakLetter());
    }

    // ---------- Voz generada por el navegador ----------

    speakLetter() {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance('Encuentra la letra ' + this.currentTargetLetter);
        utterance.lang = 'es-ES';
        utterance.rate = 0.8;
        utterance.pitch = 1.1;
        window.speechSynthesis.speak(utterance);
    }

    // ---------- Manejo de rondas ----------

    startRound() {
        this.gameActive = true;
        this.currentTargetLetter = Phaser.Utils.Array.GetRandom(this.letterPool);
        this.targetLetterText.setText(this.currentTargetLetter);
        this.correctPopped = 0;
        this.round++;
        this.lastWasTarget = false;
        this.feedbackText.setText('');
        this.time.delayedCall(250, () => this.speakLetter());
    }

    // Duración del trayecto de subida: Disminuye con cada ronda para aumentar la velocidad
    currentFallDuration() {
        const speedBoost = (this.round - 1) * BUBBLE_CONFIG.speedRampAmount;
        const duration = BUBBLE_CONFIG.baseFallDuration - speedBoost;
        return Phaser.Math.Clamp(duration, BUBBLE_CONFIG.minFallSpeedDuration, BUBBLE_CONFIG.baseFallDuration);
    }

    pickRandomOtherLetter() {
        let letter;
        do {
            letter = Phaser.Utils.Array.GetRandom(this.letterPool);
        } while (letter === this.currentTargetLetter && this.letterPool.length > 1);
        return letter;
    }

    // ---------- Burbujas ----------

    spawnBubble() {
        if (!this.gameActive) return;

        let isCorrect;
        // Evitar que salgan dos letras objetivo seguidas en ráfaga
        if (this.lastWasTarget) {
            isCorrect = false;
            this.lastWasTarget = false;
        } else {
            isCorrect = Math.random() < BUBBLE_CONFIG.correctBubbleChance;
            if (isCorrect) this.lastWasTarget = true;
        }

        const letter = isCorrect ? this.currentTargetLetter : this.pickRandomOtherLetter();
        const radius = Phaser.Math.Between(BUBBLE_CONFIG.bubbleRadiusRange[0], BUBBLE_CONFIG.bubbleRadiusRange[1]);
        const size = radius * 2;
        const x = Phaser.Math.Between(120, 1160);
        const startY = 760;

        const bubbleImg = this.add.image(radius, radius, 'bubble_' + letter);
        const scale = size / Math.max(bubbleImg.width, bubbleImg.height);
        bubbleImg.setScale(scale);

        const container = this.add.container(x, startY, [bubbleImg]);
        container.setSize(size, size);
        container.setInteractive(
            new Phaser.Geom.Circle(radius, radius, radius * BUBBLE_CONFIG.hitAreaPadding),
            Phaser.Geom.Circle.Contains
        );
        container.input.cursor = 'pointer';
        container.setData('letter', letter);
        container.setData('isCorrect', isCorrect);
        container.setData('popped', false);

        this.bubbleLayer.add(container);
        this.bubbles.push(container);

        // Balanceo horizontal suave
        this.tweens.add({
            targets: container,
            x: x + Phaser.Math.Between(-30, 30),
            duration: 1400 + Math.random() * 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Ascenso vertical
        const riseTween = this.tweens.add({
            targets: container,
            y: -80,
            duration: this.currentFallDuration(),
            ease: 'Linear',
            onComplete: () => {
                if (container.active) {
                    // Si se escapa la letra buscada sin reventar, se resta una vida
                    if (container.getData('isCorrect') && !container.getData('popped') && this.gameActive) {
                        this.lives--;
                        this.flashFeedback('¡Se escapó!', '#EF476F');
                        this.cameras.main.shake(200, 0.01);
                        this.updateHUD();

                        if (this.lives <= 0) {
                            this.destroyBubble(container);
                            this.endGame();
                            return;
                        }
                    }
                    this.destroyBubble(container);
                }
            }
        });
        container.setData('riseTween', riseTween);

        container.on('pointerdown', () => this.handleBubbleClick(container));
    }

    destroyBubble(container) {
        this.tweens.killTweensOf(container);
        const idx = this.bubbles.indexOf(container);
        if (idx !== -1) this.bubbles.splice(idx, 1);
        container.destroy();
    }

    handleBubbleClick(container) {
        if (!this.gameActive || container.getData('popped')) return;
        container.setData('popped', true);
        container.disableInteractive();

        const isCorrect = container.getData('isCorrect');
        const tween = container.getData('riseTween');
        if (tween) tween.stop();

        if (isCorrect) {
            this.score += 10;
            this.correctPopped++;
            this.flashFeedback('¡Bien!', '#7CFC00');
        } else {
            this.lives--;
            this.flashFeedback('¡Esa no!', '#EF476F');
            this.cameras.main.shake(200, 0.01);
        }
        this.updateHUD();

        this.tweens.add({
            targets: container,
            scale: 1.4,
            alpha: 0,
            duration: 250,
            ease: 'Back.easeIn',
            onComplete: () => this.destroyBubble(container)
        });

        if (this.lives <= 0) {
            this.endGame();
            return;
        }

        if (this.correctPopped >= BUBBLE_CONFIG.correctNeededPerRound) {
            this.gameActive = false;
            this.time.delayedCall(500, () => this.clearAllBubbles());
            this.time.delayedCall(900, () => {
                this.startRound();
            });
        }
    }

    clearAllBubbles() {
        [...this.bubbles].forEach(b => this.destroyBubble(b));
    }

    flashFeedback(msg, color) {
        this.feedbackText.setColor(color);
        this.feedbackText.setText(msg);
        this.tweens.killTweensOf(this.feedbackText);
        this.feedbackText.setAlpha(1);
        this.tweens.add({ targets: this.feedbackText, alpha: 0, duration: 700, delay: 400 });
    }

    updateHUD() {
        const hearts = '❤️'.repeat(Math.max(this.lives, 0)) + '🖤'.repeat(BUBBLE_CONFIG.startLives - Math.max(this.lives, 0));
        this.livesText.setText(hearts);
        this.scoreText.setText('' + this.score);
    }

    // ---------- Fin del juego ----------

    endGame() {
        this.gameActive = false;
        if (this.spawnEvent) this.spawnEvent.remove();
        this.clearAllBubbles();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();

        // Estrellas según las rondas completadas antes de quedarse sin vidas
        const rounds = Math.max(0, this.round - 1);
        const stars = rounds >= 5 ? 3 : rounds >= 3 ? 2 : 1;
        this.time.delayedCall(450, () => showResults(this, {
            stars,
            score: this.score,
            detail: `${rounds} ${rounds === 1 ? 'ronda completada' : 'rondas completadas'}`
        }));
    }

    cleanup() {
        if (this.spawnEvent) this.spawnEvent.remove();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    // ---------- Navegación ----------

    createBackButton() {
        const backBtn = this.add.image(80, 625, 'control')
            .setDisplaySize(100, 100)
            .setInteractive({ useHandCursor: true });
        const baseScale = backBtn.scaleX;

        backBtn.on('pointerover', () => {
            this.tweens.add({ targets: backBtn, scale: baseScale * 1.15, duration: 120 });
        });
        backBtn.on('pointerout', () => {
            this.tweens.add({ targets: backBtn, scale: baseScale, duration: 120 });
        });
        backBtn.on('pointerdown', () => {
            this.cleanup();
            this.scene.start('Actividades');
        });
    }
}