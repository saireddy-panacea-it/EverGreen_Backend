export declare class FirebaseService {
    constructor();
    private initializeFirebase;
    sendNotification(token: any, title: any, data: any): Promise<import("firebase-admin/lib/messaging/messaging-api").MessagingDevicesResponse>;
}
