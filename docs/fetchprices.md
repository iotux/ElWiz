# Fetching energy prices

The **fetchprices.js** program retrieves prices from the Nord Pool power exchange and the Entso-E European power market. Provided the power tariffs and VAT are correctly set, the program calculates 
the user's gross price per kWh, as well as the spot price including VAT as shown below.

```javascript
"hourly": [
  {
    "startTime": "2024-07-22T11:00:00",
    "endTime": "2024-07-22T12:00:00",
    "spotPrice": 0.3559,
    "gridFixedPrice": 0.1925,
    "supplierFixedPrice": 0.0542
  }
]
```
In addition, a daily summary is provided.
```javascript
  "daily": {
    "minPrice": 0.2904,
    "maxPrice": 0.3717,
    "avgPrice": 0.3438,
    "peakPrice": 0.359,
    "offPeakPrice1": 0.3141,
    "offPeakPrice2": 0.3576
  }
```
### Running the Program

The program fetches new prices daily from the Nord Pool power exchange. 
There are several parameters that can be adjusted to customize the program's behavior.
Below is the part of the configuration file relevant to **getprices.js**.
Make sure to include a space after the colon \( **:** \) if parameters are changed.

The default scheduling method is the **node-schedule** module.
This is enabled by setting the **runNodeSchedule** parameter to **true**.
The program will then run continuously. 
Control of the program is managed through the **scheduleHours** and **scheduleMinutes** parameters.

The default paramers are:
```
runNodeSchedule: true

scheduleHours: [13,14]
scheduleMinutes: [6,11,16,21]
scheduleEuMinutes: [5]
```
Users who prefer to use **node-schedule** can ensure the program runs continuously
by using **PM2** (https://pm2.keymetrics.io/) or a similar program.

When the program starts, it will create the **./data** directory and fetch the first set
of prices, then calculate the prices.

The **keepDays** parameter determines how many days of price data are kept. 
This is set to **7 days**, but can be changed to fewer or more days.

Those who prefer to use **cron** to run the program, can do so by setting the **runNodeSchedule** parameter to **false**.
In the example, the program is run half an hour past the hours **15, 17, 19, 21, 23**. 
This increases the chances of fetching data even if data 
from the Nordic power exchange is unavailable at a given time. 
The program's path must be set to the directory where **ElWiz** is installed.

```
30 15,17,19,21,23 * * * cd /your/program/path/ && ./fetchprices.js
```

### Local Currency and Region

The local currency can be **EUR, DKK, NOK or SEK**. This is set in the **priceCurrency** parameter.
```
priceCurrency: NOK
```
It is also important to specify the correct region. This information is available from the network owner. 
For **Sweden, Finland, and Denmark**, the options are:
```
# [SE1, SE2, SE3, SE4, FI, DK1, DK2]
# [  1,   2,   3,   4,  5,   6,   7]
```
For Norway, the options are:
```
[Oslo, Kr.sand, Bergen, Molde, Tr.heim, Tromsø]
[   8,       9,     10,    11,      12,     13]
```
It's important to use the number that corresponds to the region.
For Oslo, it's **8**.
```
priceRegion: 8
```

### Price Calculation
To get correct price calculations, it is important to enter the prices listed in the local power company's invoice. 
The invoice prices consist of a fixed price and a price per kWh for both the network owner and the power company.
For the following parameters, you can choose to enter prices with or without **VAT**. 
If you enter net prices, the VAT rate must be entered in the **supplierVatPercent** parameter.
In the example below, the power company delivers electricity at the spot price + a surcharge of **9 NOK** per month.
Here, **VAT** of **25%** is already included. **supplierVatPercent** is therefore set to **0.0**. 
The surcharge of **9 NOK** is distributed over the number of hours in a month. 
The spot price from the Nordic power exchange is added **VAT** and included in the result.

```
supplierKwhPrice: 0.0
supplierMonthPrice: 9.0
supplierVatPercent: 0.0

spotVatPercent: 25.0
```
The network owner's price in the example below is **0.4454** per kWh. 
Additionally, the network owner charges a fixed price per day of **6.66 NOK**, which is then distributed over the number of hours in a day. 
Here, prices are also already inclusive of VAT, so ***gridVatPercent*** is set to **0.0**
```
gridKwhPrice: 0.4454
gridDayPrice: 6.66
gridVatPercent: 0.0
```

```yaml
#############################################
# The rest of the configuration is only valid 
# for the "fetchprices" program

# Days to keep data files
keepDays: 7

# Windows users without cron may want to use 
# the "node-schedule" module.
# Set the following to "true" if that is the case.
# Cron users should set it to "false".
runNodeSchedule: false

# The following recommended scheduling
# will try to fetch prices 10 minutes past 
# the scheduleHours. The same scheduling is
# recommended for cron users
scheduleHours: [15,17,19,21,23]
scheduleMinutes: [30]

# Your local supplier's price information
# Setting computePrices false for
# only returning naked spot prices (no VAT)
computePrices: false

# Use the same currency as your local supplier
# The following currencies are available:
# [EUR, SEK, NOK, DKR]
priceCurrency: NOK

# The following regions are available.
#
# Sweden, Finland, Denmark
# [SE1, SE2, SE3, SE4, FI, DK1, DK2]
# [  1,   2,   3,   4,  5,   6,   7]
#
# Norway
# [Oslo, Kr.sand, Bergen, Molde, Tr.heim, Tromsø]
# [   8,       9,     10,    11,      12,     13]
#
# Find your region and insert here.
# Ask your local supplier if in doubt.
priceRegion: 8

# Spot prices from Nordpool are without VAT
# and VAT needs to be added
spotVatPercent: 25.0

# Change the following values according
# to your electric power supplier's invoice
# Different price models may require changes to the program 
# You will most likely find your prices on your supplier's invoices

supplierKwhPrice: 0.0
supplierMonthPrice: 0.0
supplierVatPercent: 0.0

# Network cost
gridKwhPrice: 0.0
gridDayPrice: 0.0
gridVatPercent: 0.0
```
