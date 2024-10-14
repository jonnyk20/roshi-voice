import {Request} from 'express';
import WebSocket, {RawData} from 'ws';
import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import {AUDIO_DIR} from './constants';
import {firebaseStorage} from './firebase';

// Function to save audio data to Firebase Storage and return the signed URL
async function saveAudioToFirebaseStorage(
  audioBuffer: Buffer
): Promise<string> {
  // Generate a unique filename for the audio file
  const audioFileName = `AAA/response_${Date.now()}.wav`;

  // Get a reference to the Firebase Storage bucket
  const bucket = firebaseStorage.bucket();

  // Create a file object in Firebase Storage
  const file = bucket.file(audioFileName);

  // Define WAV file parameters
  const numChannels = 1; // Mono
  const sampleRate = 24000; // 24,000 Hz
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const subchunk2Size = audioBuffer.length; // Data size in bytes
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
  const wavData = Buffer.concat([header, audioBuffer]);

  // Upload the audio buffer to Firebase Storage
  await file.save(wavData, {
    metadata: {
      contentType: 'audio/wav',
    },
  });

  await file.makePublic();
  const publicUrl = file.publicUrl();

  // Return the signed URL
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
  message: string,
  req: Request
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

    let audioData: Uint8Array[] = [];
    let transcript = '';

    ws.on('open', function open() {
      console.log('Connected to OpenAI Realtime API.');

      // Send the user's message to the assistant with corrected content type
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text', // Corrected content type
                text: message,
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
            modalities: ['audio', 'text'],
            instructions:
              'Please speak using the given instructions. You will receive a json with text, and speaking instructions. Repeat the text, making adjustments based on the instructions if needed (Treat it as SSML).',
          },
        })
      );
    });

    // Handle incoming messages from the server
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data as any);
        const {type: eventType} = event;
        console.log(`Received event: ${eventType}`);
        // Uncomment the following line to log the entire event if needed
        // console.log(JSON.stringify(event, null, 2));

        switch (eventType) {
          case 'response.audio.delta':
            // Extract and decode the base64-encoded audio data
            const {delta} = event;
            const audioBuffer = Buffer.from(delta, 'base64');
            // Append the audio data to the array
            audioData.push(audioBuffer);
            break;

          case 'response.audio_transcript.delta':
            // Append the assistant's transcript response
            const {delta: transcriptDelta} = event;
            transcript += transcriptDelta;
            break;

          case 'response.audio_transcript.done':
            // Optionally handle the final transcript
            const {transcript: finalTranscript} = event;
            transcript = finalTranscript; // Ensure the transcript is complete
            break;

          case 'response.audio.done':
            console.log('Finished receiving audio response.');

            // Combine all audio buffers into one
            const fullAudioBuffer = Buffer.concat(audioData);

            // Save the audio and get the URL
            // const audioUrl = saveAudio(fullAudioBuffer, req);
            return saveAudioToFirebaseStorage(fullAudioBuffer)
              .then((audioUrl) => {
                // Close the WebSocket connection here
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

                // Close the WebSocket connection on error
                ws.close();

                reject(error);
              });

          case 'error':
            console.error('Error from assistant:', event.error);
            ws.close();
            reject(new Error('Error from assistant: ' + event.error?.message));
            break;

          default:
            break;
        }
      } catch (e) {
        console.error('Error handling message:', e);
        ws.close();
        reject(e);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      reject(err);
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
}
