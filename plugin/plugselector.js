
// const { default: isThisHour } = require("date-fns/isThisHour/index");
const configFile = './config.yaml';
const { event } = require('../misc/misc.js');
const { loadYaml } = require('../misc/util.js');
//require('../storage/redisdb.js');
const { mergePrices } = require('../plugin/mergeprices.js');
const { calculateCost } = require('../plugin/calculatecost.js');
const config = loadYaml(configFile);
const debug = config.plugselector.debug || false;
const publisher = require('../publish/' + config.publisher + '.js');

let storage;

if (config.storage !== 'none') {
  storage = require('../storage/' + config.storage + '.js');
  console.log('Using storage: ' + config.storage);
}

const onPlugEvent1 = async function (obj) {
  // No prices for listtype 1
  obj = await mergePrices('list1', obj);
  // Send to publish
  if (debug) {
    obj.cacheType = config.cacheType || 'file';
    //console.log('List1: plugSelector', obj);
  }
  event.emit('publish1', obj);
};

const onPlugEvent2 = async function (obj) {
  // Needed for HA cost calculation
  obj = await mergePrices('list2', obj);

  //xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  if (config.calculateCost) {
    try {
      obj = await calculateCost('list2', obj);
    } catch (error) {
      console.log('onPlugEvent2 calling calculateCost', error);
    }
  }
  //xxxxxxxxxxxxxxxxxxxxxxxxxxxxx

  if (debug) {
    obj.cacheType = config.cacheType || 'file';
    console.log('List2: plugSelector', obj);
  }
  event.emit('publish2', obj);
  if (config.storage !== 'none') {
    // Sending data to storage is optional
    try {
      event.emit('storage2', obj);
    } catch (error) {
      console.log('Error while emitting storage3 event:', error);
    }
  }
};

const onPlugEvent3 = async function (obj) {
  if (config.computePrices) {
    try {
      obj = await mergePrices('list3', obj);
    } catch (error) {
      console.log('calling mergePrices', error);
    }

    if (config.calculateCost) {
      try {
        obj = await calculateCost('list3', obj);
      } catch (error) {
        console.log('onPlugEvent3 calling calculateCost', error);
      }
    }

  }

  if (debug) {
    console.log('List3: plugSelector', obj);
  }

  try {
    // Send to publish
    event.emit('publish3', obj);
  } catch (error) {
    console.error('Error while emitting publish3 event:', error);
  }
  if (config.storage !== 'none') {
    // Sending data to storage is optional
    try {
      event.emit('storage3', obj);
    } catch (error) {
      console.log('Error while emitting storage3 event:', error);
    }
  }
};

const plugSelector = {
  // Plugin constants
  isVirgin: true,
  today: undefined,
  tomorrow: undefined,
  dayPrices: {},
  nextDayPrices: {},

  init: function () {
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('list1', onPlugEvent1);
      event.on('list2', onPlugEvent2);
      event.on('list3', onPlugEvent3);
    }
  }
};

plugSelector.init();
module.exports = plugSelector;
