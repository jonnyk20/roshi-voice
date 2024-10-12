import '@/config';
import express from 'express';
import fs from 'fs';

import {sendMessageAndGetResponse} from './textToSpeechService';
import {AUDIO_DIR} from './constants';
import bodyParser from 'body-parser';

const APP_VERSION = process.env.VERSION || '0.0.07';
const ENV = process.env.ENV || '??';
const NODE_VERSION = process.version;

const app = express();

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({extended: true})); // for parsing application/x-www-form-urlencoded

// POST endpoint '/send_message'
app.post('/send_message', async (req, res) => {
  console.log('REQ', req);
  const {text, instructions} = req.body;
  if (!text) {
    res.status(400).json({error: 'Text is required', response: null});
  }

  try {
    const response = await sendMessageAndGetResponse(
      JSON.stringify({text, instructions}),
      req
    );
    res.json(response);
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

const hasKey = !!process.env.OPENAI_API_KEY;
app.get('/', async (req, res) => {
  res.json({
    appVersion: APP_VERSION,
    nodeVersion: NODE_VERSION,
    hasKey,
    env: ENV,
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(
    `Hello from Cloud Run! The container started successfully and is listening for HTTP requests on ${PORT}`
  );
});
