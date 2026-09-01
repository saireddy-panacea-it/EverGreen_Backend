import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const NAVY = rgb(0.008, 0.137, 0.322);
const BLUE = rgb(0.125, 0.341, 0.651);
const MUTED = rgb(0.388, 0.459, 0.529);
const LINE = rgb(0.91, 0.929, 0.949);
const WHITE = rgb(1, 1, 1);
const ORANGE = rgb(0.98, 0.392, 0.294);

export async function buildServiceReportPdf(view: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensure = (need: number) => {
    if (y - need < MARGIN + 24) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const safe = (value: any) =>
    String(value ?? "-")
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "-";

  const text = (
    value: string,
    x: number,
    top: number,
    size: number,
    font = regular,
    color = NAVY,
    maxWidth?: number,
  ) => {
    const clean = safe(value);
    page.drawText(clean, {
      x,
      y: top - size,
      size,
      font,
      color,
      maxWidth,
    });
  };

  const wrap = (value: string, width: number, size: number, font = regular) => {
    const words = safe(value).split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : ["-"];
  };

  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  page.drawRectangle({
    x: MARGIN,
    y: y - 78,
    width: contentWidth,
    height: 78,
    color: NAVY,
  });
  text("EVERGREEN ENTERPRISES", MARGIN + 12, y - 10, 14, bold, WHITE);
  text(
    "Imported and Indian Equipment Spares and Service",
    MARGIN + 12,
    y - 28,
    8,
    regular,
    rgb(0.75, 0.8, 0.86),
  );
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - 96,
    y: y - 28,
    width: 84,
    height: 16,
    color: BLUE,
  });
  text("SERVICE REPORT", PAGE_WIDTH - MARGIN - 90, y - 14, 7, bold, WHITE);
  text("Ticket", MARGIN + 12, y - 48, 8, regular, rgb(0.75, 0.8, 0.86));
  text(view.ticket_no || "-", MARGIN + 12, y - 60, 11, bold, WHITE);
  text("Generated", MARGIN + 180, y - 48, 8, regular, rgb(0.75, 0.8, 0.86));
  text(view.generated_at || "-", MARGIN + 180, y - 60, 10, bold, WHITE);
  text("Status", MARGIN + 360, y - 48, 8, regular, rgb(0.75, 0.8, 0.86));
  page.drawRectangle({
    x: MARGIN + 360,
    y: y - 74,
    width: 90,
    height: 12,
    color: view.status_key === "closed" ? rgb(0.3, 0.71, 0.16) : ORANGE,
  });
  text(view.current_status || "-", MARGIN + 364, y - 63, 8, bold, WHITE);
  y -= 92;

  const cards = [
    {
      title: "COMPANY",
      lines: [
        view.company?.name || "-",
        view.company?.branch || "",
        view.company?.location || "-",
        view.company?.email || "",
      ],
    },
    {
      title: "RAISED BY",
      lines: [
        view.contact?.name || "-",
        view.contact?.phone || "-",
        view.contact?.email || "",
        view.created_by ? `Created by ${view.created_by}` : "",
      ],
    },
    {
      title: "TECHNICIAN",
      lines: [
        view.technician?.name || "Not assigned yet",
        view.technician?.phone || "",
        view.technician?.note || "",
      ],
    },
  ];
  const cardWidth = (contentWidth - 12) / 3;
  ensure(86);
  cards.forEach((card, index) => {
    const x = MARGIN + index * (cardWidth + 6);
    page.drawRectangle({
      x,
      y: y - 80,
      width: cardWidth,
      height: 80,
      borderColor: LINE,
      borderWidth: 1,
    });
    page.drawRectangle({
      x,
      y: y - 16,
      width: cardWidth,
      height: 16,
      color: rgb(0.91, 0.929, 0.949),
    });
    text(card.title, x + 6, y - 3, 7, bold, NAVY);
    let lineY = y - 22;
    card.lines.filter(Boolean).forEach((line) => {
      text(String(line), x + 6, lineY, 8, regular, NAVY, cardWidth - 12);
      lineY -= 12;
    });
  });
  y -= 94;

  const section = (title: string) => {
    ensure(28);
    page.drawRectangle({
      x: MARGIN,
      y: y - 18,
      width: contentWidth,
      height: 18,
      color: NAVY,
    });
    text(title, MARGIN + 8, y - 4, 9, bold, WHITE);
    y -= 26;
  };

  section("EQUIPMENT");
  const rows = [
    ["Name", view.equipment?.name, "Make", view.equipment?.make],
    ["Model", view.equipment?.model, "Serial No.", view.equipment?.serial_no],
    ["EG Serial", view.equipment?.eg_serial, "Location", view.equipment?.location],
    ["Call type", view.call_type, "Created on", view.created_at],
  ];
  rows.forEach((row) => {
    ensure(18);
    page.drawRectangle({
      x: MARGIN,
      y: y - 16,
      width: contentWidth,
      height: 16,
      borderColor: LINE,
      borderWidth: 0.6,
    });
    text(row[0], MARGIN + 4, y - 3, 8, bold, MUTED);
    text(row[1] || "-", MARGIN + 70, y - 3, 8, regular, NAVY, 180);
    text(row[2], MARGIN + 270, y - 3, 8, bold, MUTED);
    text(row[3] || "-", MARGIN + 340, y - 3, 8, regular, NAVY, 180);
    y -= 16;
  });
  y -= 10;

  section("ISSUE");
  const issueLines = [
    view.task_name || "-",
    view.task_description || "No description",
  ];
  issueLines.forEach((line, index) => {
    const wrapped = wrap(line, contentWidth - 8, index === 0 ? 11 : 9, index === 0 ? bold : regular);
    wrapped.forEach((item) => {
      ensure(14);
      text(item, MARGIN + 2, y, index === 0 ? 11 : 9, index === 0 ? bold : regular, index === 0 ? NAVY : MUTED);
      y -= 13;
    });
  });
  y -= 8;

  section("TIMELINE OF EVENTS");
  const events = Array.isArray(view.timeline) ? view.timeline : [];
  if (!events.length) {
    text("No events recorded yet.", MARGIN + 2, y, 9, regular, MUTED);
    y -= 16;
  }
  events.forEach((event) => {
    const detailLines = wrap(event.detail || "", contentWidth - 24, 9);
    ensure(28 + detailLines.length * 11);
    page.drawCircle({
      x: MARGIN + 5,
      y: y - 8,
      size: 3.5,
      color: BLUE,
    });
    text(event.time || "-", MARGIN + 16, y, 8, regular, MUTED);
    y -= 11;
    text(event.title || "-", MARGIN + 16, y, 10, bold, NAVY);
    y -= 12;
    detailLines.forEach((line) => {
      text(line, MARGIN + 16, y, 9, regular, MUTED);
      y -= 11;
    });
    y -= 6;
  });

  if (view.action_taken || view.requirement) {
    section("SERVICE NOTES");
    const notes = [
      ["Action taken", view.action_taken],
      ["Requirement", view.requirement],
      ["Follow up", view.follow_up],
      ["Details", view.action_req_details],
    ];
    notes.forEach(([label, value]) => {
      const lines = wrap(String(value || "-"), contentWidth - 110, 9);
      ensure(14 + lines.length * 11);
      text(String(label), MARGIN + 2, y, 8, bold, MUTED);
      lines.forEach((line, index) => {
        text(line, MARGIN + 100, y, 9, regular, NAVY);
        y -= 12;
        if (index === 0) {
          // keep label only on first line
        }
      });
    });
    y -= 6;
  }

  const hasCustomer =
    view.is_closed ||
    view.customer?.service_satisfactory ||
    view.customer?.is_running_smoothly ||
    view.customer?.notes ||
    view.customer?.rating ||
    view.signature;
  if (hasCustomer) {
    section("CUSTOMER CONFIRMATION");
    text(`Serviced to satisfaction: ${view.customer?.service_satisfactory || "-"}`, MARGIN + 2, y, 9);
    y -= 13;
    text(`Running smoothly: ${view.customer?.is_running_smoothly || "-"}`, MARGIN + 2, y, 9);
    y -= 13;
    wrap(`Comments: ${view.customer?.notes || "-"}`, contentWidth - 8, 9).forEach((line) => {
      ensure(13);
      text(line, MARGIN + 2, y, 9);
      y -= 12;
    });
    text(`Rating: ${view.customer?.rating || "-"}`, MARGIN + 2, y, 9);
    y -= 16;
    if (view.signature) {
      try {
        const raw = String(view.signature).includes(",")
          ? String(view.signature).split(",")[1]
          : String(view.signature);
        const bytes = Buffer.from(raw, "base64");
        const image = view.signature.includes("image/png")
          ? await doc.embedPng(bytes)
          : await doc.embedJpg(bytes);
        ensure(70);
        text("Client signature", MARGIN + 2, y, 8, bold, MUTED);
        y -= 8;
        const sigWidth = 160;
        const sigHeight = 48;
        page.drawImage(image, {
          x: MARGIN + 2,
          y: y - sigHeight,
          width: sigWidth,
          height: sigHeight,
        });
        y -= sigHeight + 10;
      } catch {
        text("Client signature attached", MARGIN + 2, y, 8, regular, MUTED);
        y -= 14;
      }
    }
  }

  ensure(28);
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.6,
    color: LINE,
  });
  y -= 12;
  text(
    "Evergreen Enterprises · Sanathnagar, Hyderabad · service@egeservices.in · 9052377567",
    MARGIN,
    y,
    7,
    regular,
    MUTED,
  );

  return Buffer.from(await doc.save());
}
