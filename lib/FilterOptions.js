// FilterOptions.js
import puppeteer from "puppeteer-core";

export class FilterOptions {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Apply the sport filter using the configured selector
  async applySportFilter(sport) {
    const { selectors } = this.config;

    try {
      // Click the sport dropdown and select the desired sport
      await this.page.click(selectors.filters.sport_dropdown);
      
      // Wait for the dropdown options to be visible before selecting
      await this.page.waitForSelector(selectors.filters.sport_dropdown_select, { timeout: 5000 });
      await this.page.select(selectors.filters.sport_dropdown_select, sport);

      // Wait for filtered events to appear
      await this.page.waitForSelector(selectors.filters.filtered_events, { timeout: 5000 });
      console.log(`Applied sport filter: ${sport}`);
    } catch (error) {
      console.error(`Failed to apply sport filter: ${sport} -`, error.message);
      throw error;
    }
  }

  // Apply the market type filter using the configured selector
  async applyMarketTypeFilter(type) {
    const { selectors } = this.config;

    try {
      // Click the market type filter and select the desired option
      await this.page.click(selectors.filters.market_type);
      
      // Wait for the market options to appear
      await this.page.waitForSelector(selectors.filters.market_option, { timeout: 5000 });
      await this.page.click(`${selectors.filters.market_option}[data-type="${type}"]`);
      console.log(`Applied market type filter: ${type}`);
    } catch (error) {
      console.error(`Failed to apply market type filter: ${type} -`, error.message);
      throw error;
    }
  }

  // Apply the time filter using the configured selector
  async applyTimeFilter(timeRange) {
    const { selectors } = this.config;

    try {
      // Select the time range from the dropdown
      await this.page.select(selectors.filters.time_filter_select, timeRange);

      // Wait for filtered events to appear based on the time filter
      await this.page.waitForSelector(selectors.filters.filtered_events, { timeout: 5000 });
      console.log(`Applied time filter: ${timeRange}`);
    } catch (error) {
      console.error(`Failed to apply time filter: ${timeRange} -`, error.message);
      throw error;
    }
  }

  // Reset all filters using the configured selector
  async resetFilters() {
    const { selectors } = this.config;

    try {
      // Click the reset filters button
      await this.page.click(selectors.filters.reset_filters_btn);

      // Wait for the filters to be reset and confirm if any filtered events remain
      await this.page.waitForSelector(selectors.filters.filtered_events, { hidden: true, timeout: 5000 });
      console.log('Filters reset');
    } catch (error) {
      console.error('Failed to reset filters:', error.message);
      throw error;
    }
  }
}

