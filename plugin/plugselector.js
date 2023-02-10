
//const { default: isThisHour } = require("date-fns/isThisHour/index");
const yaml = require("yamljs");
const configFile = './config.yaml';

const { event } = require('../misc/misc.js')
const { mergePrices } = require("./mergeprices.js");
const { calculateCost } = require("./calculatecost.js");
const config = yaml.load(configFile);
const debug = config.DEBUG;

let publisher = require("../publish/" + config.publisher + ".js")

const onPlugEvent1 = async function (obj) {
  // No prices for listtype 1
  // Send to publish
  event.emit('publish1', obj)
  //if (debug)
  //  console.log('List1: plugselector',obj);
}

const onPlugEvent2 = async function (obj) {
  let res;
  if (config.computePrices) {
    let obj1 = await mergePrices("list2", obj)
    if (config.calculateCost) {
      res = await calculateCost.calc("list2", obj1)
    }
  }
  // Send to publish
  event.emit('publish2', obj)
  //if (debug)
  //  console.log('List2: plugselector',obj);
}

const onPlugEvent3 = async function (obj) {
  if (config.computePrices) {
    await mergePrices("list3", obj)
    if (config.calculateCost) {
      await calculateCost.calc("list3", obj)
    }
  }
  // Send to publish
  event.emit('publish3', obj)
  if (debug)
    console.log('List3: plugselector',obj);
}

const plugSelector = {
  // Plugin constants
  isVirgin: true,
  debug: config.DEBUG,
  today: undefined,
  tomorrow: undefined,
  dayPrices: {},
  nextDayPrices: {},

  init: function () {
    if (this.isVirgin) {
      this.isVirgin = false;
      event.on('list1', onPlugEvent1)
      event.on('list2', onPlugEvent2)
      event.on('list3', onPlugEvent3)
    }
    publisher.init();
  },
}
plugSelector.init();
module.exports = plugSelector;