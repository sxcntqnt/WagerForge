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
  constructor({ page, config, nc, publisher }) {
    if (!config.name || !config.base_url || !config.selectors || !config.bet_button) {
      throw new Error('Invalid config: missing required fields');
    }
    this.page = page;
    this.config = config;
    this.nc = nc;
    this.publisher = publisher; // injected
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
    this.userSession = new UserSession(page, config);
    this.betHistory = new BetHistory(page, config, nc);
    this.betHistory.startSettledBetMonitoring();
  }

  async launchApp() {
    await this.page.goto(this.baseUrl, { timeout: this.config.timeout?.page_load || 5000 });
    await this.page.waitForSelector('body', { timeout: this.config.timeout?.selector_wait || 5000 });
    logger.info(`Launched sportsbook for ${this.config.name}`);
  }

  async login() {
    await this.userSession.login();
    logger.info(`Logged in successfully for ${this.config.name}`);
  }

  async placeBet(betRequest) {
    const timestamp = new Date().toISOString();
    const timeout = this.config.timeout?.bet_operation || 30000;
    const timeoutId = setTimeout(() => this.page.close(), timeout);

    try {
      let event, odds, stake, bet_type, betId, arbCycleID, match_id, team, side,
          win_rate, ev, strategy, search_query, home_team, away_team, risk;

      if (betRequest.BetType === 'arb' && betRequest.bets) {
        const bet = betRequest.bets.find(b => b.Bookie === this.config.name);
        if (!bet) {
          throw new Error(`No bet found for bookie ${this.config.name} in ArbCycleID ${betRequest.ArbCycleID}`);
        }
        ({
          eventId: event, match_id, team, side, odds, stake, BetType: bet_type,
          BetID: betId, ArbCycleID: arbCycleID, search_query, home_team, away_team,
          risk, win_rate, ev, strategy
        } = bet);
      } else {
        ({
          eventId: event, match_id, team, side, odds, stake, BetType: bet_type,
          BetID: betId, ArbCycleID: arbCycleID, search_query, home_team, away_team,
          risk, win_rate, ev, strategy
        } = betRequest);
      }

      const valueBets = await this.valueEngine.findValueBets(event, bet_type);
      const hasValueBet = valueBets.some(v =>
        Math.abs(v.odds - odds) < 0.01 && v.sportsbook.name === this.config.name
      );
      const arbResult = await this.arbEngine.findArbitrageOpportunity(event, bet_type);
      const hasArb = arbResult.isOpportunity && arbResult.odds.some(o =>
        Math.abs(o.odds - odds) < 0.01 && o.sportsbook.name === this.config.name
      );

      if (!hasValueBet && !hasArb) {
        const msg = `Skipping bet: odds ${odds} not valid on ${this.config.name}`;
        logger.warn(msg);
        const failure = {
          success: false, BetID: betId, ArbCycleID: arbCycleID,
          bookie: this.config.name, match_id, team, side, odds, stake,
          win_rate, ev, strategy, search_query, home_team, away_team, risk,
          timestamp, eventId: event, placed: false, hit: null, payout: null,
          profit: null, outcome: null, error: msg, Status: 'Failed'
        };
        await this.publisher.publishBetResult(failure);
        return { success: false, reason: 'Odds validation failed' };
      }

      await this.page.goto(this.baseUrl, { timeout: this.config.timeout?.page_load || 5000 });
      const search = this.selectors.event_search;

      await this.page.waitForSelector(search.sport_dropdown, { timeout: 5000 });
      await this.page.click(search.sport_dropdown);
      await this.page.waitForSelector(search.date_picker, { timeout: 5000 });
      await this.page.type(search.date_picker, search_query);
      await this.page.waitForSelector(search.search_button, { timeout: 5000 });
      await this.page.click(search.search_button);
      await this.page.waitForSelector(this.selectors.odds_selector[bet_type], { timeout: 5000 });
      await this.page.click(this.selectors.odds_selector[bet_type]);
      await this.page.waitForSelector(this.selectors.bet_slip.stake_input, { timeout: 5000 });
      await this.page.type(this.selectors.bet_slip.stake_input, String(stake));
      await this.page.waitForSelector(this.config.bet_button, { timeout: 5000 });
      await this.page.click(this.config.bet_button);
      await this.page.waitForSelector(this.selectors.bet_confirmation.success_message, { timeout: 5000 });

      const result = {
        success: true, BetID: betId, ArbCycleID: arbCycleID,
        bookie: this.config.name, match_id, team, side, odds, stake,
        win_rate, ev, strategy, search_query, home_team, away_team, risk,
        timestamp, eventId: event, placed: true, hit: null,
        payout: stake * odds, profit: null, outcome: null,
        type: hasValueBet ? 'value' : 'arbitrage', Status: 'Success'
      };
      await this.publisher.publishBetResult(result);
      logger.info(`Bet placed: ${betId} on ${this.config.name}`);
      return result;

    } catch (error) {
      const failure = {
        success: false,
        BetID: betRequest.BetID || betRequest.bets?.[0]?.BetID,
        ArbCycleID: betRequest.ArbCycleID,
        bookie: this.config.name,
        match_id: betRequest.match_id || betRequest.bets?.[0]?.match_id,
        team: betRequest.team || betRequest.bets?.[0]?.team,
        side: betRequest.side || betRequest.bets?.[0]?.side,
        odds: betRequest.odds || betRequest.bets?.[0]?.odds,
        stake: betRequest.stake || betRequest.bets?.[0]?.stake,
        win_rate: betRequest.win_rate || betRequest.bets?.[0]?.win_rate,
        ev: betRequest.ev || betRequest.bets?.[0]?.ev,
        strategy: betRequest.strategy || betRequest.bets?.[0]?.strategy,
        search_query: betRequest.search_query || betRequest.bets?.[0]?.search_query,
        home_team: betRequest.home_team || betRequest.bets?.[0]?.home_team,
        away_team: betRequest.away_team || betRequest.bets?.[0]?.away_team,
        risk: betRequest.risk || betRequest.bets?.[0]?.risk,
        timestamp,
        eventId: betRequest.eventId || betRequest.bets?.[0]?.eventId,
        placed: false, hit: null, payout: null, profit: null,
        outcome: null, error: error.message, Status: 'Failed'
      };
      await this.publisher.publishBetResult(failure);
      logger.error(`Bet failed: ${failure.BetID} on ${this.config.name}: ${error.message}`);
      return failure;

    } finally {
      clearTimeout(timeoutId);
    }
  }
}
