// executor.js
import puppeteer from 'puppeteer-core';
import { connect, StringCodec } from 'nats';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
import logger from './logger.js';
import { GitHubRepoMonitor } from './GitHubRepoMonitor.js';
import { setExecutor, getExecutor } from './ConfigManager.js'; // ✅ centralized access
import { SportsbookApp } from './SportsbookApp.js';
import { ArbitrageBetting, ValueBetting } from './value.js';

dotenv.config();


const VALID_BET_TYPES = ['moneyline', 'spread', 'totals'];

/**
 * Periodically watches the GitHub repo for updated config.
 */
function startConfigWatcher(repoMonitor, intervalMs = 5 * 60 * 1000) {
  let currentConfigHash = null;

  setInterval(async () => {
    try {
      const latestConfigDetails = await repoMonitor.getLatestConfigDetails();

      if (latestConfigDetails.hash !== currentConfigHash) {
        logger.info(`🔄 Config change detected. Reloading Executor with config from EMC/${latestConfigDetails.folder}`);

        currentConfigHash = latestConfigDetails.hash;

        const newExecutor = new Executor(latestConfigDetails.config);
        await newExecutor.initialize();

        setExecutor(newExecutor);

        logger.info('✅ Executor reloaded successfully');
      } else {
        logger.info(`ℹ️ No config changes. Using config from EMC/${latestConfigDetails.folder}`);
      }
    } catch (error) {
      logger.error(`❌ Error during config reload check: ${error.message}`);
    }
  }, intervalMs);
}

/**
 * Subscribes to NATS and processes betting requests.
 */
async function startNATSListener() {
  try {
    const nc = await connect({ servers: process.env.NATS_SERVERS || "nats://localhost:4222" });
    const sc = StringCodec();
    const betSubject = "bet.place";

    logger.info(`🎧 Listening for bet requests on ${betSubject}`);
    const betSub = nc.subscribe(betSubject);

    for await (const msg of betSub) {
      try {
        const data = JSON.parse(sc.decode(msg.data));

        if (!data.event || !data.event.id) {
          logger.error("❌ Invalid bet request: missing event or event.id");
          msg.respond(sc.encode(JSON.stringify({ success: false, error: "Invalid event data" })));
          continue;
        }

        const bet_type = data.bet_type || "moneyline";

        if (!VALID_BET_TYPES.includes(bet_type)) {
          logger.error(`❌ Invalid bet_type in request: ${bet_type}`);
          msg.respond(sc.encode(JSON.stringify({ success: false, error: `Invalid bet_type '${bet_type}'` })));
          continue;
        }

        const executor = getExecutor();
        if (!executor) {
          throw new Error("Executor not initialized");
        }

        const result = await executor.handleArbOrValueBet(data.event, bet_type);
        msg.respond(sc.encode(JSON.stringify({ success: true, ...result })));

        logger.info(`✅ Bet processed for event ${data.event.id} with bet_type ${bet_type}: ${result.type}`);
      } catch (error) {
        logger.error(`💥 Error processing bet: ${error.message}`);
        msg.respond(sc.encode(JSON.stringify({ success: false, error: error.message })));
      }
    }
  } catch (error) {
    logger.error(`🚨 Failed to start NATS listener: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Entry point
 */
async function main() {
  const repoMonitor = new GitHubRepoMonitor(
    'sxcntqnt',
    'L3-M',
    'EMC',
    './EMC'
  );

  try {
    const latestConfig = await repoMonitor.getLatestConfigDetails();

    if (!latestConfig || !latestConfig.config) {
      throw new Error("❌ No valid configuration found in latest config.");
    }

    const executor = new Executor(latestConfig.config);
    await executor.initialize();

    setExecutor(executor); // store globally
    logger.info(`✅ Executor initialized with config from EMC/${latestConfig.folder}`);

    startConfigWatcher(repoMonitor);
    await startNATSListener();
  } catch (err) {
    logger.error(`💥 Startup failure: ${err.message}`);
    process.exit(1);
  }
}

// If run directly, start app
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

