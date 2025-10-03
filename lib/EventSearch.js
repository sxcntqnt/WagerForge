// EventSearch.js
import puppeteer from "puppeteer-core";

export class EventSearch {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async searchEvents(query) {
    // Navigate to events page if not already
    await this.page.goto(`${this.baseUrl}/events`);
    
    // Enter search query
    const searchInput = await this.page.waitForSelector('input[placeholder="Search events"]');
    await searchInput.type(query);
    await this.page.keyboard.press('Enter');
    
    // Wait for results
    await this.page.waitForSelector('.event-results');
    const events = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('.event-item')).map(el => ({
        id: el.dataset.eventId,
        title: el.querySelector('.event-title').textContent.trim()
      }));
    });
    return events;
  }

  async filterBySport(sport) {
    // Click sport filter dropdown
    await this.page.click('.filter-sport select');
    await this.page.select('.filter-sport select', sport);
    
    // Wait for filtered results
    await this.page.waitForSelector('.event-results');
    console.log(`Filtered by sport: ${sport}`);
  }

  async filterByDate(date) {
    // Enter date in filter
    await this.page.type('.filter-date input', date);
    await this.page.keyboard.press('Enter');
    console.log(`Filtered by date: ${date}`);
  }

  async filterByLeague(league) {
    // Select league
    await this.page.click('.filter-league select');
    await this.page.select('.filter-league select', league);
    console.log(`Filtered by league: ${league}`);
  }
}
