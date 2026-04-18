/// <reference types="node" />
import { user, access_level } from "@prisma/client";
import { FirebaseService } from "../firebase/firebase.service";
export declare class UserService {
    private readonly firebaseService;
    constructor(firebaseService: FirebaseService);
    private readonly fcmUrl;
    private readonly serverKey;
    createUser(res: any, req: any): Promise<any>;
    updateUser(id: any, res: any, req: any): Promise<any>;
    createCompany(res: any, req: any): Promise<any>;
    forgetPassword(res: any, req: any): Promise<any>;
    sendEmail(to: any, subject: any, body: any): Promise<boolean>;
    getAllCompanies(res: any, req: any): Promise<any>;
    getAllEquipments(res: any, req: any): Promise<any>;
    adminOrNot(accessLevel: any): boolean;
    createEquipment(res: any, req: any): Promise<any>;
    updateEquipment(res: any, req: any): Promise<any>;
    upsertTokens(fcmId: any, deviceId: any, userId: any, userPhone: any): Promise<void>;
    findOne(phone: string): Promise<user | undefined>;
    createTask(res: any, req: any): Promise<any>;
    createImages(images: any): any;
    generateOtp(): string;
    getTokens(companyLink: any, access_levels: access_level[]): Promise<string[]>;
    getUserIdsByTokens(fcmIds: string[]): Promise<number[]>;
    getLatestStatusForTask(task_link: any): Promise<false | import(".prisma/client").$Enums.status>;
    assignUserToCompany(res: any, req: any): Promise<any>;
    assignTechnician(res: any, req: any): Promise<any>;
    updateTaskStatus(res: any, req: any): Promise<any>;
    getEquipmentInfo(res: any, req: any): Promise<any>;
    getHoldReasons(res: any, req: any): Promise<any>;
    clientSignatureForReport(res: any, req: any): Promise<void>;
    private urlToBase64;
    getServiceReport(res: any, req: any): Promise<any>;
    getTaskDetails(taskLink: any): Promise<{
        bill_to: {
            name: string;
            location: string;
        };
        contact_info: {
            contact_person: string;
            contact_phone: string;
        };
        equipment_details: {
            service_report: string;
            date: string;
            name: string;
            location: string;
            model_no: string;
            serial_no: string;
            voltage: string;
            call_type: string;
        };
        action_taken: string;
        requirement: string;
        follow_up: boolean;
        action_req_details: string;
        filled_by_cust: {
            service_satisfactory: boolean;
            is_running_smoothly: boolean;
            other_cmts: string;
        };
        service_report_images: {
            image_1: any;
            image_2: any;
            image_3: any;
        };
    }>;
    getPDFBufferFromHtml(htmlContent: any): Promise<Uint8Array>;
    getAllTasks(res: any, req: any, stats?: boolean): Promise<any>;
    getAllTasksCount(res: any, req: any): Promise<any>;
    updateHoldReasons(req: any, res: any): Promise<any>;
    calculateCounts(data: any[]): {
        open: number;
        closed: number;
        hold: number;
        in_progress: number;
    };
    updateTaskFeedback(res: any, req: any): Promise<any>;
    tasksCount(res: any, req: any): Promise<any>;
    dataURLToBuffer(dataUrl: any): Buffer;
    generateQRCode(text: any): Promise<unknown>;
    createPDF(equipments: any): Promise<Uint8Array>;
    generateEquipmentPDF(res: any, req: any): Promise<any>;
    getAllUser(res: any, req: any): Promise<any>;
    uploadEquipmentData(res: any, req: any, file: any): Promise<any>;
    getValueAs<T>(row: any, key: string): T | undefined;
    extractImageFromRow(worksheet: any, row: any): any;
    isImageForRow(row: any, topLeftCell: any, bottomRightCell: any): boolean;
    ensureUploadPath(path: string): void;
    sendNotification(tokens: string[], title: string, data: any): Promise<void>;
    companiesStats(res: any, req: any): Promise<any>;
    getUserStats(res: any, req: any): Promise<any>;
    getNotificationsByUserId(res: any, req: any): Promise<any>;
    getFileUrl(filePath: string): string;
    getStatusOfTask(res: any, req: any): Promise<any>;
    createTaskBasedOnTmFrequency(): Promise<void>;
    catch(error: any): void;
}
