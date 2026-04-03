import xlsx from 'xlsx';
import * as fs from 'fs';

try {
  const workbook = xlsx.readFile('./database/CentralReport_2024-25.xlsx');
  
  const data = {};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    data[sheetName] = xlsx.utils.sheet_to_json(sheet);
  }

  const outputDir = './data';
  if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync('./data/reportData.json', JSON.stringify(data, null, 2));
  console.log('Successfully written data to ./data/reportData.json');
} catch (e) {
  console.error("Error details:", e);
}
