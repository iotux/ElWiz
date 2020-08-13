
# ElWiz - program for å lese data fra Tibber Pulse

**Remark:** *This program is mainly written for a Norwegian or nordic country audience, and is therefore witten in the Norwegian language. However, the program comments are written in English for those who are not natives.*
## Intro
**Tibber Pulse** er en microcontroller (MCU) som leser data om strømforbruk fra en **AMS-måler**. Nedenfor er den angitt som **Pulse**. **ElWiz** bruker **Pulse** for å hente data fra **AMS-målere**.

Målgruppen for **ElWiz** er personer som er interessert i **smarte hjem** og **IoT**, og som vil gjøre arbeidet selv uten avhengighet av ekserne ressurser. Formålet er å hente data fra en **AMS-måler** for å bruke det i **Home Assistant**, **OpenHAB** eller et lignende system. Programmet tolker rå binærdata fra **Pulse** og oversetter det til **JSON**-format som er enkelt å utnytte videre. Programmet bruker ikke **SSL**, og det er dermed enkelt å bruke for dem som har en ekstra PC, **Raspberry** Pi eller sin egen server hjemme. Programmet er beregnet på å gå døgnkontinuerlig, og er derfor ikke egnet til å kjøre på f. eks. en bærbar eller annen maskin som man gjerne slår av etter bruk.

