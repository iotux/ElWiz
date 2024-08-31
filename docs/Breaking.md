# Breaking changes

## 2024-07-23

**Configuration file (config.yaml.sample)**

Several configuration items are changed to take into account recent program changes.
Most notably **haBaseTopic**, which was necessary to accommodate for changes in Home Assistant discovery code. Also not that MQTT **username** and **password** are now a suboption under **mqttOptions**.

Carefully inspect the changes in your own **config.yaml** file and modify accordingly.

**amsCalc** 

The **amsCalc** module are changed to calculate the energy closest possible to the next hour. This is necessary for Home Assistant's inability to show the correct energy consumption when meters publishes data past current hour. This change may break the driver code for **aidon** and **kamstrup** AMS meters. Users should post an issue at Github if this happens. This change also necessitated changes to other modules.

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

It is important to add these changes to the **configf.yaml** file, else the ElWiz execution will break. 
