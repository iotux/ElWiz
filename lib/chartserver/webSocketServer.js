const WebSocket = require("ws");

class Clients {
  constructor() {
    this.clientList = {};
    this.saveClient = this.saveClient.bind(this);
    this.getClient = this.getClient.bind(this);
    this.getClientList = this.getClientList.bind(this);
    this.deleteClient = this.deleteClient.bind(this);
  }
  saveClient(clientId, client) {
    this.clientList[clientId] = client;
  }
  getClient(clientId) {
    return this.clientList[clientId];
  }
  getClientList() {
    return this.clientList;
  }
  deleteClient(clientId) {
    delete this.clientList[clientId];
  }
  getClientIds() {
    return Object.keys(this.clientList);
  }
}

class WebSocketServer {
  constructor(wsServerPort, chartDataService, logger = console) {
    this.wss = new WebSocket.Server({ port: wsServerPort });
    this.clients = new Clients();
    this.chartDataService = chartDataService;
    this.logger = logger;
    this.setupConnectionHandler();
  }

  setupConnectionHandler() {
    this.wss.on("connection", (client) => {
      let clientId; // Declare clientId here to make it accessible in the close handler

      client.on("message", (message) => {
        try {
          const data = JSON.parse(message);
          const channel = data["channel"];
          const topic = data["topic"];
          const msg = data["payload"];

          if (!clientId) {
            clientId = data.clientId;
            client.clientId = clientId; // Store clientId on the client object
          }

          this.clients.saveClient(clientId, client);
          // const ws = this.clients.getClient(clientId); // ws is client itself

          if (msg === "init") {
            this.logger.info(
              `[WebSocketServer] Request from client ${clientId}: ${JSON.stringify(data)}`,
            );
            const chartData = this.chartDataService.getChartDataForClient();
            if (chartData) {
              if (chartData.chartData.length === 0) {
                this.logger.warn(`[WebSocketServer] Chart data is empty for client ${clientId}`);
              } else {
                this.logger.info(`[WebSocketServer] Sending chart data to client ${clientId}`);
              }
              this.wsSend(clientId, clientId, "full", chartData);
            } else {
              this.logger.warn(
                `[WebSocketServer] No chart data available for client ${clientId}`,
              );
            }
          }
          this.logger.info(
            `[WebSocketServer] Active clients: ${this.clients.getClientIds()}`,
          );
        } catch (error) {
          this.logger.error(
            `[WebSocketServer] Error processing message: ${error.message}`,
          );
        }
      });

      client.on("close", (connection) => {
        this.logger.info(
          `[WebSocketServer] Connection closed for clientId: ${client.clientId}, connection: ${connection}`,
        );
        if (client.clientId) {
          this.clients.deleteClient(client.clientId);
          this.logger.info(
            `[WebSocketServer] Client removed: ${client.clientId}. Active clients: ${this.clients.getClientIds()}`,
          );
        }
      });

      client.on("error", (error) => {
        this.logger.error(
          `[WebSocketServer] Error on client ${client.clientId || "unknown"}: ${error.message}`,
        );
      });
    });

    this.logger.info(
      `[WebSocketServer] WebSocket server started on port ${this.wss.options.port}`,
    );
  }

  wsSend(clientId, channel, topic, payload) {
    const ws = this.clients.getClient(clientId);
    if (!ws) {
      return;
    }
    try {
      ws.send(
        JSON.stringify({
          channel: channel,
          topic: topic,
          payload: payload,
        }),
      );
    } catch (error) {
      this.logger.error(
        `[WebSocketServer] Error sending message to client ${clientId}: ${error.message}`,
      );
    }
  }

  wsSendAll(channel, topic, payload) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(
            JSON.stringify({
              channel: channel,
              topic: topic,
              payload: payload,
            }),
          );
        } catch (error) {
          this.logger.error(
            `[WebSocketServer] Error sending message to all clients (client ${client.clientId || "unknown"}): ${error.message}`,
          );
        }
      }
    });
  }
}

module.exports = WebSocketServer;
