/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback, PointerEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, Trophy, Cpu, Maximize2, Settings, X, Volume2, Music, MousePointer2, Keyboard } from 'lucide-react';

// --- Types & Constants ---

enum GameState {
  START,
  PLAYING,
  PAUSED,
  GAME_OVER,
  VICTORY
}

const RACE_DISTANCE = 10000;

enum GameMode {
  SOLO,
  RACE
}

interface AIRunner {
  x: number;
  y: number;
  vy: number;
  isJumping: boolean;
  jumpCount: number;
  skill: number; 
  personality: number; // New: unique behavior modifier
  color: string;
  name: string;
  status: 'running' | 'failed';
  distance: number;
  failTime?: number;
}

interface Obstacle {
  x: number;
  width: number;
  height: number;
  type: 'spike' | 'coin' | 'shield' | 'boost' | 'magnet' | 'mine';
  id: number;
}

interface Mine {
  x: number;
  id: number;
}
// ... rest of interfaces

interface Star {
  x: number;
  y: number;
  size: number;
  speed: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

const GRAVITY = 0.6;
const JUMP_FORCE = -12;
const INITIAL_SPEED = 7;
const SPEED_INCREMENT = 0.0006;
const SPAWN_MIN_INTERVAL = 1000;
const SPAWN_MAX_INTERVAL = 2500;
const SKINS = [
  { name: 'NEON', color: '#f472b6', cost: 0, description: 'The classic runner' },
  { name: 'MATRIX', color: '#4ade80', cost: 500, description: 'Follow the white cat' },
  { name: 'VOID', color: '#c084fc', cost: 1200, description: 'From the digital abyss' },
  { name: 'GOLD', color: '#fbbf24', cost: 3000, description: 'For the elite racers' },
  { name: 'GHOST', color: '#ffffff', cost: 7500, description: 'Barely a reflection' },
];

// --- Sound Utilities ---

class SoundEngine {
  private ctx: AudioContext | null = null;
  public volume: number = 0.5;

