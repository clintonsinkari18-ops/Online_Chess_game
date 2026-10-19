import {
  generateMoveSound,
  generateCaptureSound,
  generateCheckSound,
  generateCheckmateSound,
  generateWinSound,
  generateLossSound,
  generateSpecialMoveSound,
  playSound,
} from './soundGenerator';

class SoundManager {
  private moveBuffer: AudioBuffer | null = null;
  private captureBuffer: AudioBuffer | null = null;
  private checkBuffer: AudioBuffer | null = null;
  private checkmateBuffer: AudioBuffer | null = null;
  private winBuffer: AudioBuffer | null = null;
  private lossBuffer: AudioBuffer | null = null;
  private specialMoveBuffer: AudioBuffer | null = null;
  private soundEnabled: boolean = true;
  private initialized: boolean = false;

  constructor() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('soundEnabled') : null;
    if (saved !== null) {
      try {
        this.soundEnabled = JSON.parse(saved);
      } catch {
        this.soundEnabled = true;
      }
    }
  }

  private ensureBuffers(): void {
    if (this.initialized) return;
    try {
      this.moveBuffer = generateMoveSound();
      this.captureBuffer = generateCaptureSound();
      this.checkBuffer = generateCheckSound();
      this.checkmateBuffer = generateCheckmateSound();
      this.winBuffer = generateWinSound();
      this.lossBuffer = generateLossSound();
      this.specialMoveBuffer = generateSpecialMoveSound();
      this.initialized = true;
    } catch (error) {
      console.warn('Sound initialization deferred until user interaction:', error);
    }
  }

  unlock(): void {
    this.ensureBuffers();
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('soundEnabled', JSON.stringify(enabled));
    }
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  playMoveSound(): void {
    if (!this.soundEnabled) return;
    this.ensureBuffers();
    if (this.moveBuffer) playSound(this.moveBuffer, 0.85);
  }

  playCaptureSound(): void {
    if (!this.soundEnabled) return;
    this.ensureBuffers();
    if (this.captureBuffer) playSound(this.captureBuffer, 0.95);
  }

  playCheckSound(): void {
    if (!this.soundEnabled) return;
    this.ensureBuffers();
    if (this.checkBuffer) playSound(this.checkBuffer, 0.85);
  }

  playCheckmateSound(): void {
    if (!this.soundEnabled) return;
    this.ensureBuffers();
    if (this.checkmateBuffer) playSound(this.checkmateBuffer, 0.9);
  }

  playWinSound(): void {
    if (!this.soundEnabled) return;
    this.ensureBuffers();
    if (this.winBuffer) playSound(this.winBuffer, 0.9);
  }

  playLossSound(): void {
    if (!this.soundEnabled) return;
    this.ensureBuffers();
    if (this.lossBuffer) playSound(this.lossBuffer, 0.85);
  }

  playSpecialMoveSound(): void {
    if (!this.soundEnabled) return;
    this.ensureBuffers();
    if (this.specialMoveBuffer) playSound(this.specialMoveBuffer, 0.85);
  }
}

export const soundManager = new SoundManager();
