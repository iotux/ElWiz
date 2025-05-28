#!/usr/bin/env node
// src/main.js
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

// Load core components
const logger = require('./core/logger');
const eventBus = require('./core/eventBus');

// CONFIG_PATHS is not used in the provided snippet, but kept for structural reference
// const CONFIG_PATHS = [
//   path.join(__dirname, '../config/default-config.yaml'), // Default config
//   path.join(__dirname, '../config/config.yaml'), // User overrides
// ];

let config = {}; // This will hold the fully merged configuration.
// To store initialized module instances if needed by other modules (Dependency Injection)
const services = {
  eventBus: eventBus,
  logger: logger,
};

function loadConfig() {
  logger.info('Main', 'Loading configuration...');
  let baseConfig = {};
  let userConfig = {};

  const defaultConfigPath = path.join(__dirname, '../config/default-config.yaml');
  if (fs.existsSync(defaultConfigPath)) {
    try {
      const fileContents = fs.readFileSync(defaultConfigPath, 'utf8');
      baseConfig = yaml.load(fileContents);
      logger.info('Main', `Default configuration loaded from ${defaultConfigPath}`);
    } catch (e) {
      logger.error('Main', `Error loading or parsing default config file ${defaultConfigPath}: ${e.message}`);
      process.exit(1);
    }
  } else {
    logger.warn('Main', `Default config file not found: ${defaultConfigPath}. Proceeding with empty default config.`);
  }

  const userConfigPath = path.join(__dirname, '../config/config.yaml');
  if (fs.existsSync(userConfigPath)) {
    try {
      const fileContents = fs.readFileSync(userConfigPath, 'utf8');
      userConfig = yaml.load(fileContents);
      logger.info('Main', `User configuration loaded from ${userConfigPath}`);
    } catch (e) {
      logger.error('Main', `Error loading or parsing user config file ${userConfigPath}: ${e.message}`);
    }
  } else {
    logger.info('Main', `User config file not found (optional): ${userConfigPath}`);
  }

  const deepMerge = (target, source) => {
    for (const key in source) {
      if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  };

  config = yaml.load(yaml.dump(baseConfig));
  deepMerge(config, userConfig);

  if (config.main && config.main.logLevel) {
    logger.setLogLevel(config.main.logLevel);
    logger.info('Main', `Log level set to: ${config.main.logLevel}`);
  } else {
    logger.info('Main', `Using default log level: ${logger.getLogLevel()}`);
  }
}

function initializeModules() {
  logger.info('Main', 'Initializing modules...');

  if (!config.modules) {
    logger.warn('Main', 'No modules defined in configuration.');
    return;
  }

  // --- PriceServiceModule ---
  if (config.modules.priceService && config.modules.priceService.enabled) {
    logger.info('Main', 'Loading PriceServiceModule...');
    try {
      const PriceServiceModule = require('./modules/priceService');
      const psModuleSettings = config.modules.priceService;
      const psMqttConf = psModuleSettings.mqtt || (config.main && config.main.mqtt) || {};
      const priceServiceEffectiveConfig = {
        ...psModuleSettings,
        mqttUrl: psMqttConf.url || 'mqtt://localhost:1883',
        mqttOptions: psMqttConf.options || {},
        mqttClientName: psMqttConf.clientName || 'ElWiz_PriceService_DefaultClient',
      };
      const priceService = new PriceServiceModule(priceServiceEffectiveConfig, logger, eventBus);
      priceService.start();
      services.priceService = priceService;
      logger.info('Main', 'PriceServiceModule loaded and started.');
    } catch (e) {
      logger.error('Main', `Failed to load or start PriceServiceModule: ${e.message}`, e.stack);
    }
  } else {
    logger.info('Main', 'PriceServiceModule is disabled in configuration.');
  }

  // --- ChartServiceModule ---
  if (config.modules.chartService && config.modules.chartService.enabled) {
    logger.info('Main', 'Loading ChartServiceModule...');
    try {
      const ChartServiceModule = require('./modules/chartService');
      const csModuleSettings = config.modules.chartService;
      const csMqttConf = csModuleSettings.mqtt || (config.main && config.main.mqtt) || {};
      const chartServiceEffectiveConfig = {
        ...csModuleSettings,
        mqttUrl: csMqttConf.url || 'mqtt://localhost:1883',
        mqttOptions: csMqttConf.options || {},
        mqttClientName: csMqttConf.clientName || 'ElWiz_ChartService_DefaultClient',
      };
      const chartService = new ChartServiceModule(chartServiceEffectiveConfig, logger, eventBus);
      chartService.start();
      services.chartService = chartService;
      logger.info('Main', 'ChartServiceModule loaded and started.');
    } catch (e) {
      logger.error('Main', `Failed to load or start ChartServiceModule: ${e.message}`, e.stack);
    }
  } else {
    logger.info('Main', 'ChartServiceModule is disabled in configuration.');
  }

  // --- WebSocketInterfaceModule ---
  if (config.modules.webSocketInterface && config.modules.webSocketInterface.enabled) {
    logger.info('Main', 'Loading WebSocketInterfaceModule...');
    if (!services.chartService) {
      logger.error('Main', 'WebSocketInterfaceModule cannot start because ChartServiceModule is not available or not enabled.');
    } else {
      try {
        const WebSocketInterfaceModule = require('./modules/webSocketInterface');
        const wsConfig = config.modules.webSocketInterface;
        const webSocketInterface = new WebSocketInterfaceModule(wsConfig, logger, eventBus, services.chartService);
        webSocketInterface.start();
        services.webSocketInterface = webSocketInterface;
        logger.info('Main', 'WebSocketInterfaceModule loaded and started.');
      } catch (e) {
        logger.error('Main', `Failed to load or start WebSocketInterfaceModule: ${e.message}`, e.stack);
      }
    }
  } else {
    logger.info('Main', 'WebSocketInterfaceModule is disabled in configuration.');
  }

  // --- HttpServerModule ---
  if (config.modules.httpServer && config.modules.httpServer.enabled) {
    logger.info('Main', 'Loading HttpServerModule...');
    if (!services.chartService) {
      logger.error('Main', 'HttpServerModule cannot start because ChartServiceModule is not available or not enabled (needed for /config route).');
    } else {
      try {
        const HttpServerModule = require('./modules/httpServer');
        const httpConfig = config.modules.httpServer;
        const httpServer = new HttpServerModule(httpConfig, logger, services.chartService, config); // Pass global config for chartConfig access
        httpServer.start();
        services.httpServer = httpServer;
        logger.info('Main', 'HttpServerModule loaded and started.');
      } catch (e) {
        logger.error('Main', `Failed to load or start HttpServerModule: ${e.message}`, e.stack);
      }
    }
  } else {
    logger.info('Main', 'HttpServerModule is disabled in configuration.');
  }

  // --- HanReaderModule ---
  if (config.modules.hanReader && config.modules.hanReader.enabled) {
    logger.info('Main', 'Loading HanReaderModule...');
    try {
      const HanReaderModule = require('./modules/hanReader');
      const hrModuleSettings = config.modules.hanReader;
      const hrMqttConf = hrModuleSettings.mqtt || (config.main && config.main.mqtt) || {};
      const hanReaderEffectiveConfig = {
        ...hrModuleSettings,
        mqttUrl: hrMqttConf.url || 'mqtt://localhost:1883',
        mqttOptions: hrMqttConf.options || {},
        mqttClientName: hrMqttConf.clientName || 'ElWiz_HanReader_DefaultClient',
      };
      const hanReader = new HanReaderModule(hanReaderEffectiveConfig, logger, eventBus);
      hanReader.start();
      services.hanReader = hanReader;
      logger.info('Main', 'HanReaderModule loaded and started.');
    } catch (e) {
      logger.error('Main', `Failed to load or start HanReaderModule: ${e.message}`, e.stack);
    }
  } else {
    logger.info('Main', 'HanReaderModule is disabled in configuration.');
  }

  // --- HanDataProcessorModule --- ADDED SECTION ---
  // Ensure this is placed after HanReaderModule if it depends on its config,
  // or in a logical order with other modules.
  if (config.modules.hanDataProcessor && config.modules.hanDataProcessor.enabled) {
    logger.info('Main', 'Loading HanDataProcessorModule...');
    try {
      const HanDataProcessorModule = require('./modules/hanDataProcessor');

      const hdpModuleSettings = config.modules.hanDataProcessor;
      let meterModelValue = null;
      if (config.modules.hanReader && config.modules.hanReader.meterModel) {
        meterModelValue = config.modules.hanReader.meterModel;
        logger.info('Main', `HanDataProcessorModule will use meterModel '${meterModelValue}' from hanReader config.`);
      } else {
        logger.warn('Main', 'meterModel not found in hanReader config for HanDataProcessorModule. It may not select a specific parser.');
      }

      const hanDataProcessorEffectiveConfig = {
        ...(hdpModuleSettings || {}),
        meterModel: meterModelValue,
        debug: hdpModuleSettings && typeof hdpModuleSettings.debug !== 'undefined' ? hdpModuleSettings.debug : config.main && config.main.logLevel === 'debug',
      };

      const hanDataProcessor = new HanDataProcessorModule(hanDataProcessorEffectiveConfig, logger, eventBus);
      hanDataProcessor.start();
      services.hanDataProcessor = hanDataProcessor;
      logger.info('Main', 'HanDataProcessorModule loaded and started.');
    } catch (e) {
      logger.error('Main', 'Failed to load or start HanDataProcessorModule: ' + e.message, e.stack);
    }
  } else {
    logger.info('Main', 'HanDataProcessorModule is not defined or disabled in configuration.');
  }
  // --- END ADDED SECTION for HanDataProcessorModule ---

  // --- ElwizLogicModule ---
  if (config.modules.elwizLogic && config.modules.elwizLogic.enabled) {
    logger.info('Main', 'Loading ElwizLogicModule...');
    try {
      const ElwizLogicModule = require('./modules/elwizLogic');
      const elwizLogicConfig = config.modules.elwizLogic;
      const elwizLogic = new ElwizLogicModule(elwizLogicConfig, logger, eventBus);
      elwizLogic.start();
      services.elwizLogic = elwizLogic;
      logger.info('Main', 'ElwizLogicModule loaded and started.');
    } catch (e) {
      logger.error('Main', `Failed to load or start ElwizLogicModule: ${e.message}`, e.stack);
    }
  } else {
    logger.info('Main', 'ElwizLogicModule is disabled in configuration.');
  }

  logger.info('Main', 'Module initialization complete.');
}

function start() {
  logger.info('Main', 'Starting ElWiz-NG Application...');
  loadConfig();
  initializeModules();

  logger.info('Main', 'ElWiz-NG Application started successfully.');

  // Listener for PriceService events
  eventBus.on('prices:updated', (priceData) => {
    logger.debug('Main', '[EVENT] prices:updated - Current Day:', priceData && priceData.currentPriceDate ? priceData.currentPriceDate : 'N/A', '- Next Day Available:', priceData ? priceData.nextDayAvailable : 'N/A');
  });

  // Listeners for ChartService events
  eventBus.on('chart:dataUpdated', (/* chartData */) => {
    logger.debug('Main', '[EVENT] chart:dataUpdated - Chart data for WebSocket clients has been updated.');
  });
  eventBus.on('chart:currentHourInfo', (hourInfo) => {
    logger.debug('Main', '[EVENT] chart:currentHourInfo - Spot Price:', hourInfo ? hourInfo.spotPrice : 'N/A', '@', hourInfo ? hourInfo.startTime : 'N/A', 'BelowThreshold:', hourInfo ? hourInfo.isBelowThreshold : 'N/A');
  });

  // Listeners for HanReaderModule events
  eventBus.on('han:data', (hanData) => {
    logger.debug('Main', '[EVENT] han:data - Received from topic:', hanData ? hanData.topic : 'N/A', '- Payload (raw snippet):', hanData && hanData.rawPayload ? hanData.rawPayload.substring(0, 50) + '...' : 'N/A');
  });

  // --- ADDED LISTENER for HanDataProcessorModule events ---
  eventBus.on('han:decoded:kaifa', (kaifaData) => {
    logger.debug('Main', '[EVENT] han:decoded:kaifa - Meter:', kaifaData ? kaifaData.meterModel : 'N/A', '- ListType:', kaifaData && kaifaData.decoded ? kaifaData.decoded.listType : 'N/A');
    // Potentially log more details from kaifaData.decoded if needed for debugging
    // e.g., logger.debug('Main', JSON.stringify(kaifaData.decoded.elements, null, 2));
  });
  eventBus.on('han:decodeError:kaifa', (kaifaError) => {
    logger.warn(
      'Main',
      '[EVENT] han:decodeError:kaifa - Meter:',
      kaifaError ? kaifaError.meterModel : 'N/A',
      '- Error:',
      kaifaError ? kaifaError.error : 'Unknown error',
      '- Payload Snippet:',
      kaifaError && kaifaError.rawPayload ? kaifaError.rawPayload.substring(0, 50) + '...' : 'N/A',
    );
  });
  // --- END ADDED LISTENER ---

  // Listeners for ElwizLogicModule events (placeholder for now)
  eventBus.on('elwiz:stats', (stats) => {
    logger.debug('Main', '[EVENT] elwiz:stats - Received stats object. HAN data timestamp:', stats && stats.rawHanPayload ? 'Present' : 'Missing', 'Cost calculation attempted:', stats ? stats.costCalculationAttempted : 'N/A');
  });
}

start();

process.on('uncaughtException', (error) => {
  logger.error('Main', 'Unhandled Exception:', error.message, error.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Main', 'Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
