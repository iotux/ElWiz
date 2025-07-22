#!/usr/bin/env node

const fs = require("fs");
const express = require("express");
const yaml = require("js-yaml");
const path = require("path");
const MQTTClient = require("./mqtt/mqtt");
const WebSocketServer = require("./lib/chartserver/webSocketServer");
const ChartDataService = require("./lib/chartserver/chartDataService");
const HassChartIntegration = require("./lib/chartserver/hassChartIntegration");
const PriceService = require("./lib/common/priceService.js");
const { event } = require("./misc/misc.js");

const app = express();
const configPath = "./chart-config.yaml";
let config;

// --- Logger Setup (Basic Console Logger) ---
const logger = {
  info: (message) => console.log(`[Server INFO] ${message}`),
  warn: (message) => console.warn(`[Server WARN] ${message}`),
  error: (message) => console.error(`[Server ERROR] ${message}`),
  debug: (message) => {
    // Initial config load might not be done yet when logger is defined.
    // So, check config existence before accessing serverConfig.debug.
    if (config && config.serverConfig && config.serverConfig.debug) {
      console.log(`[Server DEBUG] ${message}`);
    }
  },
};

// --- Load Main Configuration ---
try {
  const fileContents = fs.readFileSync(configPath, "utf8");
  config = yaml.load(fileContents);
} catch (error) {
  logger.error(
    `[Server] Fatal error loading config file ${configPath}: ${error.message}`,
  );
  process.exit(1);
}

const serverConfig = config.serverConfig || {};
let chartConfig = config.chartConfig || {}; // Client-side chart config

// --- MQTT Client Setup ---
// This client will be used by PriceService for price topics AND by chart server for its specific topics.
const mqttUrl = serverConfig.mqttUrl || "mqtt://localhost:1883";
const mqttOpts = serverConfig.mqttOptions || {};
// Set a 'will' topic for the chart server itself
mqttOpts.will = {
  topic: `${serverConfig.haBaseTopic || "elwiz"}/chart/status`,
  payload: "offline",
  retain: true,
  qos: 0,
};
const sharedMqttClient = new MQTTClient(
  mqttUrl,
  mqttOpts,
  "ChartSystemClient",
  logger,
); // One client for this system part

// --- Instantiate PriceService ---
// PriceService will use the sharedMqttClient to subscribe to price topics.
const priceServiceInstance = new PriceService(
  sharedMqttClient,
  {
    priceTopic: serverConfig.priceTopic, // From chart-config.yaml
    debug: serverConfig.debug,
  },
  logger,
  event,
);

// --- Instantiate Other Services ---
// ChartDataService gets the PriceService instance to fetch data.
// It also gets the sharedMqttClient for its own publications (e.g., hourly stats to MQTT if needed).
const webSocketServer = new WebSocketServer(
  serverConfig.wsServerPort || 8322,
  null, // Temporarily pass null for chartDataService
  logger,
);
const chartDataService = new ChartDataService(
  serverConfig,
  sharedMqttClient,
  priceServiceInstance,
  webSocketServer, // Pass webSocketServer instance
  logger,
);
webSocketServer.chartDataService = chartDataService; // Assign chartDataService after both are initialized
// HassIntegrationChart uses the sharedMqttClient to publish HASS discovery/status.
const hassChartIntegration = new HassChartIntegration(
  sharedMqttClient,
  serverConfig,
  logger,
);

// --- MQTT Message Handling (Now only for chart-specific adjustments) ---
sharedMqttClient.on("message", async (topic, message) => {
  logger.debug(`[Server] MQTT message received on topic: ${topic}`);
  const chartTopicBase = serverConfig.chartTopic || "elwiz/chart";

  if (topic.startsWith(chartTopicBase)) {
    await chartDataService.processMqttChartAdjustment(topic, message);
  }
});

// --- MQTT Subscriptions (Chart Server Specific) ---
// PriceService handles its own price topic subscriptions.
// Chart server only needs to subscribe to topics for its direct interactions (e.g., adjustments).
function setupChartServerSubscriptions() {
  try {
    const chartTopic = serverConfig.chartTopic || "elwiz/chart";
    sharedMqttClient.subscribe(`${chartTopic}/#`); // For chart adjustments like 'elwiz/chart/adjustLeftAvgOffset'
    logger.info(
      `[Server] Subscribed to MQTT topic: ${chartTopic}/# for chart adjustments.`,
    );

    // Publish HASS discovery messages and availability once connected and subscriptions are set up.
    hassChartIntegration.publishDiscoveryMessages();
    hassChartIntegration.publishAvailability(true);
  } catch (err) {
    logger.error(
      "[Server] MQTT subscription error for chart-specific topics: " + err,
    );
  }
}

