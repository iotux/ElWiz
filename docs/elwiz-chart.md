# elwiz-chart

![elwiz-chart](../docs/chart_and_panel.png?raw=true)

**elwiz-chart** is the solution to keep track of fluctuating energy prices and take control over your energy usage. It is a bar chart with 48 bars representing 2 days of fluctuating price data. The source of the energy prices is the **Nord Pool** European energy market. 

The bars are either green or red, where green means an opportunity to save on engergy use. We can call it a **Green zone**. Green or red is determined by the price level, where the threshold is based on the average price during a day or adjusted by **MQTT** messages.

A sequence of green bars is an opportunity to plan the usage of your most energy hungry devices. This time window can be increased or decreased by increasing or decreasing the threshold level compared to the average price. 

The usefulness of this is easy to explain with an example. If you have two days where the first day has low prices and the second day prices are well abowe the first day's average price, you can increase the first day's green zone. Then you can do your laundry or charge your EV car during this green zone rather than wait to the next day.

# elwiz-chart and Home Assistant

### Say good bye to HACS (at least for energy prices)

**elwiz-chart** is made with **Home Assistant** in mind

With **elwiz-chart** can you easily make automations.

**MQTT** messages are used to control the **elwiz** workflow.

## Chart Visualization with Timezone-Aware Data and Vertical Line Indicators

## Overview

This project focuses on presenting chart data over a 48-hour window, incorporating timezone awareness and dynamic vertical line indicators to enhance data visualization. The primary goal is to ensure that the chart accurately reflects server-time-based data, regardless of the client's local timezone, and to dynamically indicate the current time and the transition between days within the chart.

## Features

- **Timezone Awareness**: Adjusts data presentation to align with the server's timezone, ensuring consistent visualization across different client timezones.
  - **Dynamic Vertical Lines**: Includes two types of vertical lines:
  - **Current Time Indicator**: A red line indicating the current hour as per the server's timezone.
  - **Midnight Transition Indicator**: A blue line marking the transition from one day to the next, placed between the 23rd and 24th hour of the first day within the 48-hour window.

## Implementation Details

The **elwiz-chart** server sends 2 messages to **Home Assistant**.

**spotBelowThreshold** is used to control automations.
**thresholdLevel** is informational and shows at which level the transition between green and red zones occur.

The **thresholdLevel** is determined by the average spot price for the current day, which gives the default level.
On top of that, the **thresholdLevel** can be raised or lovered by a factor from the configuration file.
This is useful if the **green zone** is too narrow for the normal daily engergy consumption. In that case, it would be useful to widen the **green zone** by increasing the **thresholdLevel**. Likewise, if the green zone is too wide for the normal daily consumption, **thresholdLevel** can be lowered by a similar factor.
Widening and narrowing the **green zones** can also be done on a day to day basis by sending MQTT messages to the **elwiz-chart** server. A ready made dashboard is available for this purpose. This dashboard is a **YAML** file, which is easy to add to **Home Assistant**.

### Server-Side Timezone Offset Calculation

The server calculates its timezone offset from UTC, which is then sent to the client to adjust data presentation accordingly.

```javascript
function getServerTimezoneOffset() {
    const offset = -new Date().getTimezoneOffset() / 60;
    return offset;
}
```

