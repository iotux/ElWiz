#!/usr/bin/env node

const fs = require("fs");
const express = require("express");
const yaml = require("js-yaml");
const path = require("path");
const MQTTClient = require("./mqtt/mqtt"); // Main MQTT client for the application
const WebSocketServer = require("./lib/chartserver/webSocketServer");
const ChartDataService = require("./lib/chartserver/chartDataService");
const HassIntegrationChart = require("./lib/chartserver/hassIntegrationChart");

const app = express();
const configPath = "./chart-config.yaml";
let config;

// --- Logger Setup (Basic Console Logger) ---
// You can replace this with a more sophisticated logger if needed
const logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  debug: (message) => {
    if (config && config.serverConfig && config.serverConfig.debug) {
      console.log(`[DEBUG] ${message}`);
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
const mqttUrl = serverConfig.mqttUrl || "mqtt://localhost:1883";
const mqttOpts = serverConfig.mqttOptions || {};
mqttOpts.will = {
  topic: `${serverConfig.haBaseTopic || "elwiz"}/chart/status`,
  payload: "offline",
  retain: true,
  qos: 0,
};
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, "chartServer", logger);

// --- Instantiate Services ---
const chartDataService = new ChartDataService(serverConfig, mqttClient, logger);
const webSocketServer = new WebSocketServer(
  serverConfig.wsServerPort || 8322,
  chartDataService,
  logger,
);
const hassIntegrationChart = new HassIntegrationChart(
  mqttClient,
  serverConfig,
  logger,
);

// --- MQTT Message Handling ---
mqttClient.on("message", async (topic, message) => {
  logger.debug(`[Server] MQTT message received on topic: ${topic}`);
  const priceTopicBase = serverConfig.priceTopic || "elwiz/prices";
  const chartTopicBase = serverConfig.chartTopic || "elwiz/chart";
  let chartDataNeedsUpdate = false;

  if (topic.startsWith(priceTopicBase)) {
    // processMqttPriceData in ChartDataService now internally calls handleMessages and checkAndSendChartData.
    // It needs to signal back if an update should be broadcast.
    // For now, processMqttPriceData itself doesn't directly return this due to setTimeout.
    // We'll use a temporary mechanism or refine it.
    chartDataService.processMqttPriceData(topic, message);
    // We need a way for processMqttPriceData's async part to trigger wsSendAll
    // Let's assume for now that checkAndSendChartData inside handleMessages
    // will correctly determine if an update is needed.
    // The orchestration will be: MQTT -> processMqttPriceData -> (timeout) -> handleMessages -> checkAndSendChartData
    // If checkAndSendChartData returns true, then we broadcast.
    // This requires handleMessages to return the result of checkAndSendChartData.
    // And processMqttPriceData to somehow make this result available.

    // Simplification: Let's make handleMessages (called by processMqttPriceData's timeout)
    // return the flag and then server.js calls wsSendAll.
    // This is still a bit indirect. A better way is an event emitter from ChartDataService.
    // For now, let's assume chartDataService.triggerHandleMessages() can be called to get the status.
    setTimeout(() => {
      const updated = chartDataService.triggerHandleMessages();
      if (updated) {
        webSocketServer.wsSendAll(
          "chart",
          "update",
          chartDataService.getChartDataForClient(),
        );
      }
    }, 600); // Allow time for data processing
  } else if (topic.startsWith(chartTopicBase)) {
    const updated = chartDataService.processMqttChartAdjustment(topic, message);
    if (updated) {
      webSocketServer.wsSendAll(
        "chart",
        "update",
        chartDataService.getChartDataForClient(),
      );
    }
  }
});

// --- MQTT Subscriptions ---
if (mqttClient.connected) {
  // Or use a connect event
  try {
    const priceTopic = serverConfig.priceTopic || "elwiz/prices";
    const chartTopic = serverConfig.chartTopic || "elwiz/chart";
    mqttClient.subscribe(`${priceTopic}/#`);
    mqttClient.subscribe(`${chartTopic}/#`);
    logger.info(
      `[Server] Subscribed to MQTT topics: ${priceTopic}/# and ${chartTopic}/#`,
    );
  } catch (err) {
    logger.error("[Server] MQTT subscription error: " + err);
  }
} else {
  mqttClient.on("connect", () => {
    logger.info("[Server] MQTT Client connected, setting up subscriptions.");
    try {
      const priceTopic = serverConfig.priceTopic || "elwiz/prices";
      const chartTopic = serverConfig.chartTopic || "elwiz/chart";
      mqttClient.subscribe(`${priceTopic}/#`);
      mqttClient.subscribe(`${chartTopic}/#`);
      logger.info(
        `[Server] Subscribed to MQTT topics: ${priceTopic}/# and ${chartTopic}/#`,
      );
      // Publish HASS discovery messages once connected
      hassIntegrationChart.publishDiscoveryMessages();
      hassIntegrationChart.publishAvailability(true);
    } catch (err) {
      logger.error("[Server] MQTT subscription error after connect: " + err);
    }
  });
}

// --- Scheduled Tasks ---
async function runHourlyTasks() {
  logger.debug("[Server] Running hourly tasks...");
  const chartDataUpdated = await chartDataService.performHourlyTasks();
  if (chartDataUpdated) {
    webSocketServer.wsSendAll(
      "chart",
      "update",
      chartDataService.getChartDataForClient(),
    );
  }
}

function scheduleHourlyTasks() {
  const now = new Date();
  const minutesToNextHour = 60 - now.getMinutes();
  const secondsToNextHour = minutesToNextHour * 60 - now.getSeconds();
  const msToNextHour = secondsToNextHour * 1000;

  logger.info(
    `[Server] Scheduling first hourly task in ${msToNextHour / 1000} seconds.`,
  );

  // Initial run shortly after startup, then aligned to the hour
  setTimeout(() => {
    logger.info(
      "[Server] Performing initial run of hourly tasks post-startup.",
    );
    runHourlyTasks();
  }, 5000); // 5 seconds after startup for initial data processing

  setTimeout(() => {
    logger.info("[Server] Performing first scheduled hourly task.");
    runHourlyTasks();
    setInterval(runHourlyTasks, 3600000); // Run every hour
    logger.info("[Server] Hourly tasks scheduled to run every hour.");
  }, msToNextHour);
}

// --- Express Web Server Setup ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // Serve static files

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
  // Reload config for chartConfig part from file, in case it changed
  try {
    const currentFileConfig = yaml.load(fs.readFileSync(configPath, "utf8"));
    chartConfig = currentFileConfig.chartConfig || {}; // Update client-side config
  } catch (error) {
    logger.error(
      `[Server] Error reloading chart-config.yaml for /config route: ${error.message}`,
    );
    // Potentially send old config or an error
  }
  const clientConfig = { ...chartConfig }; // Clone
  clientConfig.timezoneOffset = chartDataService.getTimezoneOffset();
  res.json(clientConfig);
});

const serverPort = serverConfig.serverPort || 8321;
app.listen(serverPort, () => {
  logger.info(
    `[Server] HTTP server is running on http://localhost:${serverPort}`,
  );
  scheduleHourlyTasks(); // Start scheduled tasks once the server is up
});

// --- Graceful Shutdown (Example) ---
function gracefulShutdown() {
  logger.info("[Server] Attempting graceful shutdown...");
  hassIntegrationChart.publishAvailability(false);
  mqttClient.end(false, () => {
    // end(force=false, options, callback)
    logger.info("[Server] MQTT client disconnected.");
    webSocketServer.wss.close(() => {
      logger.info("[Server] WebSocket server closed.");
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
