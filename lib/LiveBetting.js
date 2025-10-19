// LiveBetting.js
import puppeteer from "puppeteer-core";

export class LiveBetting {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Get all live games based on the configured selectors
  async getLiveGames() {
    const { selectors, base_url } = this.config;

    try {
      // Navigate to the live betting section using the base URL from config
      await this.page.goto(`${base_url}/live`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the live game elements to be visible before scraping
      await this.page.waitForSelector(selectors.live_game, { timeout: 5000 });

      // Scrape live games using the configured selector
      const games = await this.page.evaluate((sel) => {
        return Array.from(document.querySelectorAll(sel)).map(el => ({
          id: el.dataset.gameId,
          teams: el.querySelector('.teams').textContent.trim(),
          score: el.querySelector('.score').textContent.trim()
        }));
      }, selectors.live_game);

      console.log(`Found ${games.length} live games`);
      return games;

    } catch (error) {
      console.error('Failed to retrieve live games:', error.message);
      throw error;
    }
  }

  // Select a specific live event based on the event ID
  async selectLiveEvent(eventId) {
    const { selectors } = this.config;

    try {
      // Wait for the specific live game to be clickable
      await this.page.waitForSelector(`${selectors.live_game}[data-id="${eventId}"]`, { timeout: 5000 });

      // Click on the live event based on the event ID and the selector
      await this.page.click(`${selectors.live_game}[data-id="${eventId}"]`);
      console.log(`Selected live event ${eventId}`);
    } catch (error) {
      console.error(`Failed to select live event ${eventId}:`, error.message);
      throw error;
    }
  }

  // Place an in-play bet for a selected option
  async placeInPlayBet(selection) {
    const { selectors } = this.config;

    try {
      // Wait for the live odds selection to be clickable
      await this.page.waitForSelector(`${selectors.live_odds}[data-selection="${selection}"]`, { timeout: 5000 });
      
      // Click on the live odds selection based on the config
      await this.page.click(`${selectors.live_odds}[data-selection="${selection}"]`);

      // Wait for the place bet button to be visible and clickable
      await this.page.waitForSelector(selectors.place_live_bet_btn, { timeout: 5000 });
      await this.page.click(selectors.place_live_bet_btn);

      console.log(`Placed in-play bet: ${selection}`);
    } catch (error) {
      console.error(`Failed to place in-play bet for ${selection}:`, error.message);
      throw error;
    }
  }

  // Update the live odds for a specific event
  async updateLiveOdds(eventId) {
    const { selectors, base_url } = this.config;

    try {
      // Navigate to the live odds page for the specific event
      await this.page.goto(`${base_url}/live/${eventId}`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the live odds to appear on the page
      await this.page.waitForSelector(selectors.live_odds, { timeout: 5000 });

      // Retrieve the live odds using the configured selector
      const odds = await this.page.evaluate((sel) => {
        return document.querySelector(sel).textContent.trim();
      }, selectors.live_odds);

      console.log(`Updated live odds for event ${eventId}: ${odds}`);
      return odds;

    } catch (error) {
      console.error(`Failed to update live odds for event ${eventId}:`, error.message);
      throw error;
    }
  }
}

