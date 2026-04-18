/// <reference types="multer" />
import { UserService } from "./user.service";
import { Response, Request } from "express";
export declare class UserController {
    private userService;
    constructor(userService: UserService);
    createUser(res: Response, req: Request): Promise<any>;
    updateUser(id: string, res: Response, req: Request): Promise<any>;
    createCompany(res: Response, req: Request): Promise<any>;
    getAllCompanies(res: Response, req: Request): Promise<any>;
    createEquipment(res: Response, req: Request): Promise<any>;
    updateEquipment(res: Response, req: Request): Promise<any>;
    createTask(res: Response, req: Request): Promise<any>;
    getAllEquipments(res: Response, req: Request): Promise<any>;
    assignUserToCompany(res: Response, req: Request): Promise<any>;
    getHoldReasons(res: Response, req: Request): Promise<any>;
    updateTaskStatus(res: Response, req: Request): Promise<any>;
    getEquipmentInfo(res: Response, req: Request): Promise<any>;
    getAllTasks(res: Response, req: Request): Promise<any>;
    updateTaskFeedback(res: Response, req: Request): Promise<any>;
    tasksCount(res: Response, req: Request): Promise<any>;
    qrCodeGenerator(res: Response, req: Request): Promise<any>;
    assignTechnician(res: Response, req: Request): Promise<any>;
    getAllUser(res: Response, req: Request): Promise<any>;
    generateServiceReport(res: Response, req: Request): Promise<any>;
    clientSignatureForReport(res: Response, req: Request): Promise<void>;
    getNotificationsByUserId(res: Response, req: Request): Promise<any>;
    updateHoldReasons(res: Response, req: Request): Promise<any>;
    getStatusOfTask(res: Response, req: Request): Promise<any>;
    companiesStats(res: Response, req: Request): Promise<any>;
    getUserStats(res: Response, req: Request): Promise<any>;
    getAllTasksCount(res: Response, req: Request): Promise<any>;
    forgetPassword(res: Response, req: Request): Promise<any>;
    uploadFile(file: Express.Multer.File, res: Response, req: Request): Response<any, Record<string, any>>;
    getImage(imageName: string, res: Response): void;
    uploadEquipmentData(res: Response, req: Request, file: any): Promise<any>;
}
