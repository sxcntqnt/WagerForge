// lib/NATSPublisher.js
import { NATSBase } from './NatsBase.js';
import logger from './logger.js';

export class NATSPublisher extends NATSBase {
  constructor(config, validConfigs = []) {
    super(config, validConfigs);
  }

  // -----------------------------------------------------------------
  // 1. ACK that we received the incoming bet
  // -----------------------------------------------------------------
  async publishReceivedAck(betId) {
    const payload = {
      bet_id: betId,
      status: 'received_pending',
      ack_type: 'initial',
      timestamp: Date.now(),
    };
    try {
      this.nc.publish('bets.ack', this.encodeMessage(payload));
      await this.nc.flush();
      logger.info(`[JS to Upstream] received_pending to bets.ack (${betId})`);
    } catch (e) {
      logger.error(`publishReceivedAck failed: ${e.message}`);
    }
  }

  // -----------------------------------------------------------------
  // 2. Bet has been placed
  // -----------------------------------------------------------------
  async publishPlacedPending(betId, extra = {}) {
    const payload = {
      bet_id: betId,
      status: 'placed_pending',
      ack_type: 'placed',
      timestamp: Date.now(),
      ...extra,
    };
    try {
      this.nc.publish('bets.placed', this.encodeMessage(payload));
      logger.info(`[JS to Upstream] placed_pending to bets.placed (${betId})`);
    } catch (e) {
      logger.error(`publishPlacedPending failed: ${e.message}`);
    }
  }

  // -----------------------------------------------------------------
  // 3. Bet has been settled
  // -----------------------------------------------------------------
  async publishSettledPending(betId, outcome = {}) {
    const payload = {
      bet_id: betId,
      status: 'settled_pending',
      ack_type: 'settled',
      timestamp: Date.now(),
      ...outcome,
    };
    try {
      this.nc.publish('bets.settled', this.encodeMessage(payload));
      logger.info(`[JS to Upstream] settled_pending to bets.settled (${betId})`);
    } catch (e) {
      logger.error(`publishSettledPending failed: ${e.message}`);
    }
  }

  // -----------------------------------------------------------------
  // 4. Bet result (used by SportsbookApp)
  // -----------------------------------------------------------------
  async publishBetResult(result) {
    const subject = result.success ? 'bets.placed' : 'bets.placed';
    const payload = {
      ...result,
      ack_type: result.success ? 'placed' : 'placed',
    };
    try {
      this.nc.publish(subject, this.encodeMessage(payload));
      logger.info(`Published bet result: ${result.Status} (${result.BetID})`);
    } catch (e) {
      logger.error(`publishBetResult failed: ${e.message}`);
    }
  }
}