  public init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playJump() {
    this.init();
    if (!this.ctx || this.volume === 0) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1 * this.volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01 * this.volume, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playGameOver() {
    this.init();
    if (!this.ctx || this.volume === 0) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(30, this.ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.2 * this.volume, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01 * this.volume, this.ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }
}

const sounds = new SoundEngine();

// --- Main Component ---

export default function App() {
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.SOLO);
  const [isMusicOn, setIsMusicOn] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShopOpen, setIsShopOpen] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [wallet, setWallet] = useState(() => {
    try {
      const saved = localStorage.getItem('neon-runner-wallet');
      return saved ? parseInt(saved, 10) : 0;
    } catch { return 0; }
  });
  const [currentSkin, setCurrentSkin] = useState(() => {
    try {
      return localStorage.getItem('neon-runner-skin') || '#f472b6';
    } catch { return '#f472b6'; }
  });
  const [purchasedSkins, setPurchasedSkins] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('neon-runner-purchased-skins');
      return saved ? JSON.parse(saved) : ['#f472b6'];
    } catch { return ['#f472b6']; }
  });
  const [volume, setVolume] = useState(0.5);
  const [controlScheme, setControlScheme] = useState<'wasd' | 'classic'>('classic');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [combo, setCombo] = useState(0);
  const [rank, setRank] = useState(1);
  const [mineCount, setMineCount] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try {
      const saved = localStorage.getItem('neon-runner-highscore');
      return saved ? parseInt(saved, 10) : 0;
    } catch { return 0; }
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const gameData = useRef({
    playerY: 0,
    playerVelocityY: 0,
    obstacles: [] as Obstacle[],
    stars: [] as Star[],
    particles: [] as Particle[],
    aiRunners: [] as AIRunner[],
    mines: [] as Mine[],
    speed: INITIAL_SPEED,
    lastSpawnTime: 0,
    nextSpawnInterval: SPAWN_MIN_INTERVAL,
    isJumping: false,
    jumpCount: 0,
    distance: 0,
    lastComboTime: 0,
    isDashing: false,
    dashStartTime: 0,
    dashCooldown: 0,
    isNitro: false,
    nitroStartTime: 0,
    nitroCooldown: 0,
    shake: 0,
    activePowerUps: {
      shield: false,
      boost: 0,
      magnet: 0
    },
    groundY: 0,
    playerX: 50,
    playerSize: 40,
    sessionCoins: 0,
    width: 0,
    height: 0
  });

  const handleInput = useCallback(() => {
    if (gameState !== GameState.PLAYING) return;
    
    const data = gameData.current;
    if (data.jumpCount < 2) {
      data.playerVelocityY = JUMP_FORCE * (data.jumpCount === 1 ? 0.8 : 1);
      data.isJumping = true;
      data.jumpCount++;
      createParticles(data.playerX + data.playerSize / 2, data.playerY + data.playerSize / 2, data.jumpCount === 2 ? '#ffffff' : '#22d3ee', 8);
      sounds.playJump();
    }
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        handleInput();
      }
      if (controlScheme === 'wasd') {
        if (e.code === 'KeyW') handleInput();
        if (e.code === 'KeyD') handleDash();
        if (e.code === 'KeyS') handleDropTrap();
      }
      if (e.code === 'ShiftLeft' || e.code === 'KeyD') {
        handleDash();
      }
      if (e.code === 'KeyN' || e.code === 'KeyF') {
        handleNitro();
      }
      if (e.code === 'KeyT' || e.code === 'KeyM') {
        handleDropTrap();
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        togglePause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleInput, gameState, isSettingsOpen]);

  useEffect(() => {
    try { localStorage.setItem('neon-runner-wallet', wallet.toString()); } catch {}
  }, [wallet]);

  useEffect(() => {
    try { localStorage.setItem('neon-runner-purchased-skins', JSON.stringify(purchasedSkins)); } catch {}
  }, [purchasedSkins]);

  useEffect(() => {
    try { localStorage.setItem('neon-runner-skin', currentSkin); } catch {}
  }, [currentSkin]);

  useEffect(() => {
    sounds.volume = volume;
  }, [volume]);

  const handleDash = () => {
    const data = gameData.current;
    const now = Date.now();
    if (gameState === GameState.PLAYING && !data.isDashing && now > data.dashCooldown) {
      data.isDashing = true;
      data.dashStartTime = now;
      data.dashCooldown = now + 1500;
      createParticles(data.playerX, data.playerY + data.playerSize / 2, '#f472b6', 20);
      sounds.playJump();
    }
  };

  const handleNitro = () => {
    const data = gameData.current;
    const now = Date.now();
    if (gameState === GameState.PLAYING && !data.isNitro && now > data.nitroCooldown) {
      data.isNitro = true;
      data.nitroStartTime = now;
      data.nitroCooldown = now + 8000; 
      data.shake = 12;
      createParticles(data.playerX, data.playerY + data.playerSize / 2, '#22d3ee', 40, 2);
      sounds.playJump();
    }
  };

  const handleDropTrap = () => {
    const data = gameData.current;
    if (gameState === GameState.PLAYING && mineCount > 0) {
      data.mines.push({ x: data.playerX - 20, id: Date.now() });
      setMineCount(prev => prev - 1);
      createParticles(data.playerX - 20, data.groundY - 10, '#c084fc', 10);
      sounds.playJump();
    }
  };

  const togglePause = () => {
    sounds.init();
    if (gameState === GameState.PLAYING) {
      setGameState(GameState.PAUSED);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    } else if (gameState === GameState.PAUSED) {
      setGameState(GameState.PLAYING);
      requestRef.current = requestAnimationFrame(updateGame);
    }
  };

  const startGame = () => {
    const aiColors = ['#f87171', '#4ade80', '#818cf8', '#c084fc', '#fb923c'];
    const aiNames = ['CHIP', 'BYTE', 'NOVA', 'ZERO', 'FLUX'];

    gameData.current = {
      ...gameData.current,
      playerY: gameData.current.height - 100,
      playerVelocityY: 0,
      obstacles: [],
      speed: INITIAL_SPEED,
      lastSpawnTime: performance.now(),
      nextSpawnInterval: SPAWN_MIN_INTERVAL,
      isJumping: false,
      jumpCount: 0,
      distance: 0,
      lastComboTime: 0,
      isDashing: false,
      isNitro: false,
      nitroStartTime: 0,
      nitroCooldown: 0,
      activePowerUps: {
        shield: false,
        boost: 0,
        magnet: 0
      },
      groundY: gameData.current.height - 60,
      stars: Array.from({ length: 50 }, () => ({
        x: Math.random() * gameData.current.width,
        y: Math.random() * (gameData.current.height - 100),
        size: Math.random() * 2 + 1,
        speed: Math.random() * 0.5 + 0.1
      })),
      particles: [],
      mines: [],
      sessionCoins: 0,
      aiRunners: gameMode === GameMode.RACE ? aiNames.map((name, i) => ({
        x: gameData.current.playerX + (Math.random() * 20 - 10), 
        y: gameData.current.height - 100,
        vy: 0,
        isJumping: false,
        jumpCount: 0,
        skill: 0.85 + (Math.random() * 0.12),
        personality: Math.random(),
        color: aiColors[i],
        name,
        status: 'running' as const,
        distance: 0
      })) : []
    };
    setScore(0);
    setLives(3);
    setLevel(1);
    setRank(1);
    setMineCount(0);
    setGameState(GameState.PLAYING);
    if ('ontouchstart' in window) {
      setShowTutorial(true);
      setTimeout(() => setShowTutorial(false), 2500);
    }
  };

  const createParticles = (x: number, y: number, color: string, count: number, speedScale = 1) => {
    for (let i = 0; i < count; i++) {
      const size = Math.random() * 4 + 1;
      gameData.current.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 10 * speedScale,
        vy: (Math.random() - 0.5) * 10 * speedScale,
        life: 1.0,
        size,
        color
      });
    }
  };

  const updateGame = (time: number) => {
    const data = gameData.current;
    const now = Date.now();
    
    if (data.shake > 0) data.shake *= 0.9;
    if (data.shake < 0.1) data.shake = 0;

    data.stars.forEach(star => {
      star.x -= star.speed * (data.speed / 2);
      if (star.x < 0) star.x = data.width;
    });

    for (let i = data.particles.length - 1; i >= 0; i--) {
      const p = data.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      if (p.life <= 0) data.particles.splice(i, 1);
    }

    data.playerVelocityY += GRAVITY;
    data.playerY += data.playerVelocityY;
    if (data.playerY >= data.groundY - data.playerSize) {
      if (data.isJumping) createParticles(data.playerX + data.playerSize / 2, data.groundY, '#f472b6', 5);
      data.playerY = data.groundY - data.playerSize;
      data.playerVelocityY = 0;
      data.isJumping = false;
      data.jumpCount = 0;
    }

    data.aiRunners.forEach(ai => {
      if (ai.status !== 'running') return;

      ai.vy += GRAVITY;
      ai.y += ai.vy;
      if (ai.y >= data.groundY - data.playerSize) {
        ai.y = data.groundY - data.playerSize;
        ai.vy = 0;
        ai.isJumping = false;
        ai.jumpCount = 0;
      }

      const idealDist = data.distance + (ai.skill * 15) - 50; 
      const lag = idealDist - ai.distance;
      const adaptiveSpeed = data.speed * (0.97 + (ai.skill * 0.1) + (ai.personality * 0.05)) + (lag * 0.015);
      
      ai.distance += adaptiveSpeed;

      const visionRange = 200 + (ai.personality * 150);
      const nextObs = data.obstacles.find(o => o.x > ai.x && o.x < ai.x + visionRange && o.type === 'spike');
      
      if (nextObs && !ai.isJumping) {
        const jumpReactionDist = 100 + (ai.personality * 60);
        if (nextObs.x - ai.x < jumpReactionDist && Math.random() < 0.99) {
          ai.vy = JUMP_FORCE;
          ai.isJumping = true;
          ai.jumpCount = 1;
        }
      }

      data.obstacles.forEach(obs => {
        if (obs.type === 'spike' && 
            ai.x < obs.x + obs.width && ai.x + data.playerSize > obs.x &&
            ai.y + data.playerSize > data.groundY - obs.height) {
          ai.status = 'failed';
          ai.failTime = Date.now();
          const aiDrawX = data.playerX + (ai.distance - data.distance);
          if (aiDrawX > 0 && aiDrawX < data.width) data.shake = 5;
          createParticles(ai.x + data.playerSize / 2, ai.y + data.playerSize / 2, ai.color, 25);
        }
      });

      for (let i = data.mines.length - 1; i >= 0; i--) {
        const mine = data.mines[i];
        const aiDrawX = data.playerX + (ai.distance - data.distance);
        if (Math.abs(aiDrawX - mine.x) < 20 && ai.y + data.playerSize > data.groundY - 20) {
          ai.status = 'failed';
          ai.failTime = Date.now();
          data.shake = 8;
          createParticles(mine.x, data.groundY, '#c084fc', 30);
          data.mines.splice(i, 1);
        }
      }
    });

    if (gameMode === GameMode.RACE) {
      const runners = [
        { name: 'YOU', distance: data.distance, status: 'running' as const },
        ...data.aiRunners.map(a => ({ name: a.name, distance: a.distance, status: a.status }))
      ];
      runners.sort((a, b) => b.distance - a.distance);
      const myPos = runners.findIndex(r => r.name === 'YOU') + 1;
      setRank(myPos);

      if (data.distance >= RACE_DISTANCE) {
        setGameState(GameState.VICTORY);
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        return;
      }
    }

    if (time - data.lastSpawnTime > data.nextSpawnInterval) {
      const rand = Math.random();
      let type: Obstacle['type'] = 'spike';
      if (rand > 0.96) type = 'boost';
      else if (rand > 0.92) type = 'magnet';
      else if (rand > 0.88) type = 'shield';
      else if (rand > 0.84) type = 'mine';
      else if (rand > 0.65) type = 'coin';

      const isItem = type !== 'spike';
      data.obstacles.push({
        x: data.width,
        width: isItem ? 25 : Math.random() * 30 + 20,
        height: isItem ? 25 : Math.random() * 40 + 30,
        type, id: Date.now()
      });
      data.lastSpawnTime = time;
      const minInterval = Math.max(500, SPAWN_MIN_INTERVAL - (data.speed * 50));
      data.nextSpawnInterval = Math.random() * (SPAWN_MAX_INTERVAL - minInterval) + minInterval;
    }

    if (data.isDashing && now - data.dashStartTime > 400) data.isDashing = false;
    if (data.isNitro && now - data.nitroStartTime > 2000) data.isNitro = false;
    
    const isBoosted = now < data.activePowerUps.boost || data.isNitro;
    const currentSpeed = data.isNitro ? data.speed * 4.0 : (data.isDashing || isBoosted) ? data.speed * 2.5 : data.speed;

    for (let i = data.mines.length - 1; i >= 0; i--) {
      data.mines[i].x -= currentSpeed;
      if (data.mines[i].x < -50) data.mines.splice(i, 1);
    }

    for (let i = data.obstacles.length - 1; i >= 0; i--) {
      const obs = data.obstacles[i];
      if (obs.type === 'coin' && now < data.activePowerUps.magnet) {
        const dx = data.playerX - obs.x;
        if (Math.abs(dx) < 300) obs.x += dx * 0.15;
      }
      obs.x -= currentSpeed;

      if (data.playerX < obs.x + obs.width && data.playerX + data.playerSize > obs.x &&
          data.playerY + data.playerSize > data.groundY - obs.height) {
        if (obs.type === 'spike') {
          if (data.isDashing || isBoosted) continue;
          if (data.activePowerUps.shield) {
            data.activePowerUps.shield = false;
            createParticles(data.playerX + data.playerSize / 2, data.playerY + data.playerSize / 2, '#4ade80', 15);
            data.obstacles.splice(i, 1);
            continue;
          }

          data.shake = 15;
          if (navigator.vibrate) navigator.vibrate(50);
          createParticles(data.playerX + data.playerSize / 2, data.playerY + data.playerSize / 2, '#fbbf24', 20);
          setLives(prev => {
            const newLives = prev - 1;
            if (newLives <= 0) {
              gameOver();
            }
            return newLives;
          });
          
          data.obstacles.splice(i, 1);
          continue;
        } else {
          const colors: Record<string, string> = { coin: '#22d3ee', shield: '#4ade80', boost: '#f87171', magnet: '#818cf8' };
          createParticles(obs.x + obs.width / 2, data.groundY - obs.height / 2, colors[obs.type] || '#fff', 12);
          if (obs.type === 'coin') {
            const newCombo = now - data.lastComboTime < 1000 ? combo + 1 : 1;
            setCombo(newCombo);
            data.lastComboTime = now;
            setScore(prev => prev + (5 * newCombo));
            data.sessionCoins += 1;
            setWallet(prev => prev + 1);
          } else if (obs.type === 'shield') data.activePowerUps.shield = true;
          else if (obs.type === 'boost') data.activePowerUps.boost = now + 3000;
          else if (obs.type === 'magnet') data.activePowerUps.magnet = now + 5000;
          else if (obs.type === 'mine') setMineCount(prev => prev + 3);
          data.obstacles.splice(i, 1);
          continue;
        }
      }
      if (obs.x + obs.width < 0) {
        data.obstacles.splice(i, 1);
        setScore(prev => prev + 1);
      }
    }

    data.speed += SPEED_INCREMENT;
    data.distance += data.speed;
    const newLevel = Math.floor(score / 50) + 1;
    if (newLevel > level) {
      setLevel(newLevel);
      data.speed += 0.5;
      data.shake = 10;
      createParticles(data.playerX, data.playerY, '#ffffff', 30, 1.5);
    }
    if (now - data.lastComboTime > 1500 && combo > 0) setCombo(0);

    draw();
    requestRef.current = requestAnimationFrame(updateGame);
  };

  const gameOver = () => {
    setGameState(GameState.GAME_OVER);
    sounds.playGameOver();
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = gameData.current;

    ctx.clearRect(0, 0, data.width, data.height);

    ctx.save();
    if (data.shake > 0) {
      const sx = (Math.random() - 0.5) * data.shake;
      const sy = (Math.random() - 0.5) * data.shake;
      ctx.translate(sx, sy);
    }

    const gradient = ctx.createRadialGradient(data.width / 2, data.height / 2, 0, data.width / 2, data.height / 2, data.width);
    gradient.addColorStop(0, '#09090b');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, data.width, data.height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    const isHighSpeed = data.isNitro || Date.now() < data.activePowerUps.boost;
    data.stars.forEach(star => {
      if (isHighSpeed) {
        ctx.lineWidth = star.size;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.moveTo(star.x, star.y);
        ctx.lineTo(star.x + 20, star.y);
        ctx.stroke();
      } else {
        ctx.fillRect(star.x, star.y, star.size, star.size);
      }
    });

    if (data.isNitro) {
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 20; i++) {
        const y = (Math.sin(Date.now() * 0.01 + i) * 0.5 + 0.5) * data.height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(data.width, y);
        ctx.stroke();
      }
    }

    data.particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#22d3ee';
    
    ctx.moveTo(0, data.groundY);
    ctx.lineTo(data.width, data.groundY);
    ctx.stroke();
    
    const gridSpacing = 40;
    const offset = (data.distance * 1.5) % gridSpacing;
    
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.2)';
    for (let x = -offset; x < data.width; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, data.groundY);
      ctx.lineTo(x - 50, data.height);
      ctx.stroke();
    }
    
    for (let y = data.groundY; y < data.height; y += 15) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(data.width, y);
      ctx.stroke();
    }
    ctx.restore();

    const drawCat = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, velocityY: number, color: string) => {
      ctx.save();
      ctx.translate(x + size / 2, y + size / 2);
      
      const rotation = (velocityY * 0.05);
      ctx.rotate(rotation);
      
      ctx.fillStyle = color;
      ctx.shadowBlur = 20;
      ctx.shadowColor = color;

      ctx.fillRect(-size / 2, -size / 4, size, size / 2);
      
      ctx.fillRect(size / 4, -size / 2, size / 3, size / 3);
      
      ctx.beginPath();
      ctx.moveTo(size / 4, -size / 2);
      ctx.lineTo(size/4 + 5, -size/2 - 10);
      ctx.lineTo(size/4 + 10, -size/2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.moveTo(size / 2, -size / 2);
      ctx.lineTo(size/2 - 5, -size/2 - 10);
      ctx.lineTo(size/2 - 10, -size/2);
      ctx.fill();

      const tailWag = Math.sin(Date.now() / 150) * 10;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.moveTo(-size / 2, 0);
      ctx.quadraticCurveTo(-size - 5, -10 + tailWag, -size - 10, tailWag);
      ctx.stroke();

      ctx.fillStyle = '#000';
      ctx.shadowBlur = 0;
      ctx.fillRect(size/4 + 8, -size/2 + 5, 3, 3);

      ctx.restore();
    };

    const drawSpike = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string) => {
      ctx.fillStyle = color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + width / 2, y - height);
      ctx.lineTo(x + width, y);
      ctx.closePath();
      ctx.fill();
      
      ctx.shadowBlur = 0;
    };

    const drawCoin = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) => {
      ctx.fillStyle = color;
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      
      const pulse = Math.sin(Date.now() / 100) * 2;
      ctx.beginPath();
      ctx.arc(x + size/2, y - size/2, (size/2) + pulse, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + size/2, y - size/2, (size/4), 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;
    };

    data.mines.forEach((mine) => {
      ctx.fillStyle = '#c084fc';
      ctx.beginPath();
      ctx.arc(mine.x, data.groundY - 5, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#c084fc';
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    data.aiRunners.forEach(ai => {
      const drawX = data.playerX + (ai.distance - data.distance);
      if (drawX > -150 && drawX < data.width + 150) {
        if (ai.status === 'running') {
          ctx.globalAlpha = 0.6;
          drawCat(ctx, drawX, ai.y, data.playerSize, ai.vy, ai.color);
          ctx.globalAlpha = 1.0;
        } else if (ai.failTime && Date.now() - ai.failTime < 800) {
          const elapsed = Date.now() - ai.failTime;
          const progress = elapsed / 800;
          
          ctx.save();
          ctx.globalAlpha = 1 - progress;
          
          const glitchX = (Math.random() - 0.5) * 10;
          const glitchY = (Math.random() - 0.5) * 10;
          
          ctx.translate(drawX + data.playerSize / 2, ai.y + data.playerSize / 2);
          ctx.rotate(progress * Math.PI * 4);
          
          drawCat(ctx, -data.playerSize / 2 + glitchX, -data.playerSize / 2 + glitchY, data.playerSize, ai.vy, '#ffffff');
          
          ctx.restore();
          ctx.font = 'bold 12px "Space Grotesk"';
          ctx.fillStyle = ai.color;
          ctx.textAlign = 'center';
          ctx.fillText('CRASHED', drawX + data.playerSize / 2, ai.y - 20 - (progress * 50));
          ctx.globalAlpha = 1.0;
        }
      }
    });

    if (data.isDashing || data.isNitro || Date.now() < data.activePowerUps.boost) {
      ctx.globalAlpha = 0.3;
      const trailCount = data.isNitro ? 5 : 2;
      for (let i = 1; i <= trailCount; i++) {
        drawCat(ctx, data.playerX - (i * 20), data.playerY, data.playerSize, data.playerVelocityY, currentSkin);
      }
      ctx.globalAlpha = 1.0;
    }

    if (data.activePowerUps.shield) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(data.playerX + data.playerSize/2, data.playerY + data.playerSize/2, data.playerSize * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (Date.now() < data.activePowerUps.magnet) {
      ctx.strokeStyle = '#818cf8';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(data.playerX + data.playerSize/2, data.playerY + data.playerSize/2, 100, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    ctx.globalAlpha = 0.2;
    drawCat(ctx, data.playerX - 5, data.playerY, data.playerSize, data.playerVelocityY, currentSkin);
    ctx.globalAlpha = 1.0;

    drawCat(ctx, data.playerX, data.playerY, data.playerSize, data.playerVelocityY, currentSkin);

    data.obstacles.forEach((obs) => {
      if (obs.type === 'spike') {
        drawSpike(ctx, obs.x, data.groundY, obs.width, obs.height, '#fbbf24');
      } else if (obs.type === 'coin') {
        drawCoin(ctx, obs.x, data.groundY, obs.width, '#22d3ee');
      } else {
        const colors: Record<string, string> = { shield: '#4ade80', boost: '#f87171', magnet: '#818cf8', mine: '#c084fc' };
        ctx.fillStyle = colors[obs.type];
        ctx.shadowBlur = 15;
        ctx.shadowColor = colors[obs.type];
        ctx.fillRect(obs.x, data.groundY - obs.height, obs.width, obs.height);
        ctx.shadowBlur = 0;
      }
    });

    ctx.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const portrait = window.innerHeight > window.innerWidth;
      setIsPortrait(portrait);

      canvas.width = window.innerWidth;
      canvas.height = portrait ? Math.min(window.innerHeight, 400) : Math.min(window.innerHeight, 500); 
      gameData.current.width = canvas.width;
      gameData.current.height = canvas.height;
      gameData.current.groundY = canvas.height - 60;
      gameData.current.playerY = gameData.current.groundY - gameData.current.playerSize;
      draw();
    };

    window.addEventListener('resize', resize);
    resize();

    if (gameState === GameState.PLAYING) {
      requestRef.current = requestAnimationFrame(updateGame);
    }

    return () => {
      window.removeEventListener('resize', resize);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState]);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      try { localStorage.setItem('neon-runner-highscore', score.toString()); } catch {}
    }
  }, [score, highScore]);

  const lastTapRef = useRef<number>(0);
  const lastClickRef = useRef<number>(0);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    sounds.init();

    if (e.button !== undefined && e.button !== 0) return;
    
    const now = Date.now();
    const isTouch = e.pointerType === 'touch';
    const GAP = now - (isTouch ? lastTapRef.current : lastClickRef.current);
    
    if (isTouch) {
      if (e.clientX > window.innerWidth / 2) {
        handleDash();
      } else {
        handleInput();
      }
    } else {
      if (GAP < 300 && GAP > 0) {
        handleDash();
      } else {
        handleInput();
      }
    }

    if (isTouch) {
      lastTapRef.current = now;
    } else {
      lastClickRef.current = now;
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div 
      className="relative w-full h-screen flex flex-col items-center justify-center bg-zinc-950 font-sans overflow-hidden touch-none"
      onPointerDown={handlePointerDown}
    >
      <div className="absolute inset-0 opacity-50 pointer-events-none" />

      {isPortrait && gameState === GameState.PLAYING && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-6 text-center sm:hidden">
          <RotateCcw className="w-16 h-16 text-cyan-400 mb-4" />
          <h2 className="text-white text-2xl font-display font-bold mb-2">ROTATE DEVICE</h2>
          <p className="text-zinc-400 text-sm">Please rotate for a better digital experience.</p>
        </div>
      )}
      
      <div className="relative w-full max-w-4xl h-[400px] md:h-[500px]">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          id="game-canvas"
        />

        {gameState === GameState.PLAYING && (
          <>
            <button
              onPointerDown={(e) => {
                e.stopPropagation();
                togglePause();
              }}
              className="absolute top-6 left-6 sm:top-6 sm:left-6 p-4 sm:p-3 bg-white/5 border border-white/10 rounded-full text-white hover:bg-white/10 transition-all z-20 shadow-xl active:scale-90"
              title="Pause"
            >
              <div className="flex gap-1">
                <div className="w-2 h-5 sm:w-1.5 sm:h-4 bg-white rounded-full" />
                <div className="w-2 h-5 sm:w-1.5 sm:h-4 bg-white rounded-full" />
              </div>
            </button>

            <div className="absolute top-7 left-24 sm:top-6 sm:left-20 flex flex-col gap-0 sm:gap-1 pointer-events-none">
              <span className="text-zinc-500 text-xs font-display tracking-widest uppercase">Score</span>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-display font-bold text-white neon-glow">{score}</span>
                {combo > 1 && (
                  <motion.span 
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    key={combo}
                    className="text-cyan-400 font-display font-bold italic"
                  >
                    x{combo}
                  </motion.span>
                )}
              </div>
            </div>
            <div className="absolute top-7 right-6 sm:top-6 sm:right-6 text-right pointer-events-none flex flex-col items-end">
              <span className="text-zinc-500 text-xs font-display tracking-widest uppercase">
                {gameMode === GameMode.RACE ? 'Position' : 'Sector'}
              </span>
              <div className="text-2xl font-display font-bold text-white tracking-widest">
                {gameMode === GameMode.RACE ? (
                  <span className={rank === 1 ? 'text-cyan-400' : 'text-white'}>
                    {rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`}
                  </span>
                ) : level}
              </div>
            </div>

            {gameMode === GameMode.RACE && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-64 h-1 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-cyan-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, (gameData.current.distance / RACE_DISTANCE) * 100)}%` }}
                />
              </div>
            )}

            <AnimatePresence>
              {showTutorial && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex pointer-events-none z-50 pt-20"
                >
                  <div className="w-1/2 h-full flex flex-col items-center justify-center bg-cyan-500/10 border-r border-white/5">
                    <motion.div
                      animate={{ y: [0, -20, 0] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="flex flex-col items-center gap-4"
                    >
                      <div className="w-16 h-16 rounded-full border-4 border-cyan-400 flex items-center justify-center">
                        <Play className="w-8 h-8 text-cyan-400 -rotate-90" />
                      </div>
                      <span className="text-cyan-400 font-display font-bold uppercase tracking-[0.2em] text-sm">TAP TO JUMP</span>
                    </motion.div>
                  </div>
                  <div className="w-1/2 h-full flex flex-col items-center justify-center bg-pink-500/10">
                    <motion.div
                      animate={{ y: [0, -20, 0] }}
                      transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                      className="flex flex-col items-center gap-4"
                    >
                      <div className="w-16 h-16 rounded-full border-4 border-pink-400 flex items-center justify-center">
                        <Play className="w-8 h-8 text-pink-400" />
                      </div>
                      <span className="text-pink-400 font-display font-bold uppercase tracking-[0.2em] text-sm">TAP TO DASH</span>
                    </motion.div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="absolute inset-0 flex pointer-events-none sm:hidden">
              <div className="w-1/2 h-full" />
              <div className="w-1/2 h-full" />
            </div>

            <div className="absolute inset-0 flex pointer-events-none sm:hidden px-4 select-none">
              <div className="w-1/2 h-full flex items-end justify-center pb-24">
                <span className="text-[8px] text-white/5 font-display font-bold uppercase tracking-widest border border-white/5 px-2 py-0.5 rounded-full">JUMP ZONE</span>
              </div>
              <div className="w-1/2 h-full flex items-end justify-center pb-24">
                <span className="text-[8px] text-white/5 font-display font-bold uppercase tracking-widest border border-white/5 px-2 py-0.5 rounded-full">DASH ZONE</span>
              </div>
            </div>

            <div className="absolute bottom-6 right-6 flex items-center gap-4">
              <div className="flex flex-col items-center gap-1">
                <button
                  onPointerDown={(e) => { e.stopPropagation(); handleNitro(); }}
                  className="w-16 h-16 sm:w-14 sm:h-14 rounded-full flex items-center justify-center font-display font-bold text-[10px] transition-all shadow-lg active:scale-95 bg-cyan-500 text-zinc-950 animate-pulse"
                >
                  NITRO
                </button>
              </div>

              <div className="flex flex-col items-center gap-1">
                <button
                  onPointerDown={(e) => { e.stopPropagation(); handleDropTrap(); }}
                  className={`w-16 h-16 sm:w-14 sm:h-14 rounded-full flex items-center justify-center font-display font-bold text-[10px] transition-all shadow-lg active:scale-95 ${
                    mineCount > 0 
                    ? 'bg-purple-500 text-white' 
                    : 'bg-zinc-800 text-zinc-600 border border-white/5'
                  }`}
                >
                  {mineCount > 0 ? `TRAP (${mineCount})` : 'EMPTY'}
                </button>
              </div>
            </div>

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3 pointer-events-none">
              {Array.from({ length: 3 }).map((_, i) => (
                <div 
                  key={i}
                  className={`w-10 h-2 sm:w-12 sm:h-2 rounded-full border transition-all duration-300 ${i < lives ? 'bg-pink-500 border-pink-400' : 'bg-transparent border-white/20'}`}
                />
              ))}
            </div>
          </>
        )}

        <AnimatePresence>
          {gameState === GameState.START && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-zinc-950/80 backdrop-blur-sm z-10"
              id="start-screen"
            >
              <div className="flex items-center gap-3 mb-2 text-cyan-400">
                <Cpu className="w-8 h-8 animate-pulse" />
                <h1 className="text-5xl font-display font-bold text-white tracking-tight uppercase">
                  Neon <span className="text-cyan-400">Runner</span>
                </h1>
              </div>
              <div className="flex gap-4 mb-10 bg-white/5 p-1 rounded-full border border-white/10">
                <button 
                  onPointerDown={(e) => { e.stopPropagation(); setGameMode(GameMode.SOLO); }}
                  className={`px-6 py-2 rounded-full font-display text-sm transition-all ${gameMode === GameMode.SOLO ? 'bg-white text-zinc-950 font-bold' : 'text-zinc-500 hover:text-white'}`}
                >
                  SOLO
                </button>
                <button 
                  onPointerDown={(e) => { e.stopPropagation(); setGameMode(GameMode.RACE); }}
                  className={`px-6 py-2 rounded-full font-display text-sm transition-all ${gameMode === GameMode.RACE ? 'bg-white text-zinc-950 font-bold' : 'text-zinc-500 hover:text-white'}`}
                >
                  RIVAL RACE
                </button>
              </div>

              <div className="flex flex-wrap justify-center gap-3 w-full max-w-md px-4">
                <button
                  onPointerDown={(e) => { e.stopPropagation(); startGame(); }}
                  id="btn-play"
                  className="group relative w-full px-12 py-5 sm:py-6 bg-cyan-500 rounded-full font-display font-bold text-zinc-950 hover:bg-cyan-400 transition-all active:scale-95 flex items-center justify-center gap-3 overflow-hidden shadow-[0_0_30px_rgba(34,211,238,0.3)]"
                >
                  <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500" />
                  <Play className="w-6 h-6 fill-current" />
                  <span className="text-lg tracking-widest">START MISSION</span>
                </button>
                
                <div className="grid grid-cols-3 gap-3 w-full">
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); setIsShopOpen(true); }}
                    className="col-span-2 px-6 py-4 bg-zinc-900 border border-white/5 text-white rounded-2xl hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 font-display font-bold uppercase tracking-wider"
                  >
                    <Trophy className="w-5 h-5 text-cyan-400" />
                    <span>Shop</span>
                  </button>
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); setIsSettingsOpen(true); }}
                    className="px-6 py-4 bg-zinc-900 border border-white/5 text-white rounded-2xl hover:bg-zinc-800 transition-all flex items-center justify-center"
                  >
                    <Settings className="w-5 h-5 text-zinc-400" />
                  </button>
                </div>

                <button
                  onPointerDown={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                  className="w-full py-3 text-zinc-600 font-display text-[10px] uppercase tracking-[0.3em] flex flex-col items-center justify-center gap-2 active:text-white"
                >
                  <div className="flex items-center gap-2">
                    <Maximize2 className="w-3 h-3" />
                    Toggle Fullscreen
                  </div>
                </button>
              </div>

              <div className="mt-8 flex items-center gap-6">
                {wallet > 0 && (
                  <div className="flex items-center gap-2 bg-cyan-500/10 px-4 py-2 rounded-full border border-cyan-500/20">
                    <div className="w-4 h-4 rounded-full bg-cyan-400" />
                    <span className="text-sm font-display font-bold text-cyan-400">{wallet}</span>
                  </div>
                )}
                {highScore > 0 && (
                  <div className="flex items-center gap-2 text-zinc-500">
                    <Trophy className="w-4 h-4" />
                    <span className="text-sm font-display tracking-tighter uppercase">BEST: {highScore}</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {gameState === GameState.PAUSED && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-black/80 backdrop-blur-sm z-40"
            >
              <h2 className="text-white text-4xl font-display font-bold mb-8 neon-glow">PAUSED</h2>
              <div className="flex flex-col gap-4 w-full max-w-xs px-6">
                <button
                  onPointerDown={(e) => { e.stopPropagation(); togglePause(); }}
                  className="w-full py-5 sm:py-4 bg-cyan-500 text-zinc-950 rounded-full font-display font-bold hover:bg-cyan-400 transition-all active:scale-95 flex items-center justify-center gap-3 shadow-lg"
                >
                  <Play className="w-5 h-5 fill-current" />
                  RESUME MISSION
                </button>
                <button
                  onPointerDown={(e) => { e.stopPropagation(); setIsSettingsOpen(true); }}
                  className="w-full py-5 sm:py-4 bg-zinc-900 border border-white/5 text-white rounded-full font-display font-bold hover:bg-zinc-800 transition-all active:scale-95 flex items-center justify-center gap-3"
                >
                  <Settings className="w-5 h-5 text-zinc-400" />
                  SETTINGS
                </button>
                <button
                  onPointerDown={(e) => { e.stopPropagation(); setGameState(GameState.START); }}
                  className="w-full py-5 sm:py-4 bg-transparent text-zinc-500 font-display font-bold hover:text-white transition-all active:scale-95 uppercase tracking-widest text-xs"
                >
                  Return to Base
                </button>
              </div>
            </motion.div>
          )}

          {isSettingsOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-black/95 backdrop-blur-md z-[60]"
            >
              <div className="w-full max-w-sm">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-white text-3xl font-display font-bold">SETTINGS</h2>
                  <button 
                    onPointerDown={(e) => { e.stopPropagation(); setIsSettingsOpen(false); }}
                    className="p-3 text-zinc-400 hover:text-white transition-all bg-white/5 rounded-full active:scale-90"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-zinc-300 pointer-events-none">
                      <Music className="w-5 h-5" />
                      <span className="font-display font-medium">BGM MUSIC</span>
                    </div>
                    <button
                      onPointerDown={(e) => { e.stopPropagation(); setIsMusicOn(!isMusicOn); }}
                      className={`w-14 h-8 rounded-full transition-all relative ${isMusicOn ? 'bg-cyan-500' : 'bg-zinc-800'}`}
                    >
                      <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${isMusicOn ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-zinc-300">
                      <div className="flex items-center gap-3">
                        <Volume2 className="w-5 h-5" />
                        <span className="font-display font-medium">SFX VOLUME</span>
                      </div>
                      <span className="text-sm font-mono">{Math.round(volume * 100)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.01" value={volume}
                      onChange={(e) => setVolume(parseFloat(e.target.value))}
                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-zinc-300">
                      <Keyboard className="w-5 h-5" />
                      <span className="font-display font-medium">CONTROL SCHEME</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); setControlScheme('classic'); }}
                        className={`py-4 rounded-xl border font-display text-sm transition-all flex flex-col items-center gap-2 active:scale-95 ${controlScheme === 'classic' ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}
                      >
                        <MousePointer2 className="w-4 h-4" />
                        CLASSIC
                      </button>
                      <button
                        onPointerDown={(e) => { e.stopPropagation(); setControlScheme('wasd'); }}
                        className={`py-4 rounded-xl border font-display text-sm transition-all flex flex-col items-center gap-2 active:scale-95 ${controlScheme === 'wasd' ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400' : 'bg-zinc-900 border-white/5 text-zinc-500'}`}
                      >
                        <div className="text-[10px] font-bold">W-A-S-D</div>
                        MODERN
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  onPointerDown={(e) => { e.stopPropagation(); setIsSettingsOpen(false); }}
                  className="w-full mt-10 py-5 bg-white text-zinc-950 rounded-full font-display font-bold hover:bg-zinc-200 transition-all uppercase tracking-widest text-sm shadow-xl active:scale-95"
                >
                  Confirm Settings
                </button>
              </div>
            </motion.div>
          )}

          {isShopOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-black/95 backdrop-blur-md z-[70]"
            >
              <div className="w-full max-w-lg">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-white text-3xl font-display font-bold uppercase tracking-tight">NEON SHOP</h2>
                  <button 
                    onPointerDown={(e) => { e.stopPropagation(); setIsShopOpen(false); }}
                    className="p-3 text-zinc-400 hover:text-white transition-all bg-white/5 rounded-full active:scale-90"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-8 bg-cyan-500/10 px-3 py-1.5 rounded-full w-fit border border-cyan-500/20">
                  <div className="w-4 h-4 rounded-full bg-cyan-400" />
                  <span className="text-sm font-display font-bold text-cyan-400">{wallet} COINS</span>
                </div>
                <div className="grid grid-cols-1 gap-3 max-h-[40vh] sm:max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                  {SKINS.map((skin) => {
                    const isPurchased = purchasedSkins.includes(skin.color);
                    const isSelected = currentSkin === skin.color;
                    const canAfford = wallet >= skin.cost;
                    return (
                      <div 
                        key={skin.name}
                        className={`p-4 sm:p-5 rounded-2xl border transition-all flex items-center gap-4 ${isSelected ? 'bg-white/10 border-cyan-500/50' : 'bg-white/5 border-white/5'}`}
                      >
                        <div 
                          className="w-14 h-14 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center border-2 border-white/10 shrink-0"
                          style={{ backgroundColor: skin.color, boxShadow: `0 0 15px ${skin.color}44` }}
                        >
                          <div className="w-8 h-4 sm:w-6 sm:h-3 bg-black/40 rounded-sm" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-display font-bold text-base sm:text-lg truncate">{skin.name}</h3>
                          <p className="text-zinc-500 text-[10px] sm:text-xs truncate">{skin.description}</p>
                        </div>
                        {isPurchased ? (
                          <button
                            onPointerDown={(e) => { e.stopPropagation(); setCurrentSkin(skin.color); }}
                            disabled={isSelected}
                            className={`px-5 py-3 sm:px-6 sm:py-2 rounded-full font-display font-bold text-xs transition-all active:scale-95 ${isSelected ? 'bg-zinc-800 text-zinc-500' : 'bg-cyan-500 text-zinc-950 hover:bg-cyan-400'}`}
                          >
                            {isSelected ? 'ACTIVE' : 'EQUIP'}
                          </button>
                        ) : (
                          <button
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              if (canAfford) {
                                setWallet(prev => prev - skin.cost);
                                setPurchasedSkins(prev => [...prev, skin.color]);
                                setCurrentSkin(skin.color);
                              }
                            }}
                            disabled={!canAfford}
                            className={`px-5 py-3 sm:px-6 sm:py-2 rounded-full font-display font-bold text-xs transition-all active:scale-95 flex items-center gap-2 ${canAfford ? 'bg-cyan-500 text-zinc-950 hover:bg-cyan-400' : 'bg-zinc-800 text-zinc-500'}`}
                          >
                            {skin.cost}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  onPointerDown={(e) => { e.stopPropagation(); setIsShopOpen(false); }}
                  className="w-full mt-8 py-5 bg-white text-zinc-950 rounded-full font-display font-bold hover:bg-zinc-200 transition-all uppercase tracking-widest text-sm shadow-xl active:scale-95"
                >
                  Return to Base
                </button>
              </div>
            </motion.div>
          )}

          {gameState === GameState.VICTORY && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-zinc-950/90 backdrop-blur-md z-30"
              id="victory-screen"
            >
              <div className="text-cyan-400 mb-4">
                <Trophy className="w-16 h-16 sm:w-20 sm:h-20 animate-bounce" />
              </div>
              <h2 className="text-white text-4xl sm:text-5xl font-display font-bold mb-2 neon-glow tracking-tighter uppercase">MISSION COMPLETE</h2>
              <p className="text-zinc-500 font-display mb-8 tracking-[0.2em] uppercase text-[10px] sm:text-xs text-center">
                YOU FINISHED IN <span className="text-cyan-400">{rank === 1 ? '1ST PLACE' : `${rank}TH PLACE`}</span>
              </p>
              <div className="flex flex-col items-center gap-1 mb-10 bg-white/5 p-8 rounded-[32px] border border-white/10 min-w-[280px]">
                <span className="text-zinc-500 text-[10px] uppercase tracking-widest mb-2 font-bold text-center">Score Harvested</span>
                <span className="text-6xl font-display font-bold text-white mb-6 neon-glow">{score}</span>
                <div className="flex items-center gap-3 bg-cyan-500/10 px-8 py-3 rounded-2xl border border-cyan-500/30">
                  <div className="w-5 h-5 rounded-full bg-cyan-400" />
                  <span className="text-2xl font-display font-bold text-cyan-400">+{gameData.current.sessionCoins}</span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs sm:max-w-none justify-center px-6 sm:px-0">
                <button
                  onPointerDown={(e) => { e.stopPropagation(); startGame(); }}
                  className="flex-1 px-12 py-5 sm:py-4 bg-cyan-500 text-zinc-950 rounded-full font-display font-bold hover:bg-cyan-400 transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  <RotateCcw className="w-5 h-5" />
                  <span>PLAY AGAIN</span>
                </button>
                <button
                  onPointerDown={(e) => { e.stopPropagation(); setGameState(GameState.START); }}
                  className="px-10 py-5 sm:py-4 bg-zinc-900 text-zinc-500 border border-white/5 rounded-full font-display font-bold hover:text-white transition-all text-xs active:scale-95"
                >
                  RETURN TO BASE
                </button>
              </div>
            </motion.div>
          )}

          {gameState === GameState.GAME_OVER && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", damping: 15 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-zinc-950/95 backdrop-blur-xl z-20"
              id="game-over-screen"
            >
              <motion.h2 
                animate={{ opacity: [1, 0.2, 1, 0.8, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="text-pink-500 text-5xl sm:text-7xl font-display font-bold mb-2 neon-glow uppercase tracking-tighter text-center"
              >
                GAME OVER
              </motion.h2>
              <p className="text-zinc-500 font-display mb-10 tracking-[0.4em] text-[10px] sm:text-xs">SYSTEM RECOVERY INITIATED</p>
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-white/5 p-8 sm:p-10 rounded-[32px] border border-white/10 flex flex-col items-center mb-10 min-w-[280px] shadow-2xl"
              >
                <span className="text-zinc-500 text-[10px] uppercase tracking-widest mb-2 font-bold text-center">Final Data Points</span>
                <div className="text-7xl font-display font-bold text-white mb-6 neon-glow">{score}</div>
                <div className="flex items-center gap-3 bg-cyan-500/10 px-8 py-3 rounded-2xl border border-cyan-500/30">
                  <div className="w-5 h-5 rounded-full bg-cyan-400" />
                  <span className="text-2xl font-display font-bold text-cyan-400">+{gameData.current.sessionCoins}</span>
                </div>
              </motion.div>
              <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs sm:max-w-none justify-center px-6 sm:px-0">
                <button
                  onPointerDown={(e) => { e.stopPropagation(); startGame(); }}
                  className="flex-1 px-10 py-5 sm:py-4 bg-white text-zinc-950 rounded-full font-display font-bold hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 text-lg sm:text-base active:scale-95 shadow-xl"
                >
                  <RotateCcw className="w-5 h-5" />
                  REPLAY
                </button>
                <button
                  onPointerDown={(e) => { e.stopPropagation(); setGameState(GameState.START); }}
                  className="px-10 py-5 sm:py-4 bg-zinc-900 text-zinc-500 border border-white/5 rounded-full font-display font-bold hover:text-white transition-all text-xs active:scale-95"
                >
                  ABORT
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-6 md:hidden flex items-center gap-6 px-8 py-4 bg-white/5 rounded-2xl border border-white/5 opacity-40">
        <div className="flex flex-col items-center gap-1">
          <div className="w-8 h-8 rounded-lg border border-cyan-500/30 flex items-center justify-center font-display text-[10px] text-cyan-400">LEFT</div>
          <span className="text-[9px] uppercase tracking-widest text-zinc-500">JUMP</span>
        </div>
        <div className="w-px h-8 bg-white/10" />
        <div className="flex flex-col items-center gap-1 text-zinc-500">
          <div className="w-8 h-8 rounded-lg border border-pink-500/30 flex items-center justify-center font-display text-[10px] text-pink-400">RIGHT</div>
          <span className="text-[9px] uppercase tracking-widest text-zinc-500">DASH</span>
        </div>
      </div>
    </div>
  );
}
