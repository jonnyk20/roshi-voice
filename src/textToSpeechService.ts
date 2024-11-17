import {Request} from 'express';
import WebSocket, {RawData} from 'ws';
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import {AUDIO_DIR} from './constants';
import {firebaseStorage} from './firebase';

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

    let audioData = new Int16Array(0); // Use Int16Array for audio data
    let transcript = '';
    let processingCompleted = false; // Flag to prevent further processing

    let prompt =
      'You are a text-to-speech assistant used to generate audio for a lesson. Please read the given text in a natural tone.';

    let input: Object = {
      text: text,
    };

    if (!!instructions) {
      prompt = instructions;
      input = {
        text: text,
        instructions: instructions,
      };
    }

    ws.on('open', function open() {
      console.log('Connected to OpenAI Realtime API.');

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

      // Request the assistant's response with audio and text modalities
      ws.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            voice,
            modalities: ['audio', 'text'],
            instructions: prompt,
          },
        })
      );
    });

    // Handle incoming messages from the server
    ws.on('message', (data) => {
      if (processingCompleted) {
        return; // Ignore any further messages after processing is complete
      }
      try {
        const event = JSON.parse(data.toString());
        const {type: eventType} = event;
        console.log(`Received event: ${eventType}`);

        switch (eventType) {
          case 'response.audio.delta':
            {
              // Extract and decode the base64-encoded audio data
              const {delta} = event;
              const arrayBuffer = Buffer.from(delta, 'base64').buffer;
              const appendData = new Int16Array(arrayBuffer);

              // Merge the new audio data with existing data
              const mergedAudioData = new Int16Array(
                audioData.length + appendData.length
              );
              mergedAudioData.set(audioData);
              mergedAudioData.set(appendData, audioData.length);
              audioData = mergedAudioData;
            }
            break;

          case 'response.audio_transcript.delta':
            {
              const {delta: transcriptDelta} = event;
              transcript += transcriptDelta;
            }
            break;

          case 'response.audio_transcript.done':
            {
              const {transcript: finalTranscript} = event;
              transcript = finalTranscript; // Ensure the transcript is complete
            }
            break;

          case 'response.audio.done':
            console.log('Finished receiving audio response.');

            // Now, construct the WAV data
            const wavData = createWavData(audioData);

            // Save the audio and get the URL
            saveAudioToFirebaseStorage(wavData)
              .then((audioUrl) => {
                // Set the flag to prevent further processing
                processingCompleted = true;

                // Close the WebSocket connection
                ws.close();

                // Resolve the Promise with the response data
                resolve({
                  audioUrl,
                  transcript,
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

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
}
