// Main script
import puppeteer from 'puppeteer-core';
import { connect, StringCodec } from 'nats';
import { GitHubRepoMonitor } from './GitHubRepoMonitor.js';
import { SportsbookApp } from './SportsbookApp.js';
import logger from './logger.js';

let currentConfig = null;
let sportsbookApp = null;
let browser = null;
let nc = null;
const sc = StringCodec();

async function launchBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({ headless: true });
  }
  return browser;
}

async function initSportsbookApp(config, nc) {
  if (sportsbookApp) {
    logger.info('Closing old sportsbook app browser page...');
    try {
      await sportsbookApp.page.close();
    } catch (e) {
      logger.warn('Error closing old page: ' + e.message);
    }
  }

  browser = await launchBrowser(); // Ensure global browser is set
  const page = await browser.newPage();
  sportsbookApp = new SportsbookApp({ page, config, nc });
  await sportsbookApp.launchApp();
  await sportsbookApp.login(); // Login once during initialization
  logger.info(`SportsbookApp initialized for bookie: ${config.name}`);
}

async function startConfigWatcher(repoMonitor) {
  repoMonitor.on('configChanged', async (newConfig) => {
    logger.info(`Config updated: ${newConfig.name}`);
    currentConfig = newConfig;
    await initSportsbookApp(currentConfig, nc);
  });
}

async function startNATSListener() {
  nc = await connect({ servers: 'nats://localhost:4222' });
  logger.info('Connected to NATS server');

  const sub = nc.subscribe('bets.incoming');
  logger.info('Subscribed to bets.incoming');

  (async () => {
    for await (const msg of sub) {
      try {
        const betRequest = JSON.parse(sc.decode(msg.data));
        logger.info(`Received bet request: ${JSON.stringify(betRequest)}`);

        if (!sportsbookApp) {
          logger.error('SportsbookApp not initialized. Ignoring bet request.');
          continue;
        }

        const result = await sportsbookApp.placeBet(betRequest);
        logger.info(`Bet processed result: ${JSON.stringify(result)}`);
      } catch (err) {
        logger.error(`Failed to process bet request: ${err.message}`);
      }
    }
  })();
}

async function cleanup() {
  logger.info('Shutting down...');
  if (sportsbookApp?.page) {
    await sportsbookApp.page.close().catch(e => logger.warn(`Error closing page: ${e.message}`));
  }
  if (browser) {
    await browser.close().catch(e => logger.warn(`Error closing browser: ${e.message}`));
  }
  if (nc) {
    await nc.close().catch(e => logger.warn(`Error closing NATS: ${e.message}`));
  }
  logger.info('Shutdown complete');
  process.exit(0);
}

async function main() {
  try {
    const repoMonitor = new GitHubRepoMonitor('sxcntqnt', 'L3-M', 'EMC', './EMC');
    const latestConfig = await repoMonitor.getLatestConfigDetails();
    
    if (!latestConfig?.config || !latestConfig.config.name) {
      throw new Error('No valid config found');
    }

    currentConfig = latestConfig.config;
    await connectNATSAndInit();
    await initSportsbookApp(currentConfig, nc);
    await startNATSListener();
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    await cleanup();
  }
}

async function connectNATSAndInit() {
  if (!nc) {
    nc = await connect({ servers: 'nats://localhost:4222' });
    logger.info('NATS connected');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  main();
}

