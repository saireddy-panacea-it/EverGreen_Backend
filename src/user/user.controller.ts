import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  Put,
} from "@nestjs/common";
import { UserService } from "./user.service";
import { Response, Request } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import * as path from "path";
import * as fs from "fs";
import { extname, join } from "path";
import { apiKeyAuth } from "src/auth/api_key_auth.decorator";

@Controller("user")
export class UserController {
  constructor(private userService: UserService) {}
  @Post("createUser")
  async createUser(@Res() res: Response, @Req() req: Request) {
    return await this.userService.createUser(res, req);
  }

  @Put("updateUser/:id")
  async updateUser(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() req: Request
  ) {
    return await this.userService.updateUser(id, res, req);
  }

  @Post("createCompany")
  async createCompany(@Res() res: Response, @Req() req: Request) {
    return await this.userService.createCompany(res, req);
  }

  @Put("updateCompany/:id")
  async updateCompany(
    @Param("id") id: string,
    @Res() res: Response,
    @Req() req: Request
  ) {
    return await this.userService.updateCompany(id, res, req);
  }

  @Post("deleteCompany")
  async deleteCompany(@Res() res: Response, @Req() req: Request) {
    return await this.userService.deleteCompany(res, req);
  }

  @Get("getAllCompanies")
  async getAllCompanies(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getAllCompanies(res, req);
  }

  @Post("createEquipment")
  async createEquipment(@Res() res: Response, @Req() req: Request) {
    return await this.userService.createEquipment(res, req);
  }

  @Post("updateEquipment")
  async updateEquipment(@Res() res: Response, @Req() req: Request) {
    return await this.userService.updateEquipment(res, req);
  }

  @Post("deleteEquipment")
  async deleteEquipment(@Res() res: Response, @Req() req: Request) {
    return await this.userService.deleteEquipment(res, req);
  }

  @Post("updateTask")
  async updateTask(@Res() res: Response, @Req() req: Request) {
    return await this.userService.updateTask(res, req);
  }

  @Post("deleteTask")
  async deleteTask(@Res() res: Response, @Req() req: Request) {
    return await this.userService.deleteTask(res, req);
  }

  @Post("deleteUser")
  async deleteUser(@Res() res: Response, @Req() req: Request) {
    return await this.userService.deleteUser(res, req);
  }

  @Post("createTask")
  async createTask(@Res() res: Response, @Req() req: Request) {
    return await this.userService.createTask(res, req);
  }
  @Post("getAllEquipments")
  async getAllEquipments(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getAllEquipments(res, req);
  }

  @Post("assignUserToCompany")
  async assignUserToCompany(@Res() res: Response, @Req() req: Request) {
    return await this.userService.assignUserToCompany(res, req);
  }

  @Post("getHoldReasons")
  async getHoldReasons(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getHoldReasons(res, req);
  }

  @Post("updateTaskStatus")
  async updateTaskStatus(@Res() res: Response, @Req() req: Request) {
    return await this.userService.updateTaskStatus(res, req);
  }

  @Post("getEquipmentInfo")
  async getEquipmentInfo(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getEquipmentInfo(res, req);
  }

  @Post("getAllTasks")
  async getAllTasks(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getAllTasks(res, req);
  }

  @Post("updateTaskFeedback")
  async updateTaskFeedback(@Res() res: Response, @Req() req: Request) {
    return await this.userService.updateTaskFeedback(res, req);
  }

  @Post("tasksCount")
  async tasksCount(@Res() res: Response, @Req() req: Request) {
    return await this.userService.tasksCount(res, req);
  }
  @Post("qrCodeGenerator")
  async qrCodeGenerator(@Res() res: Response, @Req() req: Request) {
    return await this.userService.generateEquipmentPDF(res, req);
  }

  @Post("assignTechnician")
  async assignTechnician(@Res() res: Response, @Req() req: Request) {
    return await this.userService.assignTechnician(res, req);
  }

  @Post("getAllUser")
  async getAllUser(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getAllUser(res, req);
  }

  @Post("getServiceReport")
  async generateServiceReport(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getServiceReport(res, req);
  }

  @Post("clientSignatureForReport")
  async clientSignatureForReport(@Res() res: Response, @Req() req: Request) {
    return await this.userService.clientSignatureForReport(res, req);
  }

  @Post("getNotificationsByUserId")
  async getNotificationsByUserId(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getNotificationsByUserId(res, req);
  }

  @Post("upsertToken")
  async upsertToken(@Res() res: Response, @Req() req: Request) {
    return await this.userService.registerFcm(res, req);
  }

