// lib/NATSPublisher.js
import { NATSBase } from './NatsBase.js';
import logger from './logger.js';

export class NATSPublisher extends NATSBase {
  constructor(config) {
    super(config);
  }

  static async publishBetAck(BetID, nc, natsBase, ackType = 'bet_received') {
    try {
      const ackPayload = {
        bet_id: BetID,
        status: 'Received',
        timestamp: Date.now(),
        ack_type: ackType  // Add ack_type to distinguish ACK sources
      };
      nc.publish('bets.ack', natsBase.encodeMessage(ackPayload));
      await nc.flush()
      logger.info(`Published ${ackType} ACK for BetID ${BetID} to bets.ack`);
    } catch (err) {
      logger.error(`Failed to publish ACK for BetID ${BetID}: ${err.message}`);
    }
  }

  static publishBetResult(resultData, nc, natsBase, ackType = 'bet_placed') {
    try {
      const subject = 'bets.placed';
      const message = natsBase.encodeMessage({
        ...resultData,
        ack_type: ackType  // Add ack_type to bet results
      });
      nc.publish(subject, message);
      logger.info(`Published ${ackType} for BetID ${resultData.BetID} to ${subject}`);
    } catch (err) {
      logger.error(`Failed to publish bet result for BetID ${resultData.BetID}: ${err.message}`);
    }
  }

  static publishSettled(settledData, nc, natsBase, ackType = 'bet_settled') {
    try {
      const subject = 'bets.settled';
      const message = natsBase.encodeMessage({
        ...settledData,
        ack_type: ackType  // Add ack_type to settled bets
      });
      nc.publish(subject, message);
      logger.info(`Published ${ackType} for BetID ${settledData.BetID} to ${subject}`);
    } catch (err) {
      logger.error(`Failed to publish settled bet ${settledData.BetID}: ${err.message}`);
    }
  }
}
