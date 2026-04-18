import * as fs from 'fs';

export function readServiceReportTemplate(): string {
  const content = fs.readFileSync('src/service_report/service_report.html', 'utf-8');
  return `${content}
    `;
}

const serviceReportTemplate = readServiceReportTemplate();

export default serviceReportTemplate;
