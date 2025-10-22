// lib/NATSListener.js

import { connect, StringCodec } from 'nats';
import { decode, Packr } from 'msgpackr';
import logger from './logger.js';
import { ClusterManager } from './ClusterManager.js';

export class NATSListener {
  constructor(config) {
    this.sc = StringCodec();
    this.arbCycleStore = new Map();
    this.ackStore = new Map();
    this.returnsStore = new Map();
    this.nc = null;
    this.currentConfig = config;
    // Configure msgpackr to match Python's encoding
    this.packr = new Packr({
      useBigIntForLongNumbers: false,
      encodeStringsAsBinary: false,
      useFloat32: false,
      useRecords: false, // Disable records to avoid parsing issues
      structuredClone: false
    });
  }

  async connect() {
    try {
      this.nc = await connect({ servers: 'nats://localhost:4222' });
      logger.info('Connected to NATS server');
      await this.startListeners();
    } catch (err) {
      logger.error('Failed to connect to NATS: ' + err.message);
      throw err;
    }
  }

  async startListeners() {
    try {
      const subIncoming = this.nc.subscribe('bets.incoming');
      logger.info('Subscribed to bets.incoming');
      this.handleIncomingBets(subIncoming);
      const subIncomingBets = this.nc.subscribe('bets.incoming.bets');
      logger.info('Subscribed to bets.incoming.bets');
      this.handleIncomingBets(subIncomingBets);

      const subAck = this.nc.subscribe('*.ack');
      logger.info('Subscribed to *.ack');
      this.handleAckMessages(subAck);

      const subReturns = this.nc.subscribe('*.returns');
      logger.info('Subscribed to *.returns');
      this.handleReturnMessages(subReturns);

      this.periodicCleanup();
    } catch (err) {
      logger.error('Failed to start NATS listeners: ' + err.message);
      throw err;
    }
  }

