import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private initialized = false;
  private readonly serverKey = process.env.FIREBASE_SERVER_KEY;
  private readonly legacyFcmUrl = 'https://fcm.googleapis.com/fcm/send';

  constructor() {
    this.initializeFirebase();
  }

  private loadServiceAccount(): admin.ServiceAccount | null {
    const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (fromEnv) {
      try {
        return JSON.parse(fromEnv) as admin.ServiceAccount;
      } catch (error) {
        this.logger.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
        return null;
      }
    }

    const credsPath =
      process.env.FIREBASE_CREDENTIALS_PATH ||
      path.join(__dirname, 'firebase-creds.json');

    if (fs.existsSync(credsPath)) {
      return JSON.parse(
        fs.readFileSync(credsPath, 'utf8'),
      ) as admin.ServiceAccount;
    }

    return null;
  }

  private initializeFirebase() {
    if (admin.apps.length) {
      this.initialized = true;
      return;
    }

    const serviceAccount = this.loadServiceAccount();
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      this.initialized = true;
      this.logger.log('Firebase Admin initialized (service account)');
      return;
    }

    if (this.serverKey) {
      this.logger.warn(
        'No Firebase service account found. Falling back to FIREBASE_SERVER_KEY (legacy FCM). Prefer FIREBASE_SERVICE_ACCOUNT on Render.',
      );
      return;
    }

    this.logger.warn(
      'Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT (recommended) or FIREBASE_SERVER_KEY.',
    );
  }

  async sendNotification(token: string, title: string, data: any) {
    const payloadData: Record<string, string> = {};
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        payloadData[key] = value == null ? '' : String(value);
      }
    }
    if (title && !payloadData.title) {
      payloadData.title = String(title);
    }

    if (this.initialized) {
      return admin.messaging().send({
        token,
        data: payloadData,
      });
    }

    if (this.serverKey) {
      const response = await axios.post(
        this.legacyFcmUrl,
        {
          to: token,
          data: payloadData,
          priority: 'high',
        },
        {
          headers: {
            Authorization: `key=${this.serverKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data;
    }

    this.logger.warn('Skipping push notification: Firebase is not configured.');
    return null;
  }
}
