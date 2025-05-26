// src/core/eventBus.js
const EventEmitter = require('events');
const eventBus = new EventEmitter();

// Optional: Increase the default max listeners if many modules will listen
// eventBus.setMaxListeners(20); // Default is 10

module.exports = eventBus;

