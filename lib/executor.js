// main.js

import dotenv from 'dotenv';
import { GitHubRepoMonitor } from './GitHubRepoMonitor.js';
import { NATSListener } from './NatsListener.js';
import { ClusterManager } from './ClusterManager.js';
import { SportsbookApp } from './SportsbookApp.js';
import logger from './logger.js';

dotenv.config();

let currentConfig = null;
let natsListener = null;
let sportsbookApp = null;
let natsListeners = new Map(); 

async function main() {
  try {
    // Initialize GitHubRepoMonitor to fetch the latest Sportsbook configuration
    const repoMonitor = new GitHubRepoMonitor('sxcntqnt', 'L3-M', 'EMC', './EMC');
    const latestConfig = await repoMonitor.getLatestConfigDetails();

    // Filter valid configs based on required fields
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

    // Initialize a single Puppeteer cluster with dynamic concurrency
    const maxConcurrency = Math.min(validConfigs.length, parseInt(process.env.MAX_CONCURRENCY || '4')); // Cap at env var or 4
    const cluster = await ClusterManager.initCluster(maxConcurrency);
    logger.info(`Puppeteer cluster initialized with maxConcurrency: ${maxConcurrency}`);

    // Process each valid config concurrently
    for (const validConfig of validConfigs) {
      const bookieConfig = {
        ...validConfig.config,
        browser_path: process.env.BROWSER_PATH || validConfig.config.browser_path || '/usr/bin/chromium',
      };
      logger.info(`Loaded configuration for bookie: ${bookieConfig.name}`);

      // Initialize and start NATS listener for the bookie
      const natsListener = new NATSListener(bookieConfig,validConfigs);
      await natsListener.connect();
      await natsListener.startListeners();
      logger.info(`NATS listener started for ${bookieConfig.name}`);
      natsListeners.set(bookieConfig.name, natsListener);

      // Queue task for each bookie in the cluster with retry logic
      cluster.queue(
        async ({ page }) => {
          const sportsbookApp = new SportsbookApp({
            page,
            config: bookieConfig,
            nc: natsListener.nc,
            validConfigs: validConfigs,
          });
          try {
            await sportsbookApp.launchApp();

            // Wait for the login page to load and ensure the username input is available
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
            throw err; // Re-throw to allow cluster to handle errors
          }
        },
        { retryLimit: 2, retryDelay: 1000 } // Add retry logic for transient failures
      );
    }

    // Wait for all tasks in the cluster to complete
    await cluster.idle(); // Wait for all queued tasks to finish
    await cluster.close(); // Close the cluster after all tasks are done
    logger.info('All bookies processed concurrently');

    // Keep NATS listeners running for bet and OTP processing
    logger.info('Application started successfully, NATS listeners active');
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    await cleanup(natsListeners);
  }
}

// Updated cleanup function to handle NATS listeners and cluster
async function cleanup(natsListeners = new Map()) {
  try {
    // Close all NATS listeners
    for (const [bookie, natsListener] of natsListeners) {
      try {
        await natsListener.close();
        logger.info(`Closed NATS listener for ${bookie}`);
      } catch (err) {
        logger.error(`Failed to close NATS listener for ${bookie}: ${err.message}`);
      }
    }
    // Close the Puppeteer cluster
    await ClusterManager.closeCluster();
  } catch (err) {
    logger.error(`Cleanup failed: ${err.message}`);
  } finally {
    logger.info('Cleanup completed, exiting process');
    process.exit(0);
  }
}

// Handle process termination signals
if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, initiating cleanup...');
    await cleanup(natsListeners);
  });
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, initiating cleanup...');
    await cleanup(natsListeners);
  });
  main();
}



