export class musica {
    constructor(game) {
        this.game = game;
        this.playlist = ['pista1', 'pista2', 'pista3', 'pista4'];
        this.shuffledQueue = [];
        this.currentSound = null;
    }

    static preloadTracks(scene) {
        scene.load.audio('pista1', 'assets/musica/1.mp3');
        scene.load.audio('pista2', 'assets/musica/2.mp3');
        scene.load.audio('pista3', 'assets/musica/3.mp3');
        scene.load.audio('pista4', 'assets/musica/4.mp3');
    }

    startPlaylist(scene) {
        if (this.currentSound && this.currentSound.isPlaying) return;
        this.playNextTrack(scene);
    }

    playNextTrack(scene) {
        // Si la cola está vacía, volvemos a aleatorizar la lista completa
        if (this.shuffledQueue.length === 0) {
            this.shuffledQueue = Phaser.Utils.Array.Shuffle([...this.playlist]);
        }

        const nextTrackKey = this.shuffledQueue.shift();

        // Creamos la pista global o persistente en la escena
        this.currentSound = scene.sound.add(nextTrackKey, { volume: 0.4 });

        // Cuando la canción termine, reproduce la siguiente de la cola aleatoria
        this.currentSound.once('complete', () => {
            this.playNextTrack(scene);
        });

        this.currentSound.play();
    }
}