  async handleIncomingBets(subIncoming) {
    for await (const msg of subIncoming) {
      try {
        // Log raw message data
        logger.info(`Raw NATS message: subject=${msg.subject}, length=${msg.data.length}, hex=${msg.data.toString('hex')}, base64=${msg.data.toString('base64')}`);
        
        // Try decoding as string for inspection
        let rawString;
        try {
          rawString = this.sc.decode(msg.data);
          logger.info(`Raw message as string: ${rawString}`);
        } catch (stringErr) {
          logger.info(`Could not decode raw message as string: ${stringErr.message}`);
        }

        // Check for empty message
        if (!msg.data || msg.data.length === 0) {
          logger.error('Received empty NATS message. Ignoring.');
          continue;
        }

        // Decode msgpack using decode (instead of unpack)
        let betRequest;
        try {
          betRequest = decode(msg.data); // Use decode directly
          logger.info('Successfully decoded msgpack data using decode.');
        } catch (decodeErr) {
          logger.error(`Failed to decode msgpack data: ${decodeErr.message}. Trying unpack method...`);
          try {
            betRequest = this.packr.unpack(msg.data);
            logger.info('Unpack method succeeded.');
          } catch (unpackErr) {
            logger.error(`Failed to unpack msgpack data: ${unpackErr.message}. Raw data: length=${msg.data.length}, hex=${msg.data.toString('hex')}, base64=${msg.data.toString('base64')}`);
            continue;
          }
        }
        
        // Log full betRequest
        logger.info(`Unpacked betRequest: ${JSON.stringify(betRequest, (key, value) => 
          typeof value === 'bigint' ? value.toString() : value, 2)}`);

        // Check for empty or invalid betRequest
        if (!betRequest || Object.keys(betRequest).length === 0) {
          logger.error('Empty or invalid betRequest object. Ignoring.');
          continue;
        }

        // Map Python payload fields
        const {
          type,
          file,
          bet_id: BetID,
          bookie_channel: Bookie,
          data: {
            arbcycle_id: ArbCycleID,
            match_id,
            team,
            side,
            odds,
            win_rate,
            ev,
            strategy,
            home_team,
            away_team,
            risk,
            timestamp
          } = {} // Default to empty object if data is undefined
        } = betRequest;

        // Infer BetType from file if type is invalid
        let BetType = type === 'arb' || type === 'value' ? type : undefined;
        if (!BetType && file) {
          BetType = file === 'arb_bets.csv' ? 'arb' : file === 'value_bets.csv' ? 'value' : undefined;
          if (!BetType) {
            logger.warn(`Unknown file type: ${file}. Cannot infer BetType.`);
          }
        }

        // Log specific fields
        const logFields = {
          BetType,
          BetID,
          ArbCycleID: ArbCycleID || 'none',
          match_id,
          team,
          side,
          Bookie,
          file,
          odds,
          win_rate,
          ev,
          strategy,
          home_team,
          away_team,
          risk,
          timestamp
        };
        logger.info(`Received bet request: ${JSON.stringify(logFields)}`);

        if (!this.currentConfig) {
          logger.error('No valid config found. Ignoring bet request.');
          continue;
        }

        // Validate required fields
        if (BetType === 'arb') {
          if (!ArbCycleID || !match_id || !team || !side) {
            logger.error(`Missing required fields for arb bet: ArbCycleID=${ArbCycleID}, match_id=${match_id}, team=${team}, side=${side}. Full request: ${JSON.stringify(betRequest, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`);
            continue;
          }
        } else if (BetType === 'value') {
          if (!match_id || !team || !side) {
            logger.error(`Missing required fields for value bet: match_id=${match_id}, team=${team}, side=${side}. Full request: ${JSON.stringify(betRequest, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`);
            continue;
          }
        } else {
          logger.error(`Invalid BetType: ${BetType} (inferred from file: ${file}, type: ${type}). Ignoring bet request. Full request: ${JSON.stringify(betRequest, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`);
          continue;
        }

        if (!BetID || !Bookie) {
          logger.error(`Missing BetID or Bookie. Ignoring bet request. Full request: ${JSON.stringify(betRequest, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`);
          continue;
        }

        // Reconstruct betRequest
        const normalizedBetRequest = {
          BetType,
          BetID,
          ArbCycleID: BetType === 'arb' ? ArbCycleID : undefined,
          Bookie,
          match_id,
          team,
          side,
          odds,
          win_rate,
          ev,
          strategy,
          home_team,
          away_team,
          risk,
          timestamp
        };

        if (BetType === 'value') {
          logger.info(`Processing value bet: ${BetID} for ${Bookie}`);
          await ClusterManager.queueBet({
            config: this.currentConfig,
            betRequest: normalizedBetRequest,
            nc: this.nc,
          });
        } else if (BetType === 'arb') {
          if (!this.arbCycleStore.has(ArbCycleID)) {
            this.arbCycleStore.set(ArbCycleID, {
              bets: [],
              receivedAt: Date.now(),
              expectedBets: 2,
            });
          }

          const cycle = this.arbCycleStore.get(ArbCycleID);
          cycle.bets.push(normalizedBetRequest);

          if (cycle.bets.length >= cycle.expectedBets) {
            logger.info(`Collected all bets for ArbCycleID: ${ArbCycleID}`);
            await ClusterManager.queueBet({
              config: this.currentConfig,
              betRequest: {
                ArbCycleID,
                bets: cycle.bets,
                BetType: 'arb',
              },
              nc: this.nc,
            });
            this.arbCycleStore.delete(ArbCycleID);
          } else {
            logger.info(`Waiting for more bets for ArbCycleID: ${ArbCycleID}. Received ${cycle.bets.length}/${cycle.expectedBets}`);
          }
        }
      } catch (err) {
        logger.error(`Failed to process bet request: ${err.message}. Raw data: length=${msg.data.length}, hex=${msg.data.toString('hex')}, base64=${msg.data.toString('base64')}`);
      }
    }
  }

