FROM node:18-bullseye-slim

RUN apt-get update && apt-get install tzdata -y
# For development
#RUN apt install vim -y && \
#    apt install less -y

ENV TZ="Europe/Oslo"
ENV HOST="localhost"
ENV PORT=3000

RUN npm install pm2 -g

# Create app directory
RUN mkdir -p /app
WORKDIR /app

RUN npm install fs && \
  npm install axios && \
  npm install express && \
  npm install date-fns && \
  npm install xml-js && \
  npm install mqtt && \
  npm install node-schedule && \
  npm install js-yaml && \
  npm cache clean --force

# Bundle app source
COPY . /app

ENTRYPOINT ["pm2", "--no-daemon", "start"]
CMD ["pm2run.json"]

