// EventSearch.js
import puppeteer from "puppeteer-core";

export class EventSearch {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Search for events based on a query
  async searchEvents(query) {
    const { base_url, selectors } = this.config;

    try {
      // Navigate to events page using the base URL from the config
      await this.page.goto(`${base_url}/events`, { waitUntil: 'domcontentloaded' });

      // Wait for the search input to appear and type the query
      const searchInput = await this.page.waitForSelector(selectors.event_search.search_input, { timeout: 5000 });
      await searchInput.type(query);

      // Simulate pressing 'Enter' to submit the search
      await this.page.keyboard.press('Enter');

      // Wait for the event results to load
      await this.page.waitForSelector(selectors.event_search.event_results, { timeout: 5000 });

      // Extract event data
      const events = await this.page.evaluate((eventSelector, titleSelector) => {
        return Array.from(document.querySelectorAll(eventSelector)).map(el => ({
          id: el.dataset.eventId,
          title: el.querySelector(titleSelector)?.textContent.trim() || 'Unknown Title',
        }));
      }, selectors.event_search.event_item, selectors.event_search.event_title);

      console.log(`Found ${events.length} events for search query: ${query}`);
      return events;
    } catch (error) {
      console.error(`Failed to search for events with query "${query}":`, error.message);
      throw error;
    }
  }

  // Filter events by sport using the configured selector
  async filterBySport(sport) {
    const { selectors } = this.config;

    try {
      // Click the sport filter dropdown and select the desired sport
      await this.page.click(selectors.event_search.sport_filter);
      await this.page.select(selectors.event_search.sport_filter_select, sport);

      // Wait for filtered results to load
      await this.page.waitForSelector(selectors.event_search.event_results, { timeout: 5000 });
      console.log(`Filtered events by sport: ${sport}`);
    } catch (error) {
      console.error(`Failed to filter events by sport "${sport}":`, error.message);
      throw error;
    }
  }

  // Filter events by date using the configured selector
  async filterByDate(date) {
    const { selectors } = this.config;

    try {
      // Enter the date into the filter and press Enter
      await this.page.type(selectors.event_search.date_filter_input, date);
      await this.page.keyboard.press('Enter');
      console.log(`Filtered events by date: ${date}`);
    } catch (error) {
      console.error(`Failed to filter events by date "${date}":`, error.message);
      throw error;
    }
  }

  // Filter events by league using the configured selector
  async filterByLeague(league) {
    const { selectors } = this.config;

    try {
      // Select the desired league from the filter
      await this.page.click(selectors.event_search.league_filter);
      await this.page.select(selectors.event_search.league_filter_select, league);
      console.log(`Filtered events by league: ${league}`);
    } catch (error) {
      console.error(`Failed to filter events by league "${league}":`, error.message);
      throw error;
    }
  }
}

