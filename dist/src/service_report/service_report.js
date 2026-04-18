"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readServiceReportTemplate = void 0;
const fs = require("fs");
function readServiceReportTemplate() {
    const content = fs.readFileSync('src/service_report/service_report.html', 'utf-8');
    return `${content}
    `;
}
exports.readServiceReportTemplate = readServiceReportTemplate;
const serviceReportTemplate = readServiceReportTemplate();
exports.default = serviceReportTemplate;
//# sourceMappingURL=service_report.js.map