  @Post("updateHoldReasons")
  async updateHoldReasons(@Res() res: Response, @Req() req: Request) {
    return await this.userService.updateHoldReasons(req, res);
  }

  @Post("getStatusOfTask")
  async getStatusOfTask(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getStatusOfTask(res, req);
  }

  @Post("companiesStats")
  async companiesStats(@Res() res: Response, @Req() req: Request) {
    return await this.userService.companiesStats(res, req);
  }

  @Post("getUserStats")
  async getUserStats(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getUserStats(res, req);
  }

  @Post("getAllTasksCount")
  async getAllTasksCount(@Res() res: Response, @Req() req: Request) {
    return await this.userService.getAllTasksCount(res, req);
  }

  @apiKeyAuth()
  @Post("forgetPassword")
  async forgetPassword(@Res() res: Response, @Req() req: Request) {
    return await this.userService.forgetPassword(res, req);
  }

  @Post("upload-file")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (req, file, callback) => {
          const folderName = (req.query?.folderName as string) || undefined;
          const uploadPath = path.join(
            __dirname,
            "..",
            "..",
            "uploads",
            folderName ?? ""
          );
          console.log(folderName, "folderName");
          // Create the folder if it doesn't exist
          fs.mkdirSync(uploadPath, { recursive: true });

          callback(null, uploadPath);
        },
        filename: (req, file, callback) => {
          const timeStamp = new Date().valueOf();
          const fileName = `${timeStamp}-${file.originalname}`;
          callback(null, fileName);
        },
      }),
    })
  )
  uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Res() res: Response,
    @Req() req: Request
  ) {
    const baseUrl = process.env.BASE_URL;
    const folderName = (req.query?.folderName as string) || undefined;
    const relativeImagePath = path.join("uploads", folderName, file.filename);
    const imageUrl = `${relativeImagePath}`;

    if (file) {
      return res.status(200).send({
        status: 200,
        message: "File uploaded Successfully",
        image_url: imageUrl,
      });
    } else {
      return res.status(402).send({
        status: 402,
        message: "Something went wrong",
      });
    }
  }

  @Get("get-image/:imageName")
  getImage(@Param("imageName") imageName: string, @Res() res: Response): void {
    // const imagePath = `${__dirname+'/uploads/'+imageName}`;
    const imagePath = path.join(__dirname, "..", "..", "uploads", imageName);

    console.log(imagePath);
    // Check if the file exists
    const fileExists = fs.existsSync(imagePath);

    if (fileExists) {
      // Read the image file and send it in the response
      const imageStream = fs.createReadStream(imagePath);
      imageStream.pipe(res);
    } else {
      // Return a 404 if the file doesn't exist
      res.status(404).send("file not found");
    }
  }

  @Post("uploadEquipmentData")
  @UseInterceptors(FileInterceptor("file"))
  async uploadEquipmentData(
    @Res() res: Response,
    @Req() req: Request,
    @UploadedFile() file
  ) {
    return await this.userService.uploadEquipmentData(res, req, file);
  }

  @Post("uploadCompanyData")
  @UseInterceptors(FileInterceptor("file"))
  async uploadCompanyData(
    @Res() res: Response,
    @Req() req: Request,
    @UploadedFile() file
  ) {
    return await this.userService.uploadCompanyData(res, req, file);
  }

  @Post("uploadTechnicianData")
  @UseInterceptors(FileInterceptor("file"))
  async uploadTechnicianData(
    @Res() res: Response,
    @Req() req: Request,
    @UploadedFile() file
  ) {
    return await this.userService.uploadTechnicianData(res, req, file);
  }

  // @Post(':destination')
  // @UseInterceptors(
  //   FileInterceptor('file', {
  //     storage: diskStorage({
  //       destination: (req, file, cb) => {
  //         const destination = req.params.destination;
  //         const uploadPath = join(__dirname, '..', 'uploads', destination);
  //         const path = this.userService.ensureUploadPath(uploadPath);
  //         cb(null, uploadPath);
  //       },
  //       filename: (req, file, cb) => {
  //         const uniqueSuffix =
  //           Date.now() + '-' + Math.round(Math.random() * 1e9);
  //         const ext = extname(file.originalname);
  //         cb(null, `${uniqueSuffix}${ext}`);
  //       },
  //     }),
  //   }),
  // )
  // async uploadFile(
  //   @UploadedFile() file: Express.Multer.File,
  //   @Param('destination') destination: string,
  // ) {
  //   const filePath = join('uploads', destination, file.filename);
  //   const fileUrl = this.userService.getFileUrl(filePath);
  //   return { url: fileUrl };
  // }
}
