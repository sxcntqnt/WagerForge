import puppeteer from 'puppeteer-core';

export class UserSession {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  // Login method dynamically uses the config object
  async login() {
    const { username, password, selectors, base_url } = this.config;

    try {
      // Navigate to the login page using the base URL from config
      await this.page.goto(`${base_url}/login`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Wait for the username input field to appear
      await this.page.waitForSelector(selectors.login.username_input, { timeout: 5000 });
      await this.page.type(selectors.login.username_input, username);

      // Wait for the password input field to appear
      await this.page.waitForSelector(selectors.login.password_input, { timeout: 5000 });
      await this.page.type(selectors.login.password_input, password);

      // Wait for the login button to appear
      await this.page.waitForSelector(selectors.login.login_button, { timeout: 5000 });
      await this.page.click(selectors.login.login_button);

      // Wait for the dashboard (or login success indicator) to appear
      await this.page.waitForSelector(selectors.dashboard || '.dashboard', { timeout: 10000 });
      console.log('Login successful');
    } catch (error) {
      console.error('Login failed:', error.message);
      throw error;
    }
  }

  // Logout method dynamically uses the config object
  async logout() {
    const { selectors } = this.config;

    try {
      // Wait for the logout button to appear
      await this.page.waitForSelector(selectors.user_menu.logout_button, { timeout: 5000 });
      await this.page.click(selectors.user_menu.logout_button);

      // Wait for logout confirmation (login form should appear again)
      await this.page.waitForSelector(selectors.login_form || '.login-form', { timeout: 5000 });
      console.log('Logout successful');
    } catch (error) {
      console.error('Logout failed:', error.message);
      throw error;
    }
  }

  // Retrieve the user balance using the configured selector
  async getUserBalance() {
    const balanceSelector = this.config.selectors.balance || '.balance';

    try {
      // Wait for the balance element to appear
      await this.page.waitForSelector(balanceSelector, { timeout: 5000 });

      // Scrape the balance from the page using the configured balance selector
      const balance = await this.page.evaluate((selector) => {
        const balanceElement = document.querySelector(selector);
        return balanceElement ? balanceElement.textContent.trim() : '';
      }, balanceSelector);

      // Return balance as a float after removing the currency symbol
      if (!balance) {
        throw new Error('Balance not found');
      }
      return parseFloat(balance.replace('$', '').trim()) || 0;
    } catch (error) {
      console.error('Failed to retrieve balance:', error.message);
      throw error;
    }
  }

  // Update account details based on the dynamic config object
  async updateAccountDetails(details) {
    const { selectors } = this.config;

    try {
      // Wait for the account link to appear in the user menu
      await this.page.waitForSelector(selectors.user_menu.account_link, { timeout: 5000 });
      await this.page.click(selectors.user_menu.account_link);

      // Wait for the account form to load
      await this.page.waitForSelector(selectors.account_form || '.account-form', { timeout: 10000 });

      // Update fields (example: email) if provided in details
      if (details.email) {
        await this.page.waitForSelector(selectors.account_form.email_input, { timeout: 5000 });
        await this.page.type(selectors.account_form.email_input, details.email);
      }

      // Wait for the save button and click it
      await this.page.waitForSelector(selectors.account_form.save_button, { timeout: 5000 });
      await this.page.click(selectors.account_form.save_button);
      console.log('Account details updated successfully');
    } catch (error) {
      console.error('Failed to update account details:', error.message);
      throw error;
    }
  }
}

