import {initializeApp} from 'firebase-admin/app';
import {credential as Credential} from 'firebase-admin';
import {getStorage} from 'firebase-admin/storage';

const app = initializeApp({
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  credential: Credential.applicationDefault(),
});

export const firebaseStorage = getStorage(app);

export default app;
