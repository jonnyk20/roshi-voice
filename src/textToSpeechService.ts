import {Request} from 'express';
import WebSocket, {RawData} from 'ws';
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import {AUDIO_DIR} from './constants';
import {firebaseStorage} from './firebase';

function recursivelySetKey<T>(obj: T, key: string, value: any): T {
  const newObj: T = {...obj};
  for (const k in newObj) {
    if (k === key) {
      newObj[k] = value;
    } else if (typeof newObj[k] === 'object') {
      newObj[k] = recursivelySetKey(newObj[k], key, value);
    }
  }
  return newObj;
}
function createWavData(audioData: Int16Array): Buffer {
  // Define WAV file parameters
  const numChannels = 1; // Mono
  const sampleRate = 24000; // 24,000 Hz
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  // Calculate subchunk2Size and chunkSize based on audioData length
  const subchunk2Size = audioData.length * (bitsPerSample / 8);
  const chunkSize = 36 + subchunk2Size; // Total chunk size

  // Create a buffer for the WAV file header
  const header = Buffer.alloc(44);

  // Write the WAV file header
  header.write('RIFF', 0); // ChunkID
  header.writeUInt32LE(chunkSize, 4); // ChunkSize
  header.write('WAVE', 8); // Format
  header.write('fmt ', 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  header.write('data', 36); // Subchunk2ID
  header.writeUInt32LE(subchunk2Size, 40); // Subchunk2Size

  // Create a Buffer from the audioData Int16Array
  const audioBuffer = Buffer.from(audioData.buffer);

  // Combine header and audio data
  const wavData = Buffer.concat([header, audioBuffer]);

  return wavData;
}

// Function to save audio data to Firebase Storage and return the signed URL
async function saveAudioToFirebaseStorage(wavData: Buffer): Promise<string> {
  // Generate a unique filename for the audio file
  const audioFileName = `directed-voice/response_${Date.now()}.wav`;

  // Get a reference to the Firebase Storage bucket
  const bucket = firebaseStorage.bucket();

  // Create a file object in Firebase Storage
  const file = bucket.file(audioFileName);

  // Upload the audio buffer to Firebase Storage
  await file.save(wavData, {
    metadata: {
      contentType: 'audio/wav',
    },
  });

  await file.makePublic();
  const publicUrl = file.publicUrl();

  // Return the public URL
  return publicUrl;
}

// Function to save audio data and return the audio URL
function saveAudio(audioBuffer: RawData, req: Request) {
  // Generate a unique filename for the audio file
  const audioFileName = `response_${Date.now()}.wav`;
  const audioFilePath = path.join(AUDIO_DIR, audioFileName);

  // Define WAV file parameters
  const numChannels = 1; // Mono
  const sampleRate = 24000; // 24,000 Hz
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const subchunk2Size = (audioBuffer as any).length; // Data size in bytes
  const chunkSize = 36 + subchunk2Size; // Total chunk size

  // Create a buffer for the WAV file header
  const header = Buffer.alloc(44);

  // Write the WAV file header
  header.write('RIFF', 0); // ChunkID
  header.writeUInt32LE(chunkSize, 4); // ChunkSize
  header.write('WAVE', 8); // Format
  header.write('fmt ', 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  header.write('data', 36); // Subchunk2ID
  header.writeUInt32LE(subchunk2Size, 40); // Subchunk2Size

  // Combine header and audio data
  const wavData = Buffer.concat([header, audioBuffer as any]);

  // Save the WAV file
  fs.writeFileSync(audioFilePath, wavData);

  // Construct the full audio URL
  const audioUrl = `${req.protocol}://${req.get(
    'host'
  )}/audio/${audioFileName}`;

  // Return the audio URL
  return audioUrl;
}

// Function to send message to OpenAI Realtime API and get the response
export async function sendMessageAndGetResponse(
  req: Request,
  text: string,
  voice: string,
  instructions: string = ''
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url =
      'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';

    // Create a new WebSocket connection
    const ws = new WebSocket(url, {
      headers: {
        Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
        'OpenAI-Beta': 'realtime=v1',
      },
    });
    // Define the messages to send: first "Hello World", then the desired phrase
    const messages = [
      {
        text: 'Hello World',
        voice,
        instructions:
          'You are a text-to-speech assistant used to generate audio for a lesson. Please read the given text in a natural tone.',
      },
      {
        text: text, // The desired phrase
        instructions:
          instructions ||
          'You are a text-to-speech assistant used to generate audio for a lesson. Please read the given text in a natural tone.',
      },
    ];

    let currentMessageIndex = 0;
    let currentAudioData = new Int16Array(0); // Audio data for the current message
    let currentTranscript = ''; // Transcript for the current message
    let processingCompleted = false; // Flag to prevent further processing

    function sendNextMessage(voice: string = '') {
      if (currentMessageIndex < messages.length) {
        const message = messages[currentMessageIndex];

        // Initialize data for this message
        currentAudioData = new Int16Array(0);
        currentTranscript = '';
        processingCompleted = false;

        // Prepare the input
        const input = {
          text: message.text,
          instructions: message.instructions || '',
        };

        // Send the user's message to the assistant
        ws.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify(input),
                },
              ],
            },
          })
        );

        let response: Object = {
          modalities: ['audio', 'text'],
          instructions: message.instructions,
        };

        // Request the assistant's response with audio and text modalities
        ws.send(
          JSON.stringify({
            type: 'response.create',
            response,
          })
        );
      } else {
        // All messages sent, close the connection
        ws.close();
      }
    }

    ws.on('open', function open() {
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            voice: voice,
          },
        })
      );

      // Send the first message
      sendNextMessage();
    });

    // Handle incoming messages from the server
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        const {type: eventType} = event;

        switch (eventType) {
          case 'response.audio.delta':
            {
              // Extract and decode the base64-encoded audio data
              const {delta} = event;
              const arrayBuffer = Buffer.from(delta, 'base64').buffer;
              const appendData = new Int16Array(arrayBuffer);

              // Merge the new audio data with existing data
              const mergedAudioData = new Int16Array(
                currentAudioData.length + appendData.length
              );
              mergedAudioData.set(currentAudioData);
              mergedAudioData.set(appendData, currentAudioData.length);
              currentAudioData = mergedAudioData;
            }
            break;

          case 'response.audio_transcript.delta':
            {
              const {delta: transcriptDelta} = event;
              currentTranscript += transcriptDelta;
            }
            break;

          case 'response.audio_transcript.done':
            {
              const {transcript: finalTranscript} = event;
              currentTranscript = finalTranscript; // Ensure the transcript is complete
            }
            break;

          case 'response.audio.done':
            // Do not set processingCompleted here
            break;

          case 'response.done':
            // Check if the response is incomplete due to content filter
            if (
              event.response &&
              event.response.status === 'incomplete' &&
              event.response.status_details?.reason === 'content_filter'
            ) {
              console.error(
                'Content filter triggered. Response is incomplete.'
              );
              processingCompleted = true;
              ws.close();
              reject(
                new Error(
                  'Content filter triggered. Response was incomplete due to disallowed content.'
                )
              );
              return;
            }

            // Now, construct the WAV data
            const wavData = createWavData(currentAudioData);

            if (currentMessageIndex === 1) {
              // This is the second message, save the audio
              saveAudioToFirebaseStorage(wavData)
                .then((audioUrl) => {
                  // Set the flag to prevent further processing
                  processingCompleted = true;

                  // Close the WebSocket connection
                  ws.close();

                  // Resolve the Promise with the response data
                  resolve({
                    audioUrl,
                    transcript: currentTranscript,
                    error: '',
                  });
                })
                .catch((error) => {
                  console.error('Error saving audio:', error);

                  // Set the flag to prevent further processing
                  processingCompleted = true;

                  // Close the WebSocket connection
                  ws.close();

                  reject(error);
                });
            } else {
              // Discard the audio and send the next message
              currentMessageIndex++;
              sendNextMessage();
            }

            break;

          case 'error':
            console.error('Error from assistant:', event.error);

            // Set the flag to prevent further processing
            processingCompleted = true;

            ws.close();
            reject(new Error('Error from assistant: ' + event.error?.message));
            break;

          default:
            break;
        }
      } catch (e) {
        console.error('Error handling message:', e);

        // Set the flag to prevent further processing
        processingCompleted = true;

        ws.close();
        reject(e);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);

      // Set the flag to prevent further processing
      processingCompleted = true;

      ws.close();
      reject(err);
    });

    ws.on('close', () => {});
  });
}
