# fetchprices.js

Programmet **fetchprices.js** henter priser fra den nordiske kraftbørsen og beregner 
brukerens bruttopris og kostnad per kWh, samt spotprisen inklusive MVA som vist under.

```javascript
{
  "customerPrice": 1.3513, // Lokal valuta
  "lastHourCost": 1.9432,  // Lokal valuta
  "spotPrice": 0.6163,     // Lokal valuta
  "startTime": '2020-08-12T11:00:00',
  "endTime": '2020-08-12T12:00:00'
}
```
### Kjøring av programmet

Programmet henter nye priser daglig fra den nordiske kraftbørsen. 
Det finnes en rekke parametre som kan justeres for tilpasse måten programmet oppfører seg på.
Nedenfor er gjengitt den delen av konfigurasjonsfila gjelder for **getprices.js**.
Pass på å ha et mellomrom etter kolon \( **:** \) hvis parametre endres.

For brukere av Linux er det greieste å bruke **cron** for å kjøre programmet.
I eksemplet blir programmet kjørt en halvtime over timene **15, 17, 19, 21, 23**. 
Dermed er det en rimelig sjanse til å få hentet data selv om data 
fra den nordiske kraftbørsen skulle være utilgjengelig på et tidspunkt. 
Programmets sti må settes til den mappa hvor **ElWiz** er installert

```
30 15,17,19,21,23 * * * cd /your/program/path/ && ./fetchprices.js
```
Windows-brukere og andre som ikke har tilgang til **cron**, kan benytte seg av **node-schedule**.
Dette blir tlgjengelig ved å sette parametret **runNodeSchedule** til **true**.
Programmet vil da kjøre kontinuerlig. 
Styring av programmet ligger i parametrene **scheduleHours** og **scheduleMinutes**.

```
runNodeSchedule: true

scheduleHours: [15,17,19,21,23]
scheduleMinutes: [30]
```
Brukere som foretrekker å bruke **node-schedule** kan sikre at programmet kjører kontinuerlig
ved å bruke **PM2** (https://pm2.keymetrics.io/) eller lignende program.

Når programmet starter, vil det opprette mappa/katalogen **./data** og hente den første samlinga
med priser, samt regne ut priser.

Parametret **keepDays** bestemmer hvor mange dager med prisdata som skal beholdes. 
Denne er satt til **7 dager**, men dette kan endres til færre eller flere dager.

### Lokal valuta og region

Som lokal valuta kan brukes **EUR, DKK, NOK eller SEK**. Dette settes i parameterer **priceCurrency**.
```
priceCurrency: NOK
```
Det er også viktig å angi rett region. Dette får man vite hos netteieren. 
For **Sverige, Finnland og Danmark** har man følgende muligheter:
```
# [SE1, SE2, SE3, SE4, FI, DK1, DK2]
# [  1,   2,   3,   4,  5,   6,   7]
```
For Norge har man disse alternativene:
```
[Oslo, Kr.sand, Bergen, Molde, Tr.heim, Tromsø]
[   8,       9,     10,    11,      12,     13]
```
Her er det viktig her å bruke det nummeret som samsvarer med region,
For Oslos vedkommende er det **8**.
```
priceRegion: 8
```

### Prisberegning
For å få korrekt beregning av priser er det viktig å legge inn prisene som oppgis i det lokale kraftselskapets faktura. 
Prisene på fakturaen består av en fastpris og en pris per kWh for både netteier og kraftselskapet.
For de følgende parametrene kan man velge å sette prisende med eller uten **MVA**. 
Velger man å sette inn nettopriser, så må MVA-satsen settes inn i parameteret **supplierVatPercent**.
I eksemplet nedenfor leverer kraftselskapet strøm til spotpris + et påslag av **kr 9** per måned.
Her er det allerede innregnet **MVA** med **25%**. **supplierVatPercent** er derfor satt til **0.0**. 
Påslaget på **kr 9** blir fordelt på antall timer i en måned. 
Spotprisen fra den nordiske kraftbørsen blir tillagt **MVA** og lagt til i resultatet.

```
supplierKwhPrice: 0.0
supplierMonthPrice: 9.0
supplierVatPercent: 0.0

spotVatPercent: 25.0
```
Prisen fra netteieren er i eksemplet nedenfor på **0.4454** per kWh. 
Videre beregner netteieren en fastpris per dag på kr **6.66**, som igjen blir fordelt på antall timer i et døgn. 
Her er også prisene allerede tillagt MVA, og følgelig er ***gridVatPercent*** satt til **0.0**
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
# Cron users should set  it to "false".
runNodeSchedule: false

# The following recommendedecommended scheduleing
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

# Change the following values according
# to your electric power supplier's invoice
# Different price models may require changes to program 
# You will mos likely find you prices from your supplier's invoices

supplierKwhPrice: 0.0
supplierMonthPrice: 0.0
supplierVatPercent: 0.0

# Spot prices from Nordpool are without VAT
# and VAT needs to be added
spotVatPercent: 25.0

# Network cost
gridKwhPrice: 0.0
gridDayPrice: 0.0
gridVatPercent: 0.0
```
