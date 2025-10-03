// UserSession.js
import puppeteer from "puppeteer-core";

export class UserSession {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async login(username, password) {
    // Navigate to login page
    await this.page.goto(`${this.baseUrl}/login`);
    
    // Fill username and password
    await this.page.type('input[name="username"]', username);
    await this.page.type('input[name="password"]', password);
    
    // Click login button
    await this.page.click('button[type="submit"]');
    
    // Wait for login to complete (e.g., dashboard load)
    await this.page.waitForSelector('.dashboard', { timeout: 10000 });
    console.log('Login successful');
  }

  async logout() {
    // Click logout button
    await this.page.click('.user-menu button[aria-label="Logout"]');
    
    // Wait for logout confirmation
    await this.page.waitForSelector('.login-form', { timeout: 5000 });
    console.log('Logout successful');
  }

  async getUserBalance() {
    // Scrape balance from page
    const balance = await this.page.evaluate(() => {
      return document.querySelector('.balance').textContent.trim();
    });
    return parseFloat(balance.replace('$', '')) || 0;
  }

  async updateAccountDetails(details) {
    // Navigate to account settings
    await this.page.click('.user-menu a[href="/account"]');
    await this.page.waitForSelector('.account-form');
    
    // Update fields (example: email)
    if (details.email) {
      await this.page.type('input[name="email"]', details.email);
    }
    
    // Save changes
    await this.page.click('button[type="save"]');
    console.log('Account details updated');
  }
}
