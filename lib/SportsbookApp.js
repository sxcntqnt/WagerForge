// lib/SportsbookApp.js
import { UserSession } from './UserSession.js';
import { EventSearch } from './EventSearch.js';
import { OddsSelector } from './OddsSelector.js';
import { BetSlip } from './BetSlip.js';
import { LiveBetting } from './LiveBetting.js';
import { LineMovementTracker } from './LineMovementTracker.js';
import { FilterOptions } from './FilterOptions.js';
import { BetConfirmation } from './BetConfirmation.js';
import { BetHistory } from './BetHistory.js';
import { PromotionsManager } from './PromotionsManager.js';
import { CashOutManager } from './CashOutManager.js';
import { NotificationCenter } from './NotificationCenter.js';
import { initConfigWatcher, getExecutor } from './ConfigManager.js';
import { StringCodec } from 'nats';
import { ValueBetting, ArbitrageBetting } from './value.js';
import logger from './logger.js';

export class SportsbookApp {
  // Constructor accepts the page and other configurations
  constructor({ page, config, nc }) {
    // Check for required configuration fields
    if (!config.name || !config.base_url || !config.selectors) {
      throw new Error('Invalid config: missing required fields');
    }

    this.page = page;
    this.config = config;
    this.nc = nc;
    this.sc = StringCodec();
    this.baseUrl = config.base_url;
    this.selectors = config.selectors;

    // Initialize value and arbitrage engines with a dummy sportsbook
    const sportsbook = {
      name: config.name,
      getOdds: async () => { throw new Error('No fetching inside placeBet'); },
      placeBet: async (event, odds, stake, bet_type) => {
        throw new Error('Dummy sportsbook not used for placing bets');
      }
    };

    this.valueEngine = new ValueBetting([sportsbook]);
    this.arbEngine = new ArbitrageBetting([sportsbook]);
  }

  // Launches the app
  async launchApp() {
    await this.page.goto(this.baseUrl);
    await this.page.waitForSelector('body', { timeout: 5000 });
    logger.info(`Launched sportsbook for ${this.config.name}`);
  }

  // Logs into the sportsbook using the provided selectors and credentials
  async login() {
    const { username_input, password_input, login_button } = this.selectors.login;
    const { username, password } = this.config;

    try {
      await this.page.waitForSelector(username_input, { timeout: 5000 });
      await this.page.type(username_input, username);
      await this.page.waitForSelector(password_input, { timeout: 5000 });
      await this.page.type(password_input, password);
      await this.page.waitForSelector(login_button, { timeout: 5000 });
      await this.page.click(login_button);
      await this.page.waitForNavigation({ timeout: 10000 });
      logger.info('Logged in successfully');
    } catch (error) {
      logger.error(`Login failed: ${error.message}`);
      throw error;
    }
  }

  // Places a bet with retry logic for DOM interactions
  async placeBet({ eventId, query, team, stake, bet_type, odds }) {
    const subject = 'bet.placed';
    const timestamp = new Date().toISOString();

    // Add timeout for entire bet operation (30 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const event = { id: eventId, query, team };

      // Validate odds
      const valueBets = await this.valueEngine.findValueBets(event, bet_type);
      const hasValueBet = valueBets.some(v =>
        Math.abs(v.odds - odds) < 0.01 && v.sportsbook.name === this.config.name
      );

      const arbResult = await this.arbEngine.findArbitrageOpportunity(event, bet_type);
      const hasArb = arbResult.isOpportunity && arbResult.odds.some(o =>
        Math.abs(o.odds - odds) < 0.01 && o.sportsbook.name === this.config.name
      );

      if (!hasValueBet && !hasArb) {
        const msg = `Skipping bet: odds ${odds} not valid for value or arbitrage betting on ${this.config.name}`;
        logger.warn(msg);
        this.nc?.publish(subject, this.sc.encode(JSON.stringify({
          success: false,
          eventId,
          bookie: this.config.name,
          error: msg,
          timestamp
        })));
        return { success: false, reason: 'Odds validation failed' };
      }

      // Place bet with retry logic for DOM interactions
      await this.page.goto(this.baseUrl);
      const search = this.selectors.event_search;

      try {
        await this.page.waitForSelector(search.sport_dropdown, { timeout: 5000 });
        await this.page.click(search.sport_dropdown);
        await this.page.waitForSelector(search.date_picker, { timeout: 5000 });
        await this.page.type(search.date_picker, query);
        await this.page.waitForSelector(search.search_button, { timeout: 5000 });
        await this.page.click(search.search_button);
        await this.page.waitForSelector(this.selectors.odds_selector[bet_type], { timeout: 5000 });
        await this.page.click(this.selectors.odds_selector[bet_type]);
        await this.page.waitForSelector('input#stake', { timeout: 5000 });
        await this.page.type('input#stake', String(stake));
        await this.page.waitForSelector(this.config.bet_button, { timeout: 5000 });
        await this.page.click(this.config.bet_button);
        await this.page.waitForSelector('body', { timeout: 5000 });
      } catch (error) {
        logger.error(`DOM interaction failed: ${error.message}`);
        throw error;
      }

      const result = {
        success: true,
        eventId,
        bookie: this.config.name,
        stake,
        bet_type,
        odds,
        payout: stake * odds,
        type: hasValueBet ? 'value' : 'arbitrage',
        timestamp
      };

      this.nc?.publish(subject, this.sc.encode(JSON.stringify(result)));
      logger.info(`Published bet result: ${JSON.stringify(result)}`);
      return result;

    } catch (error) {
      const failure = {
        success: false,
        eventId,
        bookie: this.config.name,
        error: error.message,
        timestamp
      };
      this.nc?.publish(subject, this.sc.encode(JSON.stringify(failure)));
      logger.error(`Error placing bet for ${eventId} on ${this.config.name}: ${error.message}`);
      return failure;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

