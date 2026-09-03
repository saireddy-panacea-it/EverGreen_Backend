import { Injectable } from "@nestjs/common";
import { PrismaClient, access_level } from "@prisma/client";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import * as moment from "moment";
import { Prisma } from "@prisma/client";
import { buildServiceReportPdf } from "./build_pdf";

const prisma = new PrismaClient();

@Injectable()
export class ServiceReportService {
  canManage(accessLevel): boolean {
    return (
      accessLevel === access_level.eg_super_admin ||
      accessLevel === access_level.eg_admin ||
      accessLevel === "eg_super_admin" ||
      accessLevel === "eg_admin"
    );
  }

  async requester(req) {
    if (!req?.user?.phone) return null;
    return prisma.user.findFirst({
      where: { phone: req.user.phone },
      include: { company_user: true },
    });
  }

  forbidden(res, message = "You are not authorized to manage service reports") {
    return res.status(403).send({
      status: 403,
      message,
    });
  }

  async requireManager(res, req) {
    const user = await this.requester(req);
    if (!user) {
      res.status(401).send({ status: 401, message: "Please login again" });
      return null;
    }
    if (!this.canManage(user.access_level)) {
      this.forbidden(res);
      return null;
    }
    return user;
  }

  formatTime(value?: Date | string) {
    if (!value) return "-";
    return moment(value).format("DD MMM YYYY, hh:mm A");
  }

  text(value): string {
    if (value == null) return "";
    return String(value).trim();
  }

  optional(value) {
    const text = this.text(value);
    return text ? text : null;
  }

  parseCost(value) {
    if (value == null || value === "") return null;
    const raw = String(value).replace(/[₹,\s]/g, "");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
  }

