
// const { default: isThisHour } = require("date-fns/isThisHour/index");
const yaml = require('yamljs');
const configFile = './config.yaml';

const { event } = require('../misc/misc.js');
const { mergePrices } = require('./mergeprices.js');
const { calculateCost } = require('./calculatecost.js');
const config = yaml.load(configFile);
const debug = config.DEBUG || false;

const publisher = require('../publish/' + config.publisher + '.js');

// let redisdb;

// if (config.storage !== 'none') {
//  redisdb = require('../storage/' + config.storage + '.js');
//  console.log('Using storage: ' + config.storage);
// }

const onPlugEvent1 = async function (obj) {
  // No prices for listtype 1
  // Send to publish
  event.emit('publish1', obj);
  if (debug) {
    obj.cacheType = config.cacheType || 'file';
    console.log('List1: plugselector', obj);
  }
};

const onPlugEvent2 = async function (obj) {
  if (config.computePrices) {
    obj = await mergePrices('list2', obj);
    if (config.calculateCost) {
      obj = await calculateCost.calc('list2', obj);
    }
  }
  // Send to publish
  event.emit('publish2', obj);
  if (debug) {
    console.log('List2: plugselector', obj);
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
        obj = await calculateCost.calc('list3', obj);
      } catch (error) {
        console.log('onPlugEvent3 calling calculateCost', error);
      }
    }
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
  if (debug) {
    console.log('List3: plugselector', obj);
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
