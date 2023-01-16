FROM node:buster

RUN apt update && apt install tzdata -y
# For development
#RUN apt install vim -y && \
#    apt install less -y

ENV TZ="Europe/Oslo"
ENV HOST localhost
ENV PORT 3000

RUN npm install pm2 -g

# Create app directory
RUN mkdir -p /app
WORKDIR /app

RUN npm install fs && \
    npm install axios && \
    npm install date-fns && \
    npm install xml-js && \
    npm install mqtt && \
    npm install node-schedule && \
    npm install simple-json-db && \
    npm install yamljs && \
    npm cache clean --force

# Bundle app source
COPY . /app

#ENTRYPOINT ["pm2-runtime", "start"]
ENTRYPOINT ["pm2", "--no-daemon", "start"]
# Use one, comment out the other
CMD ["pm2run.json"]
#CMD ["pm2run-nordpool.json"]
#CMD ["pm2run-entsoe.json"]

