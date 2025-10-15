// lib/ClusterManager.js
import { Cluster } from 'puppeteer-cluster';
import { SportsbookApp } from './SportsbookApp.js';
import logger from './logger.js';

let clusterInstance = null;

export class ClusterManager {
  static async initCluster() {
    if (!clusterInstance) {
      const browserPath = process.env.BROWSER_PATH || '/usr/bin/chromium';
      try {
        clusterInstance = await Cluster.launch({
          concurrency: Cluster.CONCURRENCY_CONTEXT,
          maxConcurrency: 2,
          puppeteerOptions: {
            headless: true,
            executablePath: browserPath,
          },
        });
        logger.info(`✅ Puppeteer cluster launched successfully using path: ${browserPath}`);
      } catch (error) {
        logger.error(`❌ Failed to launch Puppeteer cluster: ${error.message}`);
        throw error;
      }
    }
    return clusterInstance;
  }

  static async queueBet({ config, betRequest, nc }) {
    if (!clusterInstance) {
      throw new Error('Cluster not initialized');
    }
    await clusterInstance.queue(async ({ page }) => {
      const sportsbookApp = new SportsbookApp({ page, config, nc });
      await sportsbookApp.launchApp();
      await sportsbookApp.login();
      const result = await sportsbookApp.placeBet(betRequest);
      logger.info(`Processed bet: ${JSON.stringify(result)}`);
    });
  }

  static async closeCluster() {
    if (clusterInstance) {
      await clusterInstance.close().catch(e => logger.warn(`Error closing cluster: ${e.message}`));
      clusterInstance = null;
      logger.info('Puppeteer cluster closed');
    }
  }
}
