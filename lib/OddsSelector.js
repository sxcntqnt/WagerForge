// OddsSelector.js
import puppeteer from "puppeteer-core";

export class OddsSelector {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Get the decimal odds for Home, Away, or Draw bet (Moneyline)
  async getHomeOdds(eventId) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to the event page using the base URL and event ID
      await this.page.goto(`${base_url}/events/${eventId}`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the Home odds to be available before clicking
      const selector = selectors.odds_selector.moneyline.replace('{outcome}', 'home');
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      console.log('Selected Home odds');

      // Scrape the decimal odds value from the page
      const odds = await this.page.evaluate((sel) => {
        const oddsElement = document.querySelector(sel);
        return oddsElement ? parseFloat(oddsElement.textContent.trim()) : null;
      }, selector);

      if (!odds) {
        throw new Error('No odds found for Home team.');
      }

      console.log(`Home odds: ${odds}`);
      return odds;

    } catch (error) {
      console.error('Failed to get Home odds:', error.message);
      throw error;
    }
  }

  // Get the decimal odds for Away bet
  async getAwayOdds(eventId) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to the event page
      await this.page.goto(`${base_url}/events/${eventId}`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the Away odds to be available before clicking
      const selector = selectors.odds_selector.moneyline.replace('{outcome}', 'away');
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      console.log('Selected Away odds');

      // Scrape the decimal odds value from the page
      const odds = await this.page.evaluate((sel) => {
        const oddsElement = document.querySelector(sel);
        return oddsElement ? parseFloat(oddsElement.textContent.trim()) : null;
      }, selector);

      if (!odds) {
        throw new Error('No odds found for Away team.');
      }

      console.log(`Away odds: ${odds}`);
      return odds;

    } catch (error) {
      console.error('Failed to get Away odds:', error.message);
      throw error;
    }
  }

  // Get the decimal odds for Draw bet
  async getDrawOdds(eventId) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to the event page
      await this.page.goto(`${base_url}/events/${eventId}`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the Draw odds to be available before clicking
      const selector = selectors.odds_selector.moneyline.replace('{outcome}', 'draw');
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      console.log('Selected Draw odds');

      // Scrape the decimal odds value from the page
      const odds = await this.page.evaluate((sel) => {
        const oddsElement = document.querySelector(sel);
        return oddsElement ? parseFloat(oddsElement.textContent.trim()) : null;
      }, selector);

      if (!odds) {
        throw new Error('No odds found for Draw outcome.');
      }

      console.log(`Draw odds: ${odds}`);
      return odds;

    } catch (error) {
      console.error('Failed to get Draw odds:', error.message);
      throw error;
    }
  }

  // Get the decimal odds for the Spread bet (Home or Away)
  async getSpreadOdds(eventId, side, spread) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to the event page
      await this.page.goto(`${base_url}/events/${eventId}`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the spread odds to be available before clicking
      const selector = selectors.odds_selector.spread.replace('{side}', side).replace('{spread}', spread);
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      console.log(`Selected Spread odds for ${side} at ${spread}`);

      // Extract decimal odds from the page
      const odds = await this.page.evaluate((sel) => {
        const oddsElement = document.querySelector(sel);
        return oddsElement ? parseFloat(oddsElement.textContent.trim()) : null;
      }, selector);

      if (!odds) {
        throw new Error(`No odds found for ${side} at ${spread}.`);
      }

      console.log(`Spread odds for ${side} at ${spread}: ${odds}`);
      return odds;

    } catch (error) {
      console.error(`Failed to get spread odds for ${side} at ${spread}:`, error.message);
      throw error;
    }
  }

  // Get the decimal odds for the Totals (Over/Under) bet
  async getTotalsOdds(eventId, overUnder, value) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to the event page
      await this.page.goto(`${base_url}/events/${eventId}`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the totals odds to be available before clicking
      const selector = selectors.odds_selector.totals.replace('{overUnder}', overUnder).replace('{value}', value);
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      console.log(`Selected Totals odds for ${overUnder} ${value}`);

      // Get the decimal odds from the page
      const odds = await this.page.evaluate((sel) => {
        const oddsElement = document.querySelector(sel);
        return oddsElement ? parseFloat(oddsElement.textContent.trim()) : null;
      }, selector);

      if (!odds) {
        throw new Error(`No odds found for totals bet ${overUnder} ${value}.`);
      }

      console.log(`Totals odds for ${overUnder} ${value}: ${odds}`);
      return odds;

    } catch (error) {
      console.error(`Failed to get totals odds for ${overUnder} ${value}:`, error.message);
      throw error;
    }
  }
}

