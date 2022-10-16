#!/usr/bin/env node

"use strict";
const programName = "ElWiz";
const programPid = process.pid;

const mqtt = require("mqtt");
const fs = require("fs");
const yaml = require("yamljs");
const JSONdb = require('simple-json-db');

const configFile = "./config.yaml";
const energyFile = './savepower.json'
const db = new JSONdb(energyFile, {}, { jsonSpaces: 2 });

// The watchdog timer
const watchValue = 15;

const weekDays = [undefined, "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
// Data offset into buffer packets
const meterOffset = 71;

// ********* Local processing **********
// ***********************************
// Functions for local processing
// called right after packet decoding
// Decoded data in "json"

function onList1(json) {
  // ********** Home Assistant ***********
  if (pulse.haPublish) {
    let haBaseTopic = pulse.haBaseTopic + "/";
    pulse.client.publish(haBaseTopic + "timestamp", json.date, pulse.list1Opts);
    pulse.client.publish(haBaseTopic + "power", json.powImpActive.toString(), pulse.list1Opts);
    pulse.client.publish(haBaseTopic + "minPower", json.minPower.toString(), pulse.list1Opts);
    pulse.client.publish(haBaseTopic + "maxPower", json.maxPower.toString(), pulse.list1Opts);
  }
}

function onList2(json) {
  // ********** Home Assistant ***********
  if (pulse.haPublish) {
    let haBaseTopic = pulse.haBaseTopic + "/";
    let list2Opts = pulse.list2Opts;
    let signal;
    if (pulse.pulseStatus !== undefined)
      signal = pulse.pulseStatus.rssi
    else
      signal = "N/A"

    pulse.client.publish(haBaseTopic + "timestamp", json.date, list2Opts);
    pulse.client.publish(haBaseTopic + "power", json.powImpActive.toString(), list2Opts);
    pulse.client.publish(haBaseTopic + "voltagePhase1", json.voltageL1.toString(), list2Opts);
    pulse.client.publish(haBaseTopic + "voltagePhase2", json.voltageL2.toString(), list2Opts);
    pulse.client.publish(haBaseTopic + "voltagePhase3", json.voltageL3.toString(), list2Opts);
    pulse.client.publish(haBaseTopic + "currentL1", json.currentL1.toString(), list2Opts);
    pulse.client.publish(haBaseTopic + "currentL2", json.currentL2.toString(), list2Opts);
    pulse.client.publish(haBaseTopic + "currentL3", json.currentL3.toString(), list2Opts);
    pulse.client.publish(haBaseTopic + "signalStrength", signal.toString(), list2Opts);
  }
}

function onList3(json) {
  // ********** Home Assistant ***********
  if (pulse.haPublish) {
    let haBaseTopic = pulse.haBaseTopic + "/";
    let list3Opts = pulse.list3Opts;
    let signal;
    if (pulse.pulseStatus !== undefined)
      signal = pulse.pulseStatus.rssi
    else
      signal = "N/A"

    // Some key/value pairs are left in a commented state for later development
    // Most keys are reuse from Tibber (API)
    // Most of the data here are handled by Home Assistant auto discovery 
    let haData = {
      meterDate: json.meterDate,
      timestamp: json.date,
      power: json.powImpActive,
      lastMeterConsumption: json.cumuHourPowImpActive,     // kWh - last meter import register
      lastMeterProduction: json.cumuHourPowExpActive,      // kWh - last meter export register
      accumulatedConsumption: json.accumulatedConsumption, // kWh since midnight
      accumulatedProduction: json.accumulatedProduction,   // kWh since midnight
      accumulatedConsumptionLastHour: json.accumulatedConsumptionLastHour, // since last hour shift
      accumulatedProductionLastHour: json.accumulatedProductionLastHour,   // since last hour shift
      //---------------------
      //accumulatedCost: 0,                   // (Tibber) accumulated cost since midnight
      //accumulatedReward: 0,                 // (Tibber) accumulated reward since midnight
      //currency: "NOK",                      // (Tibber) currency of displayed cost
      //---------------------
      minPower: json.minPower,                // Watt (min consumption since midnight)
      //averagePower: json.averagePower,        // Watt (avg consumption since midnight)
      maxPower: json.maxPower,                // Watt (max consumption since midnight)
      //powerProduction: json.poweProduction, // Watt (A- at the moment)
      //powerReactive: 0,                     // kWAr (current reactive consumption, Q+)
      //powerProductionReactive: 0,           // kWAr (current net reactive production Q-)
      minPowerProduction: 0,                  // Watt (since midnight)
      maxPowerProduction: 0,                  // Watt (since midnight)
      //powerFactor: 0,                       // (active power / apparent power)
      voltagePhase1: json.voltageL1,
      voltagePhase2: json.voltageL3,
      voltagePhase3: json.voltageL3,
      currentL1: json.currentL1,
      currentL2: json.currentL2,
      currentL3: json.currentL3,
      signalStrength: signal
    }
    pulse.client.publish(haBaseTopic + "timestamp", json.date, list3Opts);
    pulse.client.publish(haBaseTopic + "power", json.powImpActive.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "lastMeterConsumption", haData.lastMeterConsumption.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "lastMeterProduction", haData.lastMeterProduction.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "accumulatedConsumption", haData.accumulatedConsumption.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "accumulatedProduction", haData.accumulatedProduction.toString());
    pulse.client.publish(haBaseTopic + "accumulatedConsumptionLastHour", haData.accumulatedConsumptionLastHour.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "accumulatedProductionLastHour", haData.accumulatedProductionLastHour.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "minPower", haData.minPower.toString(), list3Opts);
    //pulse.client.publish(haBaseTopic + "averagePower", haData.averagePower.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "maxPower", haData.maxPower.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "minPowerProduction", haData.minPowerProduction.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "maxPowerProduction", haData.maxPowerProduction.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "voltagePhase1", json.voltageL1.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "voltagePhase2", json.voltageL2.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "voltagePhase3", json.voltageL3.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "currentL1", json.currentL1.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "currentL2", json.currentL2.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "currentL3", json.currentL3.toString(), list3Opts);
    pulse.client.publish(haBaseTopic + "signalStrength", signal.toString(), list3Opts);
    if (pulse.debug)
      console.log("onList3:", haData);
    let time = json.date.substr(11, 8);
    console.log('onList3-time: ', time);
    time = json.meterDate.substr(11, 8);
    console.log('METERDATE: ', time);
  }
}

function onStatus(json) {
  // Do something
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
  return id.substr(10, 2)
    + ":" + id.substr(8, 2)
    + ":" + id.substr(6, 2)
    + ":" + id.substr(4, 2)
    + ":" + id.substr(2, 2)
    + ":" + id.substr(0, 2)
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
  //lastMeterConsumption: undefined,
  //accumulatedConsumption: undefined,  // reset @ midnight
  //accumulatedConsumptionLastHour: undefined, // reset @ every lapsed hour
  //lastMeterProduction: undefined,
  //accumulatedProduction: undefined,  // reset @ midnight
  //accumulatedProductionLastHour: undefined, // reset @ every lapsed hour
  lastDayConsumption: undefined,
  lastHourConsumption: undefined,
  lastMeterProduction: undefined,
  lastDayProduction: undefined,
  lastHourProduction: undefined,
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
  statOpts: {},
  list1Opts: {},
  list2Opts: {},
  list3Opts: {},
  debug: false,
  republish: true,
  computePrices: false,
  dayPrices: {},

  // Home assistant (turn off in "config.yaml")
  haPublish: true,
  haAnnounceTopic: "homeassistant/sensor/ElWiz/",
  haBaseTopic: "elwiz/sensor",

  energySavings: {
    "lastMeterConsumption": 0,
    "accumulatedConsumption": 0,
    "accumulatedConsumptionLastHour": 0,
    "lastMeterProduction": 0,
    "accumulatedProduction": 0,
    "accumulatedProductionLastHour": 0,
    "prevDayConsumptiom": 0,
    "prevDayProduction": 0,
    "minPower": 0,
    "maxPower": 0
  },

  hassDevice: function (name, uniqueId, devClass, staClass, unitOfMeasurement, stateTopic) {
    let result = {
      name: name,
      uniq_id: uniqueId,
      dev_cla: devClass, // device_class
      stat_cla: staClass, // state_class
      unit_of_meas: unitOfMeasurement,
      avty_t: pulse.haBaseTopic + "/status",    // availability_topic
      stat_t: pulse.haBaseTopic + "/" + stateTopic,
      //last_reset_topic: haBaseTopic + "/" +  stateTopic,
      //last_reset_value_template: "1970-01-01T00:00:00+00:00",
      //val_t: "{{ value_json." + stateTopic + " }}",
      val_tpl: "{{value|round(3)}}",
      dev: {
        ids: ["elwiz_pulse_enabler"],
        name: "ElWiz Pulse Enabler",
        sw: "https://github.com/iotux/ElWiz",
        mdl: "ElWiz",
        mf: "iotux"
      }
    }
    //if (staClass === 'measurement') {
    //delete (result.last_reset_topic);
    //delete (result.last_reset_value_template);
    //}
    return result;
  },

  hassAnnounce: function () {
    const haTopic = pulse.haAnnounceTopic;
    const pubOpts = { qos: 1, retain: true }
    const debug = pulse.debug;
    //  hassDevice: function (name, uniqueId, devClass, stateClass, uom, stateTopic) {
    let announce = pulse.hassDevice('Last meter consumption', 'last_meter_consumption', 'energy', 'total_increasing', 'kWh', 'lastMeterConsumption');
    pulse.client.publish(haTopic + "lastMeterConsumption/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Accumulated consumption today', 'accumulated_consumption', 'energy', 'total', 'kWh', 'accumulatedConsumption');
    pulse.client.publish(haTopic + "accumulatedConsumption/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Accumulated consumption last hour', 'accumulated_consumption_last_hour', 'energy', 'total_increasing', 'kWh', 'accumulatedConsumptionLastHour');
    pulse.client.publish(haTopic + "accumulatedConsumptionLastHour/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Last meter production', 'last_meter_production', 'energy', 'total_increasing', 'kWh', 'lastMeterProduction');
    pulse.client.publish(haTopic + "lastMeterProduction/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Accumulated production today', 'accumulated_production', 'energy', 'total', 'kWh', 'accumulatedProduction');
    pulse.client.publish(haTopic + "accumulatedProduction/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Accumulated production last hour', 'accumulated_production_last_hour', 'energy', 'total_increasing', 'kWh', 'accumulatedProductionLastHour');
    pulse.client.publish(haTopic + "accumulatedProductionLastHour/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = this.hassDevice('Current power use', 'power_current_use', 'power', 'measurement', 'kW', 'power');
    pulse.client.publish(haTopic + "power/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = this.hassDevice('Min power since midnight', 'min_power_since_midnight', 'power', 'measurement', 'kW', 'minPower');
    pulse.client.publish(haTopic + "minPower/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = this.hassDevice('Max power since midnight', 'max_power_since_midnight', 'power', 'measurement', 'kW', 'maxPower');
    pulse.client.publish(haTopic + "maxPower/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Voltage phase 1', 'voltage_phase_1', 'voltage', 'measurement', 'V', 'voltagePhase1');
    pulse.client.publish(haTopic + "voltagePhase1/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Voltage phase 2', 'voltage_phase_2', 'voltage', 'measurement', 'V', 'voltagePhase2');
    pulse.client.publish(haTopic + "voltagePhase2/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Voltage phase 3', 'voltage_phase_3', 'voltage', 'measurement', 'V', 'voltagePhase3');
    pulse.client.publish(haTopic + "voltagePhase3/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Current L1', 'current_L1', 'current', 'measurement', 'A', 'currentL1');
    pulse.client.publish(haTopic + "currentL1/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Current L2', 'current_L2', 'current', 'measurement', 'A', 'currentL2');
    pulse.client.publish(haTopic + "currentL2/config", JSON.stringify(announce, !debug, 2), pubOpts);

    announce = pulse.hassDevice('Current L3', 'current_L3', 'current', 'measurement', 'A', 'currentL3');
    pulse.client.publish(haTopic + "currentL3/config", JSON.stringify(announce, !debug, 2), pubOpts);

    // Set retain flag (pubOpts) on status message to let HA find it after a stop/restart
    pulse.client.publish(pulse.haBaseTopic + "/status", "online", pubOpts);
    // Populate lastMeterConsumption from storage to prevent up to one hour wait after a restart or stop
    if (db.get("lastMeterConsumption" < 0) || db.get("lastMeterProduction") > 0) {
      let haBaseTopic = pulse.haBaseTopic + "/";
      pulse.client.publish(haBaseTopic + "lastMeterConsumption", db.get("lastMeterConsumption").toString(), pubOpts);
      pulse.client.publish(haBaseTopic + "accumulatedConsumption", db.get("accumulatedConsumption").toString(), pubOpts);
      pulse.client.publish(haBaseTopic + "accumulatedConsumptionLastHour", db.get("accumulatedConsumptionLastHour").toString(), pubOpts);
      pulse.client.publish(haBaseTopic + "lastMeterProduction", db.get("lastMeterProduction").toString(), pubOpts);
      pulse.client.publish(haBaseTopic + "accumulatedProduction", db.get("accumulatedProduction").toString(), pubOpts);
      pulse.client.publish(haBaseTopic + "accumulatedProductionLastHour", db.get("accumulatedProductionLastHour").toString(), pubOpts);
    }
  },

  init: function () {
    setInterval(pulse.watch, 1000);
    console.log(programName + " is performing, PID: ", programPid);

    // Load broker and topics preferences from config file
    C = yaml.load(configFile);
    pulse.debug = C.DEBUG;

    if (pulse.debug)
      console.log(C);

    if (C.mqttBroker === null) {
      console.log("\nBroker IP address or hostname missing");
      console.log("Edit your \"config.yaml\" file\n");
      process.exit(0);
    }

    pulse.republish = C.REPUBLISH;

    pulse.broker = C.mqttBroker + ":" + C.brokerPort;
    pulse.mqttOptions = {
      userName: C.userName, password: C.password,
      will: {
        topic: C.pubNotice, payLoad: C.willMessage,
      }
    };

    if (!fs.existsSync(energyFile)) {
      db.JSON(pulse.energySavings);
      db.sync();
    }

    if (pulse.debug)
      console.log("Stored status file: ", db.JSON());

    if (C.computePrices !== undefined)
      pulse.computePrices = C.computePrices;

    if (pulse.computePrices) {
      if (fs.existsSync("./data/prices-" + today() + ".json")) {
        pulse.dayPrices = require("./data/prices-" + today() + ".json");
      }
    }

    // Home Assistant Base Topic
    pulse.haPublish = C.haPublish;
    pulse.haBaseTopic = C.haBaseTopic;

    pulse.list1Opts = { qos: C.list1Qos, retain: C.list1Retain };
    pulse.list2Opts = { qos: C.list2Qos, retain: C.list2Retain };
    pulse.list3Opts = { qos: C.list3Qos, retain: C.list3Retain };
    pulse.statOpts = { qos: C.statusQos, retain: C.statusRetain };

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
        if (err) { console.log("Subscription error"); }
      });
      pulse.client.publish(C.pubNotice, C.greetMessage);
    });

    // A "kill -INT <process ID> will save the last cumulative power before killing the process
    // Likewise a <Ctrl C> will do
    process.on("SIGINT", function () {
      db.sync();
      console.log("\nGot SIGINT, power saved");
      process.exit(0);
    });

    // A "kill -TERM <process ID> will save the last cumulative power before killing the process
    process.on("SIGTERM", function () {
      db.sync();
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
      pulse.client.publish(C.pubNotice, C.offlineMessage, { qos: 0, retain: false });
      // Make sure that RIP message only fires once
      pulse.timerExpired = true;
      pulse.timerValue = 0;
      console.log("Pulse is offline!");
    }
  },

  getMinPower: function (pow) {
    if (db.get('minPower') === 0 || db.get('minPower') > pow)
      db.set('minPower', pow);
    return db.get('minPower');
  },

  getMaxPower: function (pow) {
    if (db.get('maxPower') === 0 || db.get('maxPower') < pow)
      db.set('maxPower', pow);
    return db.get('maxPower');
  },

  list1Func: function (buf) {
    let pow;
    // Process List #1 raw data
    if (buf[2] === 0x27) {
      pow = buf.readUIntBE(34, 4) / 1000;
    } else 
    if (buf[2] === 0x2a) {
      pow = buf.readUIntBE(31, 4) / 1000;
    }
    // let wDay = buf.readUInt8(23);
    return {
      //date: pulseDate(buf.subarray(19)),
      //weekDay: weekDay(wDay),
      powImpActive: pow,
      minPower: this.getMinPower(pow),
      maxPower: this.getMaxPower(pow)
    }
  },

  list2Func: function (buf) {
    // Process List #2 raw data
    let offset = meterOffset; // 71
    let L1 = buf.readUInt32BE(offset + 35); // Volts Item 12 ul
    let L2 = buf.readUInt32BE(offset + 40); // Volts Item 13 ul
    let L3 = buf.readUInt32BE(offset + 45); // Volts Item 15 ul
    let power = buf.readUInt32BE(offset) / 1000; // kW imp Item 5 udl
    if (L2 === 0) // This meter doesn't measure L1L3
      L2 = Math.sqrt((L1 - L3 * 0.5) ** 2 + (L3 * 0.866) ** 2);
    return {
      date: pulseDate(buf.subarray(19)),
      weekDay: weekDay(buf.readUInt8(23)),
      meterVersion: buf.subarray(35, 42).toString(), // Item 2
      meterId: buf.subarray(44, 60).toString(), // Item 3
      meterType: buf.subarray(62, 70).toString(), // Item 4
      powImpActive: power,
      minPower: this.getMinPower(power),
      maxPower: this.getMaxPower(power),
      powExpActive: buf.readUInt32BE(offset + 5) / 1000, // kW exp Item 6 udl
      powImpReactive: buf.readUInt32BE(offset + 10) / 1000, // kVAr imp Item 7 udl
      powExpReactive: buf.readUInt32BE(offset + 15) / 1000, // kVar exp Item 8 udl
      currentL1: buf.readInt32BE(offset + 20) / 1000, // Amps Item 9 sl
      currentL2: buf.readInt32BE(offset + 25) / 1000, // Amps Item 10 sl
      currentL3: buf.readInt32BE(offset + 30) / 1000, // Amps Item 11 sl
      voltageL1: L1 / 10,
      voltageL2: (L2 / 10).toFixed(1) * 1,
      voltageL3: L3 / 10
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

    json.meterDate = pulseDate(buf.subarray(offset + 51)).substr(0, 17) + "00";
    json.cumuHourPowImpActive = buf.readUInt32BE(offset + 64) / 1000; // kWh
    json.cumuHourPowExpActive = buf.readUInt32BE(offset + 69) / 1000; // kWh
    json.cumuHourPowImpReactive = buf.readUInt32BE(offset + 74) / 1000; // kVArh
    json.cumuHourPowExpReactive = buf.readUInt32BE(offset + 79) / 1000; // kVArh

    if (json.meterDate.substr(11, 8) === "00:00:00") {
      db.set("prevDayConsumption", json.cumuHourPowImpActive);
      db.set("prevDayProduction", json.cumuHourPowExpActive);
    }

    if (db.get("lastMeterConsumption") > 0)
      json.accumulatedConsumptionLastHour = (json.cumuHourPowImpActive - db.get("lastMeterConsumption")).toFixed(3) * 1;
    else
      json.accumulatedConsumptionLastHour = json.cumuHourPowImpActive;
    db.set("accumulatedConsumptionLastHour", json.accumulatedConsumptionLastHour);
    if (db.get("accumulatedConsumption") > 0)
      json.accumulatedConsumption = (db.get("accumulatedConsumption") + json.accumulatedConsumptionLastHour).toFixed(2) * 1;
    else
      json.accumulatedConsumption = json.accumulatedConsumptionLastHour;
    db.set("accumulatedConsumption", json.accumulatedConsumption);

    db.set("lastMeterConsumption", json.cumuHourPowImpActive);

    if (db.get("lastMeterProduction") > 0)
      json.accumulatedProductionLastHour = (json.cumuHourPowExpActive - db.get("lastMeterProduction")).toFixed(3) * 1;
    else
      json.accumulatedProductionLastHour = json.cumuHourPowExpActive;
    db.set("accumulatedProductionLastHour", json.accumulatedProductionLastHour);
    if (db.get("accumulatedProduction") > 0)
      json.accumulatedProduction = (db.get("accumulatedProduction") + json.accumulatedProductionLastHour).toFixed(2) * 1;
    else
      json.accumulatedProduction = json.accumulatedProductionLastHour;
    db.set("accumulatedProduction", json.accumulatedProduction);

    db.set("lastMeterProduction", json.cumuHourPowExpActive);

    // Every midnight
    if (json.meterDate.substr(11, 8) === "00:00:00") {
      db.set("accumulatedConsumption", 0);
      json.accumulatedConsumption = 0;
      db.set("accumulatedProduction", 0);
      json.accumulatedProduction = 0;
      db.set('minPower', 0);
      db.set('maxPower', 0);
    }
    db.sync();
    console.log(db.JSON());

    if (pulse.computePrices) {
      let index = json.meterDate.substr(11, 2) * 1;
      if (index === 0) index = 24;
      console.log("index: ", index);
      //console.log(pulse.dayPrices[index - 1]);
      json.customerPrice = pulse.dayPrices[index - 1].customerPrice;
      json.lastHourCost = (json.customerPrice * json.accumulatedConsumptionLastHour).toFixed(4) * 1;
      json.spotPrice = pulse.dayPrices[index - 1].spotPrice;
      json.startTime = pulse.dayPrices[index - 1].startTime;
      json.endTime = pulse.dayPrices[index - 1].endTime;
      //console.log(json);
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
          // BREAKING change
          let m = JSON.parse(msg);
          pulse.pulseStatus = m.status;
          onStatus(pulse.pulseStatus);
          if (pulse.republish && pulse.pulseStatus !== undefined)
            pulse.client.publish(C.pubStatus, JSON.stringify(pulse.pulseStatus, !pulse.debug, 2), pulse.statOpts);
        }

        // Raw buffer meter data
        else if (buf[0] === 0x7e) {  // 0x7e, 126, "~"
          // Check for valid data
          if (buf.length === buf[2] + 2) {
            // Renew watchdog timer
            pulse.timerValue = watchValue;
            pulse.timerExpired = false;

            if (buf[2] === 0x27 || buf[2] === 0x2a) { // 0x27,39 || 0x2a,42
              // List 1 data
              pulse.pulseData1 = pulse.list1Func(buf);
              // Hook for postprocessing List #1 data
              onList1(pulse.pulseData1);
              if (pulse.republish && pulse.pulseData1 !== undefined)
                pulse.client.publish(C.pubTopic + "/list1", JSON.stringify(pulse.pulseData1, !pulse.debug, 2), pulse.list1Opts);
            }

            else if (buf[2] === 0x79) { // 0x79, 121 / 0x9b, 155
              // List 2 data
              pulse.pulseData2 = pulse.list2Func(buf);
              // Hook for postprocessing List #2 data
              onList2(pulse.pulseData2);
              if (pulse.republish && pulse.pulseData2 !== undefined) {
                pulse.client.publish(C.pubTopic + "/list2", JSON.stringify(pulse.pulseData2, !pulse.debug, 2), pulse.list2Opts);
              }
            }

            else if (buf[2] === 0x9b) { // 0x9b, 155
              //if (true) { // 0x9b, 155
              //pulse.pulseData3 = pulse.list3Func(buf);
              pulse.pulseData3 = pulse.list3Func(buf);
              // Hook for postprocessing List #3 data
              onList3(pulse.pulseData3);
              if (pulse.republish && pulse.pulseData3 !== undefined) {
                pulse.client.publish(C.pubTopic + "/list3", JSON.stringify(pulse.pulseData3, !pulse.debug, 2), pulse.list3Opts);
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
            pulse.client.publish(C.pubNotice, C.greetMessage, pulse.statOpts);
          if (pulse.debug)
            console.log("Pulse is starting: " + C.pubNotice + " ", msg);
        } else {
          let msg = message.toString();
          if (pulse.republish)
            pulse.client.publish(C.pubNotice, msg, pulse.statOpts);
          if (pulse.debug)
            console.log("Event message: " + C.pubNotice + " ", msg);
        }
      } // topic === "tibber"
    }); // client.on(message)
  } // run ()
};

pulse.init();
pulse.hassAnnounce();
pulse.run();
