const yaml = require("yamljs");
const configFile = "./config.yaml";

const db = require('../misc/dbinit.js')
const amsCalc = require('../ams/amscalc.js')
const { event } = require('../misc/misc.js')
const { hex2Dec, hex2Ascii, hasData, getAmsTime } = require('../misc/util.js')
const { format } = require('date-fns')

// Load broker and topics preferences from config file
const config = yaml.load(configFile);
const debug = config.DEBUG;

// Aidon constants
const METER_VERSION = "020209060101000281FF0A0B"; // 22
const METER_ID = "020209060000600100FF0A10";      // 32
const METER_MODEL = "020209060000600107FF0A04";   // 8
const POWER = "020309060100010700FF06";           // 8
const POWER_PRODUCTION = "020309060100020700FF06";// 8
const POWER_REACTIVE = "020309060100030700FF06";  // 8
const POWER_PRODUCTION_REACTIVE = "020309060100040700FF06"; // 8
const CURRENT_L1 = "0203090601001F0700FF10";      // 4
const CURRENT_L2 = "020309060100330700FF10";      // 4
const CURRENT_L3 = "020309060100470700FF10";      // 4
const VOLTAGE_PHASE_1 = "020309060100200700FF12"; // 4 signed int
const VOLTAGE_PHASE_2 = "020309060100340700FF12"; // 4 signed int
const VOLTAGE_PHASE_3 = "020309060100480700FF12"; // 4 signed int
const DATE = "020209060000010000FF090C";  // 4,2,2,2,2,2
const LAST_METER_CONSOMPTION = "020309060100010800FF06"; // 8
const LAST_METER_PRODUCTION = "020309060100020800FF06";  // 8
const LAST_METER_CONSOMPTION_REACTIVE = "020309060100030800FF06"; // 8
const LAST_METER_PRODUCTION_REACTIVE = "020309060100040800FF06"; // 8

let obj = new Object();

function hex2DecSign(hex) {
  let dec = parseInt(hex, 16)
  if ((dec & 0x8000) > 0) {
    dec = dec - 0x10000;
  }
  return dec;
}

function getMinPower(pow) {
  if (db.get('minPower') === undefined || db.get('minPower') > pow){
    db.set('minPower', pow);
  }
  return db.get('minPower');
};

function getMaxPower(pow) {
  if (db.get('maxPower') === undefined || db.get('maxPower') < pow) {
    db.set('maxPower', pow);
  }
  return db.get('maxPower');
};

const listDecode = async function (buf) {
  let msg = new Object();
  msg.data = buf;

  obj = { listType: 'list1', data: {} }

  if (hasData(msg.data, METER_VERSION) > -1) {
    obj.data.meterVersion = hex2Ascii(msg.data.substr(hasData(msg.data, METER_VERSION), 22))
    obj.listType = 'list2';
  }

  if (hasData(msg.data, METER_ID) > -1) {
    obj.data.meterID = hex2Ascii(msg.data.substr(hasData(msg.data, METER_ID), 32))
  }

  if (hasData(msg.data, METER_MODEL) > -1) {
    obj.data.meterModel = hex2Ascii(msg.data.substr(hasData(msg.data, METER_MODEL), 8))
  }

  if (hasData(msg.data, POWER) > -1) {
    obj.data.power = hex2Dec(msg.data.substr(hasData(msg.data, POWER), 8)) / 1000;
  }

  if (hasData(msg.data, POWER_REACTIVE) > -1) {
    obj.data.powerReactive = hex2Dec(msg.data.substr(hasData(msg.data, POWER_REACTIVE), 8)) / 1000;
  }

  if (hasData(msg.data, POWER_PRODUCTION) > -1) {
    obj.data.powerProduction = hex2Dec(msg.data.substr(hasData(msg.data, POWER_PRODUCTION), 8)) / 1000;
  }

  if (hasData(msg.data, POWER_PRODUCTION_REACTIVE) > -1) {
    obj.data.powerProductionReactive = hex2Dec(msg.data.substr(hasData(msg.data, POWER_PRODUCTION_REACTIVE), 8)) / 1000;
  }

  if (hasData(msg.data, CURRENT_L1) > -1) {
    obj.data.currentL1 = hex2DecSign(msg.data.substr(hasData(msg.data, CURRENT_L1), 4)) / 10;
  }

  if (hasData(msg.data, CURRENT_L2) > -1) {
    obj.data.currentL2 = hex2DecSign(msg.data.substr(hasData(msg.data, CURRENT_L2), 4)) / 10;
  }

  if (hasData(msg.data, CURRENT_L3) > -1) {
    obj.data.currentL3 = hex2DecSign(msg.data.substr(hasData(msg.data, CURRENT_L3), 4)) / 10;
  }

  if (hasData(msg.data, VOLTAGE_PHASE_1) > -1) {
    obj.data.voltagePhase1 = hex2Dec(msg.data.substr(hasData(msg.data, VOLTAGE_PHASE_1), 4)) / 10;
  }

  if (hasData(msg.data, VOLTAGE_PHASE_2) > -1) {
    obj.data.voltagePhase2 = hex2Dec(msg.data.substr(hasData(msg.data, VOLTAGE_PHASE_2), 4)) / 10;

  }
  if (hasData(msg.data, VOLTAGE_PHASE_3) > -1) {
    obj.data.voltagePhase3 = hex2Dec(msg.data.substr(hasData(msg.data, VOLTAGE_PHASE_3), 4)) / 10;
  }

  if (hasData(msg.data, DATE) > -1) {
    let i = hasData(msg.data, DATE);
    obj.data.meterDate = getAmsTime(msg.data, i);
    obj.listType = 'list3';
  }

  if (msg.data.includes(LAST_METER_CONSOMPTION)) {
    obj.data.lastMeterConsumption = hex2Dec(msg.data.substr(hasData(msg.data, LAST_METER_CONSOMPTION), 8)) / 100;
  }

  if (msg.data.includes(LAST_METER_CONSOMPTION_REACTIVE)) {
    obj.data.lastMeterConsumptionReactive = hex2Dec(msg.data.substr(hasData(msg.data, LAST_METER_CONSOMPTION_REACTIVE), 8)) / 100;
  }

  if (msg.data.includes(LAST_METER_PRODUCTION)) {
    obj.data.lastMeterProduction = hex2Dec(msg.data.substr(hasData(msg.data, LAST_METER_PRODUCTION), 8)) / 100;
  }

  if (msg.data.includes(LAST_METER_PRODUCTION_REACTIVE)) {
    obj.data.lastMeterProductionReactive = hex2Dec(msg.data.substr(hasData(msg.data, LAST_METER_PRODUCTION_REACTIVE), 8)) / 100;
  }

  if (Object.getOwnPropertyNames(obj.data).length === 0) {
    console.error("Raw data packet exception : ", JSON.stringify(msg));
  } else {
    //if (debug) console.log(obj)
    obj.data.minPower = await getMinPower(obj.data.power);
    obj.data.maxPower = await getMaxPower(obj.data.power);
    // TODO: calculate average
    obj.averagePower = 0;
  }
  //if (debug) console.log(obj)
  return obj;
};

const listHandler = async function (buf) {
  let hex = await buf.toString('hex').toUpperCase();
  let result = await listDecode(hex)
  let listObject = result['data'];
  let list = result['listType'];
  if (list === 'list3')
    obj = await amsCalc.calc(listObject);
  await event.emit(list, obj);
};

event.on('pulse', listHandler)

module.exports = {listHandler};
