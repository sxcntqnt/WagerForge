//userSession
import puppeteer from 'puppeteer-core';
import logger from './logger.js';
import dotenv from 'dotenv';
import { ClusterManager } from './ClusterManager.js';
import fs from 'fs';

dotenv.config();

export class UserSession {
  constructor(page, config) {
    this.page = page;
    this.config = config;
    this.username = process.env.USERNAME || config.username;
    this.password = process.env.PASSWORD || config.password;
    this.cookiesPath = process.env.COOKIES_PATH || './cookies.json';  // Set path to save cookies
  }

  // Login method dynamically uses the config object and handles OTP if required
  async login() {
    const { selectors, base_url } = this.config;

    try {
      // First, check if we already have cookies saved
      const cookies = await this.loadCookies();
      if (cookies.length) {
        logger.info('Using saved cookies for login');
        await this.page.setCookie(...cookies);
        await this.page.goto(base_url, { waitUntil: 'networkidle0' });
        logger.info('Logged in using saved cookies');
        return;
      }

      // Navigate to the login page using the base URL from config
      await this.page.goto(`${base_url}/login`, { waitUntil: 'networkidle0', timeout: 10000 });

      // Handle any modals that might contain login fields
      await this.handleModalsForLogin(selectors);

      // Handle login form inside the modal
      await this.page.waitForSelector(selectors.login.username_input, { timeout: 5000 });
      await this.page.type(selectors.login.username_input, this.username);

      await this.page.waitForSelector(selectors.login.password_input, { timeout: 5000 });
      await this.page.type(selectors.login.password_input, this.password);

      // Handle any modals (e.g., popups, consent forms) that might appear
      await this.handleModals();

      // Wait for the login button and click it
      await this.page.waitForSelector(selectors.login.login_button, { timeout: 5000 });
      await this.page.click(selectors.login.login_button);

      // Wait for potential OTP input (if OTP is required)
      await this.handleOtp(selectors.login.otp_input);

      // Wait for the dashboard (or login success indicator) to appear
      await this.page.waitForSelector(selectors.dashboard || '.dashboard', { timeout: 10000 });

      // Save cookies for future sessions
      await this.saveCookies();
      logger.info('Login successful');
    } catch (error) {
      logger.error('Login failed:', error.message);
      throw error;
    }
  }

  // Handle OTP input if required (fetch OTP dynamically from external service)
  async handleOtp(otpSelector) {
    if (!otpSelector) {
      logger.info('OTP selector not found in config.');
      return;
    }

    // Wait for OTP field to appear
    await this.page.waitForSelector(otpSelector, { timeout: 5000 });

    const otp = await this.fetchOtp();  // Fetch OTP dynamically from external service
    if (!otp) {
      throw new Error('OTP code is required but not provided.');
    }

    // Type the OTP code
    await this.page.type(otpSelector, otp);
    const otpSubmitButton = this.config.selectors.login.otp_submit_button || this.config.selectors.login.login_button;
    await this.page.click(otpSubmitButton); // Submit OTP
    logger.info('OTP entered successfully');
  }

  // Fetch OTP from external service if not provided elsewhere
  async fetchOtp() {
    try {
      const otpData = await ClusterManager.getOtpForBookie(this.config.name, 30000);
      if (!otpData || !otpData.Otp) {
        throw new Error(`No OTP received for bookie ${this.config.name}`);
      }
      return otpData.Otp;
    } catch (err) {
      logger.error('Failed to fetch OTP:', err.message);
      throw err;
    }
  }

  // Handle any modals that may pop up during login (e.g., cookie consent, popup forms)
  async handleModals() {
    try {
      // Example modal selector, can be customized for different sites
      const modalSelectors = ['.modal', '.popup', '.consent-popup'];

      for (const selector of modalSelectors) {
        const modal = await this.page.$(selector);
        if (modal) {
          await this.page.click(`${selector} .close`); // Close the modal
          logger.info('Closed modal');
        }
      }
    } catch (error) {
      logger.warn('No modals were found or closed:', error.message);
    }
  }

  // Handle modals that contain login forms
  async handleModalsForLogin(selectors) {
    const loginModalSelector = selectors.login.modal || '.login-modal'; // Selector for the modal containing login

    // Check if login modal is present and interact with it
    const loginModal = await this.page.$(loginModalSelector);
    if (loginModal) {
      logger.info('Login modal detected, interacting with it');

      // Ensure that the modal is visible before interacting with it
      await this.page.waitForSelector(`${loginModalSelector} ${selectors.login.username_input}`, { timeout: 5000 });
      await this.page.type(`${loginModalSelector} ${selectors.login.username_input}`, this.username);
      await this.page.waitForSelector(`${loginModalSelector} ${selectors.login.password_input}`, { timeout: 5000 });
      await this.page.type(`${loginModalSelector} ${selectors.login.password_input}`, this.password);

      logger.info('Username and password typed into the modal');
    }
  }

  // Save cookies to a file for persistence across sessions
  async saveCookies() {
    const cookies = await this.page.cookies();
    fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
    logger.info('Cookies saved for persistence');
  }

  // Load cookies from a file if they exist
  async loadCookies() {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(this.cookiesPath));
        return cookies;
      }
    } catch (error) {
      logger.error('Error loading cookies:', error.message);
    }
    return [];
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
      logger.info('Logout successful');
    } catch (error) {
      logger.error('Logout failed:', error.message);
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
      logger.error('Failed to retrieve balance:', error.message);
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
      logger.info('Account details updated successfully');
    } catch (error) {
      logger.error('Failed to update account details:', error.message);
      throw error;
    }
  }
}

