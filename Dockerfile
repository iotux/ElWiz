FROM node:16-buster-slim

ENV HOST localhost
ENV PORT 3000

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

ENTRYPOINT ["node","elwiz.js"]

