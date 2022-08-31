FROM node:16-buster-slim

ENV HOST localhost
ENV PORT 3000

# Create app directory
RUN mkdir -p /app
WORKDIR /app

RUN npm install mqtt && \
    npm install fs && \
    npm install yamljs && \
    npm install node-schedule && \
    npm install request && \
    npm install request-promise && \
    npm install simple-json-db \
    npm cache clean --force


# Bundle app source
COPY . /app

ENTRYPOINT ["node","elwiz.js"]

