// Authentic wooden chess acoustic sound synthesis using Web Audio API
// Synthesizes realistic wooden piece physics (transient impact, wood body resonance, dual-strike captures)

const getAudioContext = (): AudioContext => {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new AudioCtx();
};

/**
 * 1. NORMAL MOVE: Crisp, satisfying wooden piece "thock" on wooden chessboard
 * Features: micro-click transient + dual wood-body resonance + low-frequency table damping
 */
export const generateMoveSound = (): AudioBuffer => {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const duration = 0.12;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < buffer.length; i++) {
    const t = i / sampleRate;

    // Transient click (piece felt/edge making contact)
    const clickEnv = Math.exp(-220 * t);
    const click = (Math.random() * 2 - 1) * clickEnv * 0.45;

    // Primary wooden body resonance (pitch drops quickly as piece settles)
    const bodyFreq = 260 * Math.exp(-18 * t) + 140;
    const bodyEnv = Math.exp(-38 * t);
    const bodyHarmonic1 = Math.sin(2 * Math.PI * bodyFreq * t);
    const bodyHarmonic2 = Math.sin(2 * Math.PI * (bodyFreq * 1.85) * t) * 0.4;
    const bodyHarmonic3 = Math.sin(2 * Math.PI * (bodyFreq * 2.7) * t) * 0.15;
    const body = (bodyHarmonic1 + bodyHarmonic2 + bodyHarmonic3) * bodyEnv * 0.65;

    // Low-end weighted piece thump
    const thumpEnv = Math.exp(-55 * t);
    const thump = Math.sin(2 * Math.PI * 110 * t) * thumpEnv * 0.35;

    data[i] = (click + body + thump) * 0.85;
  }

  return buffer;
};

/**
 * 2. CAPTURE SOUND: Meaty, dual-impact wooden collision (piece striking piece + landing on board)
 */
export const generateCaptureSound = (): AudioBuffer => {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const duration = 0.22;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);

  // Impact 1: Piece striking piece at t=0
  // Impact 2: Captured piece sliding / taking piece landing at t=0.038s
  const t2 = 0.038;

  for (let i = 0; i < buffer.length; i++) {
    const t = i / sampleRate;

    // Strike 1 (Hard wood-on-wood collision)
    const env1 = Math.exp(-70 * t);
    const strikeClick = (Math.random() * 2 - 1) * Math.exp(-280 * t) * 0.55;
    const strikeWood = Math.sin(2 * Math.PI * (520 * Math.exp(-15 * t)) * t) * env1 * 0.5 +
                       Math.sin(2 * Math.PI * (880 * Math.exp(-20 * t)) * t) * env1 * 0.35;
    const strike1 = strikeClick + strikeWood;

    // Strike 2 (Heavy base landing on the board)
    let strike2 = 0;
    if (t >= t2) {
      const dt = t - t2;
      const env2 = Math.exp(-42 * dt);
      const landingClick = (Math.random() * 2 - 1) * Math.exp(-200 * dt) * 0.35;
      const landingBody = Math.sin(2 * Math.PI * (210 * Math.exp(-12 * dt)) * dt) * env2 * 0.65 +
                          Math.sin(2 * Math.PI * 115 * dt) * Math.exp(-50 * dt) * 0.45;
      strike2 = (landingClick + landingBody);
    }

    data[i] = (strike1 + strike2 * 0.9) * 0.82;
  }

  return buffer;
};

/**
 * 3. SPECIAL MOVE (Castle / Promotion): Double crisp wooden step (King + Rook in rapid succession)
 */
export const generateSpecialMoveSound = (): AudioBuffer => {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const duration = 0.28;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);

  const t2 = 0.075; // second tap 75ms later

  for (let i = 0; i < buffer.length; i++) {
    const t = i / sampleRate;

    // Tap 1
    const env1 = Math.exp(-45 * t);
    const click1 = (Math.random() * 2 - 1) * Math.exp(-240 * t) * 0.35;
    const wood1 = Math.sin(2 * Math.PI * (280 * Math.exp(-18 * t)) * t) * env1 * 0.55;
    const tap1 = click1 + wood1;

    // Tap 2 (slightly higher pitch, crisper rook slide)
    let tap2 = 0;
    if (t >= t2) {
      const dt = t - t2;
      const env2 = Math.exp(-48 * dt);
      const click2 = (Math.random() * 2 - 1) * Math.exp(-240 * dt) * 0.38;
      const wood2 = Math.sin(2 * Math.PI * (330 * Math.exp(-18 * dt)) * dt) * env2 * 0.6;
      tap2 = click2 + wood2;
    }

    data[i] = (tap1 + tap2) * 0.82;
  }

  return buffer;
};

