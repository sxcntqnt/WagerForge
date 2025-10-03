// OddsSelector.js
import puppeteer from "puppeteer-core";

export class OddsSelector {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async selectMoneylineOdds(eventId, team) {
    // Navigate to event page
    await this.page.goto(`${this.baseUrl}/events/${eventId}`);
    
    // Click moneyline odds for team
    const selector = `.odds-moneyline [data-team="${team}"]`;
    await this.page.click(selector);
    console.log(`Selected moneyline odds for ${team}`);
    
    // Return selected odds
    const odds = await this.page.evaluate((sel) => {
      return document.querySelector(sel).textContent.trim();
    }, selector);
    return odds;
  }

  async selectSpreadOdds(eventId, side, spread) {
    await this.page.goto(`${this.baseUrl}/events/${eventId}`);
    
    const selector = `.odds-spread [data-side="${side}"][data-spread="${spread}"]`;
    await this.page.click(selector);
    console.log(`Selected spread odds for ${side} at ${spread}`);
    
    const odds = await this.page.evaluate((sel) => {
      return document.querySelector(sel).textContent.trim();
    }, selector);
    return odds;
  }

  async selectTotalsOdds(eventId, overUnder, value) {
    await this.page.goto(`${this.baseUrl}/events/${eventId}`);
    
    const selector = `.odds-totals [data-type="${overUnder}"][data-value="${value}"]`;
    await this.page.click(selector);
    console.log(`Selected totals odds ${overUnder} ${value}`);
    
    const odds = await this.page.evaluate((sel) => {
      return document.querySelector(sel).textContent.trim();
    }, selector);
    return odds;
  }
}
