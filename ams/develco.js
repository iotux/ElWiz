
// const db = require('../misc/dbinit.js');
const nodeSchedule = require('node-schedule');
const amsCalc = require('./amscalc.js');
const { event } = require('../misc/misc.js');
const db = require('../misc/dbinit.js');
const { getDateTime, loadYaml } = require('../misc/util.js');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
const config = loadYaml(configFile);
const meterModel = config.meterModel;

const debug = config.amscalc.debug || false;

//const amsLastMessage = config.amsLastMessage || '59:56';

/**
 * Decode the list message and extract relevant information
 * @param {string} msg - Hexadecimal message string to be decoded
 * @returns {Object} - An object containing the decoded list information and the list type
 */
const listDecode = async function (data) {
  const [topic1, topic2, topic3, topic4, topic5] = data.topic.split('/');
  const msg = data.message;
  const ts = getDateTime();
  const hourIndex = parseInt(ts.substring(11, 13));

  let obj = {
    // REMOVE msgType AFTER TESTING?
    msgType: undefined,
    listType: 'list1',
    timestamp: ts,
    hourIndex: hourIndex,
    power: null,
  };

  if (msg.type === 'evt.meter.report') {
    if (msg.props.unit === 'W' && msg.val !== undefined) {
      // REMOVE obj.msgType type AFTER TESTING
      obj.msgType = msg.type;
      obj.power = msg.val / 1000;
      return obj;
    }
  } else if (msg.type === 'evt.pd7.notify') {
    if (msg.val.changes.energy !== undefined) {
      // REMOVE obj.msgType type AFTER TESTING
      obj.msgType = msg.type;
      obj.listType = 'list3';
      obj.power = msg.val.param.param.wattage / 1000;
      // Placeholders
      obj.powerProduction = 0;
      obj.powerReactive = 0;
      obj.powerProductionReactive = 0;
      //obj.meterDate = msg.val.changes.timestamp;
      obj.meterDate = msg.ctime;
      obj.lastMeterConsumption = msg.val.changes.energy;
      // Placehholders
      obj.lastMeterProduction = 0;
      obj.lastMeterConsumptionReactive = 0;
      obj.lastMeterProductionReactive = 0;
      const isNewHour = obj.meterDate.substring(14, 19) <= '00:12'
      if (isNewHour) {
        obj.isNewHour = isNewHour;
        obj.isNewDay = (obj.meterDate.substring(11, 16) === '00:00' && isNewHour);
        obj.isNewMonth = (obj.meterDate.substring(8, 10) === '01' && obj.isNewDay);
      }
      return (obj);
    }
  } else if (msg.type === 'evt.meter_ext.report') {
    // REMOVE obj.msgType type AFTER TESTING?
    obj.msgType = msg.type;
    obj.listType = 'list2';
    // Placeholder
    obj.powerProduction = 0;
    obj.powerReactive = msg.val.p_import_react / 1000;
    obj.powerProductionReactive = msg.val.p_export_react / 1000;
    obj.currentL1 = msg.val.i1;
    // 3-phase meter
    if (msg.val.i2 !== undefined) {
      obj.currentL2 = msg.val.i2;
      obj.currentL3 = msg.val.i3;
    }
    obj.voltagePhase1 = msg.val.u1;
    // 3-phase meter
    if (msg.val.u2 !== undefined) {
      obj.voltagePhase2 = msg.val.u2;
      obj.voltagePhase3 = msg.val.u3;
      if (msg.val.u2 === 0) {
        obj.voltagePhase2 = (Math.sqrt((msg.val.u1 - msg.val.u3 * 0.5) ** 2 + (msg.val.u3 * 0.866) ** 2)).toFixed(0) * 1;
      }
    }
    return (obj);
  }

  return null;
};

const runBeforeHour = async function () {
  const ts = getDateTime();
  const hourIndex = parseInt(ts.substring(11, 13));

  let data = {
    // REMOVE obj.msgType type AFTER TESTING?
    type: 'runBeforeHour',
    listType: 'list1',
    timestamp: ts,
    hourIndex: hourIndex,
    isHourEnd: true,
    isDayEnd: (hourIndex === 23),
    power: null,
  };

  const obj = await amsCalc(data.listType, data);
  event.emit(obj.listType, obj);
};

const runAfterHour = async function () {
  const ts = getDateTime();
  const hourIndex = parseInt(ts.substring(11, 13));

  let data = {
    // REMOVE obj.msgType type AFTER TESTING?
    msgType: 'runAfterHour',
    listType: 'list1',
    timestamp: ts,
    hourIndex: hourIndex,
    isHourStart: true,
    power: null,
  };

  if (hourIndex === 0) {
    data.isDayStart = true;
    if (ts.substring(8, 10) === '01')
      data.isMonthStart = true;
  }

  const obj = await amsCalc(data.listType, data);
  event.emit(obj.listType, obj);
};

/**
 * Handle the list messages, decode them and emit the corresponding event
 * @param {Buffer} buf - Buffer containing the list message
 */
const listHandler = async function (buf) {
  const listObject = await listDecode(buf);
  if (listObject !== null) {
    const list = listObject.listType;
    const obj = await amsCalc(list, listObject);
    event.emit(list, obj);
  }
}

event.on(meterModel, listHandler);

// As the messager arrive at irregular intervals, 
// scheduling is needed to ensure proper timing
// for certain events
nodeSchedule.scheduleJob('1 0 * * * *', runAfterHour);
nodeSchedule.scheduleJob('59 59 * * * *', runBeforeHour);

module.exports = { listHandler };