/**
 * 4. CHECK SOUND: Crisp wooden knock + clear acoustic warning chime
 */
export const generateCheckSound = (): AudioBuffer => {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const duration = 0.35;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < buffer.length; i++) {
    const t = i / sampleRate;

    // Wooden strike transient
    const knockEnv = Math.exp(-50 * t);
    const knock = Math.sin(2 * Math.PI * 280 * t) * knockEnv * 0.4 +
                  (Math.random() * 2 - 1) * Math.exp(-250 * t) * 0.3;

    // Pure acoustic warning bell resonance (dual resonant tone)
    const bellEnv = Math.exp(-14 * t);
    const bell1 = Math.sin(2 * Math.PI * 784 * t) * bellEnv * 0.35; // G5
    const bell2 = Math.sin(2 * Math.PI * 1175 * t) * Math.exp(-18 * t) * 0.18; // D6

    data[i] = (knock + bell1 + bell2) * 0.8;
  }

  return buffer;
};

/**
 * 5. CHECKMATE / WIN SOUND: Solid wooden final slam + warm, triumphant acoustic chime sequence
 */
export const generateWinSound = (): AudioBuffer => {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const duration = 1.35;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);

  // Ascending triumph notes: C5 (523), E5 (659), G5 (784), C6 (1046)
  const notes = [
    { freq: 523.25, time: 0.05, dur: 0.55 },
    { freq: 659.25, time: 0.16, dur: 0.55 },
    { freq: 783.99, time: 0.28, dur: 0.65 },
    { freq: 1046.5, time: 0.42, dur: 0.9 },
  ];

  for (let i = 0; i < buffer.length; i++) {
    const t = i / sampleRate;

    // Initial decisive king placement thud
    const slamEnv = Math.exp(-35 * t);
    const slam = (Math.sin(2 * Math.PI * 180 * t) + (Math.random() * 2 - 1) * 0.4) * slamEnv * 0.35;

    // Marimba / warm acoustic bell chord
    let chimes = 0;
    for (const n of notes) {
      if (t >= n.time) {
        const dt = t - n.time;
        const env = Math.exp(-6.5 * dt);
        const harm1 = Math.sin(2 * Math.PI * n.freq * dt) * 0.45;
        const harm2 = Math.sin(2 * Math.PI * (n.freq * 2) * dt) * 0.12;
        chimes += (harm1 + harm2) * env;
      }
    }

    data[i] = (slam + chimes * 0.65) * 0.85;
  }

  return buffer;
};

/**
 * 6. LOSS SOUND: Soft wooden piece tip-over + gentle minor acoustic cadence
 */
export const generateLossSound = (): AudioBuffer => {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const duration = 1.1;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);

  // Soft descent: E5 (659) -> D5 (587) -> C5 (523)
  const notes = [
    { freq: 659.25, time: 0.04, dur: 0.4 },
    { freq: 587.33, time: 0.22, dur: 0.45 },
    { freq: 440.00, time: 0.45, dur: 0.65 },
  ];

  for (let i = 0; i < buffer.length; i++) {
    const t = i / sampleRate;

    // Soft piece wobble tap
    const tapEnv = Math.exp(-40 * t);
    const tap = Math.sin(2 * Math.PI * 220 * t) * tapEnv * 0.25;

    let melody = 0;
    for (const n of notes) {
      if (t >= n.time) {
        const dt = t - n.time;
        const env = Math.exp(-5.5 * dt);
        const tone = Math.sin(2 * Math.PI * n.freq * dt) * env * 0.32;
        melody += tone;
      }
    }

    data[i] = (tap + melody) * 0.75;
  }

  return buffer;
};

export const generateCheckmateSound = (): AudioBuffer => {
  return generateWinSound();
};

/**
 * Safe play helper using Web Audio API buffer source
 */
export const playSound = (buffer: AudioBuffer, volume = 0.7): void => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.warn('Audio playback error:', err);
  }
};
