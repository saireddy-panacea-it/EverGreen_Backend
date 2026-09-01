import { HttpStatus, Injectable } from "@nestjs/common";
import {
  PrismaClient,
  equipment,
  user,
  status,
  access_level,
  tm_frequency,
  task_user,
  call_type,
} from "@prisma/client";
import * as crypto from "crypto";
import puppeteer from "puppeteer";
import {
  getAccountFromCompany,
  mapAccessLevelToEnum,
  mapCallTypeToEnum,
  mapStatusToEnum,
} from "src/common";

import { existsSync, mkdirSync } from "fs";
// exceljs is CommonJS; default import is undefined at runtime (Workbook crash)
const ExcelJS = require("exceljs");
import * as moment from "moment";
var QRCode = require("qrcode");
import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
const prisma = new PrismaClient();
import nodemailer from "nodemailer";
import { FirebaseService } from "../firebase/firebase.service"; // Update the import path as necessary
import { NotificationService } from "../notification/notification.service";
import serviceReportTemplate from "../service_report/service_report"; // billInvoice
import * as ejs from "ejs";
import axios from "axios";

@Injectable()
export class UserService {
  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly notificationService: NotificationService,
  ) {}
  async createUser(res, req) {
    const user: user = {
      id: undefined,
      name: req.body.name,
      location: req.body.location ?? "",
      phone: req.body.phone,
      email: req.body.email,
      notes: req.body.notes,
      access_level: req.body.access_level,
      pan_id: req.body.pan_id,
      aadhaar_id: req.body.aadhaar_id,
      permanent_address: req.body.permanent_address,
      created_at: undefined,
      created_by: req.body.phone,
      updated_at: undefined,
      updated_by: req.body.phone,
      password: req.body.password,
    };

    const existingUser = await prisma.user.findFirst({
      where: {
        phone: user.phone,
      },
    });

    if (existingUser) {
      return res.send({
        message: `user already exists with phone ${existingUser.phone}`,
        status: 204,
      });
    }

    if (user.email && String(user.email).trim() !== "") {
      const existingEmail = await prisma.user.findFirst({
        where: {
          email: {
            equals: String(user.email).trim(),
            mode: "insensitive",
          },
        },
      });
      if (existingEmail) {
        return res.send({
          message: `This email is already used by another user`,
          status: 204,
        });
      }
    }

    const dbUser = await prisma.user.create({
      data: user,
    });

    if (dbUser != null) {
      const companyLinks = req.body.company_link;
      console.log(companyLinks);
      if (companyLinks?.length > 0) {
        for (const companyLink of companyLinks) {
          const dbCompanyUser = await prisma.company_user.findUnique({
            where: {
              user_link_company_link: {
                user_link: dbUser.id,
                company_link: parseInt(companyLink),
              },
            },
          });

          if (dbCompanyUser == null) {
            await prisma.company_user.create({
              data: {
                user_link: dbUser.id,
                company_link: parseInt(companyLink),
              },
            });
          }
        }
      }

      try {
        await this.notificationService.sendCredentialsEmail(dbUser);
        if (String(dbUser.access_level).toLowerCase() === "technician") {
          const actor = await this.findOne(req.user?.phone);
          await this.notificationService.onNewTechnician({
            technicianName: dbUser.name,
            companyLink: companyLinks?.length
              ? parseInt(companyLinks[0], 10)
              : undefined,
            actorUserId: actor?.id,
          });
        }
      } catch (notifyError) {
        console.error("createUser notification failed", notifyError);
      }

      return res.status(200).send({
        status: 200,
        data: dbUser,
        message: "user created succesfully",
      });
    } else {
      return res.send({
        status: 204,
        message: `no user created.`,
      });
    }
  }

  async updateUser(id, res, req) {
    const existingUser = await prisma.user.findFirst({
      where: {
        id: parseInt(id),
      },
    });
    if (existingUser) {
      if (req.body.email && String(req.body.email).trim() !== "") {
        const emailTaken = await prisma.user.findFirst({
          where: {
            email: { equals: String(req.body.email).trim(), mode: "insensitive" },
            NOT: { id: parseInt(id) },
          },
        });
        if (emailTaken) {
          return res.send({
            status: 204,
            message: "This email is already used by another user",
          });
        }
      }
      const user = {
        name: req.body.name ?? existingUser?.name,
        location: req.body.location ?? existingUser?.location,
        access_level: req.body.access_level ?? existingUser?.access_level,
        email: req.body.email ?? existingUser?.email,
        phone: req.body.phone ?? existingUser?.phone,
        updated_by: req.body.phone ?? existingUser?.phone,
        password: req.body.password || existingUser?.password,
      };
      const dbUser = await prisma.user.update({
        where: {
          id: parseInt(id),
        },
        data: user,
      });
      if (dbUser != null) {
        const companyLinks = req.body.company_link;
        // console.log(companyLinks);
        if (companyLinks?.length > 0) {
          const userId = dbUser.id; // Assuming `dbUser` contains the user information

          // Fetch existing company-user associations for the user
          const existingCompanyUsers = await prisma.company_user.findMany({
            where: { user_link: userId },
          });

          // Extract existing company IDs
          const existingCompanyIds = existingCompanyUsers.map(
            (companyUser) => companyUser.company_link
          );

          // Determine companies to add and remove
          const incomingCompanyIds = companyLinks.map((id: string) =>
            parseInt(id)
          ); // Convert to integers if needed
          const companiesToAdd = incomingCompanyIds.filter(
            (id: number) => !existingCompanyIds.includes(id)
          );
          const companiesToRemove = existingCompanyIds.filter(
            (id: number) => !incomingCompanyIds.includes(id)
          );

          // Add new associations
          for (const companyId of companiesToAdd) {
            await prisma.company_user.create({
              data: {
                user_link: userId,
                company_link: companyId,
              },
            });
          }

          // Remove outdated associations
          for (const companyId of companiesToRemove) {
            await prisma.company_user.deleteMany({
              where: {
                user_link: userId,
                company_link: companyId,
              },
            });
          }

          console.log("Company associations updated successfully.");
        }
        return res.status(200).send({
          status: 200,
          data: dbUser,
          message: "user updated succesfully",
        });
      } else {
        return res.send({
          status: 204,
          message: `no user updated.`,
        });
      }
    } else {
      return res.send({
        message: `user not found`,
        status: 404,
      });
    }
  }
  async createCompany(res, req) {
    try {
      if (String(req.body.action ?? "").trim().toLowerCase() === "delete") {
        return this.deleteCompany(res, req);
      }

      const companyLink = parseInt(String(req.body.company_link ?? ""), 10);
      const companyName = String(req.body.company_name ?? "").trim();
      const branchName = String(req.body.branch_name ?? "").trim();
      if (!isNaN(companyLink) && !companyName && !branchName) {
        return this.deleteCompany(res, req);
      }

      const userPhone = req.user.phone;
      const mobile = String(req.body.phone ?? "").trim();

      if (!mobile) {
        return res.send({
          message: "PLEASE ENTER MOBILE NUMBER",
          status: HttpStatus.BAD_REQUEST,
        });
      }

      const mobileRegex = /^(\+\d{1,3}[- ]?)?\d{10}$/;
      if (!mobileRegex.test(mobile)) {
        return res.send({
          message: "Please enter valid mobile number",
          status: HttpStatus.BAD_REQUEST,
        });
      }

      // Prepare user object
      const userData: user = {
        id: undefined,
        name: String(req.body.name ?? "").trim(),
        location: req.body.location,
        phone: mobile,
        email: String(req.body.email ?? "").trim(),
        notes: req.body.notes,
        password: String(req.body.password ?? "").trim(),
        access_level: access_level.client_admin,
        pan_id: "",
        aadhaar_id: "",
        permanent_address: "",
        created_at: undefined,
        created_by: userPhone,
        updated_at: undefined,
        updated_by: userPhone,
      };

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: { phone: userData.phone },
      });
      if (existingUser) {
        return res.send({
          message: `user already exists with phone ${existingUser.phone}`,
          status: HttpStatus.NO_CONTENT,
        });
      }

      if (userData.email && String(userData.email).trim() !== "") {
        const existingEmail = await prisma.user.findFirst({
          where: {
            email: {
              equals: String(userData.email).trim(),
              mode: "insensitive",
            },
          },
        });
        if (existingEmail) {
          return res.send({
            message: `This email is already used by another user`,
            status: HttpStatus.NO_CONTENT,
          });
        }
      }

      // Prepare company object
      const companyData = {
        id: undefined,
        name: req.body.company_name,
        branch_name: req.body.branch_name,
        email: req.body.company_email,
        start_date: moment
          .utc(req.body.start_date, "YYYY-MM-DD", true)
          .startOf("day")
          .toDate(),
        end_date: moment
          .utc(req.body.end_date, "YYYY-MM-DD", true)
          .startOf("day")
          .toDate(),
        location: req.body.company_location,
        logo: req.body.logo,
        created_at: undefined,
        created_by: userPhone,
        updated_at: undefined,
        updated_by: userPhone,
        address_link: null,
      };

      // Check if company already exists
      const existingCompany = await prisma.company.findUnique({
        where: {
          company_name_branch_name: {
            name: companyData.name,
            branch_name: companyData.branch_name,
          },
        },
      });
      if (existingCompany) {
        return res.send({
          message: `company already exists with name ${companyData.name} and branch ${companyData.branch_name}`,
          status: HttpStatus.CONFLICT,
        });
      }

      if (!moment.utc(req.body.start_date, "YYYY-MM-DD", true).isValid()) {
        return res.send({
          message: "Invalid start date",
          status: HttpStatus.BAD_REQUEST,
        });
      }

      if (!moment.utc(req.body.end_date, "YYYY-MM-DD", true).isValid()) {
        return res.send({
          message: "Invalid end date",
          status: HttpStatus.BAD_REQUEST,
        });
      }

      // Create user and company in parallel
      const [dbUser, dbCompany] = await Promise.all([
        prisma.user.create({ data: userData }),
        prisma.company.create({ data: companyData }),
      ]);

      // Link user to company
      await prisma.company_user.create({
        data: {
          company_link: dbCompany.id,
          user_link: dbUser.id,
        },
      });

      try {
        if (dbUser.email.trim().length > 0 && dbUser.password.trim().length > 0) {
          await this.notificationService.sendCredentialsEmail(dbUser);
        }
        await this.notificationService.onNewAmc({
          companyName: dbCompany.name,
          managerName: dbUser.name,
          location: dbCompany.location,
        });
      } catch (notifyError) {
        console.error("createCompany notification failed", notifyError);
      }

      return res.status(200).send({
        message: `company created successfully`,
        status: 200,
        data: dbCompany,
      });
    } catch (error) {
      return res.send({
        message: `something went wrong ${error}`,
        status: 204,
      });
    }
  }

  async updateCompany(id, res, req) {
    try {
      const companyId = parseInt(id, 10);
      if (isNaN(companyId)) {
        return res.send({
          message: "Invalid company id",
          status: HttpStatus.BAD_REQUEST,
        });
      }

      const userInfo = await this.findOne(req.user.phone);
      const existingCompany = await prisma.company.findUnique({
        where: { id: companyId },
      });
      if (!existingCompany) {
        return res.send({
          message: "company not found",
          status: HttpStatus.NOT_FOUND,
        });
      }

      const isAdmin = this.adminOrNot(userInfo?.access_level);
      if (!isAdmin) {
        const isLinked = await prisma.company_user.findFirst({
          where: {
            company_link: companyId,
            user_link: req.user.sub,
          },
        });
        const isCreator = existingCompany.created_by === req.user.phone;
        if (!isLinked && !isCreator) {
          return res.send({
            message: "You do not have access to update this company",
            status: HttpStatus.FORBIDDEN,
          });
        }
      }

      const companyName = String(
        req.body.company_name ?? existingCompany.name ?? ""
      ).trim();
      const branchName = String(
        req.body.branch_name ?? existingCompany.branch_name ?? ""
      ).trim();
      const startDateRaw = String(req.body.start_date ?? "").trim();
      const endDateRaw = String(req.body.end_date ?? "").trim();

      if (companyName.length === 0) {
        return res.send({
          message: "Please enter site name",
          status: HttpStatus.BAD_REQUEST,
        });
      }
      if (branchName.length === 0) {
        return res.send({
          message: "Please enter branch name",
          status: HttpStatus.BAD_REQUEST,
        });
      }

      let parsedStartDate = existingCompany.start_date;
      let parsedEndDate = existingCompany.end_date;

      if (startDateRaw.length > 0) {
        const startMoment = moment.utc(startDateRaw, "YYYY-MM-DD", true);
        if (!startMoment.isValid()) {
          return res.send({
            message: "Invalid start date",
            status: HttpStatus.BAD_REQUEST,
          });
        }
        parsedStartDate = startMoment.startOf("day").toDate();
      }

      if (endDateRaw.length > 0) {
        const endMoment = moment.utc(endDateRaw, "YYYY-MM-DD", true);
        if (!endMoment.isValid()) {
          return res.send({
            message: "Invalid end date",
            status: HttpStatus.BAD_REQUEST,
          });
        }
        parsedEndDate = endMoment.startOf("day").toDate();
      }

      const duplicateCompany = await prisma.company.findFirst({
        where: {
          name: companyName,
          branch_name: branchName,
          NOT: { id: companyId },
        },
      });
      if (duplicateCompany) {
        return res.send({
          message: `company already exists with name ${companyName} and branch ${branchName}`,
          status: HttpStatus.CONFLICT,
        });
      }

      const updatedCompany = await prisma.company.update({
        where: { id: companyId },
        data: {
          name: companyName,
          branch_name: branchName,
          email: String(req.body.company_email ?? existingCompany.email ?? ""),
          location: String(
            req.body.company_location ?? existingCompany.location ?? ""
          ),
          logo: String(req.body.logo ?? existingCompany.logo ?? ""),
          start_date: parsedStartDate ?? undefined,
          end_date: parsedEndDate ?? undefined,
          updated_by: req.user.phone,
        },
      });

      return res.status(200).send({
        status: 200,
        message: "company updated successfully",
        data: updatedCompany,
      });
    } catch (error) {
      return res.send({
        message: `something went wrong ${error}`,
        status: 204,
      });
    }
  }

  async deleteCompany(res, req) {
    try {
      const companyId = parseInt(String(req.body.company_link ?? ""), 10);
      if (isNaN(companyId)) {
        return res.status(HttpStatus.BAD_REQUEST).send({
          message: "Invalid company id",
          status: HttpStatus.BAD_REQUEST,
        });
      }

      const userInfo = await this.findOne(req.user.phone);
      const existingCompany = await prisma.company.findUnique({
        where: { id: companyId },
      });
      if (!existingCompany) {
        return res.status(HttpStatus.NOT_FOUND).send({
          message: "company not found",
          status: HttpStatus.NOT_FOUND,
        });
      }

      const isAdmin = this.adminOrNot(userInfo?.access_level);
      const requestUserId = parseInt(String(req.user.sub ?? ""), 10);
      if (!isAdmin) {
        const isLinked = await prisma.company_user.findFirst({
          where: {
            company_link: companyId,
            user_link: requestUserId,
          },
        });
        const isCreator = existingCompany.created_by === req.user.phone;
        if (!isLinked && !isCreator) {
          return res.status(HttpStatus.FORBIDDEN).send({
            message: "You do not have access to delete this company",
            status: HttpStatus.FORBIDDEN,
          });
        }
      }

      const companyEquipments = await prisma.equipment.findMany({
        where: { company_link: companyId },
        select: { id: true },
      });
      const equipmentIds = companyEquipments.map((x) => x.id);

      const linkedTasks = equipmentIds.length
        ? await prisma.tasks.findMany({
            where: {
              equipment_link: { in: equipmentIds },
            },
            select: { id: true },
          })
        : [];
      const taskIds = linkedTasks.map((x) => x.id);

      const linkedCompanyUsers = await prisma.company_user.findMany({
        where: { company_link: companyId },
        select: { user_link: true },
      });
      const linkedUserIds = linkedCompanyUsers.map((x) => x.user_link);

      await prisma.$transaction(async (tx) => {
        if (taskIds.length > 0) {
          await tx.images.deleteMany({
            where: { taskId: { in: taskIds } },
          });
          await tx.hold_reason.deleteMany({
            where: { task_link: { in: taskIds } },
          });
          await tx.task_user.deleteMany({
            where: { task_link: { in: taskIds } },
          });
          await tx.notifications.deleteMany({
            where: { task_link: { in: taskIds } },
          });
          await tx.tasks.deleteMany({
            where: { id: { in: taskIds } },
          });
        }

        if (linkedUserIds.length > 0) {
          await tx.notifications.deleteMany({
            where: { user_link: { in: linkedUserIds } },
          });
          await tx.tokens.deleteMany({
            where: { user_link: { in: linkedUserIds } },
          });
        }

        if (equipmentIds.length > 0) {
          await tx.equipment.deleteMany({
            where: { id: { in: equipmentIds } },
          });
        }

        await tx.company.updateMany({
          where: { parent_company_link: companyId },
          data: { parent_company_link: null },
        });

        await tx.company_user.deleteMany({
          where: { company_link: companyId },
        });

        if (linkedUserIds.length > 0) {
          const orphanClientAdmins = await tx.user.findMany({
            where: {
              id: { in: linkedUserIds },
              access_level: access_level.client_admin,
              company_user: { none: {} },
            },
            select: { id: true },
          });
          const orphanUserIds = orphanClientAdmins.map((user) => user.id);
          if (orphanUserIds.length > 0) {
            await tx.user.deleteMany({
              where: { id: { in: orphanUserIds } },
            });
          }
        }

        await tx.company.delete({
          where: { id: companyId },
        });
      });

      return res.status(200).send({
        status: 200,
        message: "company deleted successfully",
      });
    } catch (error) {
      console.error("deleteCompany failed", error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
        message: "Unable to delete company. Please try again.",
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    }
  }

  async forgetPassword(res, req) {
    try {
      const { phone } = req.body;

      // Find the user by phone
      const user = await this.findOne(phone);
      if (!user) {
        return res.send({
          message: "user not found",
          status: 402,
        });
      }

      const password = user.password;
      const name = user.name;
      const to = user.email;
      const subject = `Forgot Password`;
      const body = `Dear ${name},\n\nYour request to reset your password has been processed. Your password is: ${password}\n\nBest regards,\nEverGreen`;
      const sendEmail = await this.sendEmail(to, subject, body);
      if (sendEmail) {
        return res.status(200).send({
          message: `Password sent to your registered email id: ${user.email}`,
          status: 200,
        });
      } else {
        return res.status(402).send({
          message: `Password failed sent to your registered email id: ${user.email}`,
          status: 402,
        });
      }
    } catch (error) {
      console.error(error);
      return res.status(402).send({
        message: "something went wrong",
        status: 402,
      });
    }
  }

  async sendEmail(to, subject, body) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "deepikaiiitn01@gmail.com",
        pass: "xudq smxj ygzv kica",
      },
    });

    const mailOptions = {
      from: "deepikaiiitn01@gmail.com",
      to: to,
      subject: subject,
      text: body,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log("Email sent: " + info.response);
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  //   const schedule = require('node-schedule');

  // const date = new Date(2023, 11, 7, 17, 30, 0); // 7th Nov 2023 at 5:30pm

  // const job = schedule.scheduleJob(date, function(){
  //   console.log('Time for tea!');
  // });

  async getAllCompanies(res, req) {
    const userInfo = await this.findOne(req.user.phone);
    const isAdmin = this.adminOrNot(userInfo?.access_level);
    let whereCondition;
    if (!isAdmin) {
      whereCondition = {
        company_user: {
          some: {
            user_link: req.user.sub,
          },
        },
      };
    }

    const companies = await prisma.company.findMany({
      where: whereCondition,
    });

    for (const company of companies) {
      const pocDetails = await prisma.company_user.findFirst({
        where: {
          user: {
            access_level: "client_admin",
          },
          company_link: company.id,
        },
        select: {
          user: {
            select: {
              name: true,
              phone: true,
              email: true,
              access_level: true,
            },
          },
        },
      });

      company["poc_details"] = pocDetails;
    }

    return res.status(200).send({
      status: 200,
      data: companies,
      message: "companies retrived succesfully",
    });
  }

  async getAllEquipments(res, req) {
    const equipment_link = req.body.equipment_link ?? undefined;
    const companyLink = req.body.company_link;
    const user_link = req.user.sub;
    const getCompanyLinks = await prisma.company_user.findMany({
      where: {
        user_link: user_link,
      },
      select: {
        company_link: true,
      },
    });
    let equipments;
    const includeCompany = { company: true };
    if (equipment_link || companyLink) {
      equipments = await prisma.equipment.findMany({
        where: {
          id: equipment_link ?? undefined,
          company_link: companyLink ?? undefined,
        },
        include: includeCompany,
      });
    } else {
      equipments = await prisma.equipment.findMany({
        where: {
          company_link: {
            in: getCompanyLinks.map((x) => x.company_link),
          },
        },
        include: includeCompany,
      });
    }

    return res.status(200).send({
      status: 200,
      data: equipments,
      message: "equipments retrived succesfully",
    });
  }

  adminOrNot(accessLevel) {
    const access_levels = {
      client: 1,
      client_admin: 2,
      technician: 3,
      eg_admin: 4,
      eg_super_admin: 5,
      others: 6,
    };
    accessLevel = access_levels[accessLevel];

    if (
      accessLevel > access_levels.technician &&
      accessLevel < access_levels.others
    ) {
      return true;
    }

    return false;
  }

  async createEquipment(res, req) {
    try {
      const companyLink = req.body.company_link;
      const dbCompany = await prisma.company.findUnique({
        where: {
          id: companyLink,
        },
      });

      const eg_serial_number = getAccountFromCompany(
        req.body.name +
          req.body.make +
          req.body.model +
          companyLink +
          req.body.specifications +
          req.body.location,
        "EG-"
      );

      if (dbCompany != null) {
        const equipment: equipment = {
          id: undefined,
          name: req.body.name,
          make: req.body.make,
          model: req.body.model,
          eg_serial_number: eg_serial_number,
          serial_number: req.body.serial_number,
          image_url: req.body.image_url,
          specifications: req.body.specifications,
          manufacturer_date: new Date(req.body.manufacturer_date),
          location: req.body.location,
          description: req.body.description,
          tm_frequency: req.body.tm_frequency,
          company_link: companyLink,
          created_at: undefined,
          created_by: "",
          updated_at: undefined,
          updated_by: "",
          manual: "",
          is_active: true,
        };

        console.log(equipment);
        const dbEquipment = await prisma.equipment.create({
          data: equipment,
        });

        if (dbEquipment != null) {
          return res.status(200).send({
            status: 200,
            data: dbEquipment,
            message: "Equipment created successfully",
          });
        } else {
          return res.send({
            status: 204,
            message: "Equipment is not created successfully",
          });
        }
      } else {
        return res.send({
          status: 204,
          message: `Company with ID ${companyLink} is not present in the database`,
        });
      }
    } catch (error) {
      return res.status(500).send({
        status: 500,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  async updateEquipment(res, req) {
    try {
      const equipmentId = req.body.equipment_link;
      // Check if the company exists
      const dbEquipment = await prisma.equipment.findUnique({
        where: {
          id: equipmentId,
        },
      });

      if (!dbEquipment) {
        return res.send({
          status: 204,
          message: `Equipment with ID ${dbEquipment} is not present in the database`,
        });
      }

      // Update equipment
      const updatedEquipment = await prisma.equipment.update({
        where: { id: equipmentId },
        data: {
          name: req.body.name ?? dbEquipment.name,
          make: req.body.make ?? dbEquipment.make,
          model: req.body.model ?? dbEquipment.model,
          serial_number:
            req.body.serial_number ??
            req.body.specifications ??
            dbEquipment.serial_number,
          image_url: req.body.image_url ?? dbEquipment.image_url,
          specifications:
            req.body.specifications ?? dbEquipment.specifications,
          manufacturer_date: req.body.manufacturer_date
            ? new Date(req.body.manufacturer_date)
            : dbEquipment.manufacturer_date,
          location: req.body.location ?? dbEquipment.location,
          description: req.body.description ?? dbEquipment.description,
          tm_frequency: req.body.tm_frequency ?? dbEquipment.tm_frequency,
          updated_at: new Date(),
          updated_by: req.user.phone || "",
          manual: req.body.manual || dbEquipment.manual || "",
        },
      });

      if (updatedEquipment) {
        return res.status(200).send({
          status: 200,
          data: updatedEquipment,
          message: "Equipment updated successfully",
        });
      } else {
        return res.send({
          status: 204,
          message: "Equipment was not updated successfully",
        });
      }
    } catch (error) {
      return res.status(500).send({
        status: 500,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  async deleteEquipment(res, req) {
    try {
      const equipmentId = parseInt(req.body.equipment_link, 10);
      const activate = String(req.body.action || "").toLowerCase() === "activate";
      const dbEquipment = await prisma.equipment.findUnique({
        where: { id: equipmentId },
      });
      if (!dbEquipment) {
        return res.send({
          status: 204,
          message: "Equipment not found",
        });
      }
      await prisma.equipment.update({
        where: { id: equipmentId },
        data: {
          is_active: activate,
          updated_at: new Date(),
          updated_by: req.user?.phone || "",
        },
      });
      return res.status(200).send({
        status: 200,
        message: activate
          ? "Equipment marked active"
          : "Equipment marked inactive",
      });
    } catch (error) {
      return res.status(500).send({
        status: 500,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  async updateTask(res, req) {
    try {
      const taskId = parseInt(req.body.task_link, 10);
      const dbTask = await prisma.tasks.findUnique({ where: { id: taskId } });
      if (!dbTask) {
        return res.send({ status: 204, message: "Task not found" });
      }
      const updated = await prisma.tasks.update({
        where: { id: taskId },
        data: {
          name: req.body.name ?? dbTask.name,
          description: req.body.description ?? dbTask.description,
          call_type: req.body.call_type ?? dbTask.call_type,
          equipment_link: req.body.equipment_link ?? dbTask.equipment_link,
          updated_at: new Date(),
          updated_by: req.user?.phone || "",
        },
      });
      return res.status(200).send({
        status: 200,
        data: updated,
        message: "Task updated successfully",
      });
    } catch (error) {
      return res.status(500).send({
        status: 500,
        message: "Internal server error",
        error: error.message,
      });
    }
  }

  async deleteTask(res, req) {
    try {
      const taskId = parseInt(req.body.task_link, 10);
      const dbTask = await prisma.tasks.findUnique({ where: { id: taskId } });
      if (!dbTask) {
        return res.send({ status: 204, message: "Task not found" });
      }
      await prisma.hold_reason.deleteMany({ where: { task_link: taskId } });
      await prisma.images.deleteMany({ where: { taskId } });
      await prisma.task_user.deleteMany({ where: { task_link: taskId } });
      await prisma.tasks.delete({ where: { id: taskId } });
      return res.status(200).send({
        status: 200,
        message: "Task deleted successfully",
      });
    } catch (error) {
      return res.status(500).send({
        status: 500,
        message: "Unable to delete this task",
        error: error.message,
      });
    }
  }

  async deleteUser(res, req) {
    try {
      const userId = parseInt(req.body.user_link, 10);
      if (req.user?.sub && parseInt(req.user.sub, 10) === userId) {
        return res.send({
          status: 204,
          message: "You cannot delete your own account",
        });
      }
      const dbUser = await prisma.user.findUnique({ where: { id: userId } });
      if (!dbUser) {
        return res.send({ status: 204, message: "User not found" });
      }
      await prisma.company_user.deleteMany({ where: { user_link: userId } });
      await prisma.tokens.deleteMany({ where: { user_link: userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } });
      return res.status(200).send({
        status: 200,
        message: "User deleted successfully",
      });
    } catch (error) {
      return res.status(500).send({
        status: 500,
        message: "Unable to delete this user because they are linked to tasks",
        error: error.message,
      });
    }
  }

  async upsertTokens(fcmId, deviceId, userId, userPhone) {
    await prisma.tokens.upsert({
      where: {
        device_id_fcm_id_user_link: {
          device_id: deviceId,
          fcm_id: fcmId,
          user_link: userId,
        },
      },
      create: {
        device_id: deviceId,
        fcm_id: fcmId,
        user_link: userId,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: userPhone,
        updated_by: userPhone,
      },
      update: {
        device_id: deviceId,
        fcm_id: fcmId,
        user_link: userId,
        updated_by: userPhone,
        updated_at: new Date(),
      },
    });
  }

  async registerFcm(res, req) {
    const fcmId = String(req.body.fcm_id ?? "").trim();
    const deviceId = String(req.body.device_id ?? "").trim();
    const user = await this.findOne(req.user.phone);
    if (!user) {
      return res.status(401).send({
        status: 401,
        message: "Please login again",
      });
    }
    if (!fcmId || !deviceId) {
      return res.status(400).send({
        status: 400,
        message: "fcm_id and device_id are required",
      });
    }
    await this.upsertTokens(fcmId, deviceId, user.id, user.phone);
    return res.status(200).send({
      status: 200,
      message: "token registered",
    });
  }

  async findOne(phone: string): Promise<user | undefined> {
    return prisma.user.findFirst({
      where: {
        phone: phone,
      },
      include: {
        company_user: {
          include: {
            company: true,
          },
        },
      },
    });
  }

  async createTask(res, req) {
    const equipmentLink = req.body.equipment_link;
    const userPhone = req.user.phone;
    const dbEquipment = await prisma.equipment.findUnique({
      where: {
        id: equipmentLink,
      },
      include: {
        company: true,
      },
    });

    if (dbEquipment == null) {
      return res.send({
        status: 204,
        message: `Equipment with ID ${equipmentLink} is not present in the database`,
      });
    }

    const callType = mapCallTypeToEnum(req.body?.call_type);
    const task = {
      name: req.body.name,
      description: req.body.description,
      image: { create: this.createImages(req.body.images) },
      equipment_link: equipmentLink,
      ticket_no: getAccountFromCompany(
        req.body.name + req.body.description + (callType ?? undefined)
      ),
      call_type: callType ?? undefined,
      otp: this.generateOtp(),
      created_at: undefined,
      created_by: userPhone,
      updated_at: undefined,
      updated_by: userPhone,
    };

    const existingTask = await prisma.tasks.findFirst({
      where: {
        equipment_link: task.equipment_link,
        name: task.name,
        description: task.description,
        call_type: callType ?? undefined,
      },
    });

    if (existingTask) {
      return res.send({
        status: HttpStatus.CONFLICT,
        data: existingTask,
        message: `task already exist with same name, description, equipment and call_type combo`,
      });
    }

    const dbTask = await prisma.tasks.create({
      data: task,
    });

    if (dbTask != null) {
      await prisma.task_user.create({
        data: {
          client_link: req.body.client_link,
          task_link: dbTask.id,
          status: status.open,
          created_by: userPhone,
          updated_by: userPhone,
        },
      });

      const user = await this.findOne(userPhone);
      try {
        await this.notificationService.onNewTask({
          task: dbTask,
          equipment: dbEquipment,
          raisedByName: user?.name ?? user?.phone,
          companyName: dbEquipment.company?.name,
          companyLink: dbEquipment.company_link,
          isHighPriority: dbTask.call_type === call_type.breakdown,
          actorUserId: user?.id,
        });
      } catch (notifyError) {
        console.error("createTask notification failed", notifyError);
      }
      const taskStatus = await this.getLatestStatusForTask(dbTask.id);

      return res.status(200).send({
        status: 200,
        data: dbTask,
        message: "task created successfully",
      });
    }

    return res.status(200).send({
      status: 200,
      data: dbTask,
      message: "task created successfully",
    });
  }

  createImages(images) {
    return images.map((path) => ({
      url: path,
    }));
  }

  generateOtp(): string {
    // Generate a random integer between 10000 and 99999 (inclusive)
    const otp = crypto.randomInt(10000, 100000);
    // Return the OTP as a string
    return otp.toString();
  }

  async getTokens(companyLink, access_levels: access_level[]) {
    const getTokens = await prisma.company_user.findMany({
      where: {
        company_link: companyLink,
      },
      select: {
        user: {
          select: {
            access_level: true,
            id: true,
            phone: true,
          },
        },
      },
    });

    const userIds = getTokens
      .filter((item) => access_levels.includes(item.user.access_level))
      .map((item) => item.user.id);

    const tokens = await prisma.tokens.findMany({
      where: {
        user_link: {
          in: userIds,
        },
      },
      select: {
        fcm_id: true,
        user_link: true,
      },
    });

    return tokens.map((x) => x.fcm_id);
  }

  async getUserIdsByTokens(fcmIds: string[]) {
    // Fetch unique user_link values based on the given fcm_ids
    const uniqueUserLinks = await prisma.tokens.findMany({
      where: {
        fcm_id: {
          in: fcmIds,
        },
      },
      distinct: ["user_link"],
      select: {
        user_link: true,
      },
    });

    return uniqueUserLinks.map((token) => token.user_link);
  }

  async getLatestStatusForTask(task_link) {
    const tasks = await prisma.task_user.findFirst({
      where: {
        task_link: task_link,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const updateTaskStatus = await prisma.tasks.update({
      where: {
        id: task_link,
      },
      data: {
        status: tasks?.status,
      },
    });

    if (updateTaskStatus) {
      return tasks.status;
    }
    return false;
  }

  async assignUserToCompany(res, req) {
    const companyLink = req.body.company_link;
    const userLink = req.body.user_link;

    const dbUser = await prisma.user.findUnique({
      where: {
        id: userLink,
      },
    });

    const dbCompany = await prisma.company.findUnique({
      where: {
        id: companyLink,
      },
    });

    if (dbCompany && dbUser) {
      await prisma.company_user.create({
        data: {
          company_link: companyLink,
          user_link: userLink,
        },
      });

      return res.status(200).send({
        message: `user ${dbUser.name} assigned to company: ${dbCompany.name} succesfully`,
      });
    } else {
      return res.send({
        message: `user_link or company_link is not found in db company_link: ${companyLink}, user_link: ${userLink}`,
      });
    }
  }

  async assignTechnician(res, req) {
    const userPhone = req.user.phone;
    const task = await prisma.tasks.findUnique({
      where: {
        id: req.body.task_link,
      },
      select: {
        task_user: {
          orderBy: {
            id: "desc",
          },
          take: 1,
        },
      },
    });

    let response;
    let taskUser;
    const taskStatus = mapStatusToEnum(req.body.status);

    if (task) {
      if (
        task.task_user?.length > 0 &&
        task.task_user[0].technician_link == null
      ) {
        taskUser = await prisma.task_user.update({
          where: {
            id: task.task_user[0]?.id,
          },
          data: {
            technician_link: req.body.technician_link,
            updated_by: userPhone,
          },
        });
      } else {
        if (req.body.technician_link != task.task_user[0].technician_link) {
          taskUser = await prisma.task_user.create({
            data: {
              task_link: req.body.task_link,
              technician_link: req.body.technician_link,
              client_link: task.task_user[0].client_link,
              status: taskStatus ?? task.task_user[0].status,
              created_by: userPhone,
              updated_by: userPhone,
            },
          });
        }
      }

      if (taskUser) {
        response = {
          message: `technician assigned successfully`,
          status: 200,
        };
        try {
          const assignedTask = await prisma.tasks.findUnique({
            where: { id: req.body.task_link },
            include: {
              equipment: { include: { company: true } },
            },
          });
          const technician = await prisma.user.findUnique({
            where: { id: req.body.technician_link },
          });
          const actor = await this.findOne(userPhone);
          await this.notificationService.onTechnicianAssigned({
            task: assignedTask,
            equipment: assignedTask?.equipment,
            companyLink: assignedTask?.equipment?.company_link,
            companyName: assignedTask?.equipment?.company?.name,
            technicianName: technician?.name ?? technician?.phone,
            technicianUserId: req.body.technician_link,
            assignedByUserId: actor?.id,
            assignedByName: actor?.name ?? actor?.phone,
            selfAssigned: actor?.id === req.body.technician_link,
          });
        } catch (notifyError) {
          console.error("assignTechnician notification failed", notifyError);
        }
      } else {
        response = {
          message: `technician already assigned`,
          status: 200,
        };
      }
    } else {
      response = {
        message: `no tasks found`,
        status: 204,
      };
    }
    return res.status(response.status).send(response);
  }

  async updateTaskStatus(res, req) {
    let returnMessage;
    const releaseFromHold = req.body.hold?.release_from_hold ?? false;
    const userPhone = req.user.phone;
    const userInfo = await this.findOne(req.user.phone);
    const taskLink = req.body.task_user_link;
    if (taskLink == null) {
      return res.send({
        message: `task_user_link is required`,
        status: 404,
      });
    }

    const taskStatus = mapStatusToEnum(req.body.status);
    const dbTaskUser = await prisma.task_user.findUnique({
      where: {
        id: taskLink,
      },
      include: {
        task: {
          include: {
            equipment: {
              include: {
                company: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (dbTaskUser == null) {
      return res.send({
        message: "task not found.",
        status: 404,
      });
    }
    const dbTask = await prisma.tasks.findUnique({
      where: {
        id: dbTaskUser.task_link,
      },
    });

    // const dbTaskUser = await prisma.task_user.findFirst({
    //   where: {
    //     task_link: taskLink,
    //     technician_link: technicianLink ?? undefined,
    //     client_link: clientLink ?? undefined,
    //     status: taskStatus,
    //   },
    // });

    let taskUser;
    if (dbTaskUser) {
      if (dbTaskUser.technician_link == null) {
        return res.send({
          message: `technician is not assigned to task. Cannot change the task status`,
          status: HttpStatus.NOT_FOUND,
        });
      }
      taskUser = await prisma.task_user.update({
        where: {
          id: dbTaskUser.id,
        },
        data: {
          status: taskStatus,
          reason: req.body.reason != null ? req.body.reason : undefined,
          created_by: userPhone,
          updated_by: userPhone,
        },
      });
    } else {
      returnMessage = {
        message: `task_user record not found `,
        status: HttpStatus.NOT_FOUND,
      };
    }

    if (dbTaskUser) {
      returnMessage = {
        message: `task status updated succesfully to ${taskStatus} by ${userInfo.name}`,
        data: taskUser,
        status: 200,
      };

      try {
        await this.notificationService.onTaskStatusUpdated({
          task: dbTask,
          equipment: dbTaskUser.task.equipment,
          companyLink: dbTaskUser.task.equipment.company_link,
          companyName: dbTaskUser.task.equipment.company?.name,
          statusLabel: String(taskStatus),
          updatedByName: userInfo?.name ?? userInfo?.phone,
          actorUserId: userInfo?.id,
          notes: req.body.reason,
          isCompleted: taskStatus === status.closed,
        });
      } catch (notifyError) {
        console.error("updateTaskStatus notification failed", notifyError);
      }
    }

    const taskLatestStatus = await this.getLatestStatusForTask(dbTask.id);
    if (taskLatestStatus == status.hold) {
      const dbHold = {
        hold: req.body.hold.hold_reason,
        is_active: true,
        spare_part_number: req.body.hold.spare_part_number,
        image: req.body.hold.image,
        reason: req.body.hold.reason,
        updated_at: new Date(),
        updated_by: req.user.phone,
        task_link: dbTask.id,
        id: undefined,
      };

      const upsertHoldReason = await prisma.hold_reason.upsert({
        where: {
          hold_spare_part_number_task_link_key: {
            hold: dbHold.hold,
            spare_part_number: dbHold.spare_part_number,
            task_link: dbHold.task_link,
          },
        },
        create: {
          ...dbHold,
          created_at: new Date(),
          created_by: req.user.phone,
        },
        update: dbHold,
      });
    }

    if (releaseFromHold) {
      await prisma.hold_reason.update({
        where: {
          id: req.body.hold.hold_reason_link,
        },
        data: {
          is_active: false,
        },
      });
    }

    return res.send(returnMessage);
  }

  async getEquipmentInfo(res, req) {
    const equipment_link = req.body.equipment_link;
    const equipment = await prisma.equipment.findUnique({
      where: {
        id: equipment_link,
      },
      include: {
        company: true,
      },
    });

    const tasks = await prisma.task_user.findMany({
      where: {
        task: {
          equipment_link: equipment.id,
        },
      },
      include: {
        task: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i].client_link != null) {
        tasks[i]["client"] = await prisma.user.findUnique({
          where: { id: tasks[i].client_link },
          select: {
            name: true,
            id: true,
            access_level: true,
            phone: true,
          },
        });
      } else {
        tasks[i]["client"] = undefined;
      }

      if (tasks[i].technician_link != null) {
        tasks[i]["technician"] = await prisma.user.findUnique({
          where: { id: tasks[i].technician_link },
          select: {
            name: true,
            id: true,
            access_level: true,
            phone: true,
          },
        });
      } else {
        tasks[i]["technician"] = undefined;
      }
    }

    equipment["tasks"] = tasks;
    if (equipment) {
      return res.send({
        success: 200,
        data: equipment,
      });
    } else {
      return res.send({
        success: 200,
        message: `Data not found for equipment with id: ${equipment_link}`,
      });
    }
  }

  async getHoldReasons(res, req) {
    const companyLink = req.body.company_link;

    const dbHoldReasons = await prisma.hold_reason.findMany({
      where: {
        task: {
          equipment: {
            company_link: {
              in: companyLink ?? undefined,
            },
          },
        },
      },
    });

    return res.send({
      data: dbHoldReasons,
      status: 200,
      message: `Hold Reasons received successfully`,
    });
  }

  async clientSignatureForReport(res, req) {
    try {
      // const sign_url = "https://www.shutterstock.com/image-vector/fake-autograph-samples-handdrawn-signatures-260nw-2325821623.jpg";
      const task_link = req.body.task_link;
      const taskDetails = await this.getTaskDetails(task_link);
      taskDetails["signature"] = await this.urlToBase64(req.body.sign_url);
      taskDetails.service_report_images.image_1 = await this.urlToBase64(
        taskDetails.service_report_images.image_1
      );
      taskDetails.service_report_images.image_2 = await this.urlToBase64(
        taskDetails.service_report_images.image_2
      );
      taskDetails.service_report_images.image_3 = await this.urlToBase64(
        taskDetails.service_report_images.image_3
      );
      const report = await ejs.render(serviceReportTemplate, taskDetails);
      const pdfBuffer = await this.getPDFBufferFromHtml(report);
      const filePath = `./uploads/reports/file-${task_link}.pdf`;

      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
          // File does not exist, proceed with writing the file
          fs.writeFile(filePath, pdfBuffer, (writeErr) => {
            if (writeErr) {
              return res.send({
                status: 401,
                message: `Error writing file`,
                url: filePath,
              });
            }
            return res.send({
              status: 200,
              message: `file generated successfully`,
            });
          });
        } else {
          return res.send({
            status: 200,
            message: `File already exists`,
            url: filePath,
          });
        }
      });
    } catch (error) {
      console.error("Error converting HTML to PDF:", error);
      res.status(500).json({ error: "Failed to convert HTML to PDF" });
    }
  }

  private async urlToBase64(imageUrl: string) {
    if (!imageUrl) {
      return undefined;
    }

    imageUrl = `${process.env.BASE_URL + imageUrl}`;

    try {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });
      const imageBuffer = Buffer.from(response.data, "binary");

      // Convert the buffer to a base64 string
      const base64Image = imageBuffer.toString("base64");
      return `data:image/jpeg;base64,${base64Image}`;
    } catch (error) {
      console.error("Error converting image URL to base64:", error);
      return undefined; // Or handle the error as appropriate for your use case
    }
  }

  async getServiceReport(res, req) {
    try {
      const task_link = req.body.task_link;
      const filePath = `./uploads/reports/file-${task_link}.pdf`;

      // Check if the file exists
      fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
          // File does not exist
          return res.send({
            status: 401,
            message: `client signature is not done or file not found`,
          });
        } else {
          return res.send({
            status: 200,
            message: `file generated successfully`,
            url: `uploads/reports/file-${task_link}.pdf`,
          });
        }
      });
    } catch (error) {
      return res.send({
        status: 401,
        message: `${error}`,
      });
    }
  }

  async getTaskDetails(taskLink) {
    const task = await prisma.tasks.findUnique({
      where: {
        id: taskLink, // Ensure `taskLink` is the correct identifier
      },
      include: {
        task_user: {
          where: {
            status: "closed", // Assuming 'closed' is a string; adjust if it's a variable
          },
          orderBy: {
            created_at: "desc", // Orders by creation date in descending order
          },
          take: 1, // Limits to the most recent record
        },
        equipment: {
          include: {
            company: {
              select: {
                name: true,
                location: true,
              },
            },
          },
        },
      },
    });

    const clientInfo = await prisma.user.findUnique({
      where: {
        id: task.task_user[0].client_link,
      },
    });

    const outImagesArray = JSON.parse(task?.out_images || "[]");
    // if (task.task_user[0].status == status.closed) {
    const data = {
      bill_to: {
        name: task.equipment.company.name,
        location: task.equipment.company.location,
      },
      contact_info: {
        contact_person: clientInfo.name,
        contact_phone: clientInfo.phone,
      },
      equipment_details: {
        service_report: "12309",
        date: moment(task.equipment.manufacturer_date).format("yyyy-MM-DD"),
        name: task.equipment.name,
        location: task.equipment.location,
        model_no: task.equipment.model,
        serial_no: task.equipment.serial_number,
        voltage: task.equipment.make,
        call_type: task.call_type.toLocaleUpperCase(),
      },
      action_taken: task.action_taken,
      requirement: task.req_details,
      follow_up: task.follow_up,
      action_req_details: task.action_req_details,
      filled_by_cust: {
        service_satisfactory: task.service_satisfactory,
        is_running_smoothly: task.is_running_smoothly,
        other_cmts: task.notes,
      },
      service_report_images: {
        image_1: outImagesArray[0] ?? undefined,
        image_2: outImagesArray[1] ?? undefined,
        image_3: outImagesArray[2] ?? undefined,
      },
    };
    return data;
  }

  async getPDFBufferFromHtml(htmlContent) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const pdfBuffer = await page.pdf({
      printBackground: true,
      omitBackground: true,
      format: "A4",
      margin: { top: "60px", bottom: "60px", left: "5px", right: "5px" },
    });
    await browser.close();
    return pdfBuffer;
  }

  async getAllTasks(res, req, stats = false) {
    const user = req.user;
    if (user == null) {
      return res.send({
        success: 402,
        message: `Please login again`,
      });
    }
    const taskStatus = mapStatusToEnum(req.body?.status);
    const userInfo = await this.findOne(req.user.phone);
    const companyUsers = await prisma.company_user.findMany({
      where: {
        user_link: userInfo.id,
      },
    });

    const isAdmin = this.adminOrNot(userInfo?.access_level) ?? false;

    let whereCondition;
    const companyLinks = companyUsers.map((x) => x.company_link);

    if (!isAdmin) {
      whereCondition = {
        OR: [
          {
            task: {
              equipment: {
                company_link: {
                  in: companyUsers.map((x) => x.company_link),
                },
              },
            },
          },
          // {
          //   technician_link: user.access_level == access_level.technician ? user.sub : undefined,
          // },
        ],
      };
    }

    const latestTasks: task_user[] = await prisma.$queryRaw`
    SELECT * 
    FROM task_user
    WHERE (task_link, updated_at) IN (
      SELECT task_link, MAX(updated_at)
      FROM task_user
      GROUP BY task_link
    )
    ORDER BY updated_at DESC;
  `;

    const taskUsers = await prisma.task_user.findMany({
      where: {
        id: {
          in: latestTasks.map((x) => x.id),
        },
      },
      include: {
        task: {
          include: {
            equipment: {
              include: {
                company: true,
              },
            },
            hold_reason: {
              where: {
                is_active: true,
              },
            },
            image: true,
          },
        },
      },
    });

    // const filteredTasks = taskUsers.filter(task => {
    //   if(task.technician_link == null){
    //     return true;
    //   }else if(task.technician_link == user.sub){
    //     return true;
    //   }
    // });

    const filteredTasks = taskUsers.filter((task) => {
      const isTechnicianLinkValid = task.technician_link == null;
      const myTask = task.technician_link == user.sub;
      const isCompanyLinked = companyLinks.includes(
        task.task.equipment.company_link
      );
      if (userInfo.access_level == access_level.technician) {
        return myTask || (isCompanyLinked && isTechnicianLinkValid);
      } else if (
        userInfo.access_level == access_level.client ||
        userInfo.access_level == access_level.client_admin
      ) {
        return isCompanyLinked;
      } else {
        return true;
      }
    });
    const tasksWithImages = filteredTasks.map((taskUser: any) => {
      const task = taskUser.task;
      const imageUrls = task.image.map((image: any) => image.url);

      return {
        ...taskUser,
        task: {
          ...task,
          image: imageUrls,
        },
      };
    });
    const filteredTasksByStatus =
      taskStatus != null
        ? tasksWithImages.filter((x) => x.status == taskStatus)
        : tasksWithImages;
    filteredTasksByStatus.sort((a, b) => {
      const left = new Date(a.task?.created_at || a.created_at || 0).getTime();
      const right = new Date(b.task?.created_at || b.created_at || 0).getTime();
      return right - left;
    });

    for (let i = 0; i < filteredTasksByStatus.length; i++) {
      if (filteredTasksByStatus[i].client_link != null) {
        filteredTasksByStatus[i]["client"] = await prisma.user.findUnique({
          where: { id: filteredTasksByStatus[i].client_link },
          select: {
            name: true,
            id: true,
            access_level: true,
            phone: true,
          },
        });
      } else {
        filteredTasksByStatus[i]["client"] = undefined;
      }

      if (filteredTasksByStatus[i].technician_link != null) {
        filteredTasksByStatus[i]["technician"] = await prisma.user.findUnique({
          where: { id: filteredTasksByStatus[i].technician_link },
          select: {
            name: true,
            id: true,
            access_level: true,
            phone: true,
          },
        });
      } else {
        filteredTasksByStatus[i]["technician"] = undefined;
      }
    }

    const statsOfTasks = this.calculateCounts(filteredTasks);
    if (stats) {
      return statsOfTasks;
    }
    return res.send({
      data: filteredTasksByStatus,
      success: 200,
      count: statsOfTasks,
      message: `data received successfully`,
    });
  }

  async getAllTasksCount(res, req) {
    const stats = await this.getAllTasks(res, req, true);
    return res.send({
      data: stats,
      status: 200,
      message: `Tasks Count received successfully`,
    });
  }

  async updateHoldReasons(req, res) {
    const holdReasonLink = req.body.hold_reason_link;
    const updatedHoldReason = await prisma.hold_reason.update({
      where: {
        id: holdReasonLink,
      },
      data: {
        hold: req.body.hold_reason,
        spare_part_number: req.body.spare_part_number,
        image: req.body.image,
        reason: req.body.reason,
        updated_at: new Date(),
        updated_by: req.user.phone,
      },
    });

    return res.status(200).send({
      status: 200,
      message: `hold reasons updated successfully`,
      data: updatedHoldReason,
    });
  }

  calculateCounts(data: any[]): {
    open: number;
    closed: number;
    hold: number;
    in_progress: number;
  } {
    let openCount = 0;
    let inProgressCount = 0;
    let closedCount = 0;
    let holdCount = 0;

    for (const item of data) {
      if (item.status === "open") {
        openCount++;
      } else if (item.status === "closed") {
        closedCount++;
      } else if (item.status === "in_progress") {
        inProgressCount++;
      } else if (item.status === "hold") {
        holdCount++;
      }
    }

    return {
      open: openCount,
      closed: closedCount,
      in_progress: inProgressCount,
      hold: holdCount,
    };
  }

  async updateTaskFeedback(res, req) {
    let response;
    const task = await prisma.tasks.findUnique({
      where: {
        id: req.body.task_link,
      },
    });

    if (task) {
      const updateTask = await prisma.tasks.update({
        where: {
          id: req.body.task_link,
        },
        data: {
          call_type: mapCallTypeToEnum(req.body.call_type),
          action_taken: req.body.action_taken ?? undefined,
          req_details: req.body.req_details ?? undefined,
          follow_up: req.body.follow_up ?? undefined,
          out_images: Array.isArray(req.body.out_images)
            ? JSON.stringify(req.body.out_images)
            : req.body.out_images,
          action_req_details: req.body.action_req_details ?? undefined,
          service_satisfactory: req.body.service_satisfactory ?? undefined,
          is_running_smoothly: req.body.is_running_smoothly ?? undefined,
          feedback: req.body.feedback ?? undefined,
          rating: req.body.rating ?? undefined,
          updated_at: new Date(),
          updated_by: req.user.phone,
        },
      });

      if (updateTask) {
        response = {
          message: `task updated successfully`,
          data: updateTask,
          status: 200,
        };
        try {
          const actor = await this.findOne(req.user?.phone);
          const latestAssignment = await prisma.task_user.findFirst({
            where: { task_link: req.body.task_link },
            orderBy: { id: "desc" },
          });
          const equipment = await prisma.equipment.findUnique({
            where: { id: task.equipment_link },
            include: { company: true },
          });
          const hasNotes = Boolean(
            req.body.action_taken ||
              req.body.req_details ||
              req.body.action_req_details ||
              req.body.notes,
          );
          const hasFeedback = Boolean(
            req.body.feedback ||
              req.body.rating != null ||
              req.body.service_satisfactory != null ||
              req.body.is_running_smoothly != null,
          );
          if (hasNotes) {
            await this.notificationService.onTaskNotesUpdated({
              task: updateTask,
              equipment,
              companyLink: equipment?.company_link,
              updatedByName: actor?.name ?? actor?.phone,
              actorUserId: actor?.id,
              notes:
                req.body.action_taken ||
                req.body.notes ||
                req.body.req_details,
            });
          }
          if (hasFeedback) {
            await this.notificationService.onFeedback({
              task: updateTask,
              equipment,
              companyLink: equipment?.company_link,
              technicianUserId: latestAssignment?.technician_link,
              actorUserId: actor?.id,
              submittedByName: actor?.name ?? actor?.phone,
              feedback: req.body.feedback,
              rating: req.body.rating,
            });
          }
        } catch (notifyError) {
          console.error("updateTaskFeedback notification failed", notifyError);
        }
      } else {
        response = {
          message: `task not updated successfully`,
          status: 204,
        };
      }
    } else {
      response = {
        message: `task not found in db with id: ${req.body.task_link}`,
        status: 204,
      };
    }

    return res.send(response);
  }

  async tasksCount(res, req) {
    // const tasks = await prisma.tasks.findMany({
    //   select: {
    //     task_user: {
    //       orderBy: {
    //         id: `desc`,
    //       },
    //       take: 1,
    //     },
    //   },
    // });

    return res.status(200).send({
      message: `data received succesfully`,
      all: 50,
      in_progress: 20,
      open: 10,
      done: 30,
    });
  }

  dataURLToBuffer(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    return Buffer.from(base64, "base64");
  }

  async generateQRCode(text) {
    return new Promise((resolve, reject) => {
      QRCode.toDataURL(text, (err, url) => {
        if (err) reject(err);
        resolve(url);
      });
    });
  }

  async createPDF(equipments) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const margin = 50;
    const qrSize = 130;
    let x = margin;
    let y = height - margin - qrSize;

    for (const equipment of equipments) {
      const qrImage = await this.generateQRCode(equipment.id.toString());
      const qrImageBytes = this.dataURLToBuffer(qrImage);
      const qrImageEmbed = await pdfDoc.embedPng(qrImageBytes);

      page.drawImage(qrImageEmbed, {
        x,
        y,
        width: qrSize,
        height: qrSize,
      });
      page.drawText(equipment.eg_serial_number, {
        x,
        y: y - 22,
        size: 12,
        color: rgb(0, 0, 0),
      });

      x += qrSize + margin;
      if (x + qrSize + margin > width) {
        x = margin;
        y -= qrSize + margin + 20;
        if (y < margin) {
          y = height - margin - qrSize;
          page = pdfDoc.addPage();
        }
      }
    }

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  }

  async generateEquipmentPDF(res, req) {
    try {
      const companyLink = req.body.company_link;
      const equipmentLinks = req.body.equipment_link;

      if (!companyLink && (!equipmentLinks || equipmentLinks.length === 0)) {
        return res.status(400).send({
          status: 400,
          message: "Please provide either company_link or equipment_link",
        });
      }
      console.log(equipmentLinks);

      const equipmentList = await prisma.equipment.findMany({
        where: {
          OR: [
            {
              company_link: req.body.company_link,
            },
            {
              id: { in: equipmentLinks },
            },
          ],
        },
        select: {
          id: true,
          eg_serial_number: true,
        },
      });

      const pdfBytes = await this.createPDF(equipmentList);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="equipment_qrcodes.pdf"'
      );
      res.send(Buffer.from(pdfBytes));
    } catch (err) {
      console.error("Error generating PDF:", err);
      res.status(500).send("Internal Server Error");
    }
  }

  async getAllUser(res, req) {
    const dbAccessLevel = mapAccessLevelToEnum(req.body.access_level);
    const users = await prisma.user.findMany({
      where: {
        access_level: dbAccessLevel ?? undefined,
      },
    });
    // Fetch count of users grouped by access_level
    const userCounts = await prisma.user.groupBy({
      by: ["access_level"],
      _count: {
        access_level: true,
      },
    });

    // Create an object for easier access to the counts
    const userCountsObj = userCounts.reduce((acc, item) => {
      acc[item.access_level] = item._count.access_level;
      return acc;
    }, {});

    return res.status(200).send({
      status: 200,
      message: `user data received successfully`,
      data: users,
      count: userCountsObj,
    });
  }

  private excelCellText(value: any): string | undefined {
    if (value == null || value === "") return undefined;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "number") return String(value);
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || undefined;
    }
    if (typeof value === "object") {
      if (value.text) return this.excelCellText(value.text);
      if (value.result != null) return this.excelCellText(value.result);
      if (Array.isArray(value.richText)) {
        return this.excelCellText(value.richText.map((part) => part.text).join(""));
      }
    }
    const asString = String(value).trim();
    return asString || undefined;
  }

  private excelHeaderKey(value: any): string | undefined {
    const text = this.excelCellText(value);
    if (!text) return undefined;
    return text.toLowerCase().replace(/\s+/g, "_");
  }

  private excelDate(value: any): Date | undefined {
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    const text = this.excelCellText(value);
    if (!text) return undefined;
    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? undefined : parsed;
  }

  async uploadEquipmentData(res, req, file) {
    try {
      if (!file?.buffer) {
        return res.status(200).send({
          status: HttpStatus.CONFLICT,
          message: "No Excel file received",
        });
      }
      const WorkbookCtor = ExcelJS?.Workbook || ExcelJS?.default?.Workbook;
      if (!WorkbookCtor) {
        return res.status(200).send({
          status: HttpStatus.CONFLICT,
          message: "Excel parser is not available on server",
        });
      }
      const workBook = new WorkbookCtor();
      await workBook.xlsx.load(file.buffer);
      const dbCompany = await prisma.company.findUnique({
        where: {
          id: parseInt(req.body?.company_link),
        },
      });

      if (!dbCompany) {
        return res.send({
          message: `No company exists with id: ${req.body?.company_link}`,
          status: HttpStatus.NO_CONTENT,
        });
      }
      const errors = [];
      let created = 0;

      for (const worksheet of workBook.worksheets || []) {
        const headerMap = new Map<number, string>();
        worksheet.getRow(1).eachCell((cell, colNumber) => {
          const key = this.excelHeaderKey(cell.value);
          if (key) headerMap.set(colNumber, key);
        });
        if (headerMap.size === 0) {
          errors.push(`Sheet ${worksheet.name}: missing header row`);
          continue;
        }

        const lastRow = Math.max(worksheet.rowCount || 0, worksheet.actualRowCount || 0);
        for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
          const row = worksheet.getRow(rowNumber);
          const record: Record<string, any> = {};
          row.eachCell((cell, colNumber) => {
            const key = headerMap.get(colNumber);
            if (key) record[key] = cell.value;
          });
          const name = this.excelCellText(record.name);
          const make = this.excelCellText(record.make);
          const model = this.excelCellText(record.model);
          if (!name && !make && !model) continue;
          if (!name || !make || !model) {
            const missing = [
              !name ? "name" : null,
              !make ? "make" : null,
              !model ? "model" : null,
            ].filter(Boolean);
            errors.push(`Row ${rowNumber}: missing ${missing.join(", ")}`);
            continue;
          }

          const serial_number = getAccountFromCompany(
            name + make + model + dbCompany.id,
            "EG-"
          );
          const eg_serial_number =
            this.excelCellText(record.eg_serial_number) ||
            getAccountFromCompany(
              name +
                make +
                model +
                dbCompany.id +
                (this.excelCellText(record.specifications) || "") +
                (this.excelCellText(record.location) || ""),
              "EG-"
            );
          const frequency = this.excelCellText(record.tm_frequency) as tm_frequency;
          const equipmentData: any = {
            name,
            make,
            model,
            serial_number,
            eg_serial_number,
            specifications: this.excelCellText(record.specifications) || "",
            manufacturer_date: this.excelDate(record.manufacturer_date) ?? undefined,
            image_url: null,
            location: this.excelCellText(record.location) || "",
            description: this.excelCellText(record.description) || "",
            tm_frequency: frequency || undefined,
            company_link: dbCompany.id,
            created_by: "EG-Backend",
            updated_by: "EG-Backend",
            manual: "",
            is_active: true,
          };

          const existing = await prisma.equipment.findFirst({
            where: {
              OR: [
                { serial_number, make, model },
                { serial_number },
                { eg_serial_number, make, model },
              ],
            },
          });
          if (existing) {
            errors.push(
              `Row ${rowNumber}: equipment already exists (${name} / ${make} / ${model})`
            );
            continue;
          }
          await prisma.equipment.create({ data: equipmentData });
          created += 1;
        }
      }

      return res.status(200).send({
        status: 200,
        message: created
          ? `Data uploaded successfully (${created} equipment)`
          : errors.length
            ? "Upload finished with errors"
            : "No equipment rows found in the Excel file",
        errors,
      });
    } catch (e) {
      return res.status(200).send({
        status: HttpStatus.CONFLICT,
        message: `Failed to upload data ${e}`,
      });
    }
  }

  getValueAs<T>(row: any, key: string): T | undefined {
    const value = row.getCell(key).value;
    return value !== undefined ? (value as T) : undefined;
  }

  extractImageFromRow(worksheet, row) {
    let imageBuffer = null;
    worksheet.media.forEach((media) => {
      if (media.type === "image") {
        const range = media.range;
        const topLeftCell = worksheet.getCell(range.tl);
        const bottomRightCell = worksheet.getCell(range.br);

        // Check if the image overlaps the target cell's row
        if (this.isImageForRow(row, topLeftCell, bottomRightCell)) {
          imageBuffer = media.buffer;
          // fs.writeFileSync(`extracted_image_row${row.number}.png`, imageBuffer); // Optionally save the image
          // console.log(`Image extracted and saved as extracted_image_row${row.number}.png`);
        }
      }
    });

    return imageBuffer;
  }

  isImageForRow(row, topLeftCell, bottomRightCell) {
    const rowIndex = row.number;
    const startRow = topLeftCell.row;
    const endRow = bottomRightCell.row;

    return rowIndex >= startRow && rowIndex <= endRow;
  }

  ensureUploadPath(path: string): void {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  async sendNotification(
    tokens: string[],
    title: string,
    data: any,
    explicitUserIds?: number[]
  ): Promise<void> {
    const userIds = (
      explicitUserIds?.length
        ? explicitUserIds
        : await this.getUserIdsByTokens(tokens)
    ).filter((id) => id != null);
    const taskLink =
      data?.task_link != null ? parseInt(String(data.task_link), 10) : null;
    const description = String(data?.description || title || "Notification");

    for (const userId of userIds) {
      try {
        await prisma.notifications.create({
          data: {
            title,
            description,
            image_url: data?.image_url || "",
            task_link: Number.isNaN(taskLink) ? null : taskLink,
            user_link: userId,
            is_read: false,
            created_by: "EG-Backend",
            updated_by: "EG-Backend",
          },
        });
      } catch (error) {
        console.error("Failed to persist in-app notification", error);
      }
    }

    for (const token of (tokens || []).filter(Boolean)) {
      try {
        await this.firebaseService.sendNotification(token, title, data);
      } catch (error) {
        console.error("Failed to send push notification", error);
      }
    }
  }

  async companiesStats(res, req) {
    const now = moment();
    const months = [];

    // Generate an array of the last 12 months
    for (let i = 0; i < 12; i++) {
      months.push(now.clone().subtract(i, "months").startOf("month"));
    }

    const result = [];

    // Iterate through each month and get the company count
    for (const month of months) {
      const startOfMonth = month.toDate();
      const endOfMonth = month.clone().endOf("month").toDate();

      const count = await prisma.company.count({
        where: {
          created_at: {
            gte: startOfMonth,
            lt: endOfMonth,
          },
        },
      });

      result.push({
        month: month.format("YYYY-MM"),
        value: count,
      });
    }

    return res.status(200).send({
      status: 200,
      message: `Companies Onboarded for Last 12 Months`,
      data: result.reverse(), // reverse to start from the oldest month
    });
  }

  async getUserStats(res, req) {
    const accessLevels = [
      "client",
      "client_admin",
      "technician",
      "eg_admin",
      "eg_super_admin",
      "others",
    ];

    const result = await prisma.user.groupBy({
      by: ["access_level"],
      _count: {
        _all: true,
      },
    });

    // Initialize counts for all access levels to 0
    const accessLevelCounts = accessLevels.reduce((acc, level) => {
      acc[level] = 0;
      return acc;
    }, {});

    // Update the counts based on the query result
    result.forEach((entry) => {
      accessLevelCounts[entry.access_level] = entry._count._all;
    });

    // Convert the counts object to an array
    const response = Object.keys(accessLevelCounts).map((level) => ({
      access_level: level,
      count: accessLevelCounts[level],
    }));

    return res.status(200).send({
      status: 200,
      message: "User counts by access level",
      data: response,
    });
  }

  async getNotificationsByUserId(res, req) {
    const userId = req.body.user_link ?? req.user.sub;
    const notifications = await prisma.notifications.findMany({
      where: {
        user_link: userId,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    for (const notification of notifications) {
      const tasks = await prisma.tasks.findFirst({
        where: {
          id: notification?.task_link,
        },
        include: {
          task_user: {
            select: {
              technician_link: true,
              created_at: true,
            },
          },
        },
      });

      const filteredTaskUser = tasks?.task_user.filter(
        (user) => user.technician_link !== null
      );

      const oldestTechnicianLink = filteredTaskUser.length
        ? filteredTaskUser.reduce((oldest, user) => {
            return new Date(user.created_at) < new Date(oldest.created_at)
              ? user
              : oldest;
          }).technician_link
        : null;

      let technicianUser;
      if (oldestTechnicianLink != null) {
        technicianUser = await prisma.user.findUnique({
          where: {
            id: oldestTechnicianLink,
          },
          select: {
            name: true,
            phone: true,
          },
        });
      }

      notification["accepted_by"] = technicianUser ?? null;
    }

    return res.status(200).send({
      status: 200,
      message: "Notifications retrieved successfully",
      data: notifications,
    });
  }

  getFileUrl(filePath: string): string {
    // Assuming you have a base URL set up in your environment variables
    const baseUrl = process.env.BASE_URL || "http://localhost:8080";
    return `${baseUrl}/${filePath}`;
  }

  async getStatusOfTask(res, req) {
    const taskId = req.body.task_link;
    const task = await prisma.tasks.findUnique({
      where: {
        id: taskId,
      },
      include: {
        task_user: true,
      },
    });

    const allOpen = task.task_user.every(
      (x) => x.status === "open" && x.technician_link == null
    );
    const message = allOpen ? "Task is not accepted." : "Task is accepted.";

    return res.status(200).send({
      status: 200,
      message: message,
      is_accepted: !allOpen,
    });
  }

  async createTaskBasedOnTmFrequency() {
    const frequencyIntervals = {
      daily: { unit: "days", value: 1 },
      weekly: { unit: "weeks", value: 1 },
      biweekly: { unit: "weeks", value: 2 },
      monthly: { unit: "months", value: 1 },
      bi_monthly: { unit: "months", value: 2 },
      tri_monthly: { unit: "months", value: 3 },
      quarterly: { unit: "months", value: 3 },
      semi_annual: { unit: "months", value: 6 },
      annual: { unit: "years", value: 1 },
    };

    const equipments = await prisma.equipment.findMany();

    for (const equipment of equipments) {
      const { tm_frequency, created_at } = equipment;
      const interval = frequencyIntervals[tm_frequency];

      if (interval) {
        const lastTaskDate = moment(created_at);
        const today = moment().startOf("day");

        while (lastTaskDate.isBefore(today)) {
          lastTaskDate.add(
            interval.value,
            interval.unit as moment.unitOfTime.DurationConstructor
          );
          if (lastTaskDate.isSameOrBefore(today)) {
            // await prisma.task.create({
            //   data: {
            //     equipmentId: equipment.id,
            //     scheduledDate: lastTaskDate.toDate(),
            //     createdAt: new Date(),
            //   },
            // });
            // console.log(
            //   `task created for equipment ${equipment.id}, ${equipment.name}`,
            // );
          }
        }
      }
    }
  }
  catch(error) {
    console.error("Error creating tasks based on tm_frequency:", error);
  }
}
