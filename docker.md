# ElWiz and Docker

This is a step by step guide for installing and running
**ElWiz** in a **Docker** environment. 

This guide assumes that **Tibber Pulse** or similar device
is already set up for working with **ElWiz**. 

**ElWiz** is available from **dockerhub** for the following architectures:

**Linux/arm/v7**, **Linux/arm64/v8** and **Linux/amd64**

The **Mosquitto**, **ElWiz** and **HomeAssistant** deployment is tested in a **Docker** environment, running on a **Raspberry Pi 4** with **4GB RAM**.

An **MQTT broker** is mandatory for running **ElWiz**.
The **Mosquitto** broker is recommended, but any MQTT broker will do.
The broker can reside somewhere on the network, or it can run in a docker environment. 
**Mosquitto** is used as an example here.

Before installing **Mosquitto** and **ElWiz**, your **Docker** computer will need a little preparation.
Data, configuration and logs should be accessible from your OS.
Those who already use an MQTT broker can jump directly to
**3. ElWiz preparation**

## 1. Mosquitto preparation

**Mosquitto** needs a few directories and a configuration file to be made before starting.
Use your favorite editor to make the **mosquitto.conf** file.

**Preparation commands:**
```
mkdir -p ~/docker/mqtt
vi ~/docker/mqtt/mosquitto.conf
```
**Copy this content into the editor and save:**
```
# Config file for mosquitto
listener 1883
protocol mqtt
# Future websocket use
#listener 9001
#protocol websockets
persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log
allow_anonymous true
```

## 2. Getting Mosquitto from dockerhub

As soon as your mosquitto directories are prepared,
you can pull mosquitto from **dockerhub**. 

**Copy the following command, paste into your terminal and hit\<ENTER>:**
```
docker run -d \
 --name mosquitto \
 --privileged \
 --privileged \
 --restart=unless-stopped \
 -e TZ=Europe/Oslo \
 -v ~/docker/mqtt/mosquitto.conf:/mosquitto:/mosquitto/config/mosquitto.conf \
 -v ~/docker/mqtt/password.txt:/mosquitto/password.txt \
 -v ~/docker/mqtt:/mosquitto \
 --network=host \
 eclipse-mosquitto
```
This will pull **Mosquitto** from **dockerhub** if not already installe and run the program.

## 3. ElWiz preparation
**Preparation commands**
```
mkdir -p ~/docker/elwiz
curl -o ~/docker/elwiz/config.yaml https://raw.githubusercontent.com/iotux/ElWiz/master/config.yaml.sample
```
If your broker is running on your local computer, then the **config.yaml** file should work out of the box. If not, make a note of your broker's IP address.

If you you plan to run the MQTT broker in a Docker container, then you have to wait with this step until you have started the broker.

**Getting the mosquitto IP address from docker**
```
docker exec -it mosquitto ifconfig eth0
```

When you finally have found your broker's IP address, use your favorite editor to set the MQTT broker's IP address. The address or host name (FQDN) is found near the top of the config file.

```
vi ~/docker/elwiz/config.yaml
```
## 4. Getting ElWiz from dockerhub
You should now be ready to pull **ElWiz** from **dockerhub** and run the program.

**Copy the following command, paste into your terminal window and hit \<ENTER>:**

```
docker run -d \
 --name elwiz \
 --privileged \
 --restart=unless-stopped \
 -e TZ=Europe/Oslo \
 -v ~/docker/elwiz/config.yaml:/app/config.yaml \
 -v ~/docker/elwiz/data:/app/data \
 --network=host \
 tuxador/elwiz
```
## 5. Post installation and testing

**Some useful commands to test the installation**

To check the output from **mosquitto**. This will output the last hourly data.
```
docker exec -it mosquitto mosquitto_sub -v -t elwiz/# --retained-only
```
A list of node processes
```
docker exec -it elwiz pm2 list
```
A restart of **ElWiz** should be done after configuration changes.
```
docker exec -it elwiz pm2 restart elwiz
```

<!--
# Getting ElWiz from github
```
cd your/project/directory
git clone https://git.com/iotux/ElWiz.git
cd ElWiz
```
Install and run
```
docker-compose up -d
```
-->
