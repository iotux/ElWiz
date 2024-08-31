#!/usr/bin/env node

const { exit } = require('process');
const fs = require('fs');
const express = require('express');
const yaml = require('js-yaml');
const path = require('path');
const app = express();
//const mqtt = require('mqtt');
const MQTTClient = require("./mqtt/mqtt");
const WebSocket = require('ws');
const configPath = './chart-config.yaml';
const config = loadYaml(configPath);

const serverConfig = config.serverConfig;
let chartConfig = config.chartConfig;

const savePath = serverConfig.savePath;
//const saveFile = `${savePath}/chartoffsets.json`;
const saveFile = `${savePath}/thresholds.json`;

const debug = serverConfig.debug;

const serverPort = serverConfig.serverPort;
const wsServerPort = serverConfig.wsServerPort;

const mqttUrl = serverConfig.mqttUrl || 'mqtt://localhost:1883';
const mqttOpts = serverConfig.mqttOptions;

const priceTopic = serverConfig.priceTopic || 'elwiz/prices';
const chartTopic = serverConfig.chartTopic || 'elwiz/chart';
const hassPublish = serverConfig.hassPublish || true;
const haBaseTopic = serverConfig.elwiz || 'elwiz';
const haSensorTopic = 'elwiz/sensor/';
const haAnnounceTopic = serverConfig.haAnnounceTopic || 'homeassistant';
const announceTopic = `${haAnnounceTopic}/sensor/ElWizChart`;
const announceBinaryTopic = `${haAnnounceTopic}/binary_sensor/ElWizChart`;
const avtyTopic = `${haBaseTopic}/chart/status`;
const statTopic = `${haBaseTopic}/chart`

const currencyCode = serverConfig.currencyCode || 'EUR';

const fixedOffset = serverConfig.fixedAverageOffset || 0;
const stepFactor = serverConfig.adjustmentStepFactor || 1;
const verticalStepCount = serverConfig.verticalStepCount || 50;

mqttOpts.will = { topic: avtyTopic, payload: 'offline', retain: true, qos: 0 };
const mqttClient = new MQTTClient(mqttUrl, mqttOpts, 'chartServer');
const pubOpts = { retain: true, qos: 0 };

const wss = new WebSocket.Server({ port: wsServerPort });

// Storage: ./data/thresholds.json = [{ date: skewDays(-1), threshold: 0 }, { date: skewDays(0), threshold: 0 }];
let leftAvgOffsetFactor = 0;
let rightAvgOffsetFactor = 0;
let offsetFactors;
let maxPrice = 0;


let isVirgin = true;
//let hasDayAheadPrices = false;
let timezoneOffset;
let currentDate;
let currentHour;
//let currHourStr;
let isOnRightSide;

function getCurrencySymbol(symbol = 'EUR') {
  let result = Intl.NumberFormat(symbol, {
    style: 'currency',
    currency: symbol,
    currencyDisplay: 'narrowSymbol',
    maximumSignificantDigits: 1
  }).format(0);
  return result.replace(/0/, '').trim();
}

function loadYaml(configPath) {
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const data = yaml.load(fileContents);
    return data;
  } catch (error) {
    console.error(`Error reading or parsing the YAML file: ${error}`);
  }
}

function getDateString(dateTime) {
  const now = new Date(dateTime);
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function skewDays(days) {
  const oneDay = 86400000; // pre-calculate milliseconds in a day (24 * 60 * 60 * 1000)
  const date = new Date(Date.now() + oneDay * days);
  return getDateString(date);
}

async function getOffsets() {
  offsetFactors = [{ date: await skewDays(-1), threshold: 0 }, { date: await skewDays(0), threshold: 0 }]
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
    fs.writeFileSync(saveFile, JSON.stringify(thresholds));
    return offsetFactors;
  } else {
    if (!fs.existsSync(saveFile)) {
      fs.writeFileSync(saveFile, JSON.stringify(offsetFactors));
      return offsetFactors;
    }
    return JSON.parse(fs.readFileSync(saveFile));
  }
}

function saveThresholds(idx, threshold, where) {
  offsetFactors[idx].threshold = threshold;
  if (debug)
    console.log(`saveThresholds ${where}: saved`, offsetFactors);
  fs.writeFileSync(saveFile, JSON.stringify(offsetFactors));
}

