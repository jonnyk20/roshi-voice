import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import fs from 'fs';
import path from 'path';
import {sendMessageAndGetResponse} from './textToSpeechService';
import {AUDIO_DIR} from './constants';
import bodyParser from 'body-parser';

const APP_VERSION = process.env.VERSION || '0.0.04';
const NODE_VERSION = process.version;

const app = express();

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({extended: true})); // for parsing application/x-www-form-urlencoded

// POST endpoint '/send_message'
app.post('/send_message', async (req, res) => {
  console.log('REQ', req);
  const {message} = req.body;
  if (!message) {
    res.status(400).json({error: 'Message is required', response: null});
  }

  try {
    const response = await sendMessageAndGetResponse(message, req);
    res.json({error: null, response});
  } catch (error) {
    console.error(error);
    res.status(500).json({error: 'Internal server error', response: null});
  }
});

// Ensure the 'audio' directory exists for storing audio files

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR);
}

// Serve static files from the 'audio' directory
app.use('/audio', express.static(AUDIO_DIR));

app.get('/', async (req, res) => {
  res.json({
    appVersion: APP_VERSION,
    nodeVersion: NODE_VERSION,
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(
    `Hello from Cloud Run! The container started successfully and is listening for HTTP requests on ${PORT}`
  );
});
