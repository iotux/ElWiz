// src/core/logger.js
let logLevel = 'info'; // Default log level

function setLogLevel(level) {
  logLevel = level;
}

function getLogLevel() {
    return logLevel;
}

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function log(level, module, message, ...args) {
  if (levels[level] <= levels[logLevel]) {
    const timestamp = new Date().toISOString();
    const modulePrefix = module ? `[${module}] ` : '';
    if (args.length > 0) {
      console[level](`${timestamp} [${level.toUpperCase()}] ${modulePrefix}${message}`, ...args);
    } else {
      console[level](`${timestamp} [${level.toUpperCase()}] ${modulePrefix}${message}`);
    }
  }
}

const logger = {
  setLogLevel, // e.g., logger.setLogLevel('debug') from main.js based on config
  getLogLevel,
  error: (module, message, ...args) => log('error', module, message, ...args),
  warn: (module, message, ...args) => log('warn', module, message, ...args),
  info: (module, message, ...args) => log('info', module, message, ...args),
  debug: (module, message, ...args) => log('debug', module, message, ...args),
};

module.exports = logger;

