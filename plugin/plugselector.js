// const { default: isThisHour } = require("date-fns/isThisHour/index");
const configFile = './config.yaml';
const { event } = require('../misc/misc.js');
const { loadYaml } = require('../misc/util.js');
//require('../storage/redisdb.js');
const { mergePrices } = require('../plugin/mergeprices.js');
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
  // if (debug) { console.log('List1: plugSelector', JSON.stringify(obj, null, 2)); }
  event.emit('publish1', obj);
};

const onPlugEvent2 = async function (obj) {
  // Needed for HA cost calculation
  obj = await mergePrices('list2', obj);

  // if (debug) { console.log('List2: plugSelector', JSON.stringify(obj, null, 2)); }
  event.emit('publish2', obj);
  if (config.storage !== 'none') {
    // Sending data to storage is optional
    try {
      event.emit('storage2', obj);
    } catch (error) {
      console.error('Error while emitting storage3 event:', error);
    }
  }
};

const onPlugEvent3 = async function (obj) {
  // Call mergePrices unconditionally to ensure price data like spotPrice is always added
  try {
    obj = await mergePrices('list3', obj);
  } catch (error) {
    console.error('plugselector: Error calling mergePrices for list3:', error);
  }

  // if (debug) { console.log('List3: plugSelector', JSON.stringify(obj, null, 2)); }

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
  },
};

plugSelector.init();
module.exports = plugSelector;
