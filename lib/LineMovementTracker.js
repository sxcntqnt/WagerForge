// LineMovementTracker.js
import puppeteer from "puppeteer-core";

export class LineMovementTracker {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Get odds history for a specific event
  async getOddsHistory(eventId) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to the event history page using the base URL
      await this.page.goto(`${base_url}/events/${eventId}/history`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for history rows to be visible before scraping
      await this.page.waitForSelector(selectors.history_row, { timeout: 5000 });

      // Scrape odds history using the configured selector
      const history = await this.page.evaluate((sel) => {
        return Array.from(document.querySelectorAll(sel)).map(el => ({
          time: el.querySelector('.time')?.textContent.trim() || 'N/A',
          odds: el.querySelector('.odds')?.textContent.trim() || 'N/A'
        }));
      }, selectors.history_row);

      console.log(`Found ${history.length} odds history entries for event ${eventId}`);
      return history;
    } catch (error) {
      console.error(`Failed to retrieve odds history for event ${eventId}:`, error.message);
      throw error;
    }
  }

  // Get the opening line for a specific event
  async getOpeningLine(eventId) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to the event page using the base URL
      await this.page.goto(`${base_url}/events/${eventId}`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the opening line element to be visible
      await this.page.waitForSelector(selectors.opening_line, { timeout: 5000 });

      // Retrieve the opening line using the configured selector
      const opening = await this.page.evaluate((sel) => {
        return document.querySelector(sel)?.textContent.trim() || 'N/A';
      }, selectors.opening_line);

      console.log(`Opening line for event ${eventId}: ${opening}`);
      return opening;
    } catch (error) {
      console.error(`Failed to retrieve opening line for event ${eventId}:`, error.message);
      throw error;
    }
  }

  // Get the current line for a specific event
  async getCurrentLine(eventId) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to the event page using the base URL
      await this.page.goto(`${base_url}/events/${eventId}`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the current line element to be visible
      await this.page.waitForSelector(selectors.current_line, { timeout: 5000 });

      // Retrieve the current line using the configured selector
      const current = await this.page.evaluate((sel) => {
        return document.querySelector(sel)?.textContent.trim() || 'N/A';
      }, selectors.current_line);

      console.log(`Current line for event ${eventId}: ${current}`);
      return current;
    } catch (error) {
      console.error(`Failed to retrieve current line for event ${eventId}:`, error.message);
      throw error;
    }
  }

  // Detect line movement by comparing current and previous lines
  async detectLineMovement(eventId) {
    const { selectors } = this.config;

    try {
      // Get the opening line before waiting for potential movement
      const previous = await this.getCurrentLine(eventId);

      // Wait for a brief period (this could be adjusted based on sportsbook behavior)
      await this.page.waitForTimeout(5000); // This wait could be longer depending on frequency of line updates

      // Get the current line again to detect movement
      const current = await this.getCurrentLine(eventId);

      // Check if the line has moved and log the movement
      if (previous !== current) {
        console.log(`Line movement detected for event ${eventId}: ${previous} -> ${current}`);
        return true;
      } else {
        console.log(`No line movement detected for event ${eventId}`);
      }
      return false;
    } catch (error) {
      console.error(`Failed to detect line movement for event ${eventId}:`, error.message);
      throw error;
    }
  }
}

