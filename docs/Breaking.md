# Breaking changes

## 2023-04-06

**Configuration file (config.yaml.sample)**

Several new configuration items are introduced to take into account recent program changes.

Most notably these changes are as follows with the default values shown. 

**cacheType: file**

Possible options are **file** and **redis**

The cache is primarly used for storing price data and to persist AMS meter data during program stops.

**storage: none**

Storage is meant for long term storing of price and meter data for statistics purposes.

**priceTopic: elwiz/prices**

With the introduction of publishing prices via MQTT, **ElWiz** is modified accordingly to subscribe to the price data.

It is important to add these changes to the **configf.yaml** file, else the ElWiz e:qxecution will break. 
