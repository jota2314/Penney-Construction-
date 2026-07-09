import ExcelJS from "exceljs";

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function worksheetToCsv(worksheet: ExcelJS.Worksheet): string {
  const rows: string[] = [];
  const columnCount = worksheet.columnCount;

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const values: string[] = [];
    for (let column = 1; column <= columnCount; column++) {
      values.push(csvCell(row.getCell(column).text));
    }
    rows.push(values.join(","));
  }

  return rows.join("\n").trim();
}

/** Converts an XLSX or CSV attachment to text without the vulnerable xlsx package. */
export async function spreadsheetBufferToCsv(
  buffer: ArrayBuffer,
  filename: string,
  includeAllSheets = true
): Promise<string> {
  if (filename.toLowerCase().endsWith(".csv")) {
    return Buffer.from(buffer).toString("utf8");
  }
  if (!filename.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Only .xlsx and .csv spreadsheets are supported");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer));
  const worksheets = includeAllSheets
    ? workbook.worksheets
    : workbook.worksheets.slice(0, 1);

  return worksheets
    .map((worksheet) => {
      const csv = worksheetToCsv(worksheet);
      if (!csv) return "";
      return includeAllSheets && worksheets.length > 1
        ? `## Sheet: ${worksheet.name}\n${csv}`
        : csv;
    })
    .filter(Boolean)
    .join("\n\n");
}
