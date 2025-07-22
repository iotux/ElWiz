
// const db = require('../misc/dbinit.js');
const nodeSchedule = require('node-schedule');
const amsCalc = require('./amscalc.js');
const { event } = require('../misc/misc.js');
const { getDateTime, loadYaml } = require('../misc/util.js');
const { is } = require('date-fns/locale');

// Load broker and topics preferences from config file
const configFile = './config.yaml';
const config = loadYaml(configFile);
const meterModel = config.meterModel;

const debug = config.amscalc.debug || false;

let lastHour = null;
let hasTriggeredThisHour = false;
let isFirstRun = true;

function checkNewHour(timestamp) {
  const currentTime = timestamp.substring(14, 19); // MM:SS
  const currentHour = timestamp.substring(11, 13); // HH
  let isVirgin = false;
  if (isFirstRun) {
    lastHour = currentHour;
    isFirstRun = false;
    return false; // Skip first run (no comparison)
  }
  // Only check for new hour if the hour has changed
  if (currentHour !== lastHour) {
    // New hour detected! Now check if MM:SS > '00:00'
    if (currentTime > '00:00') {
      isVirgin = true;
      hasTriggeredThisHour = true;
    }
    lastHour = currentHour; // Update lastHour
  } else {
    // Same hour → reset hasTriggeredThisHour if we're back at '00:00' (optional)
    if (currentTime === '00:00') {
      hasTriggeredThisHour = false;
    }
  }
  return isVirgin;
}

//const amsLastMessage = config.amsLastMessage || '59:56';
const getAmsTime = async function(timeString) {
  //const timeString = obisObj['0-0:1.0.0'].value.toString();
  const year = '20' + timeString.substring(0, 2);
  const month = timeString.substring(2, 4);
  const day = timeString.substring(4, 6);
  const hour = timeString.substring(6, 8);
  const minute = timeString.substring(8, 10);
  second = timeString.substring(10, 12);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+01:00`;
}

/**
 * Decode the list message and extract relevant information
 * @param {string} msg - Message to be decoded
 * @returns {Object} - An object containing the decoded list information and the list type
 */
const listDecode = async function (msg) {
  const ts = getDateTime();
  const hourIndex = parseInt(ts.substring(11, 13));
  const minuteIndex = parseInt(ts.substring(14, 16));
  const timeSubStr = ts.substring(14, 19);
  const lines = msg.trim().split('\n');
  const obisObj = {};

  for (const line of lines) {
    if (line.includes('(') && line.includes(')')) {
      const [obis, valueUnit] = line.split('(');
      if (obis === '0-0:1.0.0') {
        const [value, unit] = valueUnit.split('W');
        const time = await getAmsTime(value);
        obisObj[obis] = { value: time, unit: null };
      } else if (line.includes('*')) {
        //const [obis, valueUnit] = line.split('(');
        const [value, unit] = valueUnit.split(')').join('').split('*');
        obisObj[obis] = { value: parseFloat(value), unit };
      }
    }
  }

  const result = {
    listType: 'list1',
    timestamp: ts,
    meterDate: obisObj['0-0:1.0.0'] ? obisObj['0-0:1.0.0'].value : ts,
    hourIndex: hourIndex,
    isVirgin: false,
    isNewDay: false,
    isNewMonth: false,
    measuredMeterConsumption: obisObj['1-0:1.8.0'] ? obisObj['1-0:1.8.0'].value : 0,
    lastMeterConsumption: obisObj['1-0:1.8.0'] ? obisObj['1-0:1.8.0'].value : 0,
    lastMeterProduction: obisObj['1-0:2.8.0'] ? obisObj['1-0:2.8.0'].value : 0,
    lastMeterConsumptionReactive: obisObj['1-0:3.8.0'] ? obisObj['1-0:3.8.0'].value : 0,
    lastMeterProductionReactive: obisObj['1-0:4.8.0'] ? obisObj['1-0:4.8.0'].value : 0,
    power: obisObj['1-0:1.7.0'] ? obisObj['1-0:1.7.0'].value : 0,
    powerProduction: obisObj['1-0:2.7.0'] ? obisObj['1-0:2.7.0'].value : 0,
    powerReactive: obisObj['1-0:3.7.0'] ? obisObj['1-0:3.7.0'].value : 0,
    powerProductionReactive: obisObj['1-0:4.7.0'] ? obisObj['1-0:4.7.0'].value : 0,
    currentL1: obisObj['1-0:31.7.0'] ? obisObj['1-0:31.7.0'].value : 0,
    currentL2: obisObj['1-0:51.7.0'] ? obisObj['1-0:51.7.0'].value : 0,
    currentL3: obisObj['1-0:71.7.0'] ? obisObj['1-0:71.7.0'].value : 0,
    voltagePhase1: obisObj['1-0:32.7.0'] ? obisObj['1-0:32.7.0'].value : 0,
    voltagePhase2: obisObj['1-0:52.7.0'] ? obisObj['1-0:52.7.0'].value : 0,
    voltagePhase3: obisObj['1-0:72.7.0'] ? obisObj['1-0:72.7.0'].value : 0,
  };

  //result.timestamp = result.meterDate; // meterDate has priority
  const secStr = result.meterDate.substring(17, 19);
  result.listType = ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'].includes(secStr) ? 'list2' : 'list1';

  // 2025-01-01T00:00:10+01:00
  // 0123456789012345678901234
  result.hourIndex = parseInt(result.meterDate.substring(11, 13));
  result.isVirgin = await checkNewHour(result.meterDate);
  result.isNewDay = result.isVirgin && result.meterDate.substring(11, 13) === '00';
  result.isNewMonth = result.isNewDay && result.meterDate.substring(8, 10) === '01';
  if (result.isVirgin) result.listType = 'list3';
  //console.log('obis:', result);

  if (result.meterDate.substring(14, 19) === '59:58') {
    result.isHourEnd = true;
    if (result.hourIndex === 23)
      result.isDayEnd = true;
  }

  if (result.meterDate.substring(14, 19) === '00:01') {
    result.isNewHour = true;
    if (result.hourIndex === 0) {
      result.isDayStart = true;
      if (result.meterDate.substring(8, 10) === '01')
        result.isMonthStart = true;
    }
  }

  return result;
}

/**
 * Handle the list messages, decode them and emit the corresponding event
 * @param {Buffer} buf - Buffer containing the list message
 */
const listHandler = async function (buf) {
  //console.log('Buffer:', buf);
  const listObject = await listDecode(buf);
  if (listObject !== null) {
    const list = listObject.listType;
    const obj = await amsCalc(list, listObject);
    event.emit(list, obj);
  }
}

event.on('obis', listHandler);

// As the messager arrive at irregular intervals,
// scheduling is needed to ensure proper timing
// for certain events
//nodeSchedule.scheduleJob('1 0 * * * *', runAfterHour);
//nodeSchedule.scheduleJob('59 59 * * * *', runBeforeHour);

module.exports = { listHandler };
