// LineMovementTracker.js
import puppeteer from "puppeteer-core";

export class LineMovementTracker {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async getOddsHistory(eventId) {
    await this.page.goto(`${this.baseUrl}/events/${eventId}/history`);
    
    const history = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('.history-row')).map(el => ({
        time: el.querySelector('.time').textContent.trim(),
        odds: el.querySelector('.odds').textContent.trim()
      }));
    });
    return history;
  }

  async getOpeningLine(eventId) {
    await this.page.goto(`${this.baseUrl}/events/${eventId}`);
    
    const opening = await this.page.evaluate(() => {
      return document.querySelector('.opening-line').textContent.trim();
    });
    return opening;
  }

  async getCurrentLine(eventId) {
    await this.page.goto(`${this.baseUrl}/events/${eventId}`);
    
    const current = await this.page.evaluate(() => {
      return document.querySelector('.current-line').textContent.trim();
    });
    return current;
  }

  async detectLineMovement(eventId) {
    const previous = await this.getCurrentLine(eventId);
    await this.page.waitForTimeout(5000); // Wait for potential change
    const current = await this.getCurrentLine(eventId);
    
    if (previous !== current) {
      console.log(`Line movement detected for ${eventId}: ${previous} -> ${current}`);
      return true;
    }
    return false;
  }
}
