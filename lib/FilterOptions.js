// FilterOptions.js
import puppeteer from "puppeteer-core";

export class FilterOptions {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async applySportFilter(sport) {
    await this.page.click('.filters .sport-dropdown');
    await this.page.select('.sport-dropdown select', sport);
    await this.page.waitForSelector('.filtered-events');
    console.log(`Applied sport filter: ${sport}`);
  }

  async applyMarketTypeFilter(type) {
    await this.page.click('.filters .market-type');
    await this.page.click(`.market-option[data-type="${type}"]`);
    console.log(`Applied market type filter: ${type}`);
  }

  async applyTimeFilter(timeRange) {
    await this.page.select('.time-filter select', timeRange);
    console.log(`Applied time filter: ${timeRange}`);
  }

  async resetFilters() {
    await this.page.click('.reset-filters-btn');
    console.log('Filters reset');
  }
}
