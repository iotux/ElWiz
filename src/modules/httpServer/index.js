// src/modules/httpServer/index.js
const express = require('express');
const path = require('path');
const fs = require('fs'); // For reading chart-config.yaml if dynamic config loading for client is kept
const yaml = require('js-yaml'); // For reading chart-config.yaml

class HttpServerModule {
  constructor(moduleConfig, mainLogger, chartServiceInstance, fullAppConfig) {
    this.config = moduleConfig; // Expected: { httpPort, publicDir, debug }
    this.logger = mainLogger;
    this.chartService = chartServiceInstance; // Instance of ChartServiceModule
    this.appConfig = fullAppConfig; // Full application config, contains chartConfig for client
    //this.logger.info(this.moduleName, 'Constructor: appConfig.chartConfig is:', JSON.stringify(this.appConfig ? this.appConfig.chartConfig : 'appConfig or chartConfig is null/undefined'));
    this.moduleName = 'HttpServerModule';

    this.app = express();
    this._setupMiddleware();
    this._setupRoutes();

    this.logger.info(this.moduleName, 'Initialized.');
  }

  _setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Determine public directory path
    // Assuming moduleConfig.publicDir is relative to project root, e.g., "./public"
    // If main.js is in src/, then __dirname for main.js is /path/to/project/src
    // path.resolve can build an absolute path robustly.
    // For now, assume publicDir is like './public' and main.js is in 'src/'
    // So, path.join(__dirname, '../../', this.config.publicDir || 'public') might be needed if __dirname is used from here.
    // Simpler: main.js can resolve the publicDir to an absolute path and pass it in moduleConfig.
    // For this subtask, let's assume moduleConfig.publicDir IS the correct path or relative from project root.
    // If main.js is in src, and public is at root, then path from here is ../../public
    // Let's assume public path is relative to project root for now.
    const publicPath = path.resolve(this.config.publicDir || 'public');
    this.logger.info(this.moduleName, `Serving static files from: ${publicPath}`);
    this.app.use(express.static(publicPath));
  }

  _setupRoutes() {
    // Route for the main chart page
    this.app.get('/chart', (req, res) => {
      // Assuming chart.html is at the root of the publicPath
      res.sendFile(path.join(path.resolve(this.config.publicDir || 'public'), 'chart.html'));
    });

    // Routes for icons (assuming they are at the root of publicPath)
    this.app.get('/icon-day', (req, res) => {
      res.sendFile(path.join(path.resolve(this.config.publicDir || 'public'), 'icon-day.png'));
    });

    this.app.get('/icon-night', (req, res) => {
      res.sendFile(path.join(path.resolve(this.config.publicDir || 'public'), 'icon-night.png'));
    });

    // Route to send client-side chart configuration
    this.app.get('/config', (req, res) => {
      let clientChartConfig = {};
      // Try to get chartConfig from the main application config object
      if (this.appConfig && this.appConfig.chartConfig) {
        clientChartConfig = { ...this.appConfig.chartConfig }; // Make a copy
      } else {
        this.logger.warn(this.moduleName, 'chartConfig not found in main application config. Client might not get all settings.');
        // As a fallback, could try to load chart-config.yaml directly, but less ideal
        // For now, send empty if not found in appConfig.
      }

      // Add timezoneOffset from ChartServiceModule
      if (this.chartService && typeof this.chartService.getTimezoneOffset === 'function') {
        clientChartConfig.timezoneOffset = this.chartService.getTimezoneOffset();
      } else {
        this.logger.warn(this.moduleName, 'ChartService not available or missing getTimezoneOffset for client /config route. Timezone offset not sent.');
        clientChartConfig.timezoneOffset = -new Date().getTimezoneOffset() / 60; // Fallback
      }

      // Add debug status from this module's config (or main config)
      clientChartConfig.debug = this.config.debug || (this.appConfig.main && this.appConfig.main.logLevel === 'debug') || false;

      res.json(clientChartConfig);
    });
  }

  start() {
    const httpPort = this.config.httpPort || 8321; // Default port if not specified
    if (!this.chartService) {
      this.logger.error(this.moduleName, 'ChartService instance is missing. HTTP server certain routes might fail (e.g. /config). Starting anyway.');
    }

    try {
      this.app.listen(httpPort, () => {
        this.logger.info(this.moduleName, `HTTP server is running on http://localhost:${httpPort}`);
      });
    } catch (error) {
      this.logger.error(this.moduleName, `Failed to start HTTP server on port ${httpPort}: ${error.message}`, error.stack);
    }
  }
}

module.exports = HttpServerModule;
