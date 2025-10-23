// lib/NATSPublisher.js

import { NATSBase } from './NatsBase.js';
import logger from './logger.js';

export class NATSPublisher extends NATSBase {
  constructor(config) {
    super(config);
  }

  static publishBetAck(BetID, nc, natsBase) {
    try {
      const ackPayload = {
        BetID,
        Status: 'Received',
        Timestamp: Date.now(),
      };
      nc.publish('bets.ack', natsBase.encodeMessage(ackPayload));
      logger.info(`Published ACK for BetID ${BetID} to bets.ack`);
    } catch (err) {
      logger.error(`Failed to publish ACK for BetID ${BetID}: ${err.message}`);
    }
  }

  static publishBetResult(resultData, nc, natsBase) {
    try {
      const subject = 'bets.placed';
      const message = natsBase.encodeMessage(resultData);
      nc.publish(subject, message);
      logger.info(`Published bet result for BetID ${resultData.BetID} to ${subject}`);
    } catch (err) {
      logger.error(`Failed to publish bet result for BetID ${resultData.BetID}: ${err.message}`);
    }
  }

  static publishSettled(settledData, nc, natsBase) {
    try {
      const subject = 'bets.settled';
      const message = natsBase.encodeMessage(settledData);
      nc.publish(subject, message);
      logger.info(`Published settled bet ${settledData.BetID} to ${subject}`);
    } catch (err) {
      logger.error(`Failed to publish settled bet ${settledData.BetID}: ${err.message}`);
    }
  }
}
