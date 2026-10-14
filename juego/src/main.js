// main.js
import { Start } from './scenes/start.js';
import { Menu } from './scenes/Menu.js';
import { Cuentos } from './scenes/cuentos.js';
import { CuentaCuentos } from './scenes/CuentaCuentos.js';
import { Actividades } from './scenes/actividades.js';
import { SopaDeLetras } from './scenes/sopa.js';
import { CompletaPalabra } from './scenes/completa.js';
import { UnePalabraImagen } from './scenes/unePalabra.js';
import { RompecabezasFrases } from './scenes/RompecabezasFrases.js';
import { BurbujasLetras } from './scenes/burbujas.js';
import { Memorama } from './scenes/memorama.js';
import { Intros } from './scenes/Intros.js';
import { Preguntas } from './scenes/Preguntas.js';

// ---------------------------------------------------------------------------
// Resolución 1920x1080 manteniendo las coordenadas de diseño 1280x720.
// Todas las escenas se dibujan en un "mundo" de 1280x720; la cámara hace zoom
// 1.5 para llenar el lienzo de 1920x1080. Así las imágenes y los textos se
// renderizan a resolución real (nítidos) sin reescribir cada coordenada.
// ---------------------------------------------------------------------------
const DESIGN_W = 1280;
const DESIGN_H = 720;
const RES = 1920 / DESIGN_W; // 1.5

const sceneClasses = [Start, Menu, Cuentos, CuentaCuentos, Actividades, Intros,
    SopaDeLetras, CompletaPalabra, UnePalabraImagen, RompecabezasFrases,
    BurbujasLetras, Memorama, Preguntas];

sceneClasses.forEach((SceneClass) => {
    const originalCreate = SceneClass.prototype.create;
    SceneClass.prototype.create = function (...args) {
        const cam = this.cameras.main;
        cam.setZoom(RES);
        cam.centerOn(DESIGN_W / 2, DESIGN_H / 2);
        if (originalCreate) return originalCreate.apply(this, args);
    };
});

// Textos nítidos: se rasterizan a la resolución del zoom
['text'].forEach((name) => {
    const factory = Phaser.GameObjects.GameObjectFactory.prototype;
    const original = factory[name];
    factory[name] = function (...args) {
        return original.apply(this, args).setResolution(RES);
    };
});
const creator = Phaser.GameObjects.GameObjectCreator.prototype;
const originalMakeText = creator.text;
creator.text = function (...args) {
    return originalMakeText.apply(this, args).setResolution(RES);
};

const config = {
    type: Phaser.AUTO,
    title: 'Genius',
    parent: 'game-container',
    width: 1920,
    height: 1080,
    backgroundColor: '#000000',
    pixelArt: false,
    render: {
        antialias: true,
        mipmapFilter: 'LINEAR_MIPMAP_LINEAR'
    },
    
    // Habilitar físicas Arcade
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },

    scene: [
        Start,
        Menu,
        Cuentos,
        CuentaCuentos,
        Actividades,
        Intros,
        SopaDeLetras,
        CompletaPalabra,
        UnePalabraImagen,
        RompecabezasFrases,
        BurbujasLetras,
        Memorama,
        Preguntas,
    ],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
};

const game = new Phaser.Game(config);