(async () => {

  offsetFactors = await getOffsets();
  console.log('Thresholds', offsetFactors);
  leftAvgOffsetFactor = offsetFactors[0].threshold;
  rightAvgOffsetFactor = offsetFactors[1].threshold;

  class Clients {
    constructor() {
      this.clientList = {};
      this.saveClient = this.saveClient.bind(this);
      this.getClient = this.getClient.bind(this);
      this.getClientList = this.getClientList.bind(this);
      this.deleteClient = this.deleteClient.bind(this);
    }
    saveClient(clientId, client) {
      this.clientList[clientId] = client;
    }
    getClient(clientId) {
      return this.clientList[clientId];
    }
    getClientList() {
      return this.clientList;
    }
    deleteClient(clientId) {
      delete this.clientList[clientId];
    }
    getClientIds() {
      return Object.keys(this.clientList);
    }
  }

  const clients = new Clients();
  // ============ Websockets handling ============
  // Message structure
  /*
  data = {
    clientId: clientId,
    channel: channel,
    topic: topic,
    payload: payload
  }
  */
  wss.on('connection', function (client) {
    client.on('message', function (message) {
      const data = JSON.parse(message);
      const channel = data['channel'];
      const topic = data['topic'];
      const msg = data['payload'];
      const clientId = data.clientId;
      clients.saveClient(clientId, client);
      ws = clients.getClient(clientId);
      if (msg === 'init') {
        console.log('Request from client', data);
        wsSend(clientId, clientId, 'full', chartData);
      }
      console.log('Active clients', clients.getClientIds())
    });

    client.on('close', function (connection) {
      console.log('Connection closed', connection)
      //delete clients[client];
    });
  });

  const wsSendAll = function (channel, topic, message) {
    wss.clients.forEach(function each(client) {
      client.send(
        JSON.stringify({
          channel: channel,
          topic: topic,
          payload: message,
        })
      );
    });
  };

  const wsSend = function (clientId, channel, topic, message) {
    let ws = clients.getClient(clientId);
    while (ws === undefined) return; //sleep(1000);
    ws.send(
      JSON.stringify({
        channel: channel,
        topic: topic,
        payload: message,
      })
    );
  };

  const sendMessage = async (clientId, channel, severity, message) => {
    let msg = {
      time: Date.now(),
      severity: severity,
      message: message,
    };
    await wsSend(clientId, channel, 'push/' + clientId + '/msg', msg);
  };

  // ============ MQTT initalization ============

  if (config.mqttBroker === null) {
    console.log('\nBroker IP address or hostname missing');
    console.log('Edit your "config.yaml" file\n');
    process.exit(0);
  }

  //if (isConnected) {
  //console.log(`Server is connected to ${mqttUrl}`);
  try {
    mqttClient.subscribe(`${priceTopic}/#`)
  } catch (err) {
    console.log('Subscription error', err);
  }
  try {
    mqttClient.subscribe(`${chartTopic}/#`)
  } catch (err) {
    console.log('Subscription error', err);
  }
  //} else {
  //console.log(`Server is not connected to ${mqttUrl}`);
  //}

  // ============ MQTT message handling ============
  let dataAvailable = false;
  let chartData = [];

  let twoDaysData = [];
  let timerInit = true;

  mqttClient.on('message', async (topic, message) => {
    const [topic1, topic2, topic3] = topic.split('/');
    console.log('topic', topic)
    // Receive hourly
    if (`${topic1}/${topic2}` === priceTopic) {
      const result = parseJsonSafely(message);
      if (!result.error) {
        // Fetch 2 days of price data
        if (twoDaysData.length < 2) {
          twoDaysData.push(result.data);
        } else if (result.data.priceDate > twoDaysData[1].priceDate) {
          twoDaysData.push(result.data);
          twoDaysData = twoDaysData.slice(-2);
        } else {
          if (debug)
            console.log('Pricedata skipped ', result.data.priceDate);
        }

        // MQTT price data handling
        // Give time for receiving 2 - 3 MQTT messages
        // before activating "handleMessages()"
        // Then reset "timerInit" after a delay
        if (timerInit) {
          timerInit = false;
          setTimeout(() => {
            handleMessages();
            timerInit = true;
          }, 500);
        }
      }
    } else if (`${topic1}/${topic2}` === chartTopic) {
      // MQTT message coming from HA or other sources
      if (topic3 === 'adjustLeftAvgOffset') {
        const parsed = parseFloat(message.toString());
        leftAvgOffsetFactor = parsed === 0 ? 0 : leftAvgOffsetFactor += parsed * stepFactor;
        saveThresholds(0, leftAvgOffsetFactor, 'adjustLeftDisp, topic3');
        updateAvgData(0, leftAvgOffsetFactor, 'adjustLeftDisp, topic3');
        wsSendAll('chart', 'update', chartData);
      } else if (topic3 === 'adjustRightAvgOffset') {
        const parsed = parseFloat(message.toString());
        rightAvgOffsetFactor = parsed === 0 ? 0 : rightAvgOffsetFactor += parsed * stepFactor;
        saveThresholds(1, rightAvgOffsetFactor, 'adjustRightDisp, topic3');
        updateAvgData(24, rightAvgOffsetFactor, 'adjustRightDisp, topic3');
        wsSendAll('chart', 'update', chartData);
      }
    }
  }); // mqttClient.on('message')


  function handleMessages() {
    const today = skewDays(0);
    //hasDayAheadPrices = false;
    isOnRightSide = false;

    if (debug)
      console.log('twoDaysData length', twoDaysData.length);

    //if (twoDaysData.length > 2) {
    //  twoDaysData = twoDaysData.slice(-2);
    //}

    if (twoDaysData.length > 1) {
      isOnRightSide = twoDaysData[1].priceDate === today;

      if (twoDaysData[1].priceDate > offsetFactors[1].date) {
        offsetFactors.push({ date: twoDaysData[1].priceDate, threshold: 0 });
        offsetFactors = offsetFactors.slice(-2);
        saveThresholds(1, 0, 'handleMessages');
      }
    }

    updateChartData(twoDaysData[0], offsetFactors[0].threshold);
    if (twoDaysData.length > 1)
      updateChartData(twoDaysData[1], offsetFactors[1].threshold);

    checkAndSendChartData(chartData);

    if (debug) {
      console.log('AvgOffsetFactors', offsetFactors);
      twoDaysData.forEach((m, idx) => {
        console.log('priceDate', idx, m.priceDate);
      });
    }

    leftAvgOffsetFactor = offsetFactors[0].threshold;
    rightAvgOffsetFactor = offsetFactors[1].threshold;

    isVirgin = false;
  } // handleMessages()

  // This function prepares and updates the chart data structure
  function updateChartData(prices, adjustment) {
    let hourlyData;

    try {
      hourlyData = prices.hourly;
    } catch (err) {
      console.log('No data to update.');
      return;
    }

    const avgPrice = prices.daily.avgPrice;

    // Vertical range = highest price in a 2 days period
    if (prices.daily.maxPrice > maxPrice) {
      maxPrice = prices.daily.maxPrice;
    }

    // verticalStepCount = step count for the vertical range
    const fixed = (maxPrice / verticalStepCount) * fixedOffset;
    const adjust = (maxPrice / verticalStepCount) * adjustment;

    if (debug)
      console.log('maxPrice', maxPrice, 'avgPrice', avgPrice, 'fixed', fixed, 'adjust', adjust);

    const thresholdLevel = adjustment === 0 ? parseFloat((avgPrice + fixed).toFixed(4)) : parseFloat((avgPrice + fixed + adjust).toFixed(4));
    // This check ensures that the function proceeds only if there's meaningful data to process.
    if (hourlyData.length === 0) {
      if (debug)
        console.log("No data to update.");
      return;
    }

    // Map the prices to the desired format.
    const newData = hourlyData.map(h => ({
      startTime: h.startTime,
      spotPrice: h.spotPrice,
      avgPrice: avgPrice,
      thresholdLevel: thresholdLevel,
      isBelowThreshold: h.spotPrice < thresholdLevel ? 1 : 0,
    }));

    // If starting without data, ensure chartData is initialized correctly.
    if (!dataAvailable) {
      // Assuming dataAvailable should be true now as we're processing new data.
      dataAvailable = true;
      chartData = [...newData];
    } else {
      chartData = [...chartData, ...newData];
    }

    // Ensure chartData does not exceed the 48-hour window.
    if (chartData.length > 48) {
      chartData = chartData.slice(-48); // This keeps the latest 48 entries.
    }
    if (debug)
      console.log('updateChartData processed', chartData.length, 'entries.');
  } // updateChartData()

  async function updateAvgData(startOffset, adjustment, from) {
    if (debug) console.log('updateAvgData invoked from', from);

    // Ensure startOffset is either 0 or 24
    startOffset = startOffset === 24 ? 24 : 0;
    const dayIndex = startOffset === 0 ? 0 : 1;
    const avgPrice = twoDaysData[dayIndex].daily.avgPrice;
    // Vertical range = 0..maxPrice
    const fixed = (maxPrice / verticalStepCount) * fixedOffset;
    const adjust = (maxPrice / verticalStepCount) * adjustment;

    if (debug)
      console.log('maxPrice', maxPrice, 'avgPrice', avgPrice, 'fixed', fixed, 'adjust', adjust);

    chartData.forEach((h, idx) => {
      // Modify only 24 elements starting from the startOffset index
      if (idx >= startOffset && idx < startOffset + 24) {
        if (avgPrice > 0) {
          h.thresholdLevel = parseFloat((avgPrice + fixed + adjust).toFixed(3));
        } else {
          h.thresholdLevel = 0;
        }
        h.isBelowThreshold = h.spotPrice < h.thresholdLevel ? 1 : 0;
      }
    });

    if (chartData[startOffset].startTime.slice(0, 10) === currentDate) {
      publishData(startOffset, 'updateAvgData');
      wsSendAll('chart', 'update', chartData);
    }
  }




  function publishData(startOffset, from) {
    if (debug)
      console.log('publishData invoked from', from, 'StartOffset:', startOffset, '\nchartData:', chartData[currentHour + startOffset])
    try {
      // Publish only the current date side of the chart
      mqttClient.publish(`${statTopic}/spotPrice`, String(chartData[currentHour + startOffset].spotPrice), pubOpts);
      mqttClient.publish(`${statTopic}/avgPrice`, String(chartData[currentHour + startOffset].avgPrice), pubOpts);
      mqttClient.publish(`${statTopic}/thresholdLevel`, String(chartData[currentHour + startOffset].thresholdLevel), pubOpts);
      mqttClient.publish(`${statTopic}/spotBelowThreshold`, String(chartData[currentHour + startOffset].isBelowThreshold), pubOpts);
    } catch (err) {
      console.log('Publishing failed...');
    }
  }

  const checkAndSendChartData = (function () {
    let recentUpdates = new Set();
    let lastUpdateSize = 0;

    return function (chartData) {
      const currentStartTimes = chartData.map(data => data.startTime.slice(0, 10));
      const uniqueStartTimes = new Set(currentStartTimes);
      const isNewData = [...uniqueStartTimes].some(date => !recentUpdates.has(date));

      if (isNewData || chartData.length !== lastUpdateSize) {
        if (isOnRightSide)
          updateAvgData(24, offsetFactors[1].threshold, 'checkAndSendChartData, right')
        else
          updateAvgData(0, offsetFactors[0].threshold, 'checkAndSendChartData, left')
        wsSendAll('chart', 'init', chartData);
        uniqueStartTimes.forEach(date => recentUpdates.add(date));
        lastUpdateSize = chartData.length;

        // Keep only the most recent dates
        while (recentUpdates.size > 2) {
          const oldestDate = [...recentUpdates].sort()[0];
          recentUpdates.delete(oldestDate);
        }
        if (debug)
          console.log('Data updated and sent');
      } else {
        console.log('No new data to send');
      }
    };
  })();

  // ============ Scheduling ============
  async function hourlyTasks() {
    if (debug)
      console.log('Hourly tasks invoked...')
    timezoneOffset = await getTimezoneOffset();
    const date = new Date(Date.now());
    currentHour = date.getHours();
    currentDate = getDateString(date);

    isOnRightSide = chartData[0].startTime.slice(0, 10) === currentDate ? false : true;
    //if (currentHour === 0) {
    // Just past midnight
    //  isOnRightSide = true;
    //}

    if (!isVirgin) {
      const startOffset = isOnRightSide ? 24 : 0;
      currentFactor = isOnRightSide ? offsetFactors[1].threshold : offsetFactors[0].threshold;
      await updateAvgData(startOffset, currentFactor, 'hourlyTasks');
    }

    if (debug) {
      //console.log('Hourly task', 'startOffset', startOffset, chartData[currentHour + startOffset]);
      console.log('AvgOffsetFactors', offsetFactors);
      console.log('isOnRightSide', isOnRightSide);
    }
  }

  function scheduleHourlyTasks() {
    const now = new Date();
    const minutesToNextHour = 60 - now.getMinutes();
    const secondsToNextHour = (minutesToNextHour * 60) - now.getSeconds();
    const msToNextHour = secondsToNextHour * 1000; // Convert to milliseconds

    setTimeout(() => {
      console.log('Wait for MQTT prices...');
      // First invocation after startup
      hourlyTasks();
    }, 1000);

    // First update: Delay until the start of the next hour
    setTimeout(() => {
      hourlyTasks(); // Update immediately at the next hour
      // Then update every hour after that
      setInterval(hourlyTasks, 3600000); // 3600000ms = 1 hour
    }, msToNextHour);
  }

  // ============ Web server initialization ============
  // Middleware to parse JSON and URL-encoded bodies
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Serve static files (for Chart.js and CSS)
  app.use(express.static('public'));

  // Route for the graph page
  app.get('/chart', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chart.html'));
  });

  app.get('/icon-day', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'icon-day.png'));
  });
  app.get('/icon-night', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'icon-night.png'));
  });

  // Send content of the YAML config file
  app.get('/config', (req, res) => {
    // Read config file on browser load/reload to catch changes
    const config = loadYaml(configPath);
    chartConfig = config.chartConfig;
    // Add timezoneOffset to client
    chartConfig.timezoneOffset = timezoneOffset;
    res.json(chartConfig);
  });

  app.listen(serverPort, () => {
    console.log(`Server is running on http://localhost:${serverPort}`);
  });

  // ============ Helper functions ============

  async function getTimezoneOffset() {
    // getTimezoneOffset() returns the difference in minutes, so convert it to hours
    // and invert the sign to align with conventional time zone representations.
    const offset = -new Date().getTimezoneOffset() / 60;
    return offset;
  }

  function calcAverage(obj, element) {
    // Calculate the average sum of the specified element from "obj" object array
    let sum = 0;
    for (let i = 0; i <= obj.length - 1; i++) {
      sum += obj[i][element];
    }
    return sum / i;
  }
  // Helper function to check if a string is a valid JSON
  function isJsonString(str) {
    try {
      JSON.parse(str);
    } catch (e) {
      return false;
    }
    return true;
  }

  function parseJsonSafely(message) {
    let buffer;
    try {
      buffer = message.toString();
    } catch (err) {
      console.log('Error converting buffer to string:', err);
      return { error: true, message: 'Message cannot be parsed as atring', data: null };
    }
    // Trim the input to remove leading/trailing whitespace
    const trimmedString = buffer.trim();

    // Check if the input is empty
    if (trimmedString === '') {
      return { error: true, message: 'Empty string cannot be parsed as JSON.', data: null };
    }

    // Attempt to parse the JSON string
    try {
      const data = JSON.parse(trimmedString);
      return { error: false, message: 'Successfully parsed JSON.', data: data };
    } catch (error) {
      return { error: true, message: `Error parsing JSON: ${error.message}`, data: null };
    }
  }

  // Home Assistant auto discovery according to config
  if (hassPublish) {
    const hassDevice = function (deviceType, name, uniqueId, devClass, staClass, unitOfMeasurement, stateTopic) {
      const result = {
        name: name,
        object_id: uniqueId,
        uniq_id: uniqueId,
        avty_t: avtyTopic, // availability_topic
        stat_t: statTopic + '/' + stateTopic,
        dev: {
          ids: 'elwiz_chart',
          name: 'ElWizChart',
          sw: 'https://github.com/iotux/ElWiz',
          mdl: 'Chart',
          mf: 'iotux'
        }
      };
      if (devClass !== '') result.dev_cla = devClass; // device_class
      if (staClass !== '') result.stat_cla = staClass; // state_class
      if (unitOfMeasurement !== '') result.unit_of_meas = unitOfMeasurement;
      if (deviceType === 'binary_sensor') {
        result.pl_on = '1';
        result.pl_off = '0';
      }
      return result;
    };

    // Set retain flag (pubOpts) on status message to let HA find it after a stop/restart
    let announce = hassDevice('sensor', 'Spot price', 'spotPrice', 'monetary', 'total', `${getCurrencySymbol(currencyCode)}/kWh`, 'spotPrice');
    mqttClient.publish(`${announceTopic}/spotPrice/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    announce = hassDevice('sensor', 'Average price', 'avgPrice', 'monetary', 'total', `${getCurrencySymbol(currencyCode)}/kWh`, 'avgPrice');
    mqttClient.publish(`${announceTopic}/avgPrice/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);

    announce = hassDevice('sensor', 'Backoff threshold level', 'thresholdLevel', 'monetary', 'total', `${getCurrencySymbol(currencyCode)}/kWh`, 'thresholdLevel');
    mqttClient.publish(`${announceTopic}/thresholdLevel/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
    if (debug)
      console.log('HA announce thresholdLevel', announce);

    announce = hassDevice('binary_sensor', 'Spot price below threshold', 'spotBelowThreshold', '', 'measurement', '', 'spotBelowThreshold');
    mqttClient.publish(`${announceBinaryTopic}/spotBelowThreshold/config`, JSON.stringify(announce, debug ? null : undefined, 2), pubOpts);
    if (debug)
      console.log('HA announce spotBelowThreshold', announce);

    mqttClient.publish(avtyTopic, 'online', pubOpts);
  }

  if (debug) console.log(config);

  scheduleHourlyTasks();
})();
