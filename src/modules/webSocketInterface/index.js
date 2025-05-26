// src/modules/webSocketInterface/index.js
const WebSocket = require("ws");

// Inner class for managing clients, same as original
class Clients {
  constructor() {
    this.clientList = {};
    // No need to bind here if using arrow functions or direct calls with this.clients
  }
  saveClient(clientId, client) {
    this.clientList[clientId] = client;
  }
  getClient(clientId) {
    return this.clientList[clientId];
  }
  // getClientList() { // Not actively used by the original logic being refactored
  //   return this.clientList;
  // }
  deleteClient(clientId) {
    delete this.clientList[clientId];
  }
  getClientIds() {
    return Object.keys(this.clientList);
  }
}

class WebSocketInterfaceModule {
  constructor(moduleConfig, mainLogger, eventBusInstance, chartServiceInstance) {
    this.config = moduleConfig; // Expected: { wsPort }
    this.logger = mainLogger;
    this.eventBus = eventBusInstance;
    this.chartService = chartServiceInstance; // Instance of ChartServiceModule
    this.moduleName = 'WebSocketInterfaceModule';
    
    this.clients = new Clients();
    this.wss = null; // Will be initialized in start()

    this.logger.info(this.moduleName, "Initialized.");
  }

  start() {
    const wsPort = this.config.wsPort || 8322; // Default port if not specified
    if (!this.chartService || typeof this.chartService.getChartDataForClient !== 'function') {
        this.logger.error(this.moduleName, "ChartService instance is missing or invalid. WebSocket server not started.");
        return;
    }

    try {
        this.wss = new WebSocket.Server({ port: wsPort });
        this._setupConnectionHandler(); // Renamed from setupConnectionHandler for clarity
        this._setupEventListeners();
        this.logger.info(this.moduleName, `WebSocket server started on port ${wsPort}`);
    } catch (error) {
        this.logger.error(this.moduleName, `Failed to start WebSocket server on port ${wsPort}: ${error.message}`, error.stack);
    }
  }

  _setupEventListeners() {
    this.eventBus.on('chart:dataUpdated', (chartData) => {
      if (this.config.debug) this.logger.debug(this.moduleName, "Received 'chart:dataUpdated' event. Broadcasting to clients.");
      this.wsSendAll('chart', 'update', chartData); // 'update' topic might be what client expects for full refresh
    });
  }

  _setupConnectionHandler() {
    this.wss.on("connection", (client) => {
      // client is the raw WebSocket object for this connection
      // We will assign our clientId to it after the first message
      this.logger.info(this.moduleName, "A client connected.");

      client.on("message", (message) => {
        let data;
        try {
          const messageString = message.toString(); // Ensure it's a string
          data = JSON.parse(messageString);
        } catch (error) {
          this.logger.error(this.moduleName, `Error parsing message: "${message.toString()}". Error: ${error.message}`); // Log original message on error
          return; // Ignore malformed messages
        }
        
        const channel = data["channel"]; // Not actively used in original for routing, but part of protocol
        const topic = data["topic"];     // Not actively used
        const msgPayload = data["payload"];
        const receivedClientId = data.clientId;

        if (!client.clientId && receivedClientId) {
          client.clientId = receivedClientId; // Assign clientId from first valid message
          this.clients.saveClient(receivedClientId, client);
          this.logger.info(this.moduleName, `Client registered with ID: ${receivedClientId}`);
        } else if (!receivedClientId) {
            this.logger.warn(this.moduleName, "Message received without clientId from an unregistered client.");
            // Optionally close connection if strict clientId protocol is required from first message
            // For now, we'll allow it if client.clientId was set by a previous message.
        }


        if (msgPayload === "init" && client.clientId) {
          this.logger.info(this.moduleName, `Request from client ${client.clientId}: type 'init'`);
          const chartData = this.chartService.getChartDataForClient();
          if (chartData && chartData.length > 0) { // Check if chartData has content
            this.wsSend(client.clientId, client.clientId, "full", chartData); // topic 'full' often implies full dataset
          } else {
            this.logger.info(this.moduleName, `No chart data available to send for client ${client.clientId} on 'init'.`);
            // Optionally send an empty array or a specific "no_data" message
            this.wsSend(client.clientId, client.clientId, "full", []); // Send empty array if no data
          }
        }
        if (this.config.debug) this.logger.debug(this.moduleName, `Active clients: ${this.clients.getClientIds()}`);
      });

      client.on("close", (code, reason) => {
        const reasonStr = reason ? reason.toString() : "No reason given";
        this.logger.info(this.moduleName, `Connection closed for client ${client.clientId || "unknown"}. Code: ${code}, Reason: ${reasonStr}`);
        if (client.clientId) {
          this.clients.deleteClient(client.clientId);
          this.logger.info(this.moduleName, `Client removed: ${client.clientId}. Active clients: ${this.clients.getClientIds()}`);
        }
      });

      client.on("error", (error) => {
        this.logger.error(this.moduleName, `Error on client ${client.clientId || "unknown"}: ${error.message}`);
        // Ensure client is cleaned up if an error causes a disconnect without a formal close
        if (client.clientId && client.readyState !== WebSocket.OPEN && client.readyState !== WebSocket.CONNECTING) {
            this.clients.deleteClient(client.clientId);
            this.logger.info(this.moduleName, `Client removed due to error: ${client.clientId}. Active clients: ${this.clients.getClientIds()}`);
        }
      });
    });
  }

  // Send to a specific client by clientId
  wsSend(clientId, channel, topic, message) {
    const wsClient = this.clients.getClient(clientId); // wsClient is the actual WebSocket object
    if (!wsClient) {
      if (this.config.debug) this.logger.debug(this.moduleName, `Client ${clientId} not found for sending message.`);
      return;
    }
    if (wsClient.readyState === WebSocket.OPEN) {
      try {
        wsClient.send(
          JSON.stringify({
            channel: channel, // Can be clientId or a specific channel name
            topic: topic,
            payload: message,
          })
        );
      } catch (error) {
        this.logger.error(this.moduleName, `Error sending message to client ${clientId}: ${error.message}`);
      }
    } else {
        if (this.config.debug) this.logger.debug(this.moduleName, `Client ${clientId} not OPEN (state: ${wsClient.readyState}). Message not sent.`);
    }
  }

  // Send to all connected and open clients
  wsSendAll(channel, topic, message) {
    if (!this.wss || !this.wss.clients) return;

    this.wss.clients.forEach((client) => { // client here is the raw WebSocket object from ws library
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(
            JSON.stringify({
              channel: channel, // General channel like 'chart'
              topic: topic,     // e.g., 'update'
              payload: message,
            })
          );
        } catch (error) {
          this.logger.error(this.moduleName, `Error sending message to all (client ${client.clientId || "unknown"}): ${error.message}`);
        }
      }
    });
    if (this.config.debug) this.logger.debug(this.moduleName, `Sent message on topic '${topic}' to all clients.`);
  }
}

module.exports = WebSocketInterfaceModule;

