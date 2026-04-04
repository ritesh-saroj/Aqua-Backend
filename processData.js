import fs from 'fs';
import path from 'path';

const RAW_DATA_PATH = './data/reportData.json';
const OUTPUT_DATA_PATH = './data/summaryData.json';

try {
  console.log('Starting Global Data Engine Reconstruction...');
  const rawData = JSON.parse(fs.readFileSync(RAW_DATA_PATH, 'utf8'));
  const gec = rawData.GEC || Object.values(rawData)[0];

  const units = [];
  let currentState = '';

  for (let i = 8; i < gec.length; i++) {
    const row = gec[i];
    
    // 1. Inherit or Update State
    if (row.__EMPTY_1 && row.__EMPTY_1 !== 'STATE') {
      currentState = String(row.__EMPTY_1).trim().toUpperCase();
    }
    
    if (!currentState || currentState === 'STATE') continue;

    // 2. Identify the Assessment Unit (District or Block)
    // Most summaries have District in EMPTY_2 and Block in EMPTY_3.
    // If it's a district-only summary, we use EMPTY_2.
    const districtName = String(row.__EMPTY_2 || '').trim().toUpperCase();
    const blockName = String(row.__EMPTY_3 || '').trim().toUpperCase();
    
    const unitName = blockName || districtName;
    if (!unitName || unitName === 'DISTRICT' || unitName === 'TOTAL') continue;

    const extractable = parseFloat(row.__EMPTY_111) || 0;
    const extraction = parseFloat(row.__EMPTY_112) || 0;
    const stagePct = parseFloat(row.__EMPTY_113) || 0;

    let category = "Safe";
    if (stagePct > 100) category = "Over-Exploited";
    else if (stagePct > 90) category = "Critical";
    else if (stagePct > 70) category = "Semi-Critical";

    units.push({
      state: currentState,
      district: districtName,
      unit: unitName,
      extractionPct: Math.round(stagePct * 100) / 100,
      category,
      _extractwealth: extractable,
      _extractusage: extraction,
      rawData: row
    });
  }

  // 3. Aggregate State & District Results
  const stateAggs = {};
  units.forEach(u => {
    if (!stateAggs[u.state]) {
      stateAggs[u.state] = { state: u.state, _totalExtractable: 0, _totalExtraction: 0, unitCount: 0 };
    }
    stateAggs[u.state]._totalExtractable += u._extractwealth;
    stateAggs[u.state]._totalExtraction += u._extractusage;
    stateAggs[u.state].unitCount++;
  });

  const stateSummaries = Object.values(stateAggs).map(s => {
    const pct = s._totalExtractable > 0 ? (s._totalExtraction / s._totalExtractable * 100) : 0;
    let cat = "Safe";
    if (pct > 100) cat = "Over-Exploited";
    else if (pct > 90) cat = "Critical";
    else if (pct > 70) cat = "Semi-Critical";
    return {
      state: s.state,
      extractionPct: Math.round(pct * 100) / 100,
      category: cat,
      count: s.unitCount
    };
  }).sort((a,b) => b.extractionPct - a.extractionPct);

  const finalDatabase = {
    units: units,
    stateSummaries: stateSummaries,
    lastUpdate: new Date().toISOString()
  };

  fs.writeFileSync(OUTPUT_DATA_PATH, JSON.stringify(finalDatabase, null, 2));
  console.log(`Reconstruction Complete: ${OUTPUT_DATA_PATH}`);
  console.log(`- ${stateSummaries.length} States indexed`);
  console.log(`- ${units.length} Units (Districts/Blocks) indexed`);

} catch (e) {
  console.error("Data Engine Error:", e);
}
