const amsCalc = require("../ams/amscalc.js");
const { event } = require("../misc/misc.js");
const {
  hex2Dec,
  hex2Ascii,
  hasData,
  getAmsTime,
  getDateTime,
  replaceChar,
  loadYaml
} = require("../misc/util.js");

// Load broker and topics preferences from config file
const configFile = './config.yaml';
const config = loadYaml(configFile);
const debug = config.amscalc.debug || false;

const firstTick = config.amsFirstTick || '00:04';
const lastTick = config.amsLastTick || '59:56';

// Aidon constants
const AIDON_CONSTANTS = {
  METER_VERSION: "020209060101000281FF0A0B",
  METER_ID: "020209060000600100FF0A10",
  METER_MODEL: "020209060000600107FF0A04",
  POWER: "020309060100010700FF06",
  POWER_PRODUCTION: "020309060100020700FF06",
  POWER_REACTIVE: "020309060100030700FF06",
  POWER_PRODUCTION_REACTIVE: "020309060100040700FF06",
  CURRENT_L1: "0203090601001F0700FF10",
  CURRENT_L2: "020309060100330700FF10",
  CURRENT_L3: "020309060100470700FF10",
  VOLTAGE_PHASE_1: "020309060100200700FF12",
  VOLTAGE_PHASE_2: "020309060100340700FF12",
  VOLTAGE_PHASE_3: "020309060100480700FF12",
  METER_DATE: "020209060000010000FF090C",
  LAST_METER_CONSUMPTION: "020309060100010800FF06",
  LAST_METER_PRODUCTION: "020309060100020800FF06",
  LAST_METER_CONSUMPTION_REACTIVE: "020309060100030800FF06",
  LAST_METER_PRODUCTION_REACTIVE: "020309060100040800FF06",
};

let obj = {};

/**
 * Converts a hexadecimal value to a decimal value with a sign.
 * @param {string} hex - The hexadecimal value to be converted.
 * @returns {number} - The converted decimal value with a sign.
 */
function hex2DecSign(hex) {
  let dec = parseInt(hex, 16);
  if ((dec & 0x8000) > 0) {
    dec = dec - 0x10000;
  }
  return dec;
}

async function listDecode(buf) {
  let ts = getDateTime();
  const msg = {};
  msg.data = buf;

  obj = {
    data: {
      listType: 'list1',
      // 2022-07-01T00:00:00
      timestamp: ts,
      hourIndex: parseInt(ts.substring(11, 13)),
    },
  };

  if (obj.data.timestamp.substr(14, 5) < firstTick) {
    obj.data.isHourStart = true;
    if (obj.data.timestamp.substr(11, 2) === '00') {
      obj.data.isDayStart = true;
    }
  }

  if (obj.data.timestamp.substr(14, 5) > lastTick) {
    obj.data.isHourEnd = true;
    if (obj.data.timestamp.substr(11, 2) === '23') {
      obj.data.isDayEnd = true;
    }
  }

  for (const key in AIDON_CONSTANTS) {
    const constant = AIDON_CONSTANTS[key];
    const dataIndex = hasData(msg.data, constant);
    if (dataIndex > -1) {
      switch (key) {
        case "METER_VERSION":
          // Assume that the timestamp is slightly delayed compared to the AMS List2 and List3 interval
          // obj.data.timestamp = replaceChar(ts, 18, "0"); // Align the timestamp
          obj.data.listType = "list2";
          obj.data.meterVersion = hex2Ascii(msg.data.substr(dataIndex, 22));
          break;
        case "METER_ID":
          obj.data.meterID = hex2Ascii(msg.data.substr(dataIndex, 32));
          break;
        case "METER_MODEL":
          obj.data.meterModel = hex2Ascii(msg.data.substr(dataIndex, 8));
          break;
        case "POWER":
          obj.data.power = hex2Dec(msg.data.substr(dataIndex, 8)) / 1000;
          break;
        case "POWER_PRODUCTION":
          obj.data.powerProduction =
            hex2Dec(msg.data.substr(dataIndex, 8)) / 1000;
          break;
        case "POWER_REACTIVE":
          obj.data.powerReactive =
            hex2Dec(msg.data.substr(dataIndex, 8)) / 1000;
          break;
        case "POWER_PRODUCTION_REACTIVE":
          obj.data.powerProductionReactive =
            hex2Dec(msg.data.substr(dataIndex, 8)) / 1000;
          break;
        case "CURRENT_L1":
          obj.data.currentL1 = hex2DecSign(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case "CURRENT_L2":
          obj.data.currentL2 = hex2DecSign(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case "CURRENT_L3":
          obj.data.currentL3 = hex2DecSign(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case "VOLTAGE_PHASE_1":
          obj.data.voltagePhase1 = hex2Dec(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case "VOLTAGE_PHASE_2":
          obj.data.voltagePhase2 = hex2Dec(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case "VOLTAGE_PHASE_3":
          obj.data.voltagePhase3 = hex2Dec(msg.data.substr(dataIndex, 4)) / 10;
          break;
        case "METER_DATE":
          obj.data.listType = "list3";
          obj.data.timestamp = replaceChar(ts, 18, "0"); // Align the timestamp
          obj.data.meterDate = getAmsTime(msg.data, dataIndex);
          //obj.data.hourIndex = parseInt(obj.data.meterDate.substr(11, 2));
          obj.data.isNewHour = obj.data.meterDate.substr(14, 5) === "00:10";
          obj.data.isNewDay = obj.data.meterDate.substr(11, 8) === "00:00:10";
          obj.data.isNewMonth = obj.data.meterDate.substr(8, 2) === "01" && obj.data.isNewDay;
          break;
        case "LAST_METER_CONSUMPTION":
          obj.data.lastMeterConsumption =
            hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case "LAST_METER_PRODUCTION":
          obj.data.lastMeterProduction =
            hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case "LAST_METER_CONSUMPTION_REACTIVE":
          obj.data.lastMeterConsumptionReactive =
            hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
        case "LAST_METER_PRODUCTION_REACTIVE":
          obj.data.lastMeterProductionReactive =
            hex2Dec(msg.data.substr(dataIndex, 8)) / 100;
          break;
      }
    }
  }

  if (Object.getOwnPropertyNames(obj.data).length === 0) {
    console.error("Raw data packet exception : ", JSON.stringify(msg));
  }

  return obj;
}

/**
 * Handles the list data by decoding it and emitting an event.
 * @param {Buffer} buf - The list data buffer to be handled.
 */
async function listHandler(buf) {
  const hex = buf.toString("hex").toUpperCase();
  const result = await listDecode(hex);
  const listObject = result.data;
  const list = listObject.listType;
  if (debug) {
    if (list === "list1") {
      event.emit("hex1", hex);
    } else if (list === "list2") {
      event.emit("hex2", hex);
    } else if (list === "list3") {
      event.emit("hex3", hex);
    }
  }
  obj = await amsCalc(list, listObject);
  event.emit(list, obj);
}

event.on("pulse", listHandler);

module.exports = { listHandler };