// Setup subscriptions once MQTT client connects.
// PriceService also sets up its subscriptions on its own client instance or the shared one.
sharedMqttClient.on("connect", () => {
  logger.info(
    "[Server] Shared MQTT Client connected. Setting up chart server subscriptions.",
  );
  setupChartServerSubscriptions();
  // PriceService already started its subscription process upon instantiation.
  // If PriceService needed to wait for connect, it would handle that internally.
});
if (sharedMqttClient.connected) {
  // If already connected by the time we reach here
  logger.info(
    "[Server] Shared MQTT Client was already connected. Setting up chart server subscriptions.",
  );
  setupChartServerSubscriptions();
}

event.on('newPrices', async () => {
    logger.info('[Server] newPrices event received. Triggering chart update.');
    await chartDataService.handlePriceUpdate();
});

// --- Scheduled Tasks ---
async function runHourlyTasks() {
  logger.debug("[Server] Running hourly tasks...");
  await chartDataService.performHourlyTasks();
}

function scheduleHourlyTasks() {
  const now = new Date();
  const minutesToNextHour = 60 - now.getMinutes();
  const secondsToNextHour = minutesToNextHour * 60 - now.getSeconds();
  const msToNextHour = secondsToNextHour * 1000;

  logger.info(
    `[Server] Scheduling first hourly task in ${msToNextHour / 1000} seconds.`,
  );

  setTimeout(() => {
    logger.info(
      "[Server] Performing initial run of hourly tasks post-startup (after alignment with hour).",
    );
    runHourlyTasks();
    setInterval(runHourlyTasks, 3600000); // Run every hour
    logger.info("[Server] Hourly tasks scheduled to run every hour.");
  }, msToNextHour);

  // Optional: a quick refresh shortly after startup if needed, if retained price data should immediately populate the chart.
  // This might be useful if retained price data should immediately populate the chart.
  // PriceService attempts an initial load; ChartDataService also does an initial refresh.
  // This explicit call ensures chartDataService syncs with PriceService after initial loads.
  setTimeout(async () => {
    logger.info(
      "[Server] Performing initial ChartDataService sync with PriceService post-startup.",
    );
    await chartDataService.handlePriceUpdate();
  }, 5000); // 5 seconds after startup
}

// --- Express Web Server Setup ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/chart", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chart.html"));
});

app.get("/icon-day", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "icon-day.png"));
});
app.get("/icon-night", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "icon-night.png"));
});

app.get("/config", (req, res) => {
  try {
    const currentFileConfig = yaml.load(fs.readFileSync(configPath, "utf8"));
    chartConfig = currentFileConfig.chartConfig || {};
  } catch (error) {
    logger.error(
      `[Server] Error reloading chart-config.yaml for /config route: ${error.message}`,
    );
  }
  const clientConfig = { ...chartConfig };
  res.json(clientConfig);
});

const serverPort = serverConfig.serverPort || 8321;
app.listen(serverPort, () => {
  logger.info(
    `[Server] HTTP server is running on http://localhost:${serverPort}`,
  );
  // MQTT client connection and subscriptions are handled above.
  // PriceService starts fetching data on its own.
  // ChartDataService will get data from PriceService.
  scheduleHourlyTasks(); // Start scheduled tasks once the server is up.
});

// --- Graceful Shutdown ---
function gracefulShutdown() {
  logger.info("[Server] Attempting graceful shutdown...");
  hassChartIntegration.publishAvailability(false); // Set HASS status to offline

  // Close WebSocket server
  webSocketServer.wss.close(() => {
    logger.info("[Server] WebSocket server closed.");
    // Disconnect MQTT client after WS server is closed
    sharedMqttClient.end(false, () => {
      logger.info("[Server] MQTT client disconnected.");
      process.exit(0);
    });
  });

  // Force shutdown if graceful fails
  setTimeout(() => {
    logger.warn("[Server] Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);