Brukere av **AMS-målere** blir avregnet per time. Programmet **fetchprices.js** henter **spotpriser** fra **Nordpool** kraftbørs og beregner brukerens strømkostnader time for time. For å få nytte av dette må konfigurasjonsfila **config.yaml** justeres i henhold til de takstene for strøm som brukeren betaler. **fetchprices.js** er beskrevet i detalj i **fetchprices.md** (https://github.com/iotux/ElWiz/blob/master/fetchprices.md).

**ElWiz** er skrevet i **node.js** (javascript) for Linux og består av en enkelt programfil for å gjøre det enkelt å installere og bruke, samt en fil med konfigurasjonsdata. De som vil bruke det på **Mac** eller **Windows**, må muligens gjøre noen mindre endringer i programmet. Dette gjelder eventuelt **signaler** som beskrives lenger ned.

**ElWiz** er testet med kun tilgang til **Kaifa MA304H3E AMS-måler**. Det er mulig at det også må gjøres noen mindre endringer hvis det skal brukes på en **AMS-måler** fra en anne produsent.

Nedenfor er det bekrevet hva du trenger for å installere **ElWiz** og sette opp **Pulse**. Du kan deretter sende data til **Home Assistant**, **OpenHAB**, eller lignende systemer. Det vil være opp til deg som bruker å tilpasse disse for å utnytte data fra programmet. 

#### Hva du trenger
 - en **Tibber Pulse**
 - tilgang til en **MQTT broker**
 - Noe kjennskap til **MQTT**
 - kunne redigere enkle opplysninger i en tekstfil
 
#### Kjekt å ha men ikke påkrevet
 - tilgang til **Home Assistant** eller annen tilsvarende plattform
 - kjennskap til programmering i **node.js** (javascript)
 - MQTT-kontrollert kaffekoker
 
## Installering
For de som ikke kjenner **git**, vil det enkleste være å laste ned **ZIP-arkivet** her: https://github.com/iotux/Pulse/archive/master.zip og pakke det ut i egen katalog (mappe). Brukere av **git** kan som vanlig bruke **git clone**. Programmer må ha skrivetilgang til katalogen.

Det er 3 avhengigheter som må løses. Det gjøres fra kommandolinja med kommandoen **npm** eller **yarn**.

Hvis du bruker **npm**:

```
npm install mqtt
npm install fs
npm install yamljs
```
Hvis du foretrekker **yarn**:
```
yarn add mqtt
yarn add fs
yarn add yamljs
```

## Tilpasning for egen lokal broker
Fila **config.yaml.sample** kopieres til **config.yaml**. I **config.yaml** vil det være nødvendig å angi IP-adressen og eventuelt brukernavn og passord til egen **MQTT-broker**. De viktigste parametrene i konfigurasjonsfila ser slik ut:


```yaml
---
# The IP address or hostname 
# of your favorite MQTT broker
broker: your.own.broker
brokerPort: 1883

# Enter credetials if needed
userName:
password:

# Listening topic
topic: tibber/#

# Topics for publishing
pubTopic: pulse/meter
pubStatus: pulse/status
pubNotice: pulse/notice

# ElWiz event messages
willMessage: ElWiz has left the building
greetMessage: ElWiz is performing

# Tibber Pulse event messages
onlineMessage: Pulse is talking
offlineMessage: Pulse is quiet

# Debug mode at startup
DEBUG: false

# Republish mode at startup
REPUBLISH: true
```

**IP-adressen** må endres så den stemmer med din lokale **MQTT broker**. Brokerens navn kan også brukes hvis det er gjenkjennbart.

Sett inn brukernavn og passord hvis din broker krever dette.

**topic** under **\# Listening topics** må samsvare med det som angis i **mqtt_topic** når du konfigurerer **Pulse**. Andre endringer skal normalt ikke være påkrevet.

Ved behov for å gjøre endringer i hvordan **ElWiz** vil det være nyttig å midlertidig gi **DEBUG** verdien **true**. Hvis behovet er å produsere helt nye **MQTT-meldinger**, så finnes funksjonene **onList1(), onList2()** og **onList3()** som er beregnet for dette. Ved å sette **REPUBLISH** til **false** vil programmets egne **MQTT-meldinger** undertrykkes helt. I avsnittet **Verdt å merke seg** lenger nede finnes det mer informasjon om dette.

## Oppsett av Pulse
I forhold til personvern er brukervilkårene for å bruke **Tibbers** mobil-app alt for vidtrekkende for mitt vedkommende. Jeg har derfor valgt å bruke **Pulse** uten app. Jeg mister riktignok tilgang til **Tibbers** tjenester, men til gjengjeld sparer jeg de 39 kronene per måned som det koster å være tilknyttet **Tibber**. Jeg oppnår allikevel det jeg er ute etter.

Første steg for å koble **Pulse** til eget nett, er å tvinge den inn i AP-modus. Ved å gjøre en hard reset, vil den komme opp i nettet som et aksesspunkt. En binders er det som skal til. På sida av **Pulse** er det et lite hull. Det er på motsatt side av der hvor micro-usbkontakten er. Det er som oftest mest hensiktsmessig å forsyne **Pulse** med strøm fra en mobillader eller lignende. Når strømmen er tilkoblet, bruker man en utbrettet binders i det lille hullet og trykker inn til **Pulse** begynner å blinke hurtig (etter ca 5 sekunder). De skal nå være mulig å finne den i nettet med SSID **Tibber Pulse**. Man må koble PC eller mobiltelefon til denne. Passordet står på baksiden av **Pulse** med **fet** skrift i en ramme. Når **Pulse** har akseptert tilkoblingen, kan man nå den i nettleseren på adresse **http://10.133.70.1**. **Pulses** nettside som kommer opp vil se slik ut:

![Pulse i AP-modus](https://github.com/iotux/ElWiz/blob/master/Pulse-AP.jpg)

Feltene **ssid** og **psk** fylles ut med navnet på egen WiFi-ruter og passord. 

Feltene **mqtt_url** og **mqtt_port** fylles ut med **IP-adressen** til din egen broker og portnummer **1883** for bruk uten **SSL**. 

I feltet **mqtt_topic** kan du legge inn et fritt valgt navn. Det bør være forskjellig fra topic som bruker i programmet for å sende meldinger. Ettersom **tibber** er forvalgt i programmet, kan det være greit å bruke her. 

Feltet **mqtt_topic_sub** er et **topic** som **Pulse** abonnerer på. For å markere at **MQTT-meldinger** går motsatt veg, så kan du f. eks. bruke **rebbit** her. Dermed er du sikret mot at det kommer i konflikt med andre **MQTT-meldinger**. Så langt har jeg funnet ut at ved å sende meldingen *"reboot"*, så vil **Pulse** svare med *"Debug: rebooting"* og starte på nytt. Hvis man f. eks. sender meldingen *"tull"*, så vil den svare med *"Debug: Unknown command 'tull'"*. Det er mer om dette i avsnittet **Styring av Pulse**.

Feltet **update_url** ser ut til å trenge en verdi. Jeg har brukt adressen til min egen broker her. Formålet er åpenbart for oppgradering av firmvaren i **Pulse**. Også her vil det være interessant å få informasjon hvis noen har.

De øvrige feltene kan stå tomme med mindre du ønsker å bruke **SSL**. Når feltene er fylt ut og sendt til **Pulse** går det noen sekunder, og det bebynner å blinke grønt. Det er et tegn på at **Pulse** har etablert seg i ditt eget nett. Når det skjer, er den ikke lenger i **AP-modus**, og tilgang til web-grensesnittet er ikke lenger mulig. Når dette er klart, skal det bare være å plugge **Pulse** inn i **HAN-kontakten** på **AMS-måleren**, og **Pulse** vil begynne å levere **MQTT-meldinger**.

## AMS-målerens data
Data fra **AMS-måleren** kommer i 3 forskjellige varianter. **List 1, List 2**, og **List 3** referer til **NVE** sin dokumentasjon for **AMS-målere** Kort beskrevet er det slik:

 - **List 1** inneholder det aktuelle strømforbruket målt i kW, samt tidspunkt. Denne typen mottas i intervaller på 2 eller 2,5 sekunder.

 - **List 2** inneholder i tillegg effekt, strøm og spenning som mottas i intervaller på 10 sekunder
 
 - **List 3** inneholder i tillegg til **List 2** akkumulerte data for hittil brukt strøm. Dette mottas hver hele time. 

Dette er beskrevet mer utførlig lenger nede, samt synliggjort i eksemplene nedenfor.

## Data fra Pulse
Fra **Pulse** kommer en oppstartsmelding, statusmeldinger og **AMS** målerdata. **Pulse** mangler derimot en **LastWill**-melding. En slik melding skal som regel sendes til brokeren ved oppstart av enheten. Hvis brokeren mister kontakten med enheten, vil den sende denne meldingen til abonnenter. For å kompensere for denne mangelen, er det en **"vaktbikkje"-funksjon** i **ElWiz**. Dette er en teller som teller ned med et intervall på 1 sekund. Når programmet mottar en melding fra **Pulse**, gjenoppfrisker programmet denne telleren. Hvis data fra **Pulse** uteblir, vil telleren fortsette å telle ned. Når den får verdien 0, vil programmet sende en **MQTT-melding** som varsel på at det mangler data fra **Pulse**. Telleren er i utgangspunktet satt til 15 sekunder, men denne verdien kan endres i programkoden.

```
// The watchdog timer
const watchValue = 15;
```
## MQTT-data fra ElWiz
I **ElWiz** er rådata fra **AMS-måleren** konvertert til lesbart **JSON**-format. Det er ikke gitt at formatet passer for alle. Det er derfor lagt inn 3 forskjellige funksjoner i programmet for å filtrere data for videre bruk. Det er en funksjon for hver av pakketypene fra **Pulse**. Disse funksjonene kalles umiddelbart etter konvertering av rådata fra **Pulse**. Noen av systemene som skal motta data fra **Pulse** har sin egen tidsstempling av data. Det kan derfor være aktuelt å fjerne dette før data publiseres. Funksjonene heter henholdsvis **onList1(), onList2()** og **onList3().** Andre konverteringer eller tilpasninger gjøres også her. I eksemplet fra pakketype 3 nedenfor, er det vist at målerens versjonsnummer, serienummer og typebetegnelse er filtrert bort. Nedenfor er eksempler på bruk av funksjonen.

```javascript
{
  "date": "2020-07-26T18:35:28",
  "weekDay": "Søndag",
  "powImpActive": 1.352          // Enhet: kW - Løpende strømforbruk
}
```
Eksemplet nedenfor viser et komplett sett av data fra **List 2**.
```javascript
{
  "date": "2020-07-26T18:35:30",
  "weekDay": "Søndag",
  "meterVersion": "KFM_001",      // Målerens versjonsnummer
  "meterId": "69706314037xxxxx",  // Målerens serienummer
  "meterType": "MA304H3E",        // Målerens typebetegnelse
  "powImpActive": 1.356,    // Enhet: kW
  "powExpActive": 0,        // Enhet: kW
  "powImpReactive": 0,      // Enhet: kVAr
  "powExpReactive": 0.13,   // Enhet: kWar
  "currentL1": 3.243,       // Enhet: A
  "currentL2": 3.692,       // Enhet: A
  "currentL3": 3.661,       // Enhet: A
  "voltageL1": 235.3,       // Enhet: V
  "voltageL2": 0,           // Enhet: V
  "voltageL3": 234.2        // Enhet: V
}
```
Eksemplet nedenfor er fra **List 3**. Programmet leverer komplette data, men i **onList3()** er **AMS-målerens** versjon, ID og type utelatt. I tillegg til data fra **Pulse**, er det også beregnet forbruk siste time. Resultatet av denne filtreringen er vist nedenfor.
```javascript
{ 
  "date": '2020-07-27T10:00:10',  // Pulses dato og tid
  "powImpActive": 1.63,           // Se ovenfor. Gjelder også neste verdier
  "powExpActive": 0,
  "powImpReactive": 0.185,
  "powExpReactive": 0,
  "currentL1": 5.016,
  "currentL2": 3.538,
  "currentL3": 4.145,
  "voltageL1": 235.3,
  "voltageL2": 0,
  "voltageL3": 234.9,
  "meterDate": '2020-07-27T10:00:10',   // AMS-målerens dato og tid
  "cumuHourPowImpActive": 42020.232,    // Enhet: kWh   - Akkumulert
  "cumuHourPowExpActive": 0,            // Enhet: kWh   - Akkumulert
  "cumuHourPowImpReactive2": 19900.058, // Enhet: kWArh - Akkumulert
  "cumuHourPowExpReactive": 653.829,    // Enhet: kWArh - Akkumulert
  "lastHourActivePower": '1.470'        // Enhet: kWh   - Forbruk siste time
}
  ```

Brukere av **fetchprices** vil i tillegg få tilgang til spotpriser, priser fra egen leverandør og ferdig utregnet kostnad time for time. 
```javascript
{
  "customerPrice": 1.3513, // Lokal valuta
  "lastHourCost": 1.9432,  // Local valuta
  "spotPrice": 0.6163,     // Local valuta
  "startTime": '2020-08-12T11:00:00',
  "endTime": '2020-08-12T12:00:00'
}
```
Se egen dokumentasjon i **fetchprices.md**

## Filtrering av data
I mitt tilfelle sender jeg data til **Thingsboard** i tillegg til min egen lokale **mosquitto** broker. **Thingsboard** genererer sin egen tidsstempling ved mottak.
### Filtrering eksempel 1
Her fjernes derfor tidsstempel fra **List 1** før publisering videre. 

```javascript
const thingsboard = mqtt.connect(thingsboardUrl, thingsboardOptions);
// ***********************************
// Functions for local processing
// called right after packet decoding
// Decoded JSON in "json", raw buffer in "buf"
function onList1(json) {
  // Thingsboard generates datestamp on receive,
  // so date and time is really not necessary
  delete (json.weekDay);
  delete (json.date);
  if (thingsPub)
    thingsboard.publish(thingsboardTopic, JSON.stringify(json));
  // Convenient for checking your own results
  if (pulse.debug) 
    console.log("onList1: ", json);
}
```
### Filtrering eksempel 2
Her er data fra **List 2** pakket inn i en ny JSON-pakke før sending til "minServer".
```javascript
function onList2(json) {
  let data = {
    dato: json.date,
    mittForbruk: json.powImpActive,
    minNettspenning: json.voltageL1,
    minStrom
  }
  // Gjør noe med omformaterte data
  minServer.publish("minTopic", JSON.stringify(data));
  if (pulse.debug) 
    console.log("onList2: ", data);
}
```
### Verdt å merke seg:
Komplette data publiseres **før** henholdsvis **onList1(), onList2()** og **onList3()** blir utført. Dermed vil både originale data og egne tilpasninger publiseres. For å **kun** sende egne tilpasninger, kan **REPUBLISH** settes til **false** i fila **config.yaml**. Ved å sette **DEBUG** til **true**, vil programmet dumpe JSON-pakkene til konsollet. Det kan være et godt hjelpemiddel hvis du skal filtrere eller omskrive **MQTT-meldingene**. Hvis du bruker **Linux**, kan du la denne stå til **false** og allikevel få dumpet pakkene til **Linux shell** ved å sende et **signal** fra kommandolinja. Mer om det i neste avsnitt.

## Signaler til programmet
Er du en lykkelig eier av Linux, kan du bruke signaler for å styre funksjoner i **ElWiz**. I programmer som behandler data er det obligatorisk å fange opp f. eks. **\<Ctrl C\>** eller **kill**. Formålet er å lagre data før programmet drepes. Når programmet startes, får det tildelt en prosess-ID, PID. Denne skrives ut til konsollet når programmet starter og brukes for å sende signaler til programmet. Det kan også brukes for å aktivisere endringer i **config.yaml** uten å starte programmet på nytt. Når programmet startes, skrives denne meldingen til konsollet:
```
ElWis is performing, PID: 32512
```
I programmet brukes signal blant annet for å skru debugging av og på. Det gjøres ved hjelp av signalet **SIGUSR1**. Fra kommandolinja ser det slik ut:
```
kill -USR1 12345
```
Dette slår debuggging på hvis den er avslått, og av hvis den er påslått. Eksempel på utskrift når debugging er aktiv:
```javascript
onList1: { "powImpActive": 4.438 }
onList1: { "powImpActive": 4.43 }
onList2: { "date": '2020-07-31T17:35:20',
  "powImpActive": 4.429,
  "powExpActive": 0,
  "powImpReactive": 3.98,
  "powExpReactive": 0,
  "currentL1": 14.31,
  "currentL2": 16.03,
  "currentL3": 14.131,
  "voltageL1": 232.5,
  "voltageL2": 0,
  "voltageL3": 233.7 }
onList1: { "powImpActive": 4.445 }
onList1: { "powImpActive": 4.435 }
```

Tilgjengelige signaler:

 - **SIGHUP** - Leser inn fila **config.yaml**
 - **SIGUSR1** - Slår debugging av eller på
 - **SIGTERM** - Lagrer fila **power.json** før programmet stoppes
 - **SIGINT** - Lagrer fila **power.json** før programmet stoppes 

Legg merke til at **SIG** fjernes fra kommandoen for å sende signaler. For **SIGTERM** ser det slik ut:
```
kill -TERM 23456
``` 
 **\<Ctrl C\>** sender **SIGINT** til programmet
 
## Styring av Pulse
**Pulse** har noen funksjoner som kan styres ved hjelp av **MQTT-meldinger**. Det gjøres ved å sende meldingene med **topic** som er angitt i feltet **mqtt_topic_sub** i weg-grensesnittet. Dette er ikke dokumentert, men ved å prøve forskjellige alternativer, har jeg funnet disse funksjonene.

 - reboot - Starter **Pulse** på nytt
 - update - OTA-oppdatering av styreprogram (informasjon om "update_url" mangler)

De som bruker **mosquitto** broker, har tilgang til **mosquitto_pub** for å publisere medinger. Ved å bruke det **mqtt_topic_sub** som ble oppgitt i oppsett av **Pulse**, f. eks. **rebbit**, så vil en kommano til **Pulse** se slik ut når man sender meldinga **reboot**:
```
mosquitto_pub -h localhost -t rebbit -m reboot
Debug: Rebooting
```
Ved å sende kommandoen **update**, så vi man få dette svaret:
```
mosquitto_pub -h localhost -t rebbit -m "update"
Debug: Update in progress
Debug: Firmware update failed: -1
```

## Kontinuerlig drift
Et hendig verktøy å bruke for programmer som skal være igang døgnet rundt, er **PM2** https://pm2.keymetrics.io/
Med **PM2** har du kontroll på stop, start, restart, automatisk start etter oppstart av PC/server, minneforbruk, logging og mye mer. Det er vel verdt bryet å ta en titt på.

## Referanser
Under kartleggingen av data fra **Tibber Pulse**, har har jeg hatt god hjelp av informasjon fra @daniel.h.iversen and @roarfred og andre innlegg i dette diskusjonsforumet https://www.hjemmeautomasjon.no/forums/topic/4255-tibber-pulse-mqtt/.

Nedenfor er linker med uvurderlig informasjon for de som er interessert i dekodingen.
 - [Informasjon fra NVE om HAN-grensesnittet](https://github.com/roarfred/AmsToMqttBridge/blob/master/Documentation/NVE_Info_kunder_HANgrensesnitt.pdf)
 - [Dekoding i Python (av @Danielhiversen)](https://github.com/Danielhiversen/pyHanSolo/blob/master/han_solo/__init__.py)
 - [Dekoding i C (av @roarfred)](https://github.com/roarfred/AmsToMqttBridge/blob/master/Code/Arduino/KaifaTest/KaifaTest.ino)
 - [Eksempel på dekoding av data (av @roarfred)](https://github.com/roarfred/AmsToMqttBridge/blob/master/Samples/Kaifa/obisdata.md)
