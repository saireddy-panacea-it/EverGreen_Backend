import { buildServiceReportPdf } from "./build_pdf";

const parsePdf = require("pdf-parse");

describe("buildServiceReportPdf", () => {
  it("includes the ticket, company, equipment, technician, task, and progress details", async () => {
    const bytes = await buildServiceReportPdf({
      service_report_number: "SR-2026-00001",
      ticket_no: "EG-UNIQUE-7001",
      current_status: "Awaiting Approval",
      status_key: "completed",
      generated_at: "22 Oct 2026, 10:15 AM",
      created_at: "22 Oct 2026, 09:00 AM",
      call_type: "BREAKDOWN",
      task_name: "Pump vibration inspection",
      task_description: "Inspect the motor and record the vibration reading.",
      company: {
        name: "Evergreen Test Company",
        branch: "Hyderabad Site",
        address: "Sanathnagar, Hyderabad, Telangana",
        gst_number: "GSTTEST123",
      },
      contact: { name: "Test Client", phone: "9000000000" },
      technician: { name: "Test Engineer", phone: "9111111111" },
      equipment: {
        name: "Cooling Pump",
        make: "Test Make",
        model: "CP-4",
        serial_no: "SN-9001",
        eg_serial: "EG-SN-9001",
        location: "Plant Room",
      },
      timeline: [
        {
          time: "22 Oct 2026, 09:30 AM",
          title: "Work started",
          detail: "Test Engineer moved the task to In Progress.",
        },
        {
          time: "22 Oct 2026, 10:00 AM",
          title: "Work completed; awaiting approval",
          detail: "Test Engineer marked the task complete.",
        },
      ],
      action_taken: "Inspected the pump and tightened the motor mount.",
      images: ["uploads/task-photos/vibration-reading.jpg"],
      customer: { service_satisfactory: "-", is_running_smoothly: "-", notes: "-", rating: "-" },
    });

    const parsed = await parsePdf(Buffer.from(bytes));
    for (const expected of [
      "EG-UNIQUE-7001",
      "Evergreen Test Company",
      "Sanathnagar, Hyderabad, Telangana",
      "GSTTEST123",
      "Cooling Pump",
      "Test Engineer",
      "Pump vibration inspection",
      "Work completed; awaiting approval",
      "vibration-reading.jpg",
    ]) {
      expect(parsed.text).toContain(expected);
    }
  });
});
