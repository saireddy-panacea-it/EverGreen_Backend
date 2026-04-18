import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as serviceAccount from './firebase-creds.json';

@Injectable()
export class FirebaseService {
  constructor() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      });
    }
  }

  sendNotification(token, title, data) {

    const message = {
      // notification: {
      //   title: title,
      //   body: body,
      // },
      data: data,
    };
      return admin.messaging().sendToDevice(token,message)
      .then((response) => {
      
        return response;
      })
      .catch((error) => {
        console.error('Error sending message:', error);
        throw error;
      });
  }
  // async sendNotification(token: string, title: string, body: string, data: Record<string, any>) {
  //   const message = {
  //     notification: {
  //       title,
  //       body,
  //     },
  //     data,
  //     token,
  //   };

  //   return admin.messaging().sendToDevice(token,message)
  //   .then((response) => {
    
  //     return response;
  //   })
  //   .catch((error) => {
  //     console.error('Error sending message:', error);
  //     throw error;
  //   });

  // }
}
