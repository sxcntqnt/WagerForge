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

// Function to launch and return the browser instance
async function launchBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({ headless: true, executablePath: '/usr/bin/chromium' });
    logger.info('Puppeteer browser launched successfully.');
  }
  return browser;
}

// Function to initialize the SportsbookApp
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

// Function to start the NATS listener
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

// Function to clean up and close all resources
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

// Main function to initialize and start the application
async function main() {
  try {
    const repoMonitor = new GitHubRepoMonitor('sxcntqnt', 'L3-M', 'EMC', './EMC');
    const latestConfig = await repoMonitor.getLatestConfigDetails();

    // Find the first valid config from the array
    const validConfig = latestConfig.find(configItem => configItem.config && configItem.config.name);

    // If no valid config was found
    if (!validConfig) {
      throw new Error('No valid config found');
    }

    // Proceed with the valid configuration
    currentConfig = validConfig.config;
    await initSportsbookApp(currentConfig, nc); // Ensure this initializes the app
    await startNATSListener();
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    await cleanup();
  }
}

// Listen for SIGINT and SIGTERM signals to cleanly shut down
if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  main();
}

