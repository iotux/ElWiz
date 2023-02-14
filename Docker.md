**ElWiz and Docker**

An MQTT broker is mandatory to run ElWiz.
The Mosquitto broker is recommended, but any MQTT broker will do. This broker can reside somewhere on the network, or can run in a docker environment. Here mosquitto is used as an example.

**Prerequesites for running in docker**

Before installing mosquitto and ElWiz, your docker computer will need a little preparation.
Data, configuration and logs should be accessible from your OS.

**Mosquitto preparation**
For Mosquitto, a few directories and a configuration file need to be made before intalling. 
Use your favorite editor to make the *mosquitto.conf* file:

```
mkdir -p ~/docker/mqtt
vi ~/docker/mqtt/mosquitto.conf
```
Copy this content into the editor and save:
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
**ElWiz preparation**
```
mkdir -p ~/docker/elwiz
curl -o ~/docker/elwiz/config.yaml https://raw.githubusercontent.com/iotux/ElWiz/master/config.yaml.sample
```
If your broker is running on your local computer, then the *config.yaml* should work out of the box.
If not, again use your favorite editor to set the MQTT broker's IP address
```
vi ~/docker/elwiz/config.yaml
```
If you you plan to run the MQTT broker in a Docker container, then you have to wait with this step until you have started the broker.

**Getting Mosquitto from dockerhub**
As soon as your mosquitto directories are prepared, you can pull mosquitto from dockerhub.
```
docker run -d \
 --name mosquitto \
 --privileged \
 --privileged \
 --restart=unless-stopped \
 -e TZ=Europe/Oslo \
 -v ~/docker/mqtt/mosquitto.conf:/mosquitto:/mosquitto/config/mosquitto.conf \
 -v ~/docker/mqtt:/mosquitto \
 --network=host \
 eclipse-mosquitto
```
**Getting the mosquitto IP address**
```
docker exec -it mosquitto ifconfig
```
Invoke your favorite editor to set IP address of broker
```
vi ~/docker/elwiz/configf.yaml
```
**Getting ElWiz from dockerhub**
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
**Getting ElWiz from github**
```
cd <your-project-directory>
git clone https://git.com/iotux/ElWiz.git
cd ElWiz
```
Install and run
```
docker-compose up -d
```
