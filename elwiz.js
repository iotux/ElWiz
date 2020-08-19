#!/usr/bin/env node

"use strict";
const programName = "ElWiz";
const programPid = process.pid;

const mqtt = require("mqtt");
const fs = require("fs");
const yaml = require("yamljs");

const savedPowerFile = "./power.json";
const configFile = "./config.yaml";

// The watchdog timer
const watchValue = 15;

const weekDays = [undefined, "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
// Data offset into buffer packets
const meterOffset = 71;

// ********* Local processing **********

// ***********************************
// Functions for local processing
// called right after packet decoding
// Decoded JSON in "json"
function onList1(json) {
  // Thingsboard generates datestamp on receive,
  // so date and time is really not necessary
  let ts = getTimestamp(json.date);
  delete (json.weekDay);
  delete (json.date);
  // Then publish or do other processing
  //
  // Convenient for checking your own results
  if (pulse.debug)
    console.log("onList1:", json);
}

function onList2(json) {
  // Example for using a subset of data
  delete (json.weekDay);
  delete (json.meterVersion);
  delete (json.meterId);
  delete (json.meterType);
  // Do something with the rest of data
 
  if (pulse.debug)
    console.log("onList2:", json);
}

function onList3(json) {
  //let ts = getTimestamp(json.date);
  // Adjust meterDate to make a more accurate price lookup
  delete (json.weekDay);
  delete (json.meterVersion);
  delete (json.meterId);
  delete (json.meterType);
  delete(json.date);

  // Do something with the data

  if (pulse.debug)
    console.log("onList3:", json);
}

function onStatus(json) {
 // Repack some of the status data
  let data = {
    tibberVersion: json.Build,
    hardWare: json.Hw,
    ID: json.ID,
    MAC: getMacAddress(json.ID),
    upTime: upTime(json.Uptime),
    SSID: json.ssid,
    rssi: json.rssi,
    wifiFail: json.wififail
  }

  if (pulse.debug)
    console.log("onStatus:", data);

}
// ***************** End local processing ******************

function getPower(powerFile) {
  let json = {};
  if (fs.existsSync(powerFile)) {
    // Read last hour
    json = JSON.parse(fs.readFileSync(powerFile));
  } else
    json.lastCumulativePower = 0;
  return json.lastCumulativePower;
}

function savePower(value) {
  // Save current
  fs.writeFileSync(savedPowerFile, JSON.stringify({ lastCumulativePower: value }, false, 2));
}

function addZero(num) {
  if (num <= 9) {
    return "0" + num;
  }
  return num;
}

function weekDay(day) {
  return (weekDays[day]);
}

function pulseDate(buf) {
  // Returns date and time
  return buf.readInt16BE(0)
    + "-" + addZero(buf.readUInt8(2))
    + "-" + addZero(buf.readUInt8(3))
    + "T" + addZero(buf.readUInt8(5))
    + ":" + addZero(buf.readUInt8(6))
    + ":" + addZero(buf.readUInt8(7));
}

function getMacAddress(id) {
  return id.substr(10,2) 
    + ":" + id.substr(8,2) 
    + ":" + id.substr(6,2) 
    + ":" + id.substr(4,2) 
    + ":" + id.substr(2,2) 
    + ":" + id.substr(0,2) 
}

function upTime(secsUp) {
  let d = new Date(null);
  d.setSeconds(secsUp);
  let up = d.toISOString();
  return up.substr(8, 2) - 1
    + " day(s) " + up.substr(11, 8);
}

function getTimestamp(date) {
  let millis = Date.parse(date);
  return millis;
}

function today() {
  let now = new Date();
  let tmp = new Date(now.getTime());
  let day = tmp.toLocaleDateString();
  let ret = day.split("-")[0]
    + "-" + addZero(day.split("-")[1])
    + "-" + addZero(day.split("-")[2]);
  return ret;
}

function dayAhead() {
  let oneDay = 24 * 60 * 60 * 1000;
  let now = new Date();
  let tomorrow = new Date(now.getTime() + oneDay);
  let day = tomorrow.toLocaleDateString();
  let ret = day.split("-")[0]
    + "-" + addZero(day.split("-")[1])
    + "-" + addZero(day.split("-")[2]);
    return ret;
}

let C = {};

let pulse = {
  lastCumulativePower: undefined,
  pulseStatus: undefined,
  pulseData1: undefined,
  pulseData2: undefined,
  pulseData3: undefined,
  date: undefined,
  weekDay: undefined,
  timerValue: watchValue,
  timerExpired: false,
  client: undefined,
  broker: undefined,
  mqttOptions: {},
  debug: false,
  republish: true,
  computePrices: false,
  dayPrices: {},

  init: function () {
    setInterval(pulse.watch, 1000);
    console.log(programName + " is performing, PID: ", programPid);

    // Load last accumulated power
    pulse.lastCumulativePower = getPower(savedPowerFile);

    if (fs.existsSync("./config.yaml")) {
      C = yaml.load(configFile);
    } else {
      console.log("\nConfiguration file not found");
      console.log("Please copy your \"config.yaml.sample\" to \"config.yaml\"");
      console.log("and configure your MQTT broker");
      process.exit(0);
    }

    // Load broker and topics preferences from config file
    if (C.computePrices !== undefined)
      pulse.computePrices = C.computePrices;
    
    if (pulse.computePrices) {
      if (fs.existsSync("./data/prices-" + today() + ".json")) {
        pulse.dayPrices = require("./data/prices-" + today() + ".json");
      } else {
        console.log("\nPrice file not found");
        console.log("Please configure your \"config.yaml\" and run \"getprices.js\"");
        process.exit(0);
      }
    }
  
    pulse.debug = C.DEBUG;
    pulse.republish = C.REPUBLISH;
    if (pulse.debug)
      console.log(C);

    if (C.mqttBroker === null) {
      console.log("\nBroker IP address or hostname missing");
      console.log("Edit your \"config.yaml\" file\n");
      process.exit(0);
    }

    pulse.broker = C.mqttBroker + ":" + C.brokerPort;
    pulse.mqttOptions = {
      username: C.userName,
      password: C.password,
      will: {
        topic: C.pubNotice,
        payLoad: C.willMessage,
      }
    };

    pulse.client = mqtt.connect("mqtt://" + pulse.broker, pulse.mqttOptions);
    pulse.client.on("error", function (err) {
      if (err.errno === "ENOTFOUND") {
        console.log("\nNot connectd to broker");
        console.log("Check your \"config.yaml\" file\n")
        process.exit(0);
      } else
        console.log("Client error: ", err);
    });

    pulse.client.on("connect", function () {
      pulse.client.subscribe(C.topic, function (err) {
        if (err)
         { console.log("Subscription error"); }
      });
      pulse.client.publish(C.pubNotice, C.greetMessage);
    });

    // A "kill -INT <process ID> will save the last cumulative power before killing the process
    // Likewise a <Ctrl C> will do
    process.on("SIGINT", function () {
      savePower(pulse.lastCumulativePower);
      console.log("\nGot SIGINT, power saved");
      process.exit(0);
    });

    // A "kill -TERM <process ID> will save the last cumulative power before killing the process
    process.on("SIGTERM", function () {
      savePower(pulse.lastCumulativePower);
      console.log("\nGot SIGTERM, power saved");
      process.exit(0);
    });

    // A "kill -HUP <process ID> will read the stored last cumulative power file
    process.on("SIGHUP", function () {
      console.log("\nGot SIGHUP, config loaded");
      C = yaml.load(configFile);
      pulse.init();
    });

    // A "kill -USR1 <process ID>  will toggle debugging
    process.on("SIGUSR1", function () {
      pulse.debug = !pulse.debug;
      console.log("\nGot SIGUSR1, debug %s", pulse.debug ? "ON" : "OFF");
    });

  },

  // A "watchdog" timer is implemented to compensate for 
  // the lack of "last will message" from Tibber Pulse
  // The count down timer is preset to 15 seconds
  // This can be changed by setting the "watchValue" constant to a different value
  // The watchdog sends an MQTT message to the broker if Pulse stops within the limit
  watch: function () {
    if (!pulse.timerExpired)
      pulse.timerValue--;
    if (pulse.timerValue <= 0 && !pulse.timerExpired) {
      // Publish Pulse offline message
      pulse.client.publish(C.pubNotice, C.offlineMessage);
      // Make sure that RIP message only fires once
      pulse.timerExpired = true;
      pulse.timerValue = 0;
      console.log("Pulse is offline!");
    }
  },

  list1Func: function (buf) {
    // Process List #1 raw data
    let wDay = buf.readUInt8(23);
    return {
      date: pulseDate(buf.subarray(19)),
      weekDay: weekDay(wDay),
      powImpActive: buf.readUIntBE(34, 4) / 1000
    }
  },

  list2Func: function (buf) {
    // Process List #2 raw data
    let offset = meterOffset; // 71
    return {
      date: pulseDate(buf.subarray(19)),
      weekDay: weekDay(buf.readUInt8(23)),
      meterVersion: buf.subarray(35, 42).toString(), // Item 2
      meterId: buf.subarray(44, 60).toString(), // Item 3
      meterType: buf.subarray(62, 70).toString(), // Item 4
      powImpActive: buf.readUInt32BE(offset) / 1000, // kW imp Item 5 udl
      powExpActive: buf.readUInt32BE(offset + 5) / 1000, // kW exp Item 6 udl
      powImpReactive: buf.readUInt32BE(offset + 10) / 1000, // kVAr imp Item 7 udl
      powExpReactive: buf.readUInt32BE(offset + 15) / 1000, // kVar exp Item 8 udl
      currentL1: buf.readInt32BE(offset + 20) / 1000, // Amps Item 9 sl
      currentL2: buf.readInt32BE(offset + 25) / 1000, // Amps Item 10 sl
      currentL3: buf.readInt32BE(offset + 30) / 1000, // Amps Item 11 sl
      voltageL1: buf.readUInt32BE(offset + 35) / 10, // Volts Item 12 ul
      voltageL2: buf.readUInt32BE(offset + 40) / 10, // Volts Item 13 ul
      voltageL3: buf.readUInt32BE(offset + 45) / 10 // Volts Item 14 ul
    }
  },

  list3Func: function (buf) {
    // Process List #3 raw data
    // For List 3 testing
    //buf = Buffer.from("7ea09b01020110eeaee6e7000f40000000090c07e4070d0115000aff800000021209074b464d5f30303109103639373036333134303337353736313509084d413330344833450600000649060000000006000000be060000000006000013150600000dea0600000fde06000009360600000000060000093e090c07e4070d0115000aff80000006027926b9060000000006012e4c4c06000994bccbf97e", "hex");
    let offset = meterOffset;
    let json = pulse.list2Func(buf);

    // meterDate is 10 seconds late. Is it a Pulse bug or a feature from the meter?
    // According to NVE "OBIS List Information":
    // The values are generated at XX:00:00 and streamed out from the 
    // HAN interface 10 second later (XX:00:10)
    // It makes sense to "backdate" the value by 10 secs to 
    // make for easier lookup the correct price data from Nordpool
    json.meterDate = pulseDate(buf.subarray(offset + 51)).substr(0,17) + "00";
    json.cumuHourPowImpActive = buf.readUInt32BE(offset + 64) / 1000; // kWh
    json.cumuHourPowExpActive = buf.readUInt32BE(offset + 69) / 1000; // kWh
    json.cumuHourPowImpReactive = buf.readUInt32BE(offset + 74) / 1000; // kVArh
    json.cumuHourPowExpReactive = buf.readUInt32BE(offset + 79) / 1000; // kVArh
    if (pulse.lastCumulativePower > 0) {
      json.lastHourActivePower = (buf.readUInt32BE(offset + 64) / 1000 - pulse.lastCumulativePower).toFixed(3) * 1;
    }
    pulse.lastCumulativePower = buf.readUInt32BE(offset + 64) / 1000;
    savePower(pulse.lastCumulativePower);
    if(pulse.computePrices) {
      let index = json.meterDate.substr(11,2) * 1;
      if (index === 0) index = 24;
      json.customerPrice = pulse.dayPrices[index - 1].customerPrice;
      json.lastHourCost = (json.customerPrice * json.lastHourActivePower).toFixed(4) * 1;
      json.spotPrice = pulse.dayPrices[index - 1].spotPrice;
      json.startTime = pulse.dayPrices[index -1].startTime;
      json.endTime = pulse.dayPrices[index -1].endTime;
      if (index === 24) {
        if (!fs.existsSync("./data/prices-" + today() + ".json")) {
          pulse.dayPrices = require("./data/prices-" + today() + ".json");
        }
      }
    }
    return json;
  },

  run: function () {
    pulse.client.on("message", function (topic, message) {
      let buf = Buffer.from(message);
      if (topic === "tibber") {
        // JSON data
        if (buf[0] === 0x7b) { // 0x7b, 123, "{" = Pulse status
          let msg = message.toString();
          pulse.pulseStatus = JSON.parse(msg);
          onStatus(pulse.pulseStatus.status);
          if (pulse.republish && pulse.pulseStatus !== undefined)
            pulse.client.publish(C.pubStatus, JSON.stringify(pulse.pulseStatus, !pulse.debug, 2));
        }

        // Raw buffer meter data
        else if (buf[0] === 0x7e) {  // 0x7e, 126, "~"
          // Check for valid data
          if (buf.length === buf[2] + 2) {
            // Renew watchdog timer
            pulse.timerValue = watchValue;
            pulse.timerExpired = false;

            if (buf[2] === 0x27) { // 0x27,39
              // List 1 data
              pulse.pulseData1 = pulse.list1Func(buf);
              // Hook for postprocessing List #1 data
              onList1(pulse.pulseData1);
              if (pulse.republish && pulse.pulseData1 !== undefined)
                pulse.client.publish(C.pubTopic + "/list1", JSON.stringify(pulse.pulseData1, !pulse.debug, 2));
            }

            else if (buf[2] === 0x79) { // 0x79, 121 / 0x9b, 155
              // List 2 data
              pulse.pulseData2 = pulse.list2Func(buf);
              // Hook for postprocessing List #2 data
              onList2(pulse.pulseData2);
              if (pulse.republish && pulse.pulseData2 !== undefined) {
                pulse.client.publish(C.pubTopic + "/list2", JSON.stringify(pulse.pulseData2, !pulse.debug, 2));
              }
            }

            else if (buf[2] === 0x9b) { // 0x9b, 155
              //if (true) { // 0x9b, 155
              //pulse.pulseData3 = pulse.list3Func(buf);
              pulse.pulseData3 = pulse.list3Func(buf);
              // Hook for postprocessing List #3 data
              onList3(pulse.pulseData3);
              if (pulse.republish && pulse.pulseData3 !== undefined) {
                pulse.client.publish(C.pubTopic + "/list3", JSON.stringify(pulse.pulseData3, !pulse.debug, 2));
              }
            }

            else {
              // Packet failure
              if (pulse.debug) {
                let msg = message.toString();
                console.log("Event message: ", msg);
                console.log("Raw data packet exception : ", JSON.stringify(buf));
              }
            }
          } // End valid data
        } // End raw buffer meter data 

        else if (buf[0] === "H") {
          // pulse Pulse sender bare "Hello" ved oppstart
          let msg = message.toString();
          if (pulse.republish)
            pulse.client.publish(C.pubNotice, C.greetMessage);
          if (pulse.debug)
            console.log("Pulse is starting: " + C.pubNotice + " ", msg);
        } else {
          let msg = message.toString();
          if (pulse.republish)
            pulse.client.publish(C.pubNotice, msg);
          if (pulse.debug)
            console.log("Event message: " + C.pubNotice + " ", msg);
        }
      } // topic === "tibber"
    }); // client.on(message)
  } // run ()
};

pulse.init();
pulse.run();
