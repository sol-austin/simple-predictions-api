require('monitor').start()

const env = require('dotenv').config().parsed || process.env

const Sentry = require('@sentry/node')
const environment = process.env.NODE_ENV || 'development'
const Tracing = require('@sentry/tracing')
const express = require('express')()
const { stMonitor } = require('sematext-agent-express')

stMonitor.start()

Sentry.init({
  dsn: 'https://4fc238857c344c5f90ecc4b3ebcce7d6@o342120.ingest.sentry.io/5264910',
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Tracing.Integrations.Mongo(),
    new Tracing.Integrations.Express({ express })
  ],
  tracesSampleRate: 1.0,
  environment: environment
})

const PORT = process.env.PORT || 5001

// Use imported app
express.use(Sentry.Handlers.tracingHandler())

require('./loaders').expressApp({ expressApp: express })

express.listen(PORT, () => console.log(`Listening on ${PORT}`))

// MongoDB connection URIs
// const uri = 'mongodb://127.0.0.1:27017/simple-predictions-api'
// const uri = 'mongodb+srv://compass:solaustin@simple-predictions-api-gpv4x.gcp.mongodb.net/simple-predictions-api?retryWrites=true&w=majority'

// LogDNA Bunyan connection
const bunyan = require('bunyan')
const LogDNAStream = require('logdna-bunyan').BunyanStream

const logDNA = new LogDNAStream({
  key: env.LOG_DNA_KEY
})

const logger = bunyan.createLogger({
  name: 'simple-predictions-api-nodejs',
  streams: [
    { stream: process.stdout },
    {
      stream: logDNA,
      type: 'raw'
    }
  ]
})

logger.info('Hello world!')