  parseTimeline(value) {
    if (!value) return [];
    if (typeof value === "string") {
      try {
        return this.parseTimeline(JSON.parse(value));
      } catch {
        return [];
      }
    }
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => ({
        date: this.text(item?.date),
        time: this.text(item?.time),
        title: this.text(item?.title),
        description: this.text(item?.description || item?.detail),
      }))
      .filter(
        (item) => item.date || item.time || item.title || item.description,
      );
  }

  async nextReportNumber() {
    const year = new Date().getFullYear();
    const prefix = `SR-${year}-`;
    const latest = await prisma.service_report.findFirst({
      where: { service_report_number: { startsWith: prefix } },
      orderBy: { service_report_number: "desc" },
      select: { service_report_number: true },
    });
    const last = latest?.service_report_number?.replace(prefix, "") || "0";
    const next = (parseInt(last, 10) || 0) + 1;
    return `${prefix}${String(next).padStart(5, "0")}`;
  }

  async resolveCompany(body) {
    const companyLink = parseInt(String(body?.company_link ?? ""), 10);
    let company = null;
    if (Number.isFinite(companyLink) && companyLink > 0) {
      company = await prisma.company.findUnique({ where: { id: companyLink } });
    }
    const companyName =
      this.text(body?.company_name) ||
      this.text(body?.company) ||
      this.text(company?.name);
    return {
      company,
      company_link: company?.id ?? null,
      company_name: companyName,
      company_branch:
        this.optional(body?.company_branch) ||
        this.optional(company?.branch_name),
      location:
        this.optional(body?.location) || this.optional(company?.location),
      company_email:
        this.optional(body?.company_email) || this.optional(company?.email),
    };
  }

  payloadFromBody(body, companyInfo, actor: string, existing?: any) {
    const status =
      this.optional(body?.status) || existing?.status || "Not Started";
    return {
      task_id: this.optional(body?.task_id ?? body?.taskId ?? body?.ticket_no),
      company_link: companyInfo.company_link,
      company_name: companyInfo.company_name,
      company_branch: companyInfo.company_branch,
      location: companyInfo.location,
      company_email: companyInfo.company_email,
      raised_by_name: this.optional(body?.raised_by_name),
      raised_by_phone: this.optional(body?.raised_by_phone),
      raised_by_email: this.optional(body?.raised_by_email),
      raised_by_note: this.optional(body?.raised_by_note),
      technician_name: this.optional(body?.technician_name),
      technician_phone: this.optional(body?.technician_phone),
      technician_note: this.optional(body?.technician_note),
      equipment_name: this.optional(body?.equipment_name),
      equipment_make: this.optional(body?.equipment_make),
      equipment_model: this.optional(body?.equipment_model),
      equipment_serial_number: this.optional(body?.equipment_serial_number),
      equipment_eg_serial_number: this.optional(
        body?.equipment_eg_serial_number,
      ),
      equipment_location: this.optional(body?.equipment_location),
      call_type: this.optional(body?.call_type),
      issue: this.optional(body?.issue),
      issue_description: this.optional(body?.issue_description),
      service_details: this.optional(body?.service_details),
      timeline_events: this.parseTimeline(
        body?.timeline_events ?? existing?.timeline_events,
      ) as Prisma.InputJsonValue,
      customer_serviced_to_satisfaction: this.optional(
        body?.customer_serviced_to_satisfaction,
      ),
      equipment_running_smoothly: this.optional(
        body?.equipment_running_smoothly,
      ),
      customer_comments: this.optional(body?.customer_comments),
      rating: this.optional(body?.rating),
      cost: this.parseCost(body?.cost),
      status,
      updated_by: actor,
    };
  }

  serialize(report) {
    if (!report) return null;
    return {
      ...report,
      cost:
        report.cost == null
          ? null
          : Number(report.cost),
      timeline_events: this.parseTimeline(report.timeline_events),
      generated_at: report.generated_at,
      created_at: report.created_at,
      updated_at: report.updated_at,
    };
  }

  toPdfView(report) {
    const events = this.parseTimeline(report.timeline_events).map((item) => {
      const stamp = [item.date, item.time].filter(Boolean).join(", ");
      return {
        time: stamp || "-",
        title: item.title || "Event",
        detail: item.description || "",
      };
    });
    const costValue =
      report.cost == null || report.cost === ""
        ? ""
        : `₹${Number(report.cost).toLocaleString("en-IN")}`;
    return {
      service_report_number: report.service_report_number,
      ticket_no: report.task_id || "-",
      generated_at: this.formatTime(report.generated_at || report.created_at),
      current_status: report.status || "Not Started",
      status_key: String(report.status || "")
        .toLowerCase()
        .replace(/\s+/g, "_"),
      is_closed: /closed|completed/i.test(String(report.status || "")),
      created_at: this.formatTime(report.created_at),
      created_by: report.created_by,
      call_type: report.call_type || "-",
      task_name: report.issue || "Service request",
      task_description: report.issue_description || "",
      company: {
        name: report.company_name,
        branch: report.company_branch,
        location: report.location,
        email: report.company_email,
      },
      contact: {
        name: report.raised_by_name,
        phone: report.raised_by_phone,
        email: report.raised_by_email,
        note: report.raised_by_note,
      },
      technician: {
        name: report.technician_name,
        phone: report.technician_phone,
        note: report.technician_note,
      },
      equipment: {
        name: report.equipment_name,
        make: report.equipment_make,
        model: report.equipment_model,
        serial_no: report.equipment_serial_number,
        eg_serial: report.equipment_eg_serial_number,
        location: report.equipment_location,
      },
      timeline: events,
      action_taken: report.service_details,
      service_details: report.service_details,
      cost: costValue,
      customer: {
        service_satisfactory:
          report.customer_serviced_to_satisfaction || "-",
        is_running_smoothly: report.equipment_running_smoothly || "-",
        notes: report.customer_comments || "-",
        rating: report.rating || "-",
      },
      images: [],
      signature: "",
    };
  }

  writePdf(report, includeBase64 = true) {
    const folder = "./uploads/reports";
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
    const filePath = `${folder}/${report.service_report_number}.pdf`;
    return buildServiceReportPdf(this.toPdfView(report)).then((bytes) => {
      const pdfBuffer = Buffer.from(bytes);
      writeFileSync(filePath, pdfBuffer);
      return {
        url: `uploads/reports/${report.service_report_number}.pdf`,
        pdf_base64: includeBase64 ? pdfBuffer.toString("base64") : undefined,
      };
    });
  }

  async createServiceReport(res, req) {
    try {
      const user = await this.requireManager(res, req);
      if (!user) return;
      const companyInfo = await this.resolveCompany(req.body || {});
      if (!companyInfo.company_name) {
        return res.status(400).send({
          status: 400,
          message: "Company/Customer is required",
        });
      }
      const actor = user.phone;
      const data = this.payloadFromBody(req.body || {}, companyInfo, actor);
      let created
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          created = await prisma.service_report.create({
            data: {
              ...data,
              service_report_number: await this.nextReportNumber(),
              created_by: actor,
            },
            include: { company: true },
          })
          break
        } catch (error) {
          if (error?.code !== "P2002" || attempt === 2) throw error
        }
      }
      if (!created) {
        return res.status(500).send({
          status: 500,
          message: "Unable to create service report",
        });
      }
      return res.status(200).send({
        status: 200,
        message: "Service report created successfully",
        data: this.serialize(created),
      });
    } catch (error) {
      console.error("createServiceReport failed", error);
      return res.status(500).send({
        status: 500,
        message: "Unable to create service report",
      });
    }
  }

  async updateServiceReport(res, req) {
    try {
      const user = await this.requireManager(res, req);
      if (!user) return;
      const id = parseInt(String(req.body?.id ?? req.body?.service_report_link ?? ""), 10);
      if (!id) {
        return res.status(400).send({
          status: 400,
          message: "Service report id is required",
        });
      }
      const existing = await prisma.service_report.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).send({
          status: 404,
          message: "Service report not found",
        });
      }
      const companyInfo = await this.resolveCompany({
        ...existing,
        ...req.body,
        company_name: req.body?.company_name ?? existing.company_name,
      });
      if (!companyInfo.company_name) {
        return res.status(400).send({
          status: 400,
          message: "Company/Customer is required",
        });
      }
      const updated = await prisma.service_report.update({
        where: { id },
        data: {
          ...this.payloadFromBody(req.body || {}, companyInfo, user.phone, existing),
          updated_at: new Date(),
        },
        include: { company: true },
      });
      return res.status(200).send({
        status: 200,
        message: "Service report updated successfully",
        data: this.serialize(updated),
      });
    } catch (error) {
      console.error("updateServiceReport failed", error);
      return res.status(500).send({
        status: 500,
        message: "Unable to update service report",
      });
    }
  }

  async deleteServiceReport(res, req) {
    try {
      const user = await this.requireManager(res, req);
      if (!user) return;
      const id = parseInt(String(req.body?.id ?? req.body?.service_report_link ?? ""), 10);
      if (!id) {
        return res.status(400).send({
          status: 400,
          message: "Service report id is required",
        });
      }
      const existing = await prisma.service_report.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).send({
          status: 404,
          message: "Service report not found",
        });
      }
      await prisma.service_report.delete({ where: { id } });
      return res.status(200).send({
        status: 200,
        message: "Service report deleted successfully",
      });
    } catch (error) {
      console.error("deleteServiceReport failed", error);
      return res.status(500).send({
        status: 500,
        message: "Unable to delete service report",
      });
    }
  }

  async getAllServiceReports(res, req) {
    try {
      const user = await this.requireManager(res, req);
      if (!user) return;
      const reports = await prisma.service_report.findMany({
        include: { company: true },
        orderBy: { created_at: "desc" },
      });
      return res.status(200).send({
        status: 200,
        message: "Service reports retrieved successfully",
        data: reports.map((item) => this.serialize(item)),
      });
    } catch (error) {
      console.error("getAllServiceReports failed", error);
      return res.status(500).send({
        status: 500,
        message: "Unable to load service reports",
      });
    }
  }

  async getServiceReportDetails(res, req) {
    try {
      const user = await this.requireManager(res, req);
      if (!user) return;
      const id = parseInt(String(req.body?.id ?? req.body?.service_report_link ?? ""), 10);
      if (!id) {
        return res.status(400).send({
          status: 400,
          message: "Service report id is required",
        });
      }
      const report = await prisma.service_report.findUnique({
        where: { id },
        include: { company: true },
      });
      if (!report) {
        return res.status(404).send({
          status: 404,
          message: "Service report not found",
        });
      }
      return res.status(200).send({
        status: 200,
        message: "Service report retrieved successfully",
        data: this.serialize(report),
      });
    } catch (error) {
      console.error("getServiceReportDetails failed", error);
      return res.status(500).send({
        status: 500,
        message: "Unable to load service report",
      });
    }
  }

  async downloadServiceReportPdf(res, req) {
    try {
      const user = await this.requireManager(res, req);
      if (!user) return;
      const id = parseInt(String(req.body?.id ?? req.body?.service_report_link ?? ""), 10);
      if (!id) {
        return res.status(400).send({
          status: 400,
          message: "Service report id is required",
        });
      }
      const report = await prisma.service_report.findUnique({ where: { id } });
      if (!report) {
        return res.status(404).send({
          status: 404,
          message: "Service report not found",
        });
      }
      const updated = await prisma.service_report.update({
        where: { id },
        data: { generated_at: new Date(), updated_by: user.phone },
      });
      const file = await this.writePdf(updated, true);
      return res.status(200).send({
        status: 200,
        message: "Service report generated successfully",
        url: file.url,
        pdf_base64: file.pdf_base64,
        data: this.serialize(updated),
      });
    } catch (error) {
      console.error("downloadServiceReportPdf failed", error);
      return res.status(500).send({
        status: 500,
        message: "Unable to generate service report PDF",
      });
    }
  }

  async getServiceReportPrefill(res, req) {
    try {
      const user = await this.requireManager(res, req);
      if (!user) return;
      const rawTaskId = this.text(
        req.body?.task_link ?? req.body?.task_id ?? req.body?.ticket_no,
      );
      const numericId = parseInt(rawTaskId, 10);
      let task = null;
      if (Number.isFinite(numericId) && numericId > 0) {
        task = await prisma.tasks.findUnique({
          where: { id: numericId },
          include: {
            task_user: { orderBy: { created_at: "asc" } },
            equipment: { include: { company: true } },
          },
        });
      }
      if (!task && rawTaskId) {
        task = await prisma.tasks.findFirst({
          where: { ticket_no: rawTaskId },
          include: {
            task_user: { orderBy: { created_at: "asc" } },
            equipment: { include: { company: true } },
          },
        });
      }
      if (!task) {
        return res.status(200).send({
          status: 200,
          message: "No matching task found; continue with a standalone report",
          data: {
            task_id: rawTaskId || "",
            status: "Not Started",
          },
        });
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
      const client = latest?.client_link ? userById[latest.client_link] : null;
      const technician = latest?.technician_link
        ? userById[latest.technician_link]
        : null;
      const statusMap = {
        open: "Not Started",
        in_progress: "In Progress",
        hold: "Hold",
        closed: "Completed",
      };
      const timeline = [
        {
          date: moment(task.created_at).format("YYYY-MM-DD"),
          time: moment(task.created_at).format("hh:mm A"),
          title: "Task created",
          description: `${task.name || "Task"} was raised${
            task.created_by ? ` by ${task.created_by}` : ""
          }.`,
        },
      ];
      for (const row of task.task_user) {
        const tech = row.technician_link ? userById[row.technician_link] : null;
        if (row.technician_link) {
          timeline.push({
            date: moment(row.updated_at || row.created_at).format("YYYY-MM-DD"),
            time: moment(row.updated_at || row.created_at).format("hh:mm A"),
            title: "Technician assigned",
            description: `${tech?.name || "Technician"} was assigned to this task.`,
          });
        }
      }
      return res.status(200).send({
        status: 200,
        message: "Service report draft loaded from task",
        data: {
          task_id: task.ticket_no || String(task.id),
          company_link: task.equipment?.company_link || null,
          company_name: task.equipment?.company?.name || "",
          company_branch: task.equipment?.company?.branch_name || "",
          location: task.equipment?.company?.location || "",
          company_email: task.equipment?.company?.email || "",
          raised_by_name: client?.name || "",
          raised_by_phone: client?.phone || "",
          raised_by_email: client?.email || "",
          raised_by_note: task.created_by
            ? `Created by ${task.created_by}`
            : "",
          technician_name: technician?.name || "",
          technician_phone: technician?.phone || "",
          technician_note: technician ? "Assigned technician" : "",
          equipment_name: task.equipment?.name || "",
          equipment_make: task.equipment?.make || "",
          equipment_model: task.equipment?.model || "",
          equipment_serial_number: task.equipment?.serial_number || "",
          equipment_eg_serial_number: task.equipment?.eg_serial_number || "",
          equipment_location: task.equipment?.location || "",
          call_type: task.call_type
            ? String(task.call_type).replace(/_/g, " ").toUpperCase()
            : "",
          issue: task.name || "",
          issue_description: task.description || "",
          service_details: task.action_taken || "",
          timeline_events: timeline,
          customer_serviced_to_satisfaction:
            task.service_satisfactory === true
              ? "Yes"
              : task.service_satisfactory === false
                ? "No"
                : "",
          equipment_running_smoothly:
            task.is_running_smoothly === true
              ? "Yes"
              : task.is_running_smoothly === false
                ? "No"
                : "",
          customer_comments: task.feedback || task.notes || "",
          rating: task.rating != null ? String(task.rating) : "",
          status: statusMap[latest?.status || task.status || "open"] || "Not Started",
        },
      });
    } catch (error) {
      console.error("getServiceReportPrefill failed", error);
      return res.status(500).send({
        status: 500,
        message: "Unable to load task details for the service report",
      });
    }
  }
}
