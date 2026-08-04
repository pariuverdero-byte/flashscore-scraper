import { spawn } from 'child_process';
import { LIVE_CONFIG } from '../config/live.config.js';

let running = false;
async function tick() {
  if (running) return;
  running = true;
  const child = spawn(process.execPath, ['live-betting/scripts/run-once.js'], { stdio: 'inherit', env: process.env });
  child.on('exit', () => { running = false; });
}

await tick();
setInterval(tick, LIVE_CONFIG.pollSeconds * 1000);
