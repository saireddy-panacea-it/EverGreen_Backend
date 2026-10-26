import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
  PrismaClient,
  equipment,
  user,
  status,
  access_level,
  tm_frequency,
  task_user,
  call_type,
  company,
  company_service_type,
  amc_type,
  equipment_status,
  approval_state,
  task_priority,
  pm_frequency,
  audit_action,
  audit_entity,
} from "@prisma/client";
import { writeAuditLog } from "../audit/audit-log";
import * as crypto from "crypto";
import puppeteer from "puppeteer";
import {
  getAccountFromCompany,
  mapAccessLevelToEnum,
  mapCallTypeToEnum,
  mapStatusToEnum,
} from "src/common";

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import * as path from "path";
import { buildServiceReportPdf } from "../service_report/build_pdf";
// exceljs is CommonJS; default import is undefined at runtime (Workbook crash)
const ExcelJS = require("exceljs");
import * as moment from "moment";
var QRCode = require("qrcode");
import { PDFDocument, rgb } from "pdf-lib";
import fs from "fs";
const prisma = new PrismaClient();
const SENIOR_DESIGNATION = "Senior Service Engineer";
const JUNIOR_DESIGNATION = "Junior Service Engineer";
const DESIGNATION_MESSAGE = `designation must be ${SENIOR_DESIGNATION} or ${JUNIOR_DESIGNATION}`;
import nodemailer from "nodemailer";
import { FirebaseService } from "../firebase/firebase.service"; // Update the import path as necessary
import { NotificationService, taskPlaceLabel } from "../notification/notification.service";
import serviceReportTemplate from "../service_report/service_report"; // billInvoice
import * as ejs from "ejs";
import axios from "axios";

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly notificationService: NotificationService,
  ) {}
  async createUser(res, req) {
    const actor = await this.loadActor(req);
    const requestedLevel = mapAccessLevelToEnum(req.body.access_level) ?? access_level.client;
    const permission = this.createUserDecision(
      actor?.access_level,
      actor?.companyIds ?? [],
      requestedLevel,
      this.isTechnicianRole(requestedLevel) ? [] : this.parseCompanyIds(req.body.company_link),
    );
    if (permission.allowed === false) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: permission.message });
    }
    const technicianRole = this.isTechnicianRole(req.body.access_level);
    const designation = this.normalizeTechnicianDesignation(req.body.designation);
    if (technicianRole && req.body.designation && !designation) {
      return res.status(HttpStatus.BAD_REQUEST).send({
        status: HttpStatus.BAD_REQUEST,
        message: DESIGNATION_MESSAGE,
      });
    }
    const user: user = {
      id: undefined,
      name: req.body.name,
      location: req.body.location ?? "",
      phone: req.body.phone,
      email: req.body.email,
      notes: req.body.notes,
      access_level: mapAccessLevelToEnum(req.body.access_level) ?? req.body.access_level,
      designation: technicianRole ? designation : null,
      pan_id: req.body.pan_id,
      aadhaar_id: req.body.aadhaar_id,
      permanent_address: req.body.permanent_address,
      created_at: undefined,
      created_by: req.body.phone,
      updated_at: undefined,
      updated_by: req.body.phone,
      password: req.body.password,
      is_active: true,
      bio: null,
      date_of_birth: null,
      avatar_url: null,
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
      const companyLinks = this.isTechnicianRole(req.body.access_level)
        ? []
        : permission.companyIds;
      if (companyLinks.length > 0) {
        for (const companyLink of companyLinks) {
          const dbCompanyUser = await prisma.company_user.findUnique({
            where: {
              user_link_company_link: {
                user_link: dbUser.id,
                company_link: companyLink,
              },
            },
          });

          if (dbCompanyUser == null) {
            await prisma.company_user.create({
              data: {
                user_link: dbUser.id,
                company_link: companyLink,
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
            companyLink: companyLinks.length ? companyLinks[0] : undefined,
            actorUserId: actor?.id,
          });
        }
      } catch (notifyError) {
        console.error("createUser notification failed", notifyError);
      }
      await this.auditFromReq(req, audit_action.created, audit_entity.user, dbUser.id, dbUser.name, `access_level=${dbUser.access_level}`);

      return res.status(200).send({
        status: 200,
        data: this.withoutPassword(dbUser),
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
    const userId = parseInt(id, 10);
    const existingUser = Number.isFinite(userId)
      ? await prisma.user.findFirst({ where: { id: userId } })
      : null;
    if (!existingUser) {
      return res.send({
        message: `user not found`,
        status: 404,
      });
    }

    const actor = await this.loadActor(req);
    const rawLevel = req.body.access_level;
    const requestedLevel =
      rawLevel != null && rawLevel !== "" ? mapAccessLevelToEnum(rawLevel) : undefined;
    if (rawLevel != null && rawLevel !== "" && !requestedLevel) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "Invalid access level" });
    }
    const requestedCompanyIds =
      req.body.company_link != null ? this.parseCompanyIds(req.body.company_link) : undefined;
    const permission = actor
      ? this.updateUserDecision(
          actor,
          {
            id: existingUser.id,
            access_level: existingUser.access_level,
            companyIds: await this.companyIdsOf(existingUser.id),
          },
          requestedLevel,
          requestedCompanyIds,
        )
      : ({ allowed: false, message: "You do not have access to update this user" } as const);
    if (permission.allowed === false) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: permission.message });
    }
    const selfOnly = permission.mode === "self";

    const nextAccessLevel = selfOnly
      ? existingUser.access_level
      : requestedLevel ?? existingUser.access_level;
    const designation = this.normalizeTechnicianDesignation(req.body.designation);
    if (
      this.isTechnicianRole(nextAccessLevel) &&
      req.body.designation &&
      !designation
    ) {
      return res.status(HttpStatus.BAD_REQUEST).send({
        status: HttpStatus.BAD_REQUEST,
        message: DESIGNATION_MESSAGE,
      });
    }
    if (req.body.password && String(req.body.password).length > 20) {
      return res.send({
        status: HttpStatus.BAD_REQUEST,
        message: "Password must be at most 20 characters",
      });
    }
    if (req.body.email && String(req.body.email).trim() !== "") {
      const emailTaken = await prisma.user.findFirst({
        where: {
          email: { equals: String(req.body.email).trim(), mode: "insensitive" },
          NOT: { id: userId },
        },
      });
      if (emailTaken) {
        return res.send({
          status: 204,
          message: "This email is already used by another user",
        });
      }
    }
    if (req.body.phone && String(req.body.phone).trim() !== existingUser.phone) {
      const phoneTaken = await prisma.user.findFirst({
        where: { phone: String(req.body.phone).trim(), NOT: { id: userId } },
      });
      if (phoneTaken) {
        return res.send({
          status: 204,
          message: `user already exists with phone ${phoneTaken.phone}`,
        });
      }
    }
    const dateOfBirth = this.parseOptionalDate(req.body.date_of_birth);
    if (dateOfBirth === "invalid") {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "date_of_birth must be an ISO date" });
    }
    const user = {
      name: req.body.name ?? existingUser?.name,
      location: req.body.location ?? existingUser?.location,
      access_level: nextAccessLevel,
      designation: this.isTechnicianRole(nextAccessLevel)
        ? designation ?? existingUser.designation
        : null,
      email: req.body.email ?? existingUser?.email,
      phone: req.body.phone ?? existingUser?.phone,
      updated_by: req.user?.phone ?? existingUser?.phone,
      password: req.body.password || existingUser?.password,
      bio: req.body.bio !== undefined ? (req.body.bio == null ? null : String(req.body.bio)) : undefined,
      date_of_birth: dateOfBirth,
      avatar_url:
        req.body.avatar_url !== undefined
          ? req.body.avatar_url == null || req.body.avatar_url === "" ? null : String(req.body.avatar_url)
          : undefined,
    };
    const dbUser = await prisma.user.update({
      where: {
        id: userId,
      },
      data: user,
    });
    if (dbUser == null) {
      return res.send({
        status: 204,
        message: `no user updated.`,
      });
    }

    if (!selfOnly) {
      if (this.isTechnicianRole(dbUser.access_level)) {
        await prisma.company_user.deleteMany({
          where: { user_link: dbUser.id },
        });
      } else if (requestedCompanyIds?.length > 0) {
        const existingCompanyIds = await this.companyIdsOf(dbUser.id);
        const companiesToAdd = requestedCompanyIds.filter(
          (companyId) => !existingCompanyIds.includes(companyId)
        );
        // A client admin can only unlink companies they manage themselves.
        const companiesToRemove = existingCompanyIds.filter(
          (companyId) =>
            !requestedCompanyIds.includes(companyId) &&
            (permission.mode === "admin" || actor.companyIds.includes(companyId))
        );

        for (const companyId of companiesToAdd) {
          await prisma.company_user.create({
            data: {
              user_link: dbUser.id,
              company_link: companyId,
            },
          });
        }

        if (companiesToRemove.length > 0) {
          await prisma.company_user.deleteMany({
            where: {
              user_link: dbUser.id,
              company_link: { in: companiesToRemove },
            },
          });
        }
      }
    }
    await this.recordAudit(
      actor,
      audit_action.updated,
      audit_entity.user,
      dbUser.id,
      dbUser.name,
      selfOnly ? "profile updated" : `access_level=${dbUser.access_level}`,
    );
    return res.status(200).send({
      status: 200,
      data: this.withoutPassword(dbUser),
      message: "user updated succesfully",
    });
  }

  async setUserActive(res, req) {
    const userId = parseInt(String(req.body?.user_link ?? ""), 10);
    const isActive = this.parseBoolean(req.body?.is_active);
    if (!Number.isFinite(userId) || isActive == null) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "user_link and is_active (true/false) are required" });
    }
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return res.send({ status: HttpStatus.NO_CONTENT, message: "User not found" });
    }
    const actor = await this.loadActor(req);
    const permission = actor
      ? this.setUserActiveDecision(actor, {
          id: target.id,
          access_level: target.access_level,
          companyIds: await this.companyIdsOf(target.id),
        })
      : ({ allowed: false, message: "You do not have access to change the status of this user" } as const);
    if (permission.allowed === false) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: permission.message });
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { is_active: isActive, updated_at: new Date(), updated_by: req.user?.phone },
    });
    await this.recordAudit(
      actor,
      audit_action.updated,
      audit_entity.user,
      updated.id,
      updated.name,
      isActive ? "activated" : "deactivated",
    );
    return res.status(200).send({
      status: 200,
      message: isActive ? "user activated" : "user deactivated",
      data: this.withoutPassword(updated),
    });
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
      const companyAddress = String(req.body.company_location ?? "").trim();
      const gstNumber = String(req.body.gst_number ?? "").trim().toUpperCase();
      if (!companyName) {
        return res.send({ message: "Please enter company name", status: HttpStatus.BAD_REQUEST });
      }
      if (!branchName) {
        return res.send({ message: "Please enter branch name", status: HttpStatus.BAD_REQUEST });
      }
      if (!companyAddress) {
        return res.send({ message: "Please enter company address", status: HttpStatus.BAD_REQUEST });
      }
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstNumber)) {
        return res.send({ message: "Please enter a valid GST number", status: HttpStatus.BAD_REQUEST });
      }

      const serviceTerms = this.resolveCompanyServiceTerms(req.body);
      if ("error" in serviceTerms) {
        return res.send({ message: serviceTerms.error, status: HttpStatus.BAD_REQUEST });
      }

      const adminName = String(req.body.name ?? "").trim();
      const mobile = String(req.body.phone ?? "").trim();
      const adminEmail = String(req.body.email ?? "").trim();
      const adminPassword = String(req.body.password ?? "").trim();
      const hasClientAdminDetails = [adminName, mobile, adminEmail, adminPassword].some(Boolean);
      if (hasClientAdminDetails && (!adminName || !mobile || !adminEmail || !adminPassword)) {
        return res.send({
          message: "Please provide all client admin details or leave them all empty",
          status: HttpStatus.BAD_REQUEST,
        });
      }

      let userData: user | null = null;
      if (hasClientAdminDetails) {
        const mobileRegex = /^(\+\d{1,3}[- ]?)?\d{10}$/;
        if (!mobileRegex.test(mobile)) {
          return res.send({ message: "Please enter valid mobile number", status: HttpStatus.BAD_REQUEST });
        }
        userData = {
          id: undefined,
          name: adminName,
          location: String(req.body.location ?? companyAddress).trim(),
          phone: mobile,
          email: adminEmail,
          notes: req.body.notes,
          password: adminPassword,
          access_level: access_level.client_admin,
          designation: null,
          pan_id: "",
          aadhaar_id: "",
          permanent_address: "",
          created_at: undefined,
          created_by: userPhone,
          updated_at: undefined,
          updated_by: userPhone,
          is_active: true,
          bio: null,
          date_of_birth: null,
          avatar_url: null,
        };

        const existingUser = await prisma.user.findFirst({ where: { phone: mobile } });
        if (existingUser) {
          return res.send({
            message: `user already exists with phone ${existingUser.phone}`,
            status: HttpStatus.NO_CONTENT,
          });
        }
        const existingEmail = await prisma.user.findFirst({
          where: { email: { equals: adminEmail, mode: "insensitive" } },
        });
        if (existingEmail) {
          return res.send({
            message: "This email is already used by another user",
            status: HttpStatus.NO_CONTENT,
          });
        }
      }

      const companyData = {
        id: undefined,
        name: companyName,
        branch_name: branchName,
        email: req.body.company_email,
        service_type: serviceTerms.service_type,
        amc_type: serviceTerms.amc_type,
        start_date: serviceTerms.start_date,
        end_date: serviceTerms.end_date,
        location: companyAddress,
        gst_number: gstNumber,
        logo: req.body.logo,
        created_at: undefined,
        created_by: userPhone,
        updated_at: undefined,
        updated_by: userPhone,
        address_link: null,
      };

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

      const created = await prisma.$transaction(async (transaction) => {
        const company = await transaction.company.create({ data: companyData });
        if (!userData) return { company, admin: null };
        const admin = await transaction.user.create({ data: userData });
        await transaction.company_user.create({
          data: { company_link: company.id, user_link: admin.id },
        });
        return { company, admin };
      });
      const dbCompany = created.company;
      const dbUser = created.admin;

      try {
        if (dbUser?.email.trim() && dbUser.password.trim()) {
          await this.notificationService.sendCredentialsEmail(dbUser);
        }
        await this.notificationService.onNewAmc({
          companyName: dbCompany.name,
          managerName: dbUser?.name ?? "No client admin assigned",
          location: dbCompany.location,
        });
      } catch (notifyError) {
        console.error("createCompany notification failed", notifyError);
      }
      await this.auditFromReq(req, audit_action.created, audit_entity.amc, dbCompany.id, this.companyLabel(dbCompany));
      if (dbUser) {
        await this.auditFromReq(req, audit_action.created, audit_entity.user, dbUser.id, dbUser.name, "client admin for new AMC");
      }

      return res.status(200).send({
        message: "company created successfully",
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
      const gstNumber = String(req.body.gst_number ?? "").trim().toUpperCase();

      if (companyName.length === 0) {
        return res.send({
          message: "Please enter company name",
          status: HttpStatus.BAD_REQUEST,
        });
      }
      if (branchName.length === 0) {
        return res.send({
          message: "Please enter branch name",
          status: HttpStatus.BAD_REQUEST,
        });
      }
      if (gstNumber && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstNumber)) {
        return res.send({
          message: "Please enter a valid GST number",
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

      let serviceType = existingCompany.service_type;
      let amcType = existingCompany.amc_type;
      if (this.hasBodyValue(req.body.service_type) || existingCompany.service_type) {
        const serviceTerms = this.resolveCompanyServiceTerms(req.body, existingCompany);
        if ("error" in serviceTerms) {
          return res.send({ message: serviceTerms.error, status: HttpStatus.BAD_REQUEST });
        }
        serviceType = serviceTerms.service_type;
        amcType = serviceTerms.amc_type;
        parsedStartDate = serviceTerms.start_date;
        parsedEndDate = serviceTerms.end_date;
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

      const clientAdminPlan = await this.planCompanyClientAdmin(
        req,
        companyId,
        userInfo,
        existingCompany.location,
      );
      if ("error" in clientAdminPlan) {
        return res.send({ message: clientAdminPlan.error, status: clientAdminPlan.status });
      }

      const updatedCompany = await prisma.$transaction(async (tx) => {
        if (clientAdminPlan.kind === "update") {
          await tx.user.update({
            where: { id: clientAdminPlan.userId },
            data: clientAdminPlan.data,
          });
        } else if (clientAdminPlan.kind === "create") {
          const admin = await tx.user.create({ data: clientAdminPlan.data });
          await tx.company_user.create({
            data: { company_link: companyId, user_link: admin.id },
          });
        }
        return tx.company.update({
          where: { id: companyId },
          data: {
            name: companyName,
            branch_name: branchName,
            email: String(req.body.company_email ?? existingCompany.email ?? ""),
            location: String(
              req.body.company_location ?? existingCompany.location ?? ""
            ),
            gst_number: gstNumber || existingCompany.gst_number,
            logo: String(req.body.logo ?? existingCompany.logo ?? ""),
            service_type: serviceType,
            amc_type: amcType,
            start_date: serviceType ? parsedStartDate : parsedStartDate ?? undefined,
            end_date: serviceType ? parsedEndDate : parsedEndDate ?? undefined,
            updated_by: req.user.phone,
          },
        });
      });

      if (clientAdminPlan.kind === "create") {
        try {
          await this.notificationService.sendCredentialsEmail(clientAdminPlan.data);
        } catch (notifyError) {
          console.error("updateCompany credentials email failed", notifyError);
        }
      }
      await this.recordAudit(userInfo, audit_action.updated, audit_entity.amc, updatedCompany.id, this.companyLabel(updatedCompany));

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

  private async planCompanyClientAdmin(
    req,
    companyId: number,
    userInfo,
    companyLocation: string | null,
  ): Promise<
    | { kind: "none" }
    | { kind: "update"; userId: number; data: Partial<user> }
    | { kind: "create"; data: user }
    | { error: string; status: number }
  > {
    const adminName = String(req.body.name ?? "").trim();
    const mobile = String(req.body.phone ?? "").trim();
    const adminEmail = String(req.body.email ?? "").trim();
    const adminPassword = String(req.body.password ?? "").trim();
    if (![adminName, mobile, adminEmail, adminPassword].some(Boolean)) {
      return { kind: "none" };
    }

    const isAdmin = this.adminOrNot(userInfo?.access_level);
    const isLinkedClientAdmin =
      userInfo?.access_level === access_level.client_admin &&
      this.attachedCompanyIds(userInfo).includes(companyId);
    if (!isAdmin && !isLinkedClientAdmin) {
      return {
        error: "Only admins or the company's client admin can change client admin details",
        status: HttpStatus.FORBIDDEN,
      };
    }

    const mobileRegex = /^(\+\d{1,3}[- ]?)?\d{10}$/;
    if (mobile && !mobileRegex.test(mobile)) {
      return { error: "Please enter valid mobile number", status: HttpStatus.BAD_REQUEST };
    }
    if (adminPassword.length > 20) {
      return { error: "Password must be at most 20 characters", status: HttpStatus.BAD_REQUEST };
    }

    const linked = await prisma.company_user.findFirst({
      where: {
        company_link: companyId,
        user: { access_level: access_level.client_admin },
      },
      orderBy: { assigned_at: "asc" },
      select: { user_link: true },
    });
    const excludeId = linked?.user_link;

    if (mobile) {
      const phoneTaken = await prisma.user.findFirst({
        where: { phone: mobile, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      });
      if (phoneTaken) {
        return {
          error: `user already exists with phone ${phoneTaken.phone}`,
          status: HttpStatus.NO_CONTENT,
        };
      }
    }
    if (adminEmail) {
      const emailTaken = await prisma.user.findFirst({
        where: {
          email: { equals: adminEmail, mode: "insensitive" },
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
      });
      if (emailTaken) {
        return { error: "This email is already used by another user", status: HttpStatus.NO_CONTENT };
      }
    }

    if (excludeId) {
      const data: Partial<user> = { updated_by: req.user.phone, updated_at: new Date() };
      if (adminName) data.name = adminName;
      if (mobile) data.phone = mobile;
      if (adminEmail) data.email = adminEmail;
      if (adminPassword) data.password = adminPassword;
      return { kind: "update", userId: excludeId, data };
    }

    if (!adminName || !mobile || !adminEmail || !adminPassword) {
      return {
        error: "Please provide all client admin details or leave them all empty",
        status: HttpStatus.BAD_REQUEST,
      };
    }
    return {
      kind: "create",
      data: {
        id: undefined,
        name: adminName,
        location: String(req.body.location ?? companyLocation ?? "").trim(),
        phone: mobile,
        email: adminEmail,
        notes: req.body.notes,
        password: adminPassword,
        access_level: access_level.client_admin,
        designation: null,
        pan_id: "",
        aadhaar_id: "",
        permanent_address: "",
        created_at: undefined,
        created_by: req.user.phone,
        updated_at: undefined,
        updated_by: req.user.phone,
        is_active: true,
        bio: null,
        date_of_birth: null,
        avatar_url: null,
      },
    };
  }

  async deleteCompany(res, req) {
    const action = String(req.body.action ?? "").trim().toLowerCase();
    return this.toggleCompanyActive(res, req, action === "activate");
  }

  async setCompanyActive(res, req) {
    const raw = req.body.is_active;
    if (typeof raw !== "boolean" && raw !== "true" && raw !== "false") {
      return res.send({
        message: "is_active must be true or false",
        status: HttpStatus.BAD_REQUEST,
      });
    }
    return this.toggleCompanyActive(res, req, raw === true || raw === "true");
  }

  private async toggleCompanyActive(res, req, isActive: boolean) {
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
            message: "You do not have access to change this company",
            status: HttpStatus.FORBIDDEN,
          });
        }
      }

      const company = await prisma.company.update({
        where: { id: companyId },
        data: {
          is_active: isActive,
          updated_at: new Date(),
          updated_by: req.user.phone,
        },
      });
      await this.recordAudit(
        userInfo,
        isActive ? audit_action.updated : audit_action.deleted,
        audit_entity.amc,
        company.id,
        this.companyLabel(company),
        isActive ? "activated" : "deactivated",
      );

      return res.status(200).send({
        status: 200,
        message: isActive ? "company activated" : "company deactivated",
        data: company,
      });
    } catch (error) {
      console.error("toggleCompanyActive failed", error);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
        message: "Unable to update company status. Please try again.",
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
    const userInfo = await this.findOne(req.user.phone);
    const unrestricted =
      this.adminOrNot(userInfo?.access_level) ||
      this.isTechnicianRole(userInfo?.access_level);
    const ownCompanyIds = getCompanyLinks.map((x) => x.company_link);
    if (
      companyLink != null &&
      companyLink !== "" &&
      !unrestricted &&
      !ownCompanyIds.includes(parseInt(String(companyLink), 10))
    ) {
      return res.send({
        status: HttpStatus.FORBIDDEN,
        message: "You do not have access to this company's equipment",
      });
    }
    let equipments;
    const includeCompany = { company: true };
    if (equipment_link || companyLink) {
      equipments = await prisma.equipment.findMany({
        where: {
          id: equipment_link ?? undefined,
          company_link: companyLink ?? (unrestricted ? undefined : { in: ownCompanyIds }),
        },
        include: includeCompany,
      });
    } else {
      const isAdmin = this.adminOrNot(userInfo?.access_level);
      equipments = await prisma.equipment.findMany({
        where: isAdmin
          ? undefined
          : { company_link: { in: ownCompanyIds } },
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

  attachedCompanyIds(userInfo): number[] {
    return (userInfo?.company_user || [])
      .map((link) => link.company_link)
      .filter((id) => id != null);
  }

  isTechnicianRole(level): boolean {
    return (
      level === access_level.technician ||
      String(level || "").toLowerCase() === "technician"
    );
  }

  coerceRating(value): number | undefined {
    if (value == null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.max(0, Math.min(5, Math.round(parsed)));
  }

  canAccessCompany(userInfo, companyLink): boolean {
    if (!userInfo) return false;
    if (this.adminOrNot(userInfo.access_level)) return true;
    if (userInfo.access_level === access_level.technician) return true;
    const requested = parseInt(String(companyLink ?? ""), 10);
    return this.attachedCompanyIds(userInfo).includes(requested);
  }

  withoutPassword<T>(row: T): Omit<T, "password"> {
    if (!row || typeof row !== "object") return row as Omit<T, "password">;
    const { password, ...rest } = row as T & { password?: unknown };
    return rest as Omit<T, "password">;
  }

  parseCompanyIds(value): number[] {
    const list = Array.isArray(value) ? value : value != null && value !== "" ? [value] : [];
    return list
      .map((id) => parseInt(String(id), 10))
      .filter((id) => Number.isFinite(id));
  }

  private isClientRole(level): boolean {
    return level === access_level.client || level === access_level.client_admin;
  }

  private sharesCompany(left: number[], right: number[]): boolean {
    return left.some((id) => right.includes(id));
  }

  private createUserDecision(
    actorLevel: access_level | undefined,
    actorCompanyIds: number[],
    requestedLevel: access_level,
    requestedCompanyIds: number[],
  ): { allowed: true; companyIds: number[] } | { allowed: false; message: string } {
    if (this.adminOrNot(actorLevel)) {
      if (
        requestedLevel === access_level.eg_super_admin &&
        actorLevel !== access_level.eg_super_admin
      ) {
        return { allowed: false, message: "Only a super admin can create a super admin" };
      }
      return { allowed: true, companyIds: requestedCompanyIds };
    }
    if (actorLevel === access_level.client_admin) {
      if (!this.isClientRole(requestedLevel)) {
        return { allowed: false, message: "Client admins can only create client or client admin users" };
      }
      if (actorCompanyIds.length === 0) {
        return { allowed: false, message: "You are not linked to any company" };
      }
      if (requestedCompanyIds.some((id) => !actorCompanyIds.includes(id))) {
        return { allowed: false, message: "You can only add users to your own companies" };
      }
      return {
        allowed: true,
        companyIds: requestedCompanyIds.length ? requestedCompanyIds : actorCompanyIds,
      };
    }
    return { allowed: false, message: "You do not have access to create users" };
  }

  private updateUserDecision(
    actor: { id: number; access_level: access_level; companyIds: number[] },
    target: { id: number; access_level: access_level; companyIds: number[] },
    requestedLevel: access_level | undefined,
    requestedCompanyIds: number[] | undefined,
  ): { allowed: true; mode: "admin" | "self" | "client_admin" } | { allowed: false; message: string } {
    if (this.adminOrNot(actor.access_level)) {
      const isSuper = actor.access_level === access_level.eg_super_admin;
      const touchesSuper =
        (requestedLevel === access_level.eg_super_admin && target.access_level !== access_level.eg_super_admin) ||
        (target.access_level === access_level.eg_super_admin && requestedLevel != null && requestedLevel !== access_level.eg_super_admin);
      if (touchesSuper && !isSuper) {
        return { allowed: false, message: "Only a super admin can grant or revoke super admin access" };
      }
      return { allowed: true, mode: "admin" };
    }
    if (actor.id === target.id) {
      return { allowed: true, mode: "self" };
    }
    if (actor.access_level === access_level.client_admin) {
      if (!this.isClientRole(target.access_level) || !this.sharesCompany(actor.companyIds, target.companyIds)) {
        return { allowed: false, message: "You do not have access to update this user" };
      }
      if (requestedLevel != null && !this.isClientRole(requestedLevel)) {
        return { allowed: false, message: "Client admins can only assign client or client admin access" };
      }
      if (requestedCompanyIds?.some((id) => !actor.companyIds.includes(id))) {
        return { allowed: false, message: "You can only link users to your own companies" };
      }
      return { allowed: true, mode: "client_admin" };
    }
    return { allowed: false, message: "You do not have access to update this user" };
  }

  private deleteUserDecision(
    actor: { id: number; access_level: access_level; companyIds: number[] },
    target: { id: number; access_level: access_level; companyIds: number[] },
  ): { allowed: true } | { allowed: false; message: string } {
    return this.manageUserDecision(actor, target, "delete");
  }

  private setUserActiveDecision(
    actor: { id: number; access_level: access_level; companyIds: number[] },
    target: { id: number; access_level: access_level; companyIds: number[] },
  ): { allowed: true } | { allowed: false; message: string } {
    return this.manageUserDecision(actor, target, "change the status of");
  }

  private manageUserDecision(
    actor: { id: number; access_level: access_level; companyIds: number[] },
    target: { id: number; access_level: access_level; companyIds: number[] },
    verb: string,
  ): { allowed: true } | { allowed: false; message: string } {
    if (actor.id === target.id) {
      return { allowed: false, message: `You cannot ${verb} your own account` };
    }
    if (this.adminOrNot(actor.access_level)) {
      if (target.access_level === access_level.eg_super_admin && actor.access_level !== access_level.eg_super_admin) {
        return { allowed: false, message: `Only a super admin can ${verb} a super admin` };
      }
      return { allowed: true };
    }
    if (
      actor.access_level === access_level.client_admin &&
      this.isClientRole(target.access_level) &&
      this.sharesCompany(actor.companyIds, target.companyIds)
    ) {
      return { allowed: true };
    }
    return { allowed: false, message: `You do not have access to ${verb} this user` };
  }

  private taskManageDecision(
    actor: { id: number; access_level: access_level; companyIds: number[] },
    raisedBy: number | null | undefined,
    taskCompanyLink: number | null | undefined,
  ): boolean {
    if (this.adminOrNot(actor.access_level)) return true;
    if (this.isTechnicianRole(actor.access_level)) return false;
    if (raisedBy != null && raisedBy === actor.id) return true;
    return (
      actor.access_level === access_level.client_admin &&
      taskCompanyLink != null &&
      actor.companyIds.includes(taskCompanyLink)
    );
  }

  private async taskAccessDenied(req, task, verb: "update" | "delete"): Promise<string | null> {
    const actor = await this.loadActor(req);
    if (!actor) return `You do not have access to ${verb} this task`;
    if (this.isTechnicianRole(actor.access_level)) {
      return `Service engineers cannot ${verb} tasks`;
    }
    const [raiser, equipment] = await Promise.all([
      prisma.task_user.findFirst({
        where: { task_link: task.id },
        orderBy: [{ updated_at: "desc" }, { id: "desc" }],
        select: { client_link: true },
      }),
      task.equipment_link != null
        ? prisma.equipment.findUnique({
            where: { id: task.equipment_link },
            select: { company_link: true },
          })
        : null,
    ]);
    return this.taskManageDecision(actor, raiser?.client_link, equipment?.company_link)
      ? null
      : `You do not have access to ${verb} this task`;
  }

  private async loadActor(req) {
    const actor = await this.findOne(req.user?.phone);
    if (!actor) return null;
    return {
      id: actor.id,
      access_level: actor.access_level,
      companyIds: this.attachedCompanyIds(actor),
      name: actor.name,
      designation: actor.designation,
    };
  }

  isSeniorTechnician(level, designation): boolean {
    return (
      this.isTechnicianRole(level) &&
      String(designation ?? "").trim().toLowerCase() === "senior service engineer"
    );
  }

  /** Admins and senior technicians triage tickets: approve, reject, assign, unassign. */
  canTriage(actor: { access_level?: access_level | string; designation?: string | null } | null): boolean {
    if (!actor) return false;
    return this.adminOrNot(actor.access_level) || this.isSeniorTechnician(actor.access_level, actor.designation);
  }

  private auditRoleLabel(level, designation): string {
    if (this.isSeniorTechnician(level, designation)) return "senior_technician";
    return String(level ?? "unknown");
  }

  /** Approval a ticket gets when it is raised: client-side raisers need approval first. */
  approvalOnCreate(level): approval_state {
    return this.adminOrNot(level) || this.isTechnicianRole(level)
      ? approval_state.approved
      : approval_state.requested;
  }

  /** Approval implied by the latest task_user status (same mapping as the migration backfill). */
  approvalForTaskStatus(taskStatus: status | string | null | undefined, hasTechnician: boolean): approval_state | null {
    switch (taskStatus) {
      case status.open:
        return hasTechnician ? approval_state.assigned : approval_state.approved;
      case status.hold:
      case status.in_progress:
        return approval_state.in_service;
      case status.completed:
        return approval_state.completed;
      case status.closed:
        return approval_state.confirmed;
      default:
        return null;
    }
  }

  /** Explicit approval actions; returns the next state, or null when the action is not allowed from `current`. */
  nextApprovalState(
    action: "approve" | "reject" | "unassign",
    current: approval_state | string | null | undefined,
  ): approval_state | null {
    switch (action) {
      case "approve":
        return current === approval_state.requested ? approval_state.approved : null;
      case "reject":
        return current === approval_state.requested ? approval_state.rejected : null;
      case "unassign":
        return current === approval_state.assigned ||
          current === approval_state.in_service ||
          current === approval_state.approved
          ? approval_state.approved
          : null;
      default:
        return null;
    }
  }

  normalizePmFrequency(value: unknown): pm_frequency | null {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (normalized === "monthly") return pm_frequency.monthly;
    if (normalized === "quarterly") return pm_frequency.quarterly;
    if (normalized === "half_yearly" || normalized === "halfyearly" || normalized === "semi_annual") {
      return pm_frequency.half_yearly;
    }
    if (normalized === "yearly" || normalized === "annual") return pm_frequency.yearly;
    return null;
  }

  /** Next PM due date: calendar months in UTC; month-end dates clamp (Jan 31 + 1 month = Feb 28/29). */
  advancePmDueDate(due: Date, frequency: pm_frequency): Date {
    const months = {
      [pm_frequency.monthly]: 1,
      [pm_frequency.quarterly]: 3,
      [pm_frequency.half_yearly]: 6,
      [pm_frequency.yearly]: 12,
    }[frequency];
    return moment.utc(due).add(months, "months").toDate();
  }

  /** Admins read every audit row; client admins only rows whose actor shares one of their companies. */
  auditScopeDecision(
    actor: { access_level: access_level | string; companyIds: number[] } | null,
  ): { scope: "all" } | { scope: "companies"; companyIds: number[] } | { scope: "none" } {
    if (!actor) return { scope: "none" };
    if (this.adminOrNot(actor.access_level)) return { scope: "all" };
    if (actor.access_level === access_level.client_admin && actor.companyIds.length > 0) {
      return { scope: "companies", companyIds: actor.companyIds };
    }
    return { scope: "none" };
  }

  /** An individual task has no equipment, hence no company; it carries contact_name / contact_phone / address. */
  isIndividualTask(task: { equipment_link?: number | null } | null | undefined): boolean {
    return task != null && task.equipment_link == null;
  }

  individualTaskCreateDenied(level: access_level | string | null | undefined): string | null {
    return level === access_level.eg_super_admin || level === access_level.eg_admin
      ? null
      : "Only admins can create individual tasks";
  }

  /**
   * Contact block of an individual task. Values missing from `body` fall back to `existing`;
   * every field must end up non-empty and the phone must be 10-15 digits with an optional leading +.
   */
  individualTaskContact(
    body: Record<string, unknown>,
    existing?: { name?: string | null; contact_name?: string | null; contact_phone?: string | null; address?: string | null } | null,
  ):
    | { error: string }
    | { name: string; contact_name: string; contact_phone: string; address: string } {
    const pick = (key: "name" | "contact_name" | "contact_phone" | "address") =>
      String((body?.[key] !== undefined && body?.[key] !== null ? body[key] : existing?.[key]) ?? "").trim();
    const values = {
      name: pick("name"),
      contact_name: pick("contact_name"),
      contact_phone: pick("contact_phone").replace(/[\s-]/g, ""),
      address: pick("address"),
    };
    const missing = (Object.keys(values) as Array<keyof typeof values>).filter((key) => !values[key]);
    if (missing.length) {
      return {
        error: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required for an individual task`,
      };
    }
    if (!/^\+?\d{10,15}$/.test(values.contact_phone)) {
      return { error: "contact_phone must be 10 to 15 digits with an optional leading +" };
    }
    return values;
  }

  /** Task list visibility; tasks without a company (individual tasks) never match a client's companies. */
  taskListVisible(
    viewer: { id: number; access_level: access_level | string; designation?: string | null },
    taskUser: { technician_link?: number | null; task?: { equipment?: { company_link?: number | null } | null } | null },
    companyLinks: number[],
  ): boolean {
    if (this.isSeniorTechnician(viewer.access_level, viewer.designation)) return true;
    if (viewer.access_level === access_level.technician) {
      return taskUser.technician_link != null && taskUser.technician_link == viewer.id;
    }
    if (viewer.access_level === access_level.client || viewer.access_level === access_level.client_admin) {
      const companyLink = taskUser.task?.equipment?.company_link;
      return companyLink != null && companyLinks.includes(companyLink);
    }
    return true;
  }

  /** Who may see a ticket: triage roles all, technicians their assignment, client side their companies. */
  canSeeTask(
    actor: { id: number; access_level: access_level | string; designation?: string | null; companyIds: number[] } | null,
    technicianLink: number | null | undefined,
    companyLink: number | null | undefined,
  ): boolean {
    if (!actor) return false;
    if (this.canTriage(actor)) return true;
    if (this.isTechnicianRole(actor.access_level)) return technicianLink != null && technicianLink === actor.id;
    return companyLink != null && actor.companyIds.includes(companyLink);
  }

  async recordAudit(
    actor: { id?: number; name?: string | null; access_level?: access_level | string; designation?: string | null } | null,
    action: audit_action,
    entity: audit_entity,
    entityId: string | number | null | undefined,
    entityName: string | null | undefined,
    details?: string | null,
  ): Promise<void> {
    await writeAuditLog(prisma, {
      actorLink: actor?.id ?? null,
      actorName: actor?.name || "System",
      actorRole: actor ? this.auditRoleLabel(actor.access_level, actor.designation) : "system",
      action,
      entity,
      entityId,
      entityName: entityName || "-",
      details,
    });
  }

  private async auditFromReq(
    req,
    action: audit_action,
    entity: audit_entity,
    entityId: string | number | null | undefined,
    entityName: string | null | undefined,
    details?: string | null,
  ): Promise<void> {
    try {
      const actor = await this.findOne(req.user?.phone);
      await this.recordAudit(actor, action, entity, entityId, entityName, details);
    } catch (error) {
      console.error("audit actor lookup failed", error?.message || error);
    }
  }

  private parseOptionalDate(value: unknown): Date | null | undefined | "invalid" {
    if (value === undefined) return undefined;
    if (value === null || String(value).trim() === "") return null;
    const parsed = new Date(String(value));
    return isNaN(parsed.getTime()) ? "invalid" : parsed;
  }

  private normalizePriority(value: unknown): task_priority | null {
    const normalized = String(value ?? "").trim().toLowerCase();
    return (Object.values(task_priority) as string[]).includes(normalized)
      ? (normalized as task_priority)
      : null;
  }

  private normalizeEquipmentStatus(value: unknown): equipment_status | null {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return (Object.values(equipment_status) as string[]).includes(normalized)
      ? (normalized as equipment_status)
      : null;
  }

  private companyLabel(company: { name?: string | null; branch_name?: string | null } | null): string {
    return [company?.name, company?.branch_name].filter(Boolean).join(" - ") || "-";
  }

  private parseBoolean(value: unknown): boolean | null {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return null;
  }

  private async companyIdsOf(userId: number): Promise<number[]> {
    const links = await prisma.company_user.findMany({
      where: { user_link: userId },
      select: { company_link: true },
    });
    return links.map((link) => link.company_link);
  }

  /**
   * Admins manage any equipment; clients and client admins only their own
   * companies' equipment; technicians never. Returns a refusal message or null.
   */
  private async equipmentWriteDenied(req, companyId): Promise<string | null> {
    const actor = await this.loadActor(req);
    if (!actor) return "Please login again";
    if (this.adminOrNot(actor.access_level)) return null;
    if (this.isTechnicianRole(actor.access_level)) {
      return "Service engineers cannot manage equipment";
    }
    const id = parseInt(String(companyId), 10);
    if (!Number.isFinite(id) || !actor.companyIds.includes(id)) {
      return "You do not have access to this company's equipment";
    }
    return null;
  }

  async createEquipment(res, req) {
    try {
      const companyLink = req.body.company_link;
      const denied = await this.equipmentWriteDenied(req, companyLink);
      if (denied) {
        return res.send({ status: HttpStatus.FORBIDDEN, message: denied });
      }
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

      const equipmentStatus = this.hasBodyValue(req.body.status)
        ? this.normalizeEquipmentStatus(req.body.status)
        : equipment_status.operational;
      const installedAt = this.parseOptionalDate(req.body.installed_at);
      if (!equipmentStatus) {
        return res.send({
          status: HttpStatus.BAD_REQUEST,
          message: "status must be operational, under_maintenance, faulty or retired",
        });
      }
      if (installedAt === "invalid") {
        return res.send({ status: HttpStatus.BAD_REQUEST, message: "installed_at must be an ISO date" });
      }

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
          status: equipmentStatus,
          type: this.hasBodyValue(req.body.type) ? String(req.body.type).trim() : null,
          installed_at: installedAt ?? null,
          verified_at: null,
          verified_by: null,
        };

        console.log(equipment);
        const dbEquipment = await prisma.equipment.create({
          data: equipment,
        });

        if (dbEquipment != null) {
          await this.auditFromReq(req, audit_action.created, audit_entity.equipment, dbEquipment.id, dbEquipment.name, dbEquipment.eg_serial_number);
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
          message: `Equipment with ID ${equipmentId} is not present in the database`,
        });
      }
      const denied = await this.equipmentWriteDenied(req, dbEquipment.company_link);
      if (denied) {
        return res.send({ status: HttpStatus.FORBIDDEN, message: denied });
      }
      const equipmentStatus = this.hasBodyValue(req.body.status)
        ? this.normalizeEquipmentStatus(req.body.status)
        : dbEquipment.status;
      if (!equipmentStatus) {
        return res.send({
          status: HttpStatus.BAD_REQUEST,
          message: "status must be operational, under_maintenance, faulty or retired",
        });
      }
      const installedAt = this.parseOptionalDate(req.body.installed_at);
      if (installedAt === "invalid") {
        return res.send({ status: HttpStatus.BAD_REQUEST, message: "installed_at must be an ISO date" });
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
          status: equipmentStatus,
          type: req.body.type !== undefined ? (this.hasBodyValue(req.body.type) ? String(req.body.type).trim() : null) : undefined,
          installed_at: installedAt,
        },
      });

      if (updatedEquipment) {
        await this.auditFromReq(req, audit_action.updated, audit_entity.equipment, updatedEquipment.id, updatedEquipment.name, updatedEquipment.eg_serial_number);
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
      const denied = await this.equipmentWriteDenied(req, dbEquipment.company_link);
      if (denied) {
        return res.send({ status: HttpStatus.FORBIDDEN, message: denied });
      }
      await prisma.equipment.update({
        where: { id: equipmentId },
        data: {
          is_active: activate,
          updated_at: new Date(),
          updated_by: req.user?.phone || "",
        },
      });
      await this.auditFromReq(
        req,
        activate ? audit_action.updated : audit_action.deleted,
        audit_entity.equipment,
        dbEquipment.id,
        dbEquipment.name,
        activate ? "marked active" : "marked inactive",
      );
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
      const triageActor = await this.loadActor(req);
      const canTriage = this.canTriage(triageActor);
      const seniorOnly = canTriage && !this.adminOrNot(triageActor?.access_level);
      const denied = seniorOnly ? null : await this.taskAccessDenied(req, dbTask, "update");
      if (denied) {
        return res.send({ status: HttpStatus.FORBIDDEN, message: denied });
      }
      const triage = await this.parseTaskTriageFields(req.body, dbTask);
      if ("error" in triage) {
        return res.send({ status: triage.status, message: triage.error });
      }
      if (triage.changed && !canTriage) {
        return res.send({
          status: HttpStatus.FORBIDDEN,
          message: "Only admins or senior service engineers can change priority, due date or manager",
        });
      }
      if (seniorOnly) {
        const updated = await prisma.tasks.update({
          where: { id: taskId },
          data: { ...triage.data, updated_at: new Date(), updated_by: req.user?.phone || "" },
        });
        await this.recordAudit(triageActor, audit_action.updated, audit_entity.task, updated.id, updated.ticket_no, "triage fields updated");
        return res.status(200).send({ status: 200, data: updated, message: "Task updated successfully" });
      }
      if (
        req.body.equipment_link != null &&
        parseInt(String(req.body.equipment_link), 10) !== dbTask.equipment_link
      ) {
        const actor = await this.loadActor(req);
        const target = await prisma.equipment.findUnique({
          where: { id: parseInt(String(req.body.equipment_link), 10) || -1 },
          select: { company_link: true },
        });
        if (!target) {
          return res.send({ status: 204, message: "Equipment not found" });
        }
        if (
          !this.adminOrNot(actor?.access_level) &&
          !actor?.companyIds.includes(target.company_link)
        ) {
          return res.send({
            status: HttpStatus.FORBIDDEN,
            message: "You do not have access to move this task to that equipment",
          });
        }
      }
      const contact = this.taskContactUpdate(req.body, dbTask);
      if ("error" in contact) {
        return res.send({ status: HttpStatus.BAD_REQUEST, message: contact.error });
      }
      const updated = await prisma.tasks.update({
        where: { id: taskId },
        data: {
          name: req.body.name ?? dbTask.name,
          description: req.body.description ?? dbTask.description,
          call_type: req.body.call_type ?? dbTask.call_type,
          equipment_link: req.body.equipment_link ?? dbTask.equipment_link,
          ...contact.data,
          ...triage.data,
          updated_at: new Date(),
          updated_by: req.user?.phone || "",
        },
      });
      await this.recordAudit(triageActor, audit_action.updated, audit_entity.task, updated.id, updated.ticket_no);
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

  /**
   * contact_name / contact_phone / address on an update body. A task that stays individual (no
   * equipment after the update) must keep all of them and its name non-empty; other tasks may
   * set or clear them, but a non-empty phone is still validated.
   */
  taskContactUpdate(
    body: Record<string, unknown>,
    current: { name?: string | null; equipment_link?: number | null; contact_name?: string | null; contact_phone?: string | null; address?: string | null },
  ): { error: string } | { data: { contact_name?: string | null; contact_phone?: string | null; address?: string | null } } {
    const keys = ["contact_name", "contact_phone", "address"] as const;
    const touched = keys.some((key) => body?.[key] !== undefined);
    const staysIndividual = (body?.equipment_link ?? current.equipment_link) == null;
    if (staysIndividual && body?.name !== undefined && body?.name !== null && !String(body.name).trim()) {
      return { error: "name is required for an individual task" };
    }
    if (!touched) return { data: {} };
    if (staysIndividual) {
      const parsed = this.individualTaskContact(body, current);
      if ("error" in parsed) return parsed;
      return {
        data: { contact_name: parsed.contact_name, contact_phone: parsed.contact_phone, address: parsed.address },
      };
    }
    const data: { contact_name?: string | null; contact_phone?: string | null; address?: string | null } = {};
    for (const key of keys) {
      if (body?.[key] === undefined) continue;
      const value = String(body[key] ?? "").trim();
      data[key] = value || null;
    }
    if (data.contact_phone) {
      data.contact_phone = data.contact_phone.replace(/[\s-]/g, "");
      if (!/^\+?\d{10,15}$/.test(data.contact_phone)) {
        return { error: "contact_phone must be 10 to 15 digits with an optional leading +" };
      }
    }
    return { data };
  }

  /** Optional priority / due_date / manager_link on a task body; `changed` is true only when a value differs. */
  private async parseTaskTriageFields(
    body,
    current: { priority: task_priority; due_date: Date | null; manager_link: number | null },
  ): Promise<
    | { error: string; status: number }
    | { changed: boolean; data: { priority?: task_priority; due_date?: Date | null; manager_link?: number | null } }
  > {
    const data: { priority?: task_priority; due_date?: Date | null; manager_link?: number | null } = {};
    let changed = false;
    if (body.priority !== undefined && body.priority !== null && body.priority !== "") {
      const priority = this.normalizePriority(body.priority);
      if (!priority) {
        return { error: "priority must be low, medium, high or critical", status: HttpStatus.BAD_REQUEST };
      }
      data.priority = priority;
      changed = changed || priority !== current.priority;
    }
    const dueDate = this.parseOptionalDate(body.due_date);
    if (dueDate === "invalid") {
      return { error: "due_date must be an ISO date", status: HttpStatus.BAD_REQUEST };
    }
    if (dueDate !== undefined) {
      data.due_date = dueDate;
      changed = changed || (dueDate?.getTime() ?? null) !== (current.due_date?.getTime() ?? null);
    }
    if (body.manager_link !== undefined) {
      const raw = body.manager_link;
      const managerLink = raw === null || raw === "" ? null : parseInt(String(raw), 10);
      if (managerLink !== null && !Number.isFinite(managerLink)) {
        return { error: "manager_link must be a user id", status: HttpStatus.BAD_REQUEST };
      }
      if (managerLink !== null) {
        const manager = await prisma.user.findUnique({
          where: { id: managerLink },
          select: { access_level: true, designation: true, is_active: true },
        });
        if (!manager || !manager.is_active || !this.canTriage(manager)) {
          return { error: "manager_link must be an active admin or senior service engineer", status: HttpStatus.BAD_REQUEST };
        }
      }
      data.manager_link = managerLink;
      changed = changed || managerLink !== current.manager_link;
    }
    return { changed, data };
  }

  async deleteTask(res, req) {
    try {
      const taskId = parseInt(req.body.task_link, 10);
      const dbTask = await prisma.tasks.findUnique({ where: { id: taskId } });
      if (!dbTask) {
        return res.send({ status: 204, message: "Task not found" });
      }
      const denied = await this.taskAccessDenied(req, dbTask, "delete");
      if (denied) {
        return res.send({ status: HttpStatus.FORBIDDEN, message: denied });
      }
      await prisma.hold_reason.deleteMany({ where: { task_link: taskId } });
      await prisma.images.deleteMany({ where: { taskId } });
      await prisma.task_user.deleteMany({ where: { task_link: taskId } });
      await prisma.tasks.delete({ where: { id: taskId } });
      await this.auditFromReq(req, audit_action.deleted, audit_entity.task, dbTask.id, dbTask.ticket_no, dbTask.name);
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
      const actor = await this.loadActor(req);
      const permission = actor
        ? this.deleteUserDecision(actor, {
            id: dbUser.id,
            access_level: dbUser.access_level,
            companyIds: await this.companyIdsOf(dbUser.id),
          })
        : ({ allowed: false, message: "You do not have access to delete this user" } as const);
      if (permission.allowed === false) {
        return res.send({ status: HttpStatus.FORBIDDEN, message: permission.message });
      }
      await prisma.company_user.deleteMany({ where: { user_link: userId } });
      await prisma.tokens.deleteMany({ where: { user_link: userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } });
      await this.recordAudit(actor, audit_action.deleted, audit_entity.user, dbUser.id, dbUser.name, `access_level=${dbUser.access_level}`);
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

  async isDeactivated(sub): Promise<boolean> {
    const id = parseInt(String(sub ?? ""), 10);
    if (!Number.isFinite(id)) return false;
    try {
      const row = await prisma.user.findUnique({ where: { id }, select: { is_active: true } });
      return row?.is_active === false;
    } catch {
      return false;
    }
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
    const individual = equipmentLink == null || equipmentLink === "";
    let dbEquipment = null;
    let raiser = null;
    let contact: { name: string; contact_name: string; contact_phone: string; address: string } | null = null;
    if (individual) {
      raiser = await this.findOne(userPhone);
      const denied = this.individualTaskCreateDenied(raiser?.access_level);
      if (denied) {
        return res.send({ status: HttpStatus.FORBIDDEN, message: denied });
      }
      const parsed = this.individualTaskContact(req.body ?? {});
      if ("error" in parsed) {
        return res.send({ status: HttpStatus.BAD_REQUEST, message: parsed.error });
      }
      contact = parsed;
    } else {
      dbEquipment = await prisma.equipment.findUnique({
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
      raiser = await this.findOne(userPhone);
    }

    const callType = mapCallTypeToEnum(req.body?.call_type);
    let priority: task_priority = callType === call_type.breakdown ? task_priority.high : task_priority.medium;
    if (this.hasBodyValue(req.body?.priority)) {
      priority = this.normalizePriority(req.body.priority);
      if (!priority) {
        return res.send({ status: HttpStatus.BAD_REQUEST, message: "priority must be low, medium, high or critical" });
      }
    }
    const dueDate = this.parseOptionalDate(req.body?.due_date);
    if (dueDate === "invalid") {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "due_date must be an ISO date" });
    }
    const taskName = contact ? contact.name : req.body.name;
    const task = {
      name: taskName,
      description: req.body.description,
      image: { create: this.createImages(req.body.images ?? []) },
      equipment_link: individual ? null : equipmentLink,
      ...(contact
        ? { contact_name: contact.contact_name, contact_phone: contact.contact_phone, address: contact.address }
        : {}),
      ticket_no: getAccountFromCompany(
        taskName + req.body.description + (callType ?? undefined)
      ),
      call_type: callType ?? undefined,
      otp: this.generateOtp(),
      created_at: undefined,
      created_by: userPhone,
      updated_at: undefined,
      updated_by: userPhone,
      priority,
      due_date: dueDate ?? null,
      approval: this.approvalOnCreate(raiser?.access_level),
      manager_link: this.adminOrNot(raiser?.access_level) ? raiser.id : null,
    };

    const existingTask = await prisma.tasks.findFirst({
      where: {
        equipment_link: task.equipment_link,
        name: task.name,
        description: task.description,
        call_type: callType ?? undefined,
        ...(contact ? { contact_phone: contact.contact_phone } : {}),
      },
    });

    if (existingTask) {
      return res.send({
        status: HttpStatus.CONFLICT,
        data: existingTask,
        message: contact
          ? `task already exist with same name, description, contact_phone and call_type combo`
          : `task already exist with same name, description, equipment and call_type combo`,
      });
    }

    const dbTask = await prisma.tasks.create({
      data: task,
    });

    if (dbTask != null) {
      await prisma.task_user.create({
        data: {
          // Individual tasks have no client; the raising admin owns the row so no client can reach it.
          client_link: individual ? raiser.id : req.body.client_link,
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
          companyName: taskPlaceLabel(dbTask, dbEquipment?.company),
          companyLink: dbEquipment?.company_link,
          isHighPriority: dbTask.call_type === call_type.breakdown,
          actorUserId: user?.id,
        });
      } catch (notifyError) {
        console.error("createTask notification failed", notifyError);
      }
      const taskStatus = await this.getLatestStatusForTask(dbTask.id);
      await this.recordAudit(user, audit_action.created, audit_entity.task, dbTask.id, dbTask.ticket_no, dbTask.name);

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
    const assigner = await this.loadActor(req);
    const technicianLink = parseInt(String(req.body.technician_link ?? ""), 10);
    const selfAssign = assigner != null && technicianLink === assigner.id;
    if (!this.canTriage(assigner) && !(selfAssign && this.isTechnicianRole(assigner?.access_level))) {
      return res.send({
        status: HttpStatus.FORBIDDEN,
        message: "Only admins and senior service engineers can assign other service engineers",
      });
    }
    if (Number.isFinite(technicianLink)) {
      const assignee = await prisma.user.findUnique({
        where: { id: technicianLink },
        select: { is_active: true },
      });
      if (!assignee) {
        return res.send({ status: HttpStatus.NO_CONTENT, message: "service engineer not found" });
      }
      if (!assignee.is_active) {
        return res.send({ status: HttpStatus.BAD_REQUEST, message: "This service engineer account is inactive" });
      }
    }
    const task = await prisma.tasks.findUnique({
      where: {
        id: req.body.task_link,
      },
      select: {
        manager_link: true,
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

    if (task && task.task_user?.length === 0) {
      response = { message: `no tasks found`, status: 204 };
    } else if (task) {
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
          message: `service engineer assigned successfully`,
          status: 200,
        };
        const now = new Date();
        const assignedTask = await prisma.tasks.update({
          where: { id: taskUser.task_link },
          data: {
            assigned_at: now,
            accepted_at: selfAssign ? now : null,
            approval: this.approvalForTaskStatus(taskUser.status, true) ?? approval_state.assigned,
            manager_link:
              task.manager_link == null && this.adminOrNot(assigner?.access_level) ? assigner.id : undefined,
          },
        });
        await this.recordAudit(
          assigner,
          audit_action.assigned,
          audit_entity.task,
          assignedTask.id,
          assignedTask.ticket_no,
          `technician_link=${taskUser.technician_link}`,
        );
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
            companyName: taskPlaceLabel(assignedTask, assignedTask?.equipment?.company),
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
          message: `service engineer already assigned`,
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
    const actorId = Number(req.user?.sub);
    const actorRole = String(userInfo?.access_level ?? "").toLowerCase();
    const isAdminOrManager = this.adminOrNot(userInfo?.access_level);
    const isAssignedServiceEngineer =
      actorRole === "technician" &&
      Number(dbTaskUser.technician_link) === actorId;
    let isLinkedCompanyUser = false;
    if (
      actorRole === "client_admin" &&
      dbTaskUser.task?.equipment?.company_link != null
    ) {
      const companyLink = await prisma.company_user.findUnique({
        where: {
          user_link_company_link: {
            user_link: actorId,
            company_link: dbTaskUser.task.equipment.company_link,
          },
        },
        select: { user_link: true },
      });
      isLinkedCompanyUser = companyLink != null;
    }
    if (!isAdminOrManager && !isAssignedServiceEngineer && !isLinkedCompanyUser) {
      return res.status(HttpStatus.FORBIDDEN).send({
        message: "You do not have permission to update this task status",
        status: HttpStatus.FORBIDDEN,
      });
    }
    const isApprover = ["eg_super_admin", "eg_admin", "client_admin"].includes(actorRole);
    if (taskStatus === status.closed && dbTaskUser.status === status.completed && !isApprover) {
      return res.status(HttpStatus.FORBIDDEN).send({
        message: "Only an Admin, Client Admin, or Manager can approve a completed task",
        status: HttpStatus.FORBIDDEN,
      });
    }
    if (actorRole === "technician" &&
        taskStatus !== status.in_progress &&
        taskStatus !== status.hold &&
        taskStatus !== status.completed) {
      return res.status(HttpStatus.FORBIDDEN).send({
        message: "Service engineers can move assigned tasks to In Progress, Hold, or Completed",
        status: HttpStatus.FORBIDDEN,
      });
    }
    const legacyFollowUpAwaitingApproval =
      dbTaskUser.status === status.in_progress && dbTaskUser.task?.follow_up === true;
    if (taskStatus === status.closed && dbTaskUser.status !== status.completed &&
        !legacyFollowUpAwaitingApproval && !isAdminOrManager) {
      return res.status(HttpStatus.CONFLICT).send({
        message: "Only completed tasks can be approved",
        status: HttpStatus.CONFLICT,
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
          message: `service engineer is not assigned to task. Cannot change the task status`,
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
      if (taskStatus) {
        const now = new Date();
        await prisma.tasks.update({
          where: { id: dbTaskUser.task_link },
          data: {
            approval: this.approvalForTaskStatus(taskStatus, true) ?? undefined,
            started_at: taskStatus === status.in_progress && !dbTask?.started_at ? now : undefined,
            resolved_at: taskStatus === status.completed && !dbTask?.resolved_at ? now : undefined,
            closed_at: taskStatus === status.closed ? now : undefined,
          },
        });
        await this.recordAudit(userInfo, audit_action.updated, audit_entity.task, dbTaskUser.task_link, dbTask?.ticket_no, `status=${taskStatus}`);
      }
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
          equipment: dbTaskUser.task?.equipment,
          companyLink: dbTaskUser.task?.equipment?.company_link,
          companyName: taskPlaceLabel(dbTaskUser.task, dbTaskUser.task?.equipment?.company),
          statusLabel: String(taskStatus),
          updatedByName: userInfo?.name ?? userInfo?.phone,
          actorUserId: userInfo?.id,
          notes: req.body.reason,
          isCompleted: taskStatus === status.completed || taskStatus === status.closed,
        });
      } catch (notifyError) {
        console.error("updateTaskStatus notification failed", notifyError);
      }
    }

    const taskLatestStatus = await this.getLatestStatusForTask(dbTask.id);
    if (taskLatestStatus == status.hold && req.body.hold) {
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
    const rawLink = req.body.equipment_link;
    const asNumber = Number(rawLink);
    let equipment = Number.isFinite(asNumber) && asNumber > 0
      ? await prisma.equipment.findUnique({
          where: { id: asNumber },
          include: { company: true },
        })
      : null;
    if (!equipment && rawLink != null && String(rawLink).trim() !== "") {
      equipment = await prisma.equipment.findFirst({
        where: {
          OR: [
            { eg_serial_number: String(rawLink).trim() },
            { serial_number: String(rawLink).trim() },
          ],
        },
        include: { company: true },
      });
    }
    if (!equipment) {
      return res.send({
        success: 404,
        message: `Data not found for equipment: ${rawLink}`,
      });
    }

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
    return res.send({
      success: 200,
      data: equipment,
    });
  }

  async getHoldReasons(res, req) {
    const companyLink = req.body.company_link;
    const requester = companyLink == null ? await this.findOne(req.user?.phone) : null;
    // The equipment relation filter drops individual tasks, so admins and service engineers skip it when unfiltered.
    const unscoped =
      companyLink == null &&
      (this.adminOrNot(requester?.access_level) || this.isTechnicianRole(requester?.access_level));

    const dbHoldReasons = await prisma.hold_reason.findMany({
      where: unscoped
        ? undefined
        : {
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

  async resolveTaskLink(rawId) {
    const id = parseInt(String(rawId ?? ""), 10);
    if (Number.isNaN(id)) return null;
    const task = await prisma.tasks.findUnique({ where: { id }, select: { id: true } });
    if (task) return task.id;
    const taskUser = await prisma.task_user.findUnique({
      where: { id },
      select: { task_link: true },
    });
    return taskUser?.task_link ?? null;
  }

  async clientSignatureForReport(res, req) {
    try {
      const requester = await this.findOne(req.user.phone);
      if (!this.adminOrNot(requester?.access_level) &&
          requester?.access_level !== access_level.client_admin) {
        return res.status(HttpStatus.FORBIDDEN).send({
          status: HttpStatus.FORBIDDEN,
          message: "Only an Admin, Client Admin, or Manager can approve a task",
        });
      }
      const taskLink = await this.resolveTaskLink(
        req.body.task_link ?? req.body.task_user_link
      );
      if (!taskLink) {
        return res.status(400).send({
          status: 400,
          message: "task_link is required",
        });
      }

      const approvalSaved = await this.saveClientApproval(taskLink, req, requester);
      if (approvalSaved?.error) {
        return res.status(approvalSaved.error.status).send(approvalSaved.error);
      }

      let reportFile = null;
      try {
        const signature = await this.imageToDataUrl(req.body.sign_url);
        if (req.body.sign_url) {
          await this.persistSignatureFile(taskLink, req.body.sign_url);
        }
        const view = await this.buildServiceReportView(
          taskLink,
          requester,
          signature
        );
        if (!view.error) {
          reportFile = await this.writeServiceReportPdf(taskLink, view, false);
        } else {
          this.logger.warn(
            `Service report view failed for task ${taskLink}: ${view.error.message}`
          );
        }
      } catch (reportError) {
        this.logger.error("Service report PDF failed after approval", reportError);
      }

      return res.status(200).send({
        status: 200,
        message: reportFile
          ? "Client approval saved and service report generated"
          : "Client approval saved. Service report will be available shortly",
        url: reportFile?.url,
      });
    } catch (error) {
      this.logger.error("clientSignatureForReport failed", error);
      return res.status(500).send({
        status: 500,
        message: "Failed to save client approval",
      });
    }
  }

  async saveClientApproval(taskLink, req, requester) {
    const task = await prisma.tasks.findUnique({
      where: { id: taskLink },
      include: { equipment: true },
    });
    if (!task) {
      return { error: { status: 404, message: "Task not found" } };
    }
    if (!this.canAccessCompany(requester, task.equipment?.company_link)) {
      return {
        error: {
          status: 403,
          message: "You can only approve tasks for your attached company",
        },
      };
    }

    const latest = await prisma.task_user.findFirst({
      where: { task_link: taskLink },
      orderBy: { id: "desc" },
    });
    const awaitingApproval = latest?.status === status.completed ||
      (latest?.status === status.in_progress && task.follow_up === true);
    if (!awaitingApproval) {
      return {
        error: {
          status: HttpStatus.CONFLICT,
          message: "Only completed tasks can be approved",
        },
      };
    }

    const rating = this.coerceRating(req.body.rating);
    const hasApprovalFields =
      req.body.feedback != null ||
      req.body.service_satisfactory != null ||
      req.body.is_running_smoothly != null ||
      req.body.rating != null;

    if (hasApprovalFields) {
      await prisma.tasks.update({
        where: { id: taskLink },
        data: {
          feedback: req.body.feedback ?? undefined,
          service_satisfactory:
            req.body.service_satisfactory ?? undefined,
          is_running_smoothly:
            req.body.is_running_smoothly ?? undefined,
          rating,
          updated_at: new Date(),
          updated_by: req.user?.phone,
        },
      });
    }

    if (latest && latest.status !== status.closed) {
      await prisma.task_user.update({
        where: { id: latest.id },
        data: {
          status: status.closed,
          updated_by: req.user?.phone,
          updated_at: new Date(),
        },
      });
      await prisma.tasks.update({
        where: { id: taskLink },
        data: { closed_at: new Date(), approval: approval_state.confirmed, status: status.closed },
      });
      await this.recordAudit(requester, audit_action.updated, audit_entity.task, taskLink, task.ticket_no, "confirmed by client");
    }

    return { ok: true };
  }

  private resolveLocalUploadPath(raw?: string): string | null {
    if (!raw) return null;
    let rel = String(raw).trim();
    try {
      if (/^https?:\/\//i.test(rel)) {
        rel = new URL(rel).pathname;
      }
    } catch {
      // keep original
    }
    rel = rel.replace(/^\/+/, "");
    const candidates = [
      rel,
      `./${rel}`,
      path.join(process.cwd(), rel),
      path.join(__dirname, "..", "..", rel),
      path.join(process.cwd(), "uploads", path.basename(rel)),
    ];
    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private imageMimeFromBuffer(buffer: Buffer): string {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) {
      return "image/png";
    }
    return "image/jpeg";
  }

  private async readImageBuffer(imageUrl?: string): Promise<Buffer | undefined> {
    if (!imageUrl) return undefined;
    const localPath = this.resolveLocalUploadPath(imageUrl);
    if (localPath) {
      return readFileSync(localPath);
    }
    try {
      const absolute = /^https?:\/\//i.test(imageUrl)
        ? imageUrl
        : `${String(process.env.BASE_URL || "").replace(/\/$/, "")}/${String(imageUrl).replace(/^\//, "")}`;
      const response = await axios.get(absolute, {
        responseType: "arraybuffer",
        timeout: 8000,
        validateStatus: (code) => code >= 200 && code < 400,
      });
      return Buffer.from(response.data);
    } catch (error) {
      this.logger.warn(`Unable to read image ${imageUrl}: ${error?.message || error}`);
      return undefined;
    }
  }

  private async imageToDataUrl(imageUrl?: string) {
    const buffer = await this.readImageBuffer(imageUrl);
    if (!buffer) return undefined;
    const mime = this.imageMimeFromBuffer(buffer);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  private async persistSignatureFile(taskLink: number, signUrl: string) {
    const buffer = await this.readImageBuffer(signUrl);
    if (!buffer) return null;
    this.ensureUploadPath("./uploads/reports");
    const dest = `./uploads/reports/sign-${taskLink}.png`;
    writeFileSync(dest, buffer);
    return dest;
  }

  private async urlToBase64(imageUrl: string) {
    return this.imageToDataUrl(imageUrl);
  }

  statusLabel(value?: string) {
    switch (value) {
      case "open":
        return "Not Started";
      case "in_progress":
        return "In Progress";
      case "hold":
        return "Hold";
      case "completed":
        return "Awaiting Approval";
      case "closed":
        return "Completed";
      default:
        return value || "Open";
    }
  }

  formatReportTime(value?: Date | string) {
    if (!value) return "-";
    return moment(value).format("DD MMM YYYY, hh:mm A");
  }

  yesNo(value) {
    if (value === true) return "Yes";
    if (value === false) return "No";
    return "-";
  }

  async buildServiceReportView(taskLink, requester, signatureBase64?: string) {
    const task = await prisma.tasks.findUnique({
      where: { id: taskLink },
      include: {
        task_user: { orderBy: { id: "asc" } },
        hold_reason: { orderBy: { created_at: "asc" } },
        image: true,
        equipment: { include: { company: { include: { address: true } } } },
      },
    });
    if (!task) {
      return { error: { status: 404, message: "Task not found" } };
    }
    const individual = this.isIndividualTask(task);
    if (individual ? !task.ticket_no || !task.contact_name : !task.ticket_no || !task.equipment?.name || !task.equipment?.company?.name) {
      return {
        error: {
          status: 422,
          message: individual
            ? "A report requires a ticket number and contact name on the task"
            : "A report requires a ticket number, company, and equipment on the task",
        },
      };
    }
    if (!this.canAccessCompany(requester, task.equipment?.company_link)) {
      return {
        error: {
          status: 403,
          message: "You can only view reports for your attached company",
        },
      };
    }

    const userIds = new Set<number>();
    for (const row of task.task_user) {
      if (row.technician_link) userIds.add(row.technician_link);
      if (row.client_link) userIds.add(row.client_link);
    }
    const users = userIds.size
      ? await prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, phone: true, email: true },
        })
      : [];
    const userById = Object.fromEntries(users.map((item) => [item.id, item]));
    const latest = task.task_user[task.task_user.length - 1];
    const latestClient = [...task.task_user].reverse().find((row) => row.client_link);
    const latestTechnician = [...task.task_user].reverse().find((row) => row.technician_link);
    const client = latestClient?.client_link ? userById[latestClient.client_link] : null;
    const technician = latestTechnician?.technician_link
      ? userById[latestTechnician.technician_link]
      : null;
    const currentStatus = latest?.status || "open";

    const timeline: Array<{ time: string; title: string; detail: string }> = [
      {
        time: this.formatReportTime(task.created_at),
        title: "Task created",
        detail: `${task.name || "Task"} was raised${task.created_by ? ` by ${task.created_by}` : ""}.`,
      },
    ];

    for (const row of task.task_user) {
      const tech = row.technician_link ? userById[row.technician_link] : null;
      const actor = row.updated_by || row.created_by || tech?.name || "System";
      if (row.status === "open" && row.technician_link) {
        timeline.push({
          time: this.formatReportTime(row.updated_at || row.created_at),
          title: "Service engineer assigned",
          detail: `${tech?.name || "Service engineer"} accepted this task${actor ? ` (${actor})` : ""}.`,
        });
      } else if (row.status === "open") {
        timeline.push({
          time: this.formatReportTime(row.created_at),
          title: "Awaiting service engineer",
          detail: "Task is open and not assigned yet.",
        });
      } else if (row.status === "in_progress") {
        timeline.push({
          time: this.formatReportTime(row.updated_at || row.created_at),
          title: "Work started",
          detail: `${tech?.name || actor} moved the task to In Progress.`,
        });
      } else if (row.status === "hold") {
        timeline.push({
          time: this.formatReportTime(row.updated_at || row.created_at),
          title: "Task put on hold",
          detail: row.reason || `${actor} placed the task on hold.`,
        });
      } else if (row.status === "completed") {
        timeline.push({
          time: this.formatReportTime(row.updated_at || row.created_at),
          title: "Work completed; awaiting approval",
          detail: `${tech?.name || actor} marked the task complete.`,
        });
      } else if (row.status === "closed") {
        timeline.push({
          time: this.formatReportTime(row.updated_at || row.created_at),
          title: "Task approved",
          detail: `Service completed and approved${tech?.name ? ` for work by ${tech.name}` : ""}.`,
        });
      }
    }

    for (const hold of task.hold_reason || []) {
      timeline.push({
        time: this.formatReportTime(hold.created_at),
        title: "Hold reason recorded",
        detail: [hold.hold, hold.spare_part_number, hold.reason]
          .filter(Boolean)
          .join(" · "),
      });
    }

    timeline.sort((a, b) => {
      const left = moment(a.time, "DD MMM YYYY, hh:mm A").valueOf();
      const right = moment(b.time, "DD MMM YYYY, hh:mm A").valueOf();
      return left - right;
    });

    let outputImages: string[] = [];
    if (task.out_images) {
      try {
        const parsed = typeof task.out_images === "string"
          ? JSON.parse(task.out_images)
          : task.out_images;
        if (Array.isArray(parsed)) outputImages = parsed.map((value) => String(value)).filter(Boolean);
      } catch {
        outputImages = [String(task.out_images)];
      }
    }
    const images = [
      ...task.image.map((item) => item.url),
      ...outputImages,
      ...(task.hold_reason || []).map((hold) => hold.image).filter(Boolean),
    ].filter(Boolean);
    const address = task.equipment?.company?.address;
    const formattedCompanyAddress = address
      ? [address.address_line, address.locality, address.city, address.district, address.state, address.pincode, address.country]
          .filter(Boolean)
          .join(", ")
      : "";

    return {
      ticket_no: task.ticket_no,
      generated_at: this.formatReportTime(new Date()),
      current_status: this.statusLabel(currentStatus),
      status_key: currentStatus,
      is_closed: currentStatus === "closed",
      created_at: this.formatReportTime(task.created_at),
      created_by: task.created_by,
      call_type: task.call_type ? String(task.call_type).replace(/_/g, " ").toUpperCase() : "-",
      task_name: task.name,
      task_description: task.description,
      company: individual
        ? { name: task.contact_name, branch: null, location: task.address, address: task.address, gst_number: null, email: null }
        : {
            name: task.equipment?.company?.name,
            branch: task.equipment?.company?.branch_name,
            location: task.equipment?.company?.location || formattedCompanyAddress,
            address: formattedCompanyAddress,
            gst_number: task.equipment?.company?.gst_number,
            email: task.equipment?.company?.email,
          },
      contact: individual
        ? { name: task.contact_name, phone: task.contact_phone, email: null }
        : {
            name: client?.name,
            phone: client?.phone,
            email: client?.email,
          },
      technician: {
        name: technician?.name,
        phone: technician?.phone,
        note: technician ? "Assigned service engineer" : "No service engineer assigned yet",
      },
      equipment: {
        name: task.equipment?.name,
        make: task.equipment?.make,
        model: task.equipment?.model,
        serial_no: task.equipment?.serial_number,
        eg_serial: task.equipment?.eg_serial_number,
        location: task.equipment?.location,
      },
      timeline,
      action_taken: task.action_taken,
      requirement: task.req_details,
      follow_up: this.yesNo(task.follow_up),
      action_req_details: task.action_req_details,
      customer: {
        service_satisfactory: this.yesNo(task.service_satisfactory),
        is_running_smoothly: this.yesNo(task.is_running_smoothly),
        notes: task.feedback || task.notes,
        rating: task.rating != null ? `${task.rating} / 5` : "-",
      },
      images,
      signature: signatureBase64 || "",
    };
  }

  async writeServiceReportPdf(taskLink, view, includeBase64 = true) {
    this.ensureUploadPath("./uploads/reports");
    const task = await prisma.tasks.findUnique({
      where: { id: taskLink },
      select: { ticket_no: true },
    });
    const ticketNumber = String(task?.ticket_no || taskLink).replace(/[^A-Za-z0-9_-]/g, "_");
    const fileName = `Ticket_${ticketNumber}.pdf`;
    const filePath = `./uploads/reports/${fileName}`;
    const pdfBuffer = Buffer.from(await buildServiceReportPdf(view));
    writeFileSync(filePath, pdfBuffer);
    return {
      url: `uploads/reports/${fileName}`,
      pdf_base64: includeBase64 ? pdfBuffer.toString("base64") : undefined,
    };
  }

  async getServiceReport(res, req) {
    try {
      const requester = await this.findOne(req.user.phone);
      if (!this.adminOrNot(requester?.access_level)) {
        return res.status(403).send({
          status: 403,
          message: "You are not authorized to generate a service report",
        });
      }
      const taskLink = await this.resolveTaskLink(req.body.task_link);
      if (!taskLink) {
        return res.status(400).send({
          status: 400,
          message: "task_link is required",
        });
      }
      let signature;
      const savedSign = `./uploads/reports/sign-${taskLink}.png`;
      if (existsSync(savedSign)) {
        signature = await this.imageToDataUrl(savedSign);
      } else if (req.body.sign_url) {
        signature = await this.imageToDataUrl(req.body.sign_url);
      }
      const view = await this.buildServiceReportView(
        taskLink,
        requester,
        signature
      );
      if (view.error) {
        return res.status(view.error.status).send(view.error);
      }
      const reportFile = await this.writeServiceReportPdf(taskLink, view, true);
      return res.status(200).send({
        status: 200,
        message: "Service report generated successfully",
        url: reportFile.url,
        pdf_base64: reportFile.pdf_base64,
      });
    } catch (error) {
      console.error("getServiceReport failed", error);
      return res.status(500).send({
        status: 500,
        message: "Unable to generate service report",
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

    const clientLink = task?.task_user?.[0]?.client_link;
    const clientInfo = clientLink != null
      ? await prisma.user.findUnique({ where: { id: clientLink } })
      : null;

    const outImagesArray = JSON.parse(task?.out_images || "[]");
    // if (task.task_user[0].status == status.closed) {
    const data = {
      bill_to: {
        name: task?.equipment?.company?.name ?? task?.contact_name,
        location: task?.equipment?.company?.location ?? task?.address,
      },
      contact_info: {
        contact_person: task?.equipment ? clientInfo?.name : task?.contact_name,
        contact_phone: task?.equipment ? clientInfo?.phone : task?.contact_phone,
      },
      equipment_details: {
        service_report: "12309",
        date: task?.equipment?.manufacturer_date
          ? moment(task.equipment.manufacturer_date).format("yyyy-MM-DD")
          : undefined,
        name: task?.equipment?.name,
        location: task?.equipment?.location ?? task?.address,
        model_no: task?.equipment?.model,
        serial_no: task?.equipment?.serial_number,
        voltage: task?.equipment?.make,
        call_type: task?.call_type?.toLocaleUpperCase(),
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

    const companyFilter = parseInt(String(req.body?.company_link ?? ""), 10);
    const filteredTasks = taskUsers.filter((task) => {
      if (
        Number.isFinite(companyFilter) &&
        task.task?.equipment?.company_link !== companyFilter
      ) {
        return false;
      }
      const actorId = parseInt(String(userInfo?.id ?? user.sub ?? ""), 10);
      return this.taskListVisible(
        { id: actorId, access_level: userInfo.access_level, designation: userInfo.designation },
        task,
        companyLinks,
      );
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

      const managerLink = filteredTasksByStatus[i].task?.manager_link;
      filteredTasksByStatus[i]["manager"] =
        managerLink != null
          ? await prisma.user.findUnique({
              where: { id: managerLink },
              select: { name: true, id: true, access_level: true, phone: true },
            })
          : undefined;
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
    completed: number;
    closed: number;
    hold: number;
    in_progress: number;
  } {
    let openCount = 0;
    let inProgressCount = 0;
    let closedCount = 0;
    let completedCount = 0;
    let holdCount = 0;

    for (const item of data) {
      if (item.status === "open") {
        openCount++;
      } else if (item.status === "closed") {
        closedCount++;
      } else if (item.status === "completed") {
        completedCount++;
      } else if (item.status === "in_progress") {
        inProgressCount++;
      } else if (item.status === "hold") {
        holdCount++;
      }
    }

    return {
      open: openCount,
      completed: completedCount,
      closed: closedCount,
      in_progress: inProgressCount,
      hold: holdCount,
    };
  }

  async updateTaskFeedback(res, req) {
    try {
      const taskLink = await this.resolveTaskLink(
        req.body.task_link ?? req.body.task_user_link
      );
      if (!taskLink) {
        return res.send({
          message: "task_link is required",
          status: 400,
        });
      }
      const task = await prisma.tasks.findUnique({
        where: { id: taskLink },
      });

      if (!task) {
        return res.send({
          message: `task not found in db with id: ${taskLink}`,
          status: 204,
        });
      }

      const actor = await this.findOne(req.user?.phone);
      const latestAssignment = await prisma.task_user.findFirst({
        where: { task_link: taskLink },
        orderBy: { id: "desc" },
      });
      const equipmentForAccess = task.equipment_link == null
        ? null
        : await prisma.equipment.findUnique({
            where: { id: task.equipment_link },
            select: { company_link: true },
          });
      const authorizedFeedbackRole =
        this.adminOrNot(actor?.access_level) ||
        (actor?.access_level === access_level.technician && latestAssignment?.technician_link === actor.id) ||
        (actor?.access_level === access_level.client_admin &&
          this.canAccessCompany(actor, equipmentForAccess?.company_link));
      if (!authorizedFeedbackRole) {
        return res.status(HttpStatus.FORBIDDEN).send({
          message: "You do not have permission to update this task",
          status: HttpStatus.FORBIDDEN,
        });
      }

      const updateTask = await prisma.tasks.update({
        where: { id: taskLink },
        data: {
          call_type: req.body.call_type
            ? mapCallTypeToEnum(req.body.call_type)
            : undefined,
          action_taken: req.body.action_taken ?? undefined,
          req_details: req.body.req_details ?? undefined,
          follow_up: req.body.follow_up ?? undefined,
          out_images: Array.isArray(req.body.out_images)
            ? JSON.stringify(req.body.out_images)
            : req.body.out_images ?? undefined,
          action_req_details: req.body.action_req_details ?? undefined,
          service_satisfactory: req.body.service_satisfactory ?? undefined,
          is_running_smoothly: req.body.is_running_smoothly ?? undefined,
          feedback: req.body.feedback ?? undefined,
          rating: this.coerceRating(req.body.rating),
          updated_at: new Date(),
          updated_by: req.user.phone,
        },
      });

      if (actor?.access_level === access_level.technician) {
        if (latestAssignment && (req.body.action_taken != null || req.body.out_images != null)) {
          await prisma.task_user.update({
            where: { id: latestAssignment.id },
            data: {
              status: status.completed,
              updated_by: req.user.phone,
              updated_at: new Date(),
            },
          });
          await prisma.tasks.update({
            where: { id: taskLink },
            data: {
              resolved_at: new Date(),
              resolution_notes: req.body.action_taken != null ? String(req.body.action_taken) : undefined,
              approval: approval_state.completed,
            },
          });
          await this.recordAudit(actor, audit_action.updated, audit_entity.task, taskLink, task.ticket_no, "service completed");
        }
      }

      try {
        const latestAssignment = await prisma.task_user.findFirst({
          where: { task_link: taskLink },
          orderBy: { id: "desc" },
        });
        const equipment = task.equipment_link == null
          ? null
          : await prisma.equipment.findUnique({
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
            rating: this.coerceRating(req.body.rating),
          });
        }
      } catch (notifyError) {
        console.error("updateTaskFeedback notification failed", notifyError);
      }

      return res.send({
        message: "task updated successfully",
        data: updateTask,
        status: 200,
      });
    } catch (error) {
      this.logger.error("updateTaskFeedback failed", error);
      return res.send({
        message: "Unable to save task feedback",
        status: 500,
      });
    }
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

      const selectors = [];
      if (companyLink) selectors.push({ company_link: companyLink });
      if (Array.isArray(equipmentLinks) && equipmentLinks.length > 0) {
        selectors.push({ id: { in: equipmentLinks } });
      }
      if (selectors.length === 0) {
        return res.status(400).send({
          status: 400,
          message: "Please provide either company_link or equipment_link",
        });
      }

      const equipmentList = await prisma.equipment.findMany({
        where: { OR: selectors },
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
    const requester = await this.findOne(req.user?.phone);
    const dbAccessLevel = mapAccessLevelToEnum(req.body.access_level);
    const isAdmin = this.adminOrNot(requester?.access_level);
    const seniorListingTechnicians =
      this.isSeniorTechnician(requester?.access_level, requester?.designation) &&
      dbAccessLevel === access_level.technician;
    const isClientAdmin = requester?.access_level === access_level.client_admin;
    if (!requester || (!isAdmin && !seniorListingTechnicians && !isClientAdmin)) {
      return res.status(HttpStatus.FORBIDDEN).send({
        status: HttpStatus.FORBIDDEN,
        message: this.isSeniorTechnician(requester?.access_level, requester?.designation)
          ? "Senior service engineers can only list service engineers"
          : "You do not have access to the user list",
      });
    }
    const designation = req.body.designation;
    const where: any = { access_level: dbAccessLevel ?? undefined };
    if (designation === "unclassified") {
      where.OR = [{ designation: null }, { designation: "" }];
    } else if (designation) {
      where.designation = this.normalizeTechnicianDesignation(designation) ?? designation;
    }
    if (!isAdmin && isClientAdmin) {
      where.company_user = { some: { company_link: { in: this.attachedCompanyIds(requester) } } };
    }
    const rawUsers = await prisma.user.findMany({
      where,
      include: {
        company_user: {
          include: {
            company: { select: { id: true, name: true, branch_name: true } },
          },
        },
      },
    });
    const users = rawUsers.map(({ company_user, ...item }) => {
      const companies = company_user.map(({ company }) => company);
      const row: Record<string, unknown> = {
        ...this.withoutPassword(item),
        companies,
        company_name: companies
          .map((company) => [company.name, company.branch_name].filter(Boolean).join(" - "))
          .filter(Boolean)
          .join(", "),
      };
      if (!isAdmin) {
        delete row.pan_id;
        delete row.aadhaar_id;
        delete row.permanent_address;
      }
      return row;
    });
    if (!isAdmin) {
      const scopedCounts: Record<string, number> = {};
      for (const item of rawUsers) {
        scopedCounts[item.access_level] = (scopedCounts[item.access_level] ?? 0) + 1;
        if (this.isTechnicianRole(item.access_level)) {
          const key = item.designation || "unclassified";
          scopedCounts[key] = (scopedCounts[key] ?? 0) + 1;
        }
      }
      return res.status(200).send({
        status: 200,
        message: `user data received successfully`,
        data: users,
        count: scopedCounts,
      });
    }
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
    const technicianDesignations = await prisma.user.groupBy({
      by: ["designation"],
      where: { access_level: access_level.technician },
      _count: { designation: true },
    });
    for (const row of technicianDesignations) {
      const key = row.designation || "unclassified";
      userCountsObj[key] = row._count.designation;
    }

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
      const duplicates = [];
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
            duplicates.push(
              `Row ${rowNumber}: ${name} / ${make} / ${model}`
            );
            continue;
          }
          await prisma.equipment.create({ data: equipmentData });
          created += 1;
        }
      }

      return res.status(200).send({
        status: 200,
        message: this.uploadSummary(created, duplicates, errors, "equipment"),
        errors: [...duplicates.map((item) => `Duplicate skipped: ${item}`), ...errors],
        added: created,
        skipped: duplicates.length,
      });
    } catch (e) {
      return res.status(200).send({
        status: HttpStatus.CONFLICT,
        message: `Failed to upload data ${e}`,
      });
    }
  }

  private async loadExcelRows(file) {
    if (!file?.buffer) {
      return { error: "No Excel file received", rows: [] };
    }
    const WorkbookCtor = ExcelJS?.Workbook || ExcelJS?.default?.Workbook;
    if (!WorkbookCtor) {
      return { error: "Excel parser is not available on server", rows: [] };
    }
    const workBook = new WorkbookCtor();
    await workBook.xlsx.load(file.buffer);
    const rows: Array<{ rowNumber: number; sheet: string; record: Record<string, any> }> = [];
    const errors: string[] = [];
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
        rows.push({ rowNumber, sheet: worksheet.name, record });
      }
    }
    return { rows, errors };
  }

  async uploadCompanyData(res, req, file) {
    try {
      const loaded = await this.loadExcelRows(file);
      if (loaded.error) {
        return res.status(200).send({
          status: HttpStatus.CONFLICT,
          message: loaded.error,
        });
      }
      const errors = [...(loaded.errors || [])];
      const duplicates = [];
      let created = 0;
      const userPhone = req.user?.phone || "EG-Backend";
      const mobileRegex = /^(\+\d{1,3}[- ]?)?\d{10}$/;

      for (const item of loaded.rows) {
        const record = item.record;
        const companyName =
          this.excelCellText(record.company_name) ||
          this.excelCellText(record.name) ||
          this.excelCellText(record.site_name);
        const branchName =
          this.excelCellText(record.branch_name) ||
          this.excelCellText(record.branch);
        const adminName =
          this.excelCellText(record.admin_name) ||
          this.excelCellText(record.client_admin_name) ||
          this.excelCellText(record.poc_name);
        const adminPhone =
          this.excelCellText(record.admin_phone) ||
          this.excelCellText(record.phone) ||
          this.excelCellText(record.client_admin_phone);
        const adminEmail =
          this.excelCellText(record.admin_email) ||
          this.excelCellText(record.email) ||
          this.excelCellText(record.client_admin_email);
        const adminPassword =
          this.excelCellText(record.admin_password) ||
          this.excelCellText(record.password);
        if (!companyName && !branchName && !adminName && !adminPhone) {
          continue;
        }
        if (!companyName || !branchName) {
          errors.push(`Row ${item.rowNumber}: company_name and branch_name are required`);
          continue;
        }
        if (!adminName || !adminPhone || !adminEmail || !adminPassword) {
          errors.push(
            `Row ${item.rowNumber}: admin_name, admin_phone, admin_email and admin_password are required`
          );
          continue;
        }
        if (!mobileRegex.test(adminPhone)) {
          errors.push(`Row ${item.rowNumber}: invalid admin_phone`);
          continue;
        }

        const existingCompany = await prisma.company.findUnique({
          where: {
            company_name_branch_name: {
              name: companyName,
              branch_name: branchName,
            },
          },
        });
        if (existingCompany) {
          duplicates.push(
            `Row ${item.rowNumber}: ${companyName} / ${branchName}`
          );
          continue;
        }

        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [
              { phone: adminPhone },
              { email: { equals: adminEmail, mode: "insensitive" } },
            ],
          },
        });
        if (existingUser) {
          duplicates.push(
            `Row ${item.rowNumber}: ${adminPhone} / ${adminEmail}`
          );
          continue;
        }

        const rowServiceType = this.excelCellText(record.service_type) || "amc";
        const rowIsAmc =
          this.normalizeCompanyServiceType(rowServiceType) === company_service_type.amc;
        const serviceTerms = this.resolveCompanyServiceTerms({
          service_type: rowServiceType,
          amc_type: this.excelCellText(record.amc_type),
          start_date:
            this.excelDate(record.start_date) ||
            (rowIsAmc ? moment.utc().startOf("day").toDate() : undefined),
          end_date:
            this.excelDate(record.end_date) ||
            (rowIsAmc ? moment.utc().add(1, "year").startOf("day").toDate() : undefined),
        });
        if ("error" in serviceTerms) {
          errors.push(`Row ${item.rowNumber}: ${serviceTerms.error}`);
          continue;
        }

        const dbUser = await prisma.user.create({
          data: {
            name: adminName,
            location: this.excelCellText(record.admin_location) || "",
            phone: adminPhone,
            email: adminEmail,
            password: adminPassword,
            access_level: access_level.client_admin,
            created_by: userPhone,
            updated_by: userPhone,
          },
        });
        const dbCompany = await prisma.company.create({
          data: {
            name: companyName,
            branch_name: branchName,
            email:
              this.excelCellText(record.company_email) || adminEmail,
            service_type: serviceTerms.service_type,
            amc_type: serviceTerms.amc_type,
            start_date: serviceTerms.start_date,
            end_date: serviceTerms.end_date,
            location:
              this.excelCellText(record.company_location) ||
              this.excelCellText(record.location) ||
              "",
            created_by: userPhone,
            updated_by: userPhone,
          },
        });
        await prisma.company_user.create({
          data: {
            company_link: dbCompany.id,
            user_link: dbUser.id,
          },
        });
        created += 1;
      }

      return res.status(200).send({
        status: 200,
        message: this.uploadSummary(created, duplicates, errors, "AMCs"),
        errors: [...duplicates.map((item) => `Duplicate skipped: ${item}`), ...errors],
        added: created,
        skipped: duplicates.length,
      });
    } catch (e) {
      return res.status(200).send({
        status: HttpStatus.CONFLICT,
        message: `Failed to upload AMC data ${e}`,
      });
    }
  }

  async uploadTechnicianData(res, req, file) {
    try {
      const loaded = await this.loadExcelRows(file);
      if (loaded.error) {
        return res.status(200).send({
          status: HttpStatus.CONFLICT,
          message: loaded.error,
        });
      }
      const errors = [...(loaded.errors || [])];
      const duplicates = [];
      let created = 0;
      const userPhone = req.user?.phone || "EG-Backend";
      const mobileRegex = /^(\+\d{1,3}[- ]?)?\d{10}$/;

      for (const item of loaded.rows) {
        const record = item.record;
        const name = this.excelCellText(record.name);
        const phone =
          this.excelCellText(record.phone) ||
          this.excelCellText(record.mobile);
        const email = this.excelCellText(record.email);
        const password = this.excelCellText(record.password);
        const designation = this.normalizeTechnicianDesignation(
          this.excelCellText(record.designation)
        );
        if (!name && !phone && !email) continue;
        if (!name || !phone || !email || !password || !designation) {
          errors.push(
            `Row ${item.rowNumber}: name, phone, email, password and a valid designation (${SENIOR_DESIGNATION} or ${JUNIOR_DESIGNATION}) are required`
          );
          continue;
        }
        if (!mobileRegex.test(phone)) {
          errors.push(`Row ${item.rowNumber}: invalid phone`);
          continue;
        }
        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [
              { phone },
              { email: { equals: email, mode: "insensitive" } },
            ],
          },
        });
        if (existingUser) {
          duplicates.push(`Row ${item.rowNumber}: ${name} (${phone} / ${email})`);
          continue;
        }
        await prisma.user.create({
          data: {
            name,
            phone,
            email,
            password,
            location: this.excelCellText(record.location) || "",
            access_level: access_level.technician,
            designation,
            created_by: userPhone,
            updated_by: userPhone,
          },
        });
        created += 1;
      }

      return res.status(200).send({
        status: 200,
        message: this.uploadSummary(created, duplicates, errors, "service engineers"),
        errors: [...duplicates.map((item) => `Duplicate skipped: ${item}`), ...errors],
        added: created,
        skipped: duplicates.length,
      });
    } catch (e) {
      return res.status(200).send({
        status: HttpStatus.CONFLICT,
        message: `Failed to upload service engineer data ${e}`,
      });
    }
  }

  private normalizeTechnicianDesignation(value: unknown): string | null {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized === "senior service engineer") return SENIOR_DESIGNATION;
    if (normalized === "junior service engineer" || normalized === "junior technician") {
      return JUNIOR_DESIGNATION;
    }
    return null;
  }

  private hasBodyValue(value: unknown): boolean {
    return value != null && String(value).trim() !== "";
  }

  private normalizeCompanyServiceType(value: unknown): company_service_type | null {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (normalized === "amc") return company_service_type.amc;
    if (normalized === "non_amc" || normalized === "nonamc") return company_service_type.non_amc;
    if (normalized === "regular") return company_service_type.regular;
    return null;
  }

  private normalizeAmcType(value: unknown): amc_type | null {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (normalized === "c_amc" || normalized === "camc") return amc_type.c_amc;
    if (normalized === "nc_amc" || normalized === "ncamc") return amc_type.nc_amc;
    return null;
  }

  private parseCompanyDate(value: unknown): Date | null | "invalid" {
    if (value instanceof Date) return isNaN(value.getTime()) ? "invalid" : value;
    if (!this.hasBodyValue(value)) return null;
    const parsed = moment.utc(String(value).trim(), "YYYY-MM-DD", true);
    return parsed.isValid() ? parsed.startOf("day").toDate() : "invalid";
  }

  /**
   * Only AMC companies carry an AMC type and contract dates; Non-AMC and
   * Regular companies always store them as null. Missing fields fall back to
   * `existing` so partial updates keep the saved values.
   */
  private resolveCompanyServiceTerms(
    body: Record<string, unknown>,
    existing?: company | null
  ):
    | { error: string }
    | {
        service_type: company_service_type;
        amc_type: amc_type | null;
        start_date: Date | null;
        end_date: Date | null;
      } {
    const serviceType = this.hasBodyValue(body.service_type)
      ? this.normalizeCompanyServiceType(body.service_type)
      : existing?.service_type ?? null;
    if (!serviceType) {
      return {
        error: this.hasBodyValue(body.service_type)
          ? "Service type must be AMC, Non-AMC or Regular"
          : "Please select a service type",
      };
    }
    if (serviceType !== company_service_type.amc) {
      return { service_type: serviceType, amc_type: null, start_date: null, end_date: null };
    }

    const amcType = this.hasBodyValue(body.amc_type)
      ? this.normalizeAmcType(body.amc_type)
      : existing?.amc_type ?? null;
    if (!amcType) {
      return {
        error: this.hasBodyValue(body.amc_type)
          ? "AMC type must be C AMC or NC AMC"
          : "Please select an AMC type (C AMC or NC AMC)",
      };
    }

    const startDate = this.hasBodyValue(body.start_date)
      ? this.parseCompanyDate(body.start_date)
      : existing?.start_date ?? null;
    const endDate = this.hasBodyValue(body.end_date)
      ? this.parseCompanyDate(body.end_date)
      : existing?.end_date ?? null;
    if (startDate === "invalid") return { error: "Invalid start date" };
    if (endDate === "invalid") return { error: "Invalid end date" };
    if (!startDate || !endDate) {
      return { error: "Start date and end date are required for AMC" };
    }
    if (endDate < startDate) {
      return { error: "End date must be on or after start date" };
    }
    return { service_type: serviceType, amc_type: amcType, start_date: startDate, end_date: endDate };
  }

  private uploadSummary(
    created: number,
    duplicates: string[],
    errors: string[],
    label: string
  ): string {
    const parts = [`Added ${created} ${label}`];
    if (duplicates.length) {
      parts.push(`not added ${duplicates.length} duplicates`);
    }
    if (errors.length) {
      parts.push(`${errors.length} rows had errors`);
    }
    if (!created && !duplicates.length && !errors.length) {
      return `No ${label} rows found in the Excel file`;
    }
    return parts.join(". ");
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

  private cloudinaryEnabled() {
    return String(process.env.CLOUDINARY_DISABLED || "").toLowerCase() !== "true";
  }

  async uploadToCloudinary(file: Express.Multer.File, folderName?: string) {
    if (!this.cloudinaryEnabled() || !file?.buffer) {
      return null;
    }
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "dcci94lc";
    const preset = process.env.CLOUDINARY_UPLOAD_PRESET || "evergreen_app";
    const folder = `evergreen/${String(folderName || "misc")
      .replace(/[^a-zA-Z0-9/_-]/g, "_")
      .replace(/^\/+|\/+$/g, "")}`;
    const form = new FormData();
    const blob = new Blob([file.buffer], {
      type: file.mimetype || "application/octet-stream",
    });
    const original = String(file.originalname || "upload.bin").replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );
    form.append("file", blob, original);
    form.append("upload_preset", preset);
    form.append("folder", folder);
    form.append("tags", folderName || "evergreen");
    const { data } = await axios.post(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      form,
      { timeout: 30000 }
    );
    return data?.secure_url || data?.url || null;
  }

  async uploadMedia(res, req, file: Express.Multer.File) {
    if (!file) {
      return res.status(402).send({
        status: 402,
        message: "Something went wrong",
      });
    }
    const folderName = (req.query?.folderName as string) || "misc";
    try {
      const cloudUrl = await this.uploadToCloudinary(file, folderName);
      if (cloudUrl) {
        return res.status(200).send({
          status: 200,
          message: "File uploaded Successfully",
          image_url: cloudUrl,
        });
      }
    } catch (error) {
      this.logger.error("Cloudinary upload failed, using local disk", error);
    }

    const uploadPath = path.join(process.cwd(), "uploads", folderName);
    this.ensureUploadPath(uploadPath);
    const fileName = `${Date.now()}-${String(file.originalname || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    writeFileSync(path.join(uploadPath, fileName), file.buffer);
    return res.status(200).send({
      status: 200,
      message: "File uploaded Successfully",
      image_url: path.join("uploads", folderName, fileName),
    });
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
    const requester = await this.findOne(req.user?.phone);
    if (!requester || !this.adminOrNot(requester.access_level)) {
      return res.send({
        status: HttpStatus.FORBIDDEN,
        message: "You do not have access to these stats",
      });
    }
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
    const requester = await this.findOne(req.user?.phone);
    if (!requester || !this.adminOrNot(requester.access_level)) {
      return res.send({
        status: HttpStatus.FORBIDDEN,
        message: "You do not have access to these stats",
      });
    }
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

  private async notificationUserId(req): Promise<number> {
    const callerId = parseInt(String(req.user.sub), 10);
    const requested = parseInt(String(req.body?.user_link ?? ""), 10);
    if (!Number.isFinite(requested) || requested === callerId) return callerId;
    const caller = await this.findOne(req.user.phone);
    return this.adminOrNot(caller?.access_level) ? requested : callerId;
  }

  async markNotificationsRead(res, req) {
    const callerId = parseInt(String(req.user.sub), 10);
    const ids = Array.isArray(req.body?.notification_ids)
      ? req.body.notification_ids
          .map((id) => parseInt(String(id), 10))
          .filter((id) => Number.isFinite(id))
      : [];
    const all = req.body?.all === true || req.body?.all === "true";
    if (!all && ids.length === 0) {
      return res.send({
        status: HttpStatus.BAD_REQUEST,
        message: "Provide notification_ids or all: true",
      });
    }
    const result = await prisma.notifications.updateMany({
      where: {
        user_link: callerId,
        is_read: false,
        ...(all ? {} : { id: { in: ids } }),
      },
      data: { is_read: true, updated_at: new Date(), updated_by: req.user.phone },
    });
    return res.status(200).send({
      status: 200,
      message: "Notifications marked as read",
      data: { updated: result.count },
    });
  }

  async getUnreadNotificationsCount(res, req) {
    const count = await prisma.notifications.count({
      where: { user_link: parseInt(String(req.user.sub), 10), is_read: false },
    });
    return res.status(200).send({
      status: 200,
      message: "Unread notifications count",
      data: { count },
    });
  }

  async changePassword(res, req) {
    const currentPassword = String(req.body?.current_password ?? "");
    const newPassword = String(req.body?.new_password ?? "");
    if (!currentPassword || !newPassword) {
      return res.send({
        status: HttpStatus.BAD_REQUEST,
        message: "current_password and new_password are required",
      });
    }
    if (newPassword.length < 6 || newPassword.length > 20) {
      return res.send({
        status: HttpStatus.BAD_REQUEST,
        message: "New password must be 6 to 20 characters",
      });
    }
    const caller = await prisma.user.findUnique({
      where: { id: parseInt(String(req.user.sub), 10) },
    });
    if (!caller) {
      return res.send({ status: 401, message: "Please login again" });
    }
    if (caller.password !== currentPassword) {
      return res.send({ status: 402, message: "current password is incorrect" });
    }
    await prisma.user.update({
      where: { id: caller.id },
      data: { password: newPassword, updated_at: new Date(), updated_by: caller.phone },
    });
    return res.status(200).send({ status: 200, message: "password updated" });
  }

  async getMe(res, req) {
    const me = await this.findOne(req.user?.phone);
    if (!me) {
      return res.status(401).send({ status: 401, message: "Please login again" });
    }
    return res.status(200).send({
      status: 200,
      message: "user retrieved successfully",
      data: this.withoutPassword(me),
    });
  }

  async getNotificationsByUserId(res, req) {
    const userId = await this.notificationUserId(req);
    const notifications = await prisma.notifications.findMany({
      where: {
        user_link: userId,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    await this.enrichNotificationsWithAcceptedBy(notifications);

    return res.status(200).send({
      status: 200,
      message: "Notifications retrieved successfully",
      data: notifications,
    });
  }

  async getNotificationsPage(res, req) {
    const userId = await this.notificationUserId(req);
    const rawPage = Number(req.body.page);
    const rawLimit = Number(req.body.limit);
    const page =
      Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(50, Math.floor(rawLimit))
        : 20;
    const skip = (page - 1) * limit;

    const where = { user_link: userId };
    const [total, notifications] = await Promise.all([
      prisma.notifications.count({ where }),
      prisma.notifications.findMany({
        where,
        orderBy: {
          created_at: "desc",
        },
        skip,
        take: limit,
      }),
    ]);

    await this.enrichNotificationsWithAcceptedBy(notifications);

    return res.status(200).send({
      status: 200,
      message: "Notifications retrieved successfully",
      data: notifications,
      page,
      limit,
      total,
      has_more: skip + notifications.length < total,
    });
  }

  private async enrichNotificationsWithAcceptedBy(notifications) {
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

      const filteredTaskUser =
        tasks?.task_user.filter((user) => user.technician_link !== null) ?? [];

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
  }

  async register(res, req) {
    const name = String(req.body?.name ?? "").trim();
    const phone = String(req.body?.phone ?? "").trim();
    const email = String(req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");
    const location = String(req.body?.location ?? "").trim();
    if (!name || !phone || !email || !password) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "name, phone, email and password are required" });
    }
    if (!/^(\+\d{1,3}[- ]?)?\d{10}$/.test(phone)) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "Please enter valid mobile number" });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "Please enter a valid email" });
    }
    if (password.length < 6 || password.length > 20) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "Password must be 6 to 20 characters" });
    }
    if (name.length > 200 || location.length > 100 || email.length > 100) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "name, email or location is too long" });
    }
    const phoneTaken = await prisma.user.findFirst({ where: { phone } });
    if (phoneTaken) {
      return res.send({ status: HttpStatus.NO_CONTENT, message: `user already exists with phone ${phone}` });
    }
    const emailTaken = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (emailTaken) {
      return res.send({ status: HttpStatus.NO_CONTENT, message: "This email is already used by another user" });
    }
    const created = await prisma.user.create({
      data: {
        name,
        phone,
        email,
        password,
        location,
        access_level: access_level.client,
        is_active: false,
        created_by: phone,
        updated_by: phone,
      },
    });
    try {
      await this.notificationService.pushToLevels(
        [access_level.eg_super_admin, access_level.eg_admin],
        undefined,
        "New registration",
        {
          description: `${name} (${phone}) registered and is waiting for activation.`,
          image_url: "",
          task_link: "",
          channel_id: "evergreen_normal",
          action: "",
        },
      );
    } catch (notifyError) {
      console.error("register notification failed", notifyError);
    }
    await this.recordAudit(created, audit_action.created, audit_entity.user, created.id, created.name, "self registration (inactive)");
    return res.status(200).send({
      status: 200,
      message: "Registration received. An administrator will activate your account.",
    });
  }

  async logout(res, req) {
    const me = await this.findOne(req.user?.phone);
    const deviceId = String(req.body?.device_id ?? "").trim();
    const fcmId = String(req.body?.fcm_id ?? "").trim();
    if (me && (deviceId || fcmId)) {
      await prisma.tokens.deleteMany({
        where: {
          user_link: me.id,
          ...(deviceId ? { device_id: deviceId } : {}),
          ...(fcmId ? { fcm_id: fcmId } : {}),
        },
      });
    }
    if (me) {
      await this.recordAudit(me, audit_action.logged_out, audit_entity.auth, me.id, me.name);
    }
    return res.status(200).send({ status: 200, message: "logged out" });
  }

  private async loadTaskContext(rawTaskLink) {
    const taskId = parseInt(String(rawTaskLink ?? ""), 10);
    if (!Number.isFinite(taskId)) return null;
    const task = await prisma.tasks.findUnique({
      where: { id: taskId },
      include: {
        equipment: { include: { company: true } },
        task_user: { orderBy: { id: "desc" }, take: 1 },
      },
    });
    if (!task) return null;
    return { task, latest: task.task_user[0] ?? null };
  }

  private async notifyTaskUsers(userIds: Array<number | null | undefined>, title: string, task, description: string, excludeUserId?: number) {
    try {
      await this.notificationService.pushToUsers(
        userIds.filter((id): id is number => id != null),
        title,
        this.notificationService.taskPayload(task, { description }),
        excludeUserId,
      );
    } catch (notifyError) {
      console.error(`${title} notification failed`, notifyError);
    }
  }

  private stripTaskRelations(task) {
    if (!task) return task;
    const { task_user, equipment, ...rest } = task;
    return rest;
  }

  async approveTask(res, req) {
    const actor = await this.loadActor(req);
    if (!this.canTriage(actor)) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "Only admins and senior service engineers can approve tickets" });
    }
    const ctx = await this.loadTaskContext(req.body?.task_link);
    if (!ctx) return res.send({ status: HttpStatus.NO_CONTENT, message: "Task not found" });
    const next = this.nextApprovalState("approve", ctx.task.approval);
    if (!next) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: `Only requested tickets can be approved (current: ${ctx.task.approval})` });
    }
    const note = this.hasBodyValue(req.body?.note) ? String(req.body.note).trim() : null;
    const updated = await prisma.tasks.update({
      where: { id: ctx.task.id },
      data: { approval: next, manager_link: actor.id, updated_at: new Date(), updated_by: req.user?.phone },
    });
    await this.recordAudit(actor, audit_action.updated, audit_entity.task, updated.id, updated.ticket_no, note ? `approved: ${note}` : "approved");
    await this.notifyTaskUsers(
      [ctx.latest?.client_link],
      "Ticket approved",
      ctx.task,
      `${actor.name} approved ticket ${updated.ticket_no}${note ? `: ${note}` : ""}.`,
      actor.id,
    );
    return res.status(200).send({ status: 200, message: "Ticket approved", data: updated });
  }

  async rejectTask(res, req) {
    const actor = await this.loadActor(req);
    if (!this.canTriage(actor)) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "Only admins and senior service engineers can reject tickets" });
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return res.send({ status: HttpStatus.BAD_REQUEST, message: "reason is required" });
    const ctx = await this.loadTaskContext(req.body?.task_link);
    if (!ctx) return res.send({ status: HttpStatus.NO_CONTENT, message: "Task not found" });
    const next = this.nextApprovalState("reject", ctx.task.approval);
    if (!next) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: `Only requested tickets can be rejected (current: ${ctx.task.approval})` });
    }
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      if (ctx.latest) {
        await tx.task_user.update({
          where: { id: ctx.latest.id },
          data: { status: status.closed, reason, updated_at: now, updated_by: req.user?.phone },
        });
      }
      return tx.tasks.update({
        where: { id: ctx.task.id },
        data: {
          approval: next,
          status: status.closed,
          rejection_reason: reason,
          closed_at: now,
          manager_link: ctx.task.manager_link ?? actor.id,
          updated_at: now,
          updated_by: req.user?.phone,
        },
      });
    });
    await this.recordAudit(actor, audit_action.updated, audit_entity.task, updated.id, updated.ticket_no, `rejected: ${reason}`);
    await this.notifyTaskUsers(
      [ctx.latest?.client_link],
      "Ticket rejected",
      ctx.task,
      `${actor.name} rejected ticket ${updated.ticket_no}: ${reason}`,
      actor.id,
    );
    return res.status(200).send({ status: 200, message: "Ticket rejected", data: updated });
  }

  async acceptTask(res, req) {
    const actor = await this.loadActor(req);
    const ctx = await this.loadTaskContext(req.body?.task_link);
    if (!ctx) return res.send({ status: HttpStatus.NO_CONTENT, message: "Task not found" });
    if (!actor || ctx.latest?.technician_link == null || ctx.latest.technician_link !== actor.id) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "Only the assigned service engineer can accept this ticket" });
    }
    if (ctx.latest.status === status.completed || ctx.latest.status === status.closed) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "This ticket is already completed" });
    }
    const updated = ctx.task.accepted_at
      ? this.stripTaskRelations(ctx.task)
      : await prisma.tasks.update({
          where: { id: ctx.task.id },
          data: { accepted_at: new Date(), updated_at: new Date(), updated_by: req.user?.phone },
        });
    if (!ctx.task.accepted_at) {
      await this.recordAudit(actor, audit_action.updated, audit_entity.task, updated.id, updated.ticket_no, "accepted by service engineer");
    }
    return res.status(200).send({ status: 200, message: "Ticket accepted", data: updated });
  }

  async unassignTask(res, req) {
    const actor = await this.loadActor(req);
    if (!this.canTriage(actor)) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "Only admins and senior service engineers can unassign tickets" });
    }
    const ctx = await this.loadTaskContext(req.body?.task_link);
    if (!ctx) return res.send({ status: HttpStatus.NO_CONTENT, message: "Task not found" });
    if (!ctx.latest || ctx.latest.technician_link == null) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "No service engineer is assigned to this ticket" });
    }
    const next = this.nextApprovalState("unassign", ctx.task.approval);
    if (!next || ctx.latest.status === status.completed || ctx.latest.status === status.closed) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "Completed or closed tickets cannot be unassigned" });
    }
    const removedTechnician = ctx.latest.technician_link;
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.task_user.update({
        where: { id: ctx.latest.id },
        data: { technician_link: null, status: status.open, updated_at: now, updated_by: req.user?.phone },
      });
      return tx.tasks.update({
        where: { id: ctx.task.id },
        data: {
          assigned_at: null,
          accepted_at: null,
          approval: next,
          status: status.open,
          updated_at: now,
          updated_by: req.user?.phone,
        },
      });
    });
    await this.recordAudit(actor, audit_action.updated, audit_entity.task, updated.id, updated.ticket_no, `service engineer unassigned (was ${removedTechnician})`);
    await this.notifyTaskUsers(
      [removedTechnician],
      "Task unassigned",
      ctx.task,
      `${actor.name} removed you from ticket ${updated.ticket_no}.`,
      actor.id,
    );
    return res.status(200).send({ status: 200, message: "Service engineer unassigned", data: updated });
  }

  async escalateTask(res, req) {
    const actor = await this.loadActor(req);
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return res.send({ status: HttpStatus.BAD_REQUEST, message: "reason is required" });
    const ctx = await this.loadTaskContext(req.body?.task_link);
    if (!ctx) return res.send({ status: HttpStatus.NO_CONTENT, message: "Task not found" });
    if (!this.canSeeTask(actor, ctx.latest?.technician_link, ctx.task.equipment?.company_link)) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "You do not have access to this ticket" });
    }
    const updated = await prisma.tasks.update({
      where: { id: ctx.task.id },
      data: { escalated: true, escalation_reason: reason, updated_at: new Date(), updated_by: req.user?.phone },
    });
    await this.recordAudit(actor, audit_action.updated, audit_entity.task, updated.id, updated.ticket_no, `escalated: ${reason}`);
    try {
      await this.notificationService.pushToLevels(
        [access_level.eg_super_admin, access_level.eg_admin],
        undefined,
        "Ticket escalated",
        this.notificationService.taskPayload(ctx.task, {
          description: `${actor.name} escalated ticket ${updated.ticket_no}: ${reason}`,
        }),
        actor.id,
      );
    } catch (notifyError) {
      console.error("escalateTask notification failed", notifyError);
    }
    return res.status(200).send({ status: 200, message: "Ticket escalated", data: updated });
  }

  async deescalateTask(res, req) {
    const actor = await this.loadActor(req);
    if (!this.adminOrNot(actor?.access_level)) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "Only admins can de-escalate tickets" });
    }
    const ctx = await this.loadTaskContext(req.body?.task_link);
    if (!ctx) return res.send({ status: HttpStatus.NO_CONTENT, message: "Task not found" });
    const updated = await prisma.tasks.update({
      where: { id: ctx.task.id },
      data: { escalated: false, escalation_reason: null, updated_at: new Date(), updated_by: req.user?.phone },
    });
    await this.recordAudit(actor, audit_action.updated, audit_entity.task, updated.id, updated.ticket_no, "de-escalated");
    return res.status(200).send({ status: 200, message: "Ticket de-escalated", data: updated });
  }

  async verifyEquipment(res, req) {
    const userInfo = await this.findOne(req.user?.phone);
    const equipmentId = parseInt(String(req.body?.equipment_link ?? ""), 10);
    if (!Number.isFinite(equipmentId)) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "equipment_link is required" });
    }
    const existing = await prisma.equipment.findUnique({ where: { id: equipmentId } });
    if (!existing) return res.send({ status: HttpStatus.NO_CONTENT, message: "Equipment not found" });
    if (!this.canAccessCompany(userInfo, existing.company_link)) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "You do not have access to this equipment" });
    }
    const verified = await prisma.equipment.update({
      where: { id: equipmentId },
      data: { verified_at: new Date(), verified_by: userInfo.id },
      include: { company: true, verifier: { select: { id: true, name: true } } },
    });
    await this.recordAudit(userInfo, audit_action.updated, audit_entity.equipment, verified.id, verified.name, "verified");
    return res.status(200).send({ status: 200, message: "Equipment verified", data: verified });
  }

  /** Equipment filter for read-only lists: admins and technicians see all companies, others their own. */
  private equipmentReadScope(userInfo, rawCompanyLink): { where: Record<string, unknown> } | { error: string; status: number } {
    if (this.hasBodyValue(rawCompanyLink)) {
      const companyId = parseInt(String(rawCompanyLink), 10);
      if (!Number.isFinite(companyId)) return { error: "company_link must be a number", status: HttpStatus.BAD_REQUEST };
      if (!this.canAccessCompany(userInfo, companyId)) {
        return { error: "You do not have access to this company", status: HttpStatus.FORBIDDEN };
      }
      return { where: { company_link: companyId } };
    }
    if (this.adminOrNot(userInfo?.access_level) || this.isTechnicianRole(userInfo?.access_level)) {
      return { where: {} };
    }
    return { where: { company_link: { in: this.attachedCompanyIds(userInfo) } } };
  }

  async getVerifiedEquipments(res, req) {
    const userInfo = await this.findOne(req.user?.phone);
    const scope = this.equipmentReadScope(userInfo, req.body?.company_link);
    if ("error" in scope) return res.send({ status: scope.status, message: scope.error });
    const rows = await prisma.equipment.findMany({
      where: { ...scope.where, verified_at: { not: null } },
      include: { company: true, verifier: { select: { id: true, name: true } } },
      orderBy: { verified_at: "desc" },
    });
    return res.status(200).send({ status: 200, message: "verified equipments retrieved", data: rows });
  }

  async getPmSchedules(res, req) {
    const userInfo = await this.findOne(req.user?.phone);
    const scope = this.equipmentReadScope(userInfo, req.body?.company_link);
    if ("error" in scope) return res.send({ status: scope.status, message: scope.error });
    const rows = await prisma.pm_schedule.findMany({
      where: { equipment: scope.where },
      include: { equipment: { include: { company: true } } },
      orderBy: { next_due: "asc" },
    });
    return res.status(200).send({ status: 200, message: "PM schedules retrieved", data: rows });
  }

  private async pmAdmin(req, res) {
    const actor = await this.findOne(req.user?.phone);
    if (!this.adminOrNot(actor?.access_level)) {
      res.send({ status: HttpStatus.FORBIDDEN, message: "Only admins can manage PM schedules" });
      return null;
    }
    return actor;
  }

  async createPmSchedule(res, req) {
    const actor = await this.pmAdmin(req, res);
    if (!actor) return;
    const equipmentId = parseInt(String(req.body?.equipment_link ?? ""), 10);
    const frequency = this.normalizePmFrequency(req.body?.frequency);
    const nextDue = this.parseOptionalDate(req.body?.next_due);
    if (!Number.isFinite(equipmentId)) return res.send({ status: HttpStatus.BAD_REQUEST, message: "equipment_link is required" });
    if (!frequency) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "frequency must be monthly, quarterly, half_yearly or yearly" });
    }
    if (!(nextDue instanceof Date)) return res.send({ status: HttpStatus.BAD_REQUEST, message: "next_due must be an ISO date" });
    const equipmentRow = await prisma.equipment.findUnique({ where: { id: equipmentId } });
    if (!equipmentRow) return res.send({ status: HttpStatus.NO_CONTENT, message: "Equipment not found" });
    const created = await prisma.pm_schedule.create({
      data: { equipment_link: equipmentId, frequency, next_due: nextDue, created_by: actor.phone },
      include: { equipment: { include: { company: true } } },
    });
    await this.recordAudit(actor, audit_action.created, audit_entity.equipment, equipmentRow.id, equipmentRow.name, `PM schedule ${created.id} (${frequency})`);
    return res.status(200).send({ status: 200, message: "PM schedule created", data: created });
  }

  async updatePmSchedule(res, req) {
    const actor = await this.pmAdmin(req, res);
    if (!actor) return;
    const scheduleId = parseInt(String(req.body?.pm_schedule_link ?? ""), 10);
    if (!Number.isFinite(scheduleId)) return res.send({ status: HttpStatus.BAD_REQUEST, message: "pm_schedule_link is required" });
    const existing = await prisma.pm_schedule.findUnique({ where: { id: scheduleId } });
    if (!existing) return res.send({ status: HttpStatus.NO_CONTENT, message: "PM schedule not found" });
    const data: { frequency?: pm_frequency; next_due?: Date; is_active?: boolean; updated_at: Date } = { updated_at: new Date() };
    if (this.hasBodyValue(req.body?.frequency)) {
      const frequency = this.normalizePmFrequency(req.body.frequency);
      if (!frequency) {
        return res.send({ status: HttpStatus.BAD_REQUEST, message: "frequency must be monthly, quarterly, half_yearly or yearly" });
      }
      data.frequency = frequency;
    }
    if (this.hasBodyValue(req.body?.next_due)) {
      const nextDue = this.parseOptionalDate(req.body.next_due);
      if (!(nextDue instanceof Date)) return res.send({ status: HttpStatus.BAD_REQUEST, message: "next_due must be an ISO date" });
      data.next_due = nextDue;
    }
    if (req.body?.is_active !== undefined) {
      const isActive = this.parseBoolean(req.body.is_active);
      if (isActive == null) return res.send({ status: HttpStatus.BAD_REQUEST, message: "is_active must be true or false" });
      data.is_active = isActive;
    }
    const updated = await prisma.pm_schedule.update({
      where: { id: scheduleId },
      data,
      include: { equipment: { include: { company: true } } },
    });
    await this.recordAudit(actor, audit_action.updated, audit_entity.equipment, updated.equipment_link, updated.equipment?.name, `PM schedule ${updated.id} updated`);
    return res.status(200).send({ status: 200, message: "PM schedule updated", data: updated });
  }

  async deletePmSchedule(res, req) {
    const actor = await this.pmAdmin(req, res);
    if (!actor) return;
    const scheduleId = parseInt(String(req.body?.pm_schedule_link ?? ""), 10);
    if (!Number.isFinite(scheduleId)) return res.send({ status: HttpStatus.BAD_REQUEST, message: "pm_schedule_link is required" });
    const existing = await prisma.pm_schedule.findUnique({ where: { id: scheduleId }, include: { equipment: true } });
    if (!existing) return res.send({ status: HttpStatus.NO_CONTENT, message: "PM schedule not found" });
    await prisma.pm_schedule.delete({ where: { id: scheduleId } });
    await this.recordAudit(actor, audit_action.deleted, audit_entity.equipment, existing.equipment_link, existing.equipment?.name, `PM schedule ${scheduleId} deleted`);
    return res.status(200).send({ status: 200, message: "PM schedule deleted", data: { id: scheduleId } });
  }

  async generatePmTasks(res, req) {
    const actor = await this.pmAdmin(req, res);
    if (!actor) return;
    const rawDays = req.body?.days_ahead;
    const daysAhead = this.hasBodyValue(rawDays) ? Number(rawDays) : 7;
    if (!Number.isFinite(daysAhead) || daysAhead < 0 || daysAhead > 365) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "days_ahead must be between 0 and 365" });
    }
    const windowEnd = moment.utc().add(daysAhead, "days").toDate();
    const schedules = await prisma.pm_schedule.findMany({
      where: { is_active: true, next_due: { lte: windowEnd }, equipment: { is_active: true } },
      include: { equipment: true },
      orderBy: { next_due: "asc" },
    });
    const generated = [];
    for (const schedule of schedules) {
      if (schedule.equipment.status === equipment_status.retired) continue;
      try {
        const row = await prisma.$transaction(async (tx) => {
          const claimed = await tx.pm_schedule.updateMany({
            where: { id: schedule.id, next_due: schedule.next_due, is_active: true },
            data: { next_due: this.advancePmDueDate(schedule.next_due, schedule.frequency), updated_at: new Date() },
          });
          if (claimed.count !== 1) return null;
          const clientAdmin = schedule.equipment.company_link
            ? await tx.company_user.findFirst({
                where: { company_link: schedule.equipment.company_link, user: { access_level: access_level.client_admin } },
                orderBy: { assigned_at: "asc" },
                select: { user_link: true },
              })
            : null;
          const name = `PM - ${schedule.equipment.name}`;
          const description = `Preventive maintenance due ${moment.utc(schedule.next_due).format("YYYY-MM-DD")} (${schedule.frequency})`;
          const task = await tx.tasks.create({
            data: {
              name,
              description,
              equipment_link: schedule.equipment_link,
              call_type: call_type.amc_preventive_maintenance,
              ticket_no: getAccountFromCompany(name + description + call_type.amc_preventive_maintenance),
              otp: this.generateOtp(),
              status: status.open,
              approval: approval_state.approved,
              priority: task_priority.medium,
              due_date: schedule.next_due,
              manager_link: actor.id,
              created_by: actor.phone,
              updated_by: actor.phone,
            },
          });
          await tx.task_user.create({
            data: {
              client_link: clientAdmin?.user_link ?? actor.id,
              task_link: task.id,
              status: status.open,
              created_by: actor.phone,
              updated_by: actor.phone,
            },
          });
          return tx.pm_generated_task.create({
            data: { schedule_link: schedule.id, task_link: task.id, due_date: schedule.next_due },
            include: { task: true, schedule: { include: { equipment: { include: { company: true } } } } },
          });
        });
        if (row) {
          generated.push(row);
          await this.recordAudit(actor, audit_action.created, audit_entity.task, row.task_link, row.task?.ticket_no, `PM task for schedule ${schedule.id}`);
        }
      } catch (error) {
        this.logger.error(`PM generation failed for schedule ${schedule.id}`, error);
      }
    }
    return res.status(200).send({
      status: 200,
      message: `Generated ${generated.length} PM task${generated.length === 1 ? "" : "s"}`,
      data: generated,
    });
  }

  async getPmGeneratedTasks(res, req) {
    const userInfo = await this.findOne(req.user?.phone);
    const scope = this.equipmentReadScope(userInfo, req.body?.company_link);
    if ("error" in scope) return res.send({ status: scope.status, message: scope.error });
    const scheduleId = this.hasBodyValue(req.body?.schedule_link) ? parseInt(String(req.body.schedule_link), 10) : undefined;
    if (scheduleId !== undefined && !Number.isFinite(scheduleId)) {
      return res.send({ status: HttpStatus.BAD_REQUEST, message: "schedule_link must be a number" });
    }
    const rows = await prisma.pm_generated_task.findMany({
      where: { schedule_link: scheduleId, schedule: { equipment: scope.where } },
      include: {
        task: { select: { id: true, ticket_no: true, name: true, status: true, approval: true, due_date: true } },
        schedule: {
          include: {
            equipment: {
              select: {
                id: true,
                name: true,
                eg_serial_number: true,
                company: { select: { id: true, name: true, branch_name: true } },
              },
            },
          },
        },
      },
      orderBy: { generated_at: "desc" },
      take: 500,
    });
    const data = rows.map((row) => ({
      ...row,
      frequency: row.schedule.frequency,
      equipment_name: row.schedule.equipment?.name ?? null,
      company_name: this.companyLabel(row.schedule.equipment?.company ?? null),
    }));
    return res.status(200).send({ status: 200, message: "PM generated tasks retrieved", data });
  }

  async getAuditLogs(res, req) {
    const actor = await this.loadActor(req);
    const scope = this.auditScopeDecision(actor);
    if (scope.scope === "none") {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "You do not have access to the audit log" });
    }
    const rawPage = Number(req.body?.page);
    const rawLimit = Number(req.body?.limit);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(100, Math.floor(rawLimit)) : 20;
    let entity: audit_entity | undefined;
    if (this.hasBodyValue(req.body?.entity)) {
      const requested = String(req.body.entity).trim().toLowerCase();
      if (!(Object.values(audit_entity) as string[]).includes(requested)) {
        return res.send({ status: HttpStatus.BAD_REQUEST, message: "entity must be user, task, amc, equipment or auth" });
      }
      entity = requested as audit_entity;
    }
    const where = {
      entity,
      ...(scope.scope === "companies"
        ? { actor: { company_user: { some: { company_link: { in: scope.companyIds } } } } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.audit_log.count({ where }),
      prisma.audit_log.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return res.status(200).send({
      status: 200,
      message: "audit logs retrieved",
      data: rows,
      total,
      page,
      limit,
    });
  }

  async getMonthlyStats(res, req) {
    const actor = await this.loadActor(req);
    if (!this.canTriage(actor)) {
      return res.send({ status: HttpStatus.FORBIDDEN, message: "You do not have access to these stats" });
    }
    const thisMonth = moment.utc().startOf("month");
    const months = [];
    for (let index = 0; index < 12; index++) {
      const start = thisMonth.clone().subtract(11 - index, "months");
      const range = { gte: start.toDate(), lt: start.clone().add(1, "month").toDate() };
      const [tasksCreated, tasksClosed, companies, users] = await Promise.all([
        prisma.tasks.count({ where: { created_at: range } }),
        prisma.tasks.count({ where: { closed_at: range } }),
        prisma.company.count({ where: { created_at: range } }),
        prisma.user.count({ where: { created_at: range } }),
      ]);
      months.push({
        month: start.format("YYYY-MM"),
        tasks_created: tasksCreated,
        tasks_closed: tasksClosed,
        companies,
        users,
      });
    }
    return res.status(200).send({
      status: 200,
      message: "monthly stats",
      data: { months, current: months[11], previous: months[10] },
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
