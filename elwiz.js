#!/usr/bin/env node

const fs = require('fs');
const MQTTClient = require("./mqtt/mqtt");
const notice = require('./publish/notice.js');
const { event } = require('./misc/misc.js');
const { loadYaml } = require('./misc/util.js');

require('./misc/dbinit.js');
require('./ams/pulseControl.js');
require('./plugin/plugselector.js');
require('./publish/hassAnnounce.js');

const programName = 'ElWiz';
const programPid = process.pid;
const configFile = './config.yaml';
const config = loadYaml(configFile);

const messageFormat = config.messageFormat || 'raw';
const meterModel = config.meterModel;
const meter = `./ams/${meterModel}.js`;
require(meter);

const watchValue = 15;

const mqttUrl = config.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = config.mqttOptions;
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'ElWiz');

let topic = [];
topic.push(config.topic) || 'tibber';

mqttClient.waitForConnect();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  class Pulse {
    constructor() {
      this.debug = config.DEBUG || false;
      this.mqttClient = mqttClient;
      this.init();
      notice.run();
    }

    async init() {
      //this.mqttClient = mqttClient; //new MQTTClient(mqttUrl, mqttOpts, 'ElWiz');

      delay(1500); // Delay 1.5 secs, waiting for prices
      setInterval(() => this.watch(), 1000);
      console.log(`${programName} is performing, PID: `, programPid);

      topic.forEach((topic) => {
        this.mqttClient.subscribe(topic, function (err) {
          if (err) {
            console.log("clientIn error", err);
          } else {
            console.log(`Listening on \"${brokerInUrl}\" with topic \"${topic}\"`)
          }
        });
      });

      event.emit('notice', config.greetMessage);

      //this.setupSignalHandlers();
      console.log('Running init');
    }

    // Removed signal handlers. Graceful shutdown is now handled by the UniCache module
    /*
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
        //case 'SIGUSR1':
        //  this.debug = !this.debug;
        //  console.log(`\nGot ${signal}, debug ${this.debug ? 'ON' : 'OFF'}`);
        //  break;
      }
    }
    */

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

    async run() {
      this.mqttClient.on('message', (topic, message) => {
        if (messageFormat === 'json') {
          event.emit(meterModel, { 'topic': topic, 'message': JSON.parse(message) });
        } else {
          const buf = Buffer.from(message);
          this.processMessage(buf);
        }
      });
      console.log('Running run');
    }

    processMessage(buf) {
      if (buf[0] === 0x08) {
        // Find the first occurrence of 0x7e
        const indexOf7e = buf.indexOf(0x7e);
        // If 0x7E is found, slice the buffer from that position onward, keeping 0x7E
        if (indexOf7e !== -1) {
          buf = buf.slice(indexOf7e);
        }
      }
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
  //await pulse.init();
  await pulse.run();
  //notice.run();
})();
