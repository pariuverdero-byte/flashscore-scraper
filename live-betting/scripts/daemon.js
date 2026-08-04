import { spawn } from 'child_process';
import { LIVE_CONFIG } from '../config/live.config.js';

let running = false;

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath],
      {
        stdio: 'inherit',
        env: process.env,
      }
    );

    child.on('error', reject);

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptPath} exited with code ${code}`));
      }
    });
  });
}

async function tick() {
  if (running) {
    console.log('[live] Previous cycle still running, skipping.');
    return;
  }

  running = true;

  try {
    await runScript('live-betting/scripts/run-once.js');
    await runScript('live-betting/scripts/publish-wordpress.js');
  } catch (error) {
    console.error(`[live] Cycle failed: ${error.message}`);
  } finally {
    running = false;
  }
}

await tick();

setInterval(() => {
  tick().catch((error) => {
    console.error(`[live] Unexpected error: ${error.message}`);
  });
}, LIVE_CONFIG.pollSeconds * 1000);
