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
    if (process.env.CONTROL_PLANE_URL && process.env.CONTROL_API_TOKEN) {
      await runScript('control-plane/scripts/publish-native-inputs.mjs');
    }
    if ((process.env.PV_LIVE_ENDPOINT && process.env.PV_LIVE_TOKEN) || (process.env.GBT_LIVE_ENDPOINT && process.env.GBT_LIVE_TOKEN)) {
      await runScript('live-betting/scripts/publish-wordpress.js');
    }
    if ((process.env.TELEGRAM_PV_BOT_TOKEN && process.env.TELEGRAM_PV_CHAT_ID) || (process.env.TELEGRAM_GBT_BOT_TOKEN && process.env.TELEGRAM_GBT_CHAT_ID)) {
      await runScript('live-betting/scripts/publish-telegram.js');
    }
    console.log(`[live] Cycle completed at ${new Date().toISOString()}.`);
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
