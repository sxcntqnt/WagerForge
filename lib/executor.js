// executor.js
import dotenv from 'dotenv';
import { GitHubRepoMonitor } from './GitHubRepoMonitor.js';
import { NATSListener } from './NatsListener.js';
import { ClusterManager } from './ClusterManager.js';
import { SportsbookApp } from './SportsbookApp.js';
import { NATSPublisher } from './NatsPublisher.js';
import { NATSBase } from './NatsBase.js';
import logger from './logger.js';
import { SecureBalanceTracker } from './SecureTracker.js';
dotenv.config();

let natsListeners = new Map();

async function main() {
  let tracker; // Declare tracker to make it accessible for cleanup
  try {
    // 1. Load configs
    const repoMonitor = new GitHubRepoMonitor('sxcntqnt', 'L3-M', 'EMC', './EMC');
    const latestConfig = await repoMonitor.getLatestConfigDetails();
    const validConfigs = latestConfig.filter(configItem =>
      configItem.config &&
      configItem.config.name &&
      configItem.config.base_url &&
      configItem.config.selectors
    );
    if (validConfigs.length === 0) {
      throw new Error('No valid Sportsbook configs found in repository');
    }
    logger.info(`Found ${validConfigs.length} valid bookie configurations`);
    // 2. Shared NATS connection
    const base = new NATSBase({}, []);
    await base.connect();
    // 3. Shared publisher
    const publisher = new NATSPublisher({}, []);
    publisher.nc = base.nc;
    // 4. Puppeteer cluster
    const maxConcurrency = Math.min(validConfigs.length, parseInt(process.env.MAX_CONCURRENCY || '4'));
    const cluster = await ClusterManager.initCluster(maxConcurrency);
    logger.info(`Puppeteer cluster initialized with maxConcurrency: ${maxConcurrency}`);
    // 5. Process each bookie
    for (const validConfig of validConfigs) {
      const bookieConfig = {
        ...validConfig.config,
        browser_path: process.env.BROWSER_PATH || validConfig.config.browser_path || '/usr/bin/chromium',
      };
      logger.info(`Loaded configuration for bookie: ${bookieConfig.name}`);
      // NATS Listener – inject publisher
      const natsListener = new NATSListener(bookieConfig, validConfigs, publisher);
      natsListener.nc = base.nc;
      await natsListener.startListeners();
      logger.info(`NATS listener started for ${bookieConfig.name}`);
      natsListeners.set(bookieConfig.name, natsListener);
      // Queue Puppeteer task – inject publisher
      cluster.queue(
        async ({ page }) => {
          const sportsbookApp = new SportsbookApp({
            page,
            config: bookieConfig,
            nc: base.nc,
            publisher, // injected
          });
          try {
            await sportsbookApp.launchApp();
            await page.goto(`${bookieConfig.base_url}/login`, {
              waitUntil: 'networkidle0',
              timeout: 15000,
            });
            await page.waitForSelector(bookieConfig.selectors.login.username_input, {
              visible: true,
              timeout: 10000,
            });
            await sportsbookApp.login();
            logger.info(`Launched and logged into sportsbook for ${bookieConfig.name}`);
          } catch (err) {
            logger.error(`Failed to process sportsbook for ${bookieConfig.name}: ${err.message}`);
            throw err;
          }
        },
        { retryLimit: 2, retryDelay: 1000 }
      );
    }
    await cluster.idle();
    await cluster.close();
    logger.info('All bookies processed concurrently');
    logger.info('Application started successfully, NATS listeners active');

    // Injected code: Initialize SecureBalanceTracker after core setup
    const { privateHex, corePublicB64 } = await loadIdentitiesFromVault();
    tracker = new SecureBalanceTracker(
      process.env.SECUREBUS_URL || "wss://securebus.werikana.com:4223",
      corePublicB64,
      privateHex
    );
    // Example usage:
    // tracker.addBookie("John Sharp", "+254712345678", 500000);
    // tracker.displayAll();
    await tracker.start();
    logger.info('SecureBalanceTracker started successfully');
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    if (tracker) {
      try {
        tracker.shutdown();
      } catch (shutdownErr) {
        logger.error(`Failed to shutdown tracker: ${shutdownErr.message}`);
      }
    }
    await cleanup(natsListeners);
  }
}

async function cleanup(natsListeners = new Map(), tracker) {
  try {
    for (const [bookie, natsListener] of natsListeners) {
      try {
        await natsListener.close();
        logger.info(`Closed NATS listener for ${bookie}`);
      } catch (err) {
        logger.error(`Failed to close NATS listener for ${bookie}: ${err.message}`);
      }
    }
    if (tracker) {
      try {
        tracker.shutdown();
        logger.info('SecureBalanceTracker shutdown completed');
      } catch (err) {
        logger.error(`Failed to shutdown SecureBalanceTracker: ${err.message}`);
      }
    }
    await ClusterManager.closeCluster();
  } catch (err) {
    logger.error(`Cleanup failed: ${err.message}`);
  } finally {
    logger.info('Cleanup completed, exiting process');
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, initiating cleanup...');
    await cleanup(natsListeners, tracker); // Pass tracker to cleanup
  });
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, initiating cleanup...');
    await cleanup(natsListeners, tracker); // Pass tracker to cleanup
  });
  main();
}
