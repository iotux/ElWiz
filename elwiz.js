#!/usr/bin/env node

const programName = "ElWiz";
const programPid = process.pid;
const { exit } = require("process");
const yaml = require("yamljs");
const Mqtt = require('./mqtt/mqtt.js');
const notice = require('./publish/notice.js');
const db = require('./misc/dbinit.js');
const { event } = require('./misc/misc.js');
require('./plugin/plugselector.js');
const configFile = "./config.yaml";
const config = yaml.load(configFile);

// This will load a pulse AMS driver
// according to config setting
const meter = './ams/' + config.meterModel + '.js'
const ams = require(meter);

const watchValue = 15;

const pulse = {
  init: function () {
    setInterval(pulse.watch, 1000);
    console.log(programName + " is performing, PID: ", programPid);

    this.debug = config.DEBUG;

    pulse.client = Mqtt.mqttClient();

    pulse.client.on("connect", function () {
      pulse.client.subscribe(config.topic, function (err) {
        if (err) { console.log("Subscription error"); }
      });
      pulse.client.publish(config.pubNotice, config.greetMessage);
    });

    // A "kill -INT <process ID> will save the last cumulative power before killing the process
    // Likewise a <Ctrl C> will do
    process.on("SIGINT", function () {
      console.log("\nGot SIGINT, power saved");
      //db.JSON();
      db.sync();
      process.exit(0);
    });

    // A "kill -TERM <process ID> will save the last cumulative power before killing the process
    process.on("SIGTERM", function () {
      console.log("\nGot SIGTERM, power saved");
      //db.JSON()
      db.sync();
      process.exit(0);
    });

    // A "kill -HUP <process ID> will read the stored last cumulative power file
    process.on("SIGHUP", function () {
      console.log("\nGot SIGHUP, config loaded");
      C = yaml.load(configFile);
      //db.JSON()
      db.sync();
      pulse.init();
    });

    // A "kill -USR1 <process ID>  will toggle debugging
    process.on("SIGUSR1", function () {
      pulse.debug = !pulse.debug;
      console.log("\nGot SIGUSR1, debug %s", pulse.debug ? "ON" : "OFF");
    });
  }, // init()

  watch: function () {
    if (!this.timerExpired)
      this.timerValue--;
    if (this.timerValue <= 0 && !this.timerExpired) {
      // Publish Pulse offline message
      event.emit('notice', config.offlineMessage);
      // Make sure that RIP message only fires once
      this.timerExpired = true;
      this.timerValue = 0;
      console.log("Pulse is offline!");
    }
  },

  run: function () {
    pulse.client.on("message", function (topic, message) {
      if (topic === config.topic) {
        let buf = Buffer.from(message);
        // JSON data
        if (buf[0] === 0x7b) { // 0x7b, 123, "{" = Pulse status
          let msg = message.toString();
          event.emit('status', msg);
        } else

        if (buf[0] === 0x7e) {  // 0x7e, 126, "~"
          // Raw buffer meter data
          // Check for valid data
          if (buf.length === buf[2] + 2) {
            // Renew watchdog timer
            pulse.timerValue = watchValue;
            pulse.timerExpired = false;
            // Send Pulse data to list decoder
            event.emit('pulse', buf)
          } // End valid data
        } else

        if (buf[0] === "H") {
          // pulse Pulse sender bare "Hello" ved oppstart
          let msg = message.toString();
          event.emit('hello', msg);
        } 
          
        else {
          let msg = message.toString();
          event.emit('notice', msg);
        }
      } // topic === "tibber"
    }); // client.on()    
  } // run()
}; // pulse()

pulse.init();
pulse.run();
notice.run();
//plugSelector.init()
//if (plugin) plugin.run();