  async handleAckMessages(subAck) {
    for await (const msg of subAck) {
      try {
        const ack = JSON.parse(this.sc.decode(msg.data));
        const bookie = msg.subject.split('.')[0];
        logger.info(`Received ack from ${bookie}: ${JSON.stringify(ack)}`);

        const { ArbCycleID, BetID, Status } = ack;

        if (!BetID) {
          logger.error(`Missing BetID in ack from ${bookie}. Ignoring.`);
          continue;
        }

        if (ArbCycleID) {
          if (!this.ackStore.has(ArbCycleID)) {
            this.ackStore.set(ArbCycleID, {
              acks: [],
              receivedAt: Date.now(),
              expectedAcks: 2,
            });
          }

          const cycle = this.ackStore.get(ArbCycleID);
          cycle.acks.push({ ...ack, Bookie: bookie });

          if (cycle.acks.length >= cycle.expectedAcks) {
            logger.info(`Received all acks for ArbCycleID: ${ArbCycleID}`);
            const allSuccessful = cycle.acks.every((a) => a.Status === 'Success');

            if (allSuccessful) {
              logger.info(`Arb cycle ${ArbCycleID} successfully placed across bookies`);
            } else {
              logger.warn(`Arb cycle ${ArbCycleID} incomplete. Some bets failed.`);
              cycle.acks
                .filter((a) => a.Status === 'Success')
                .forEach((a) =>
                  this.nc.publish(`${a.Bookie}.cancel`, this.sc.encode(JSON.stringify({ BetID: a.BetID, ArbCycleID })))
                );
            }

            this.ackStore.delete(ArbCycleID);
          } else {
            logger.info(`Waiting for more acks for ArbCycleID: ${ArbCycleID}. Received ${cycle.acks.length}/${cycle.expectedAcks}`);
          }
        } else {
          logger.info(`Received ack for value bet ${BetID} from ${bookie}: ${Status}`);
          if (Status !== 'Success') {
            logger.warn(`Value bet ${BetID} failed at ${bookie}: ${ack.Error || 'Unknown error'}`);
          }
        }
      } catch (err) {
        logger.error(`Failed to process ack: ${err.message}`);
      }
    }
  }

  async handleReturnMessages(subReturns) {
    for await (const msg of subReturns) {
      try {
        const returnData = JSON.parse(this.sc.decode(msg.data));
        const bookie = msg.subject.split('.')[0];
        logger.info(`Received return from ${bookie}: ${JSON.stringify(returnData)}`);

        const { ArbCycleID, BetID, Result, Return, Stake } = returnData;

        if (!BetID) {
          logger.error(`Missing BetID in return from ${bookie}. Ignoring.`);
          continue;
        }

        if (ArbCycleID) {
          if (!this.returnsStore.has(ArbCycleID)) {
            this.returnsStore.set(ArbCycleID, {
              returns: [],
              receivedAt: Date.now(),
              expectedReturns: 2,
            });
          }

          const cycle = this.returnsStore.get(ArbCycleID);
          cycle.returns.push({ ...returnData, Bookie: bookie });

          if (cycle.returns.length >= cycle.expectedReturns) {
            logger.info(`Received all returns for ArbCycleID: ${ArbCycleID}`);
            const totalInvested = cycle.returns.reduce((sum, r) => sum + (r.Stake || 0), 0);
            const totalReturn = cycle.returns.reduce((sum, r) => sum + (r.Return || 0), 0);
            const profit = totalReturn - totalInvested;
            logger.info(`Arb cycle ${ArbCycleID} profit/loss: ${profit}`);
            this.returnsStore.delete(ArbCycleID);
          } else {
            logger.info(`Waiting for more returns for ArbCycleID: ${ArbCycleID}. Received ${cycle.returns.length}/${cycle.expectedReturns}`);
          }
        } else {
          logger.info(`Received return for value bet ${BetID} from ${bookie}: ${Result}, Return: ${Return}`);
          const stake = Stake || 0;
          const profit = Return - stake;
          logger.info(`Value bet ${BetID} profit/loss: ${profit}`);
        }
      } catch (err) {
        logger.error(`Failed to process return: ${err.message}`);
      }
    }
  }

  periodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      const timeoutMs = 30_000;

      const cleanupStore = (store, storeName) => {
        for (const [id, entry] of store.entries()) {
          if (now - entry.receivedAt > timeoutMs) {
            logger.warn(`Timeout for ${id} in ${storeName}. Items received: ${entry.bets?.length || entry.acks?.length || entry.returns?.length}`);
            store.delete(id);
          }
        }
      };

      cleanupStore(this.arbCycleStore, 'arbCycleStore');
      cleanupStore(this.ackStore, 'ackStore');
      cleanupStore(this.returnsStore, 'returnsStore');
    }, 10_000);
  }

  async close() {
    if (this.nc) {
      await this.nc.close().catch(e => logger.warn(`Error closing NATS: ${e.message}`));
      logger.info('NATS connection closed');
    }
  }
}
