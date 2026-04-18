"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = void 0;
const common_1 = require("@nestjs/common");
const user_service_1 = require("./user.service");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const path = require("path");
const fs = require("fs");
const api_key_auth_decorator_1 = require("../auth/api_key_auth.decorator");
let UserController = class UserController {
    constructor(userService) {
        this.userService = userService;
    }
    async createUser(res, req) {
        return await this.userService.createUser(res, req);
    }
    async updateUser(id, res, req) {
        return await this.userService.updateUser(id, res, req);
    }
    async createCompany(res, req) {
        return await this.userService.createCompany(res, req);
    }
    async getAllCompanies(res, req) {
        return await this.userService.getAllCompanies(res, req);
    }
    async createEquipment(res, req) {
        return await this.userService.createEquipment(res, req);
    }
    async updateEquipment(res, req) {
        return await this.userService.updateEquipment(res, req);
    }
    async createTask(res, req) {
        return await this.userService.createTask(res, req);
    }
    async getAllEquipments(res, req) {
        return await this.userService.getAllEquipments(res, req);
    }
    async assignUserToCompany(res, req) {
        return await this.userService.assignUserToCompany(res, req);
    }
    async getHoldReasons(res, req) {
        return await this.userService.getHoldReasons(res, req);
    }
    async updateTaskStatus(res, req) {
        return await this.userService.updateTaskStatus(res, req);
    }
    async getEquipmentInfo(res, req) {
        return await this.userService.getEquipmentInfo(res, req);
    }
    async getAllTasks(res, req) {
        return await this.userService.getAllTasks(res, req);
    }
    async updateTaskFeedback(res, req) {
        return await this.userService.updateTaskFeedback(res, req);
    }
    async tasksCount(res, req) {
        return await this.userService.tasksCount(res, req);
    }
    async qrCodeGenerator(res, req) {
        return await this.userService.generateEquipmentPDF(res, req);
    }
    async assignTechnician(res, req) {
        return await this.userService.assignTechnician(res, req);
    }
    async getAllUser(res, req) {
        return await this.userService.getAllUser(res, req);
    }
    async generateServiceReport(res, req) {
        return await this.userService.getServiceReport(res, req);
    }
    async clientSignatureForReport(res, req) {
        return await this.userService.clientSignatureForReport(res, req);
    }
    async getNotificationsByUserId(res, req) {
        return await this.userService.getNotificationsByUserId(res, req);
    }
    async updateHoldReasons(res, req) {
        return await this.userService.updateHoldReasons(req, res);
    }
    async getStatusOfTask(res, req) {
        return await this.userService.getStatusOfTask(res, req);
    }
    async companiesStats(res, req) {
        return await this.userService.companiesStats(res, req);
    }
    async getUserStats(res, req) {
        return await this.userService.getUserStats(res, req);
    }
    async getAllTasksCount(res, req) {
        return await this.userService.getAllTasksCount(res, req);
    }
    async forgetPassword(res, req) {
        return await this.userService.forgetPassword(res, req);
    }
    uploadFile(file, res, req) {
        const baseUrl = process.env.BASE_URL;
        const folderName = req.query?.folderName || undefined;
        const relativeImagePath = path.join("uploads", folderName, file.filename);
        const imageUrl = `${relativeImagePath}`;
        if (file) {
            return res.status(200).send({
                status: 200,
                message: "File uploaded Successfully",
                image_url: imageUrl,
            });
        }
        else {
            return res.status(402).send({
                status: 402,
                message: "Something went wrong",
            });
        }
    }
    getImage(imageName, res) {
        const imagePath = path.join(__dirname, "..", "..", "uploads", imageName);
        console.log(imagePath);
        const fileExists = fs.existsSync(imagePath);
        if (fileExists) {
            const imageStream = fs.createReadStream(imagePath);
            imageStream.pipe(res);
        }
        else {
            res.status(404).send("file not found");
        }
    }
    async uploadEquipmentData(res, req, file) {
        return await this.userService.uploadEquipmentData(res, req, file);
    }
};
exports.UserController = UserController;
__decorate([
    (0, common_1.Post)("createUser"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "createUser", null);
__decorate([
    (0, common_1.Put)("updateUser/:id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateUser", null);
__decorate([
    (0, common_1.Post)("createCompany"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "createCompany", null);
__decorate([
    (0, common_1.Get)("getAllCompanies"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getAllCompanies", null);
__decorate([
    (0, common_1.Post)("createEquipment"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "createEquipment", null);
__decorate([
    (0, common_1.Post)("updateEquipment"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateEquipment", null);
__decorate([
    (0, common_1.Post)("createTask"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "createTask", null);
__decorate([
    (0, common_1.Post)("getAllEquipments"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getAllEquipments", null);
__decorate([
    (0, common_1.Post)("assignUserToCompany"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "assignUserToCompany", null);
__decorate([
    (0, common_1.Post)("getHoldReasons"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getHoldReasons", null);
__decorate([
    (0, common_1.Post)("updateTaskStatus"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateTaskStatus", null);
__decorate([
    (0, common_1.Post)("getEquipmentInfo"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getEquipmentInfo", null);
__decorate([
    (0, common_1.Post)("getAllTasks"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getAllTasks", null);
__decorate([
    (0, common_1.Post)("updateTaskFeedback"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateTaskFeedback", null);
__decorate([
    (0, common_1.Post)("tasksCount"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "tasksCount", null);
__decorate([
    (0, common_1.Post)("qrCodeGenerator"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "qrCodeGenerator", null);
__decorate([
    (0, common_1.Post)("assignTechnician"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "assignTechnician", null);
__decorate([
    (0, common_1.Post)("getAllUser"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getAllUser", null);
__decorate([
    (0, common_1.Post)("getServiceReport"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "generateServiceReport", null);
__decorate([
    (0, common_1.Post)("clientSignatureForReport"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "clientSignatureForReport", null);
__decorate([
    (0, common_1.Post)("getNotificationsByUserId"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getNotificationsByUserId", null);
__decorate([
    (0, common_1.Post)("updateHoldReasons"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "updateHoldReasons", null);
__decorate([
    (0, common_1.Post)("getStatusOfTask"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getStatusOfTask", null);
__decorate([
    (0, common_1.Post)("companiesStats"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "companiesStats", null);
__decorate([
    (0, common_1.Post)("getUserStats"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getUserStats", null);
__decorate([
    (0, common_1.Post)("getAllTasksCount"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "getAllTasksCount", null);
__decorate([
    (0, api_key_auth_decorator_1.apiKeyAuth)(),
    (0, common_1.Post)("forgetPassword"),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "forgetPassword", null);
__decorate([
    (0, common_1.Post)("upload-file"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        storage: (0, multer_1.diskStorage)({
            destination: (req, file, callback) => {
                const folderName = req.query?.folderName || undefined;
                const uploadPath = path.join(__dirname, "..", "..", "uploads", folderName ?? "");
                console.log(folderName, "folderName");
                fs.mkdirSync(uploadPath, { recursive: true });
                callback(null, uploadPath);
            },
            filename: (req, file, callback) => {
                const timeStamp = new Date().valueOf();
                const fileName = `${timeStamp}-${file.originalname}`;
                callback(null, fileName);
            },
        }),
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], UserController.prototype, "uploadFile", null);
__decorate([
    (0, common_1.Get)("get-image/:imageName"),
    __param(0, (0, common_1.Param)("imageName")),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UserController.prototype, "getImage", null);
__decorate([
    (0, common_1.Post)("uploadEquipmentData"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file")),
    __param(0, (0, common_1.Res)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UserController.prototype, "uploadEquipmentData", null);
exports.UserController = UserController = __decorate([
    (0, common_1.Controller)("user"),
    __metadata("design:paramtypes", [user_service_1.UserService])
], UserController);
//# sourceMappingURL=user.controller.js.map