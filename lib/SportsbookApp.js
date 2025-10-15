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
  constructor({ page, config, nc }) {
    if (!config.name || !config.base_url || !config.selectors) {
      throw new Error('Invalid config: missing required fields');
    }

    this.page = page;
    this.config = config;
    this.nc = nc;
    this.sc = StringCodec();
    this.baseUrl = config.base_url;
    this.selectors = config.selectors;

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

  async launchApp() {
    await this.page.goto(this.baseUrl);
    await this.page.waitForSelector('body', { timeout: 5000 });
    logger.info(`Launched sportsbook for ${this.config.name}`);
  }

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

  async placeBet(betRequest) {
    const subject = `${this.config.name}.ack`; // Publish to bookie-specific ack topic
    const timestamp = new Date().toISOString();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      let event, odds, stake, bet_type, betId, arbCycleID;

      if (betRequest.BetType === 'arb' && betRequest.bets) {
        // Handle arbitrage bets
        const bet = betRequest.bets.find(b => b.Bookie === this.config.name);
        if (!bet) {
          throw new Error(`No bet found for bookie ${this.config.name} in ArbCycleID ${betRequest.ArbCycleID}`);
        }
        ({ eventId: event, query: event.query, team: event.team, odds, stake, BetType: bet_type, BetID: betId, ArbCycleID: arbCycleID } = bet);
      } else {
        // Handle value bets
        ({ eventId: event, query: event.query, team: event.team, odds, stake, BetType: bet_type, BetID: betId, ArbCycleID: arbCycleID } = betRequest);
      }

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
          eventId: event,
          BetID: betId,
          ArbCycleID: arbCycleID,
          bookie: this.config.name,
          error: msg,
          timestamp
        })));
        return { success: false, reason: 'Odds validation failed' };
      }

      await this.page.goto(this.baseUrl);
      const search = this.selectors.event_search;

      try {
        await this.page.waitForSelector(search.sport_dropdown, { timeout: 5000 });
        await this.page.click(search.sport_dropdown);
        await this.page.waitForSelector(search.date_picker, { timeout: 5000 });
        await this.page.type(search.date_picker, event.query);
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
        eventId: event,
        BetID: betId,
        ArbCycleID: arbCycleID,
        bookie: this.config.name,
        stake,
        bet_type,
        odds,
        payout: stake * odds,
        type: hasValueBet ? 'value' : 'arbitrage',
        Status: 'Success',
        timestamp
      };

      this.nc?.publish(subject, this.sc.encode(JSON.stringify(result)));
      logger.info(`Published bet result: ${JSON.stringify(result)}`);
      return result;

    } catch (error) {
      const failure = {
        success: false,
        eventId: betRequest.eventId || betRequest.bets?.[0]?.eventId,
        BetID: betRequest.BetID || betRequest.bets?.[0]?.BetID,
        ArbCycleID: betRequest.ArbCycleID,
        bookie: this.config.name,
        error: error.message,
        Status: 'Failed',
        timestamp
      };
      this.nc?.publish(subject, this.sc.encode(JSON.stringify(failure)));
      logger.error(`Error placing bet for ${betRequest.eventId || betRequest.ArbCycleID} on ${this.config.name}: ${error.message}`);
      return failure;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
