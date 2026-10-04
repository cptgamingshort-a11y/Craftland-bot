import {
  cert,
  deleteApp,
  getApps,
  initializeApp,
  type AppOptions,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { env } from '../config/env.js';

let instance: Firestore | undefined;
export function validateFirebaseConfiguration() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (
      env.NODE_ENV === 'production' ||
      !env.FIREBASE_PROJECT_ID.startsWith('demo-')
    )
      throw new Error(
        'Firestore emulator requires a demo- project in development/test.',
      );
    return;
  }
  if (
    !process.env.K_SERVICE &&
    !env.FIREBASE_SERVICE_ACCOUNT_PATH &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY)
  )
    throw new Error(
      'Configure a Firebase service-account file OR FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY privately.',
    );
}
export function firestore(): Firestore {
  if (instance) return instance;
  validateFirebaseConfiguration();
  const name = 'craftland-server';
  let app = getApps().find((a) => a.name === name);
  if (!app) {
    const options: AppOptions = { projectId: env.FIREBASE_PROJECT_ID };
    if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.K_SERVICE) {
      const file =
        env.FIREBASE_SERVICE_ACCOUNT_PATH ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS;
      try {
        if (file) {
          const account = JSON.parse(readFileSync(file, 'utf8'));
          if (account.project_id !== env.FIREBASE_PROJECT_ID)
            throw new Error('Project mismatch');
          options.credential = cert(account);
        } else {
          options.credential = cert({
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          });
        }
      } catch {
        throw new Error(
          'Invalid Firebase service-account configuration. Check the private file, project ID and credentials.',
        );
      }
    }
    app = initializeApp(options, name);
  }
  instance = getFirestore(app);
  instance.settings({ ignoreUndefinedProperties: true });
  return instance;
}
export async function databaseHealthCheck() {
  try {
    await firestore().doc('_health/connectivity').get();
    return {
      provider: 'firestore',
      projectId: env.FIREBASE_PROJECT_ID,
      status: 'operational' as const,
    };
  } catch {
    throw new Error(
      'Firestore connection failed. Check server credentials, IAM access and that the default Firestore database exists.',
    );
  }
}
export async function closeFirebase() {
  instance = undefined;
  const app = getApps().find(
    (candidate) => candidate.name === 'craftland-server',
  );
  if (app) await deleteApp(app);
}
