#!/usr/bin/env node

const { exit } = require('process');
const yaml = require('yamljs');
const Mqtt = require('./mqtt/mqtt.js');
const notice = require('./publish/notice.js');
const db = require('./misc/dbinit.js');
const { event } = require('./misc/misc.js');
require('./plugin/plugselector.js');

const programName = 'ElWiz';
const programPid = process.pid;
const configFile = './config.yaml';
const config = yaml.load(configFile);
const meter = `./ams/${config.meterModel}.js`;
require(meter);
const watchValue = 15;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class Pulse {
  constructor() {
    this.debug = config.DEBUG || false;
  }

  init() {
    delay(1500); // Delay 1.5 secs, waiting for prices
    setInterval(() => this.watch(), 1000);
    console.log(`${programName} is performing, PID: `, programPid);

    this.client = Mqtt.mqttClient();

    this.client.on('connect', () => {
      this.client.subscribe(config.topic, (err) => {
        if (err) {
          console.log('Subscription error');
        }
      });
      this.client.publish(config.pubNotice, config.greetMessage);
    });

    this.setupSignalHandlers();
  }

  setupSignalHandlers() {
    process.on('SIGINT', this.handleSignal.bind(this, 'SIGINT'));
    process.on('SIGTERM', this.handleSignal.bind(this, 'SIGTERM'));
    process.on('SIGHUP', this.handleSignal.bind(this, 'SIGHUP'));
    process.on('SIGUSR1', this.handleSignal.bind(this, 'SIGUSR1'));
  }

  handleSignal(signal) {
    switch (signal) {
      case 'SIGINT':
      case 'SIGTERM':
        console.log(`\nGot ${signal}, power saved`);
        db.sync();
        exit(0);
        // Needed to get rid of the missing break warning
        break;
      case 'SIGHUP':
        console.log(`\nGot ${signal}, config loaded`);
        this.config = yaml.load(configFile);
        db.sync();
        this.init();
        break;
      case 'SIGUSR1':
        this.debug = !this.debug;
        console.log(`\nGot ${signal}, debug ${this.debug ? 'ON' : 'OFF'}`);
        break;
    }
  }

  watch() {
    if (!this.timerExpired) {
      this.timerValue--;
    }
    if (this.timerValue <= 0 && !this.timerExpired) {
      event.emit('notice', config.offlineMessage);
      this.timerExpired = true;
      this.timerValue = 0;
      console.log('Pulse is offline!');
    }
  }

  run() {
    this.client.on('message', (topic, message) => {
      if (topic === config.topic) {
        const buf = Buffer.from(message);
        this.processMessage(buf);
      }
    });
  }

  processMessage(buf) {
    const messageType = buf[0];

    if (messageType === 0x7b) {
      const msg = buf.toString();
      event.emit('status', msg);
    } else if (messageType === 0x7e) {
      this.processMeterData(buf);
    } else if (messageType === 'H') {
      const msg = buf.toString();
      event.emit('hello', msg);
    } else {
      const msg = buf.toString();
      event.emit('notice', msg);
    }
  }

  processMeterData(buf) {
    const dataLength = (buf[1] & 0x0F) * 256 + buf[2] + 2;

    if (buf.length === dataLength) {
      this.timerValue = watchValue;
      this.timerExpired = false;
      // Send Pulse data to list decoder
      event.emit('pulse', buf);
    } // End valid data
  }
}

const pulse = new Pulse();
pulse.init();
pulse.run();
notice.run();
