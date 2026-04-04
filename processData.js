import fs from 'fs';
import path from 'path';

const RAW_DATA_PATH = './data/reportData.json';
const OUTPUT_DATA_PATH = './data/summaryData.json';

try {
  console.log('Starting Universal Data Engine Overhaul (Human-Readable mapping)...');
  const rawData = JSON.parse(fs.readFileSync(RAW_DATA_PATH, 'utf8'));
  const gec = rawData.GEC || Object.values(rawData)[0];

  const units = [];
  let currentState = '';

  // 1. Build Global Human-Readable Header Map (Rows 5, 6, 7)
  const h1 = gec[5] || {};
  const h2 = gec[6] || {};
  const h3 = gec[7] || {};
  const allKeys = new Set([...Object.keys(h1), ...Object.keys(h2), ...Object.keys(h3)]);
  
  const sortedKeys = Array.from(allKeys).sort((a,b) => {
    const getNum = x => x === '__EMPTY' ? 0 : parseInt(x.replace('__EMPTY_',''));
    return getNum(a) - getNum(b);
  });
  
  const headerMap = {};
  let lastH1 = '', lastH2 = '';
  for (const k of sortedKeys) {
    if (h1[k]) lastH1 = String(h1[k]).trim();
    if (h2[k]) lastH2 = String(h2[k]).trim();
    
    let name = lastH1;
    if (h2[k] && h2[k] !== lastH1) name += ' - ' + h2[k];
    if (h3[k] && h3[k] !== lastH1 && h3[k] !== h2[k]) name += ' - ' + h3[k];
    
    headerMap[k] = name.trim();
  }

  // 2. Parse all blocks with State-Inheritance logic
  for (let i = 8; i < gec.length; i++) {
    const row = gec[i];
    
    // Inherit or Update State
    if (row.__EMPTY_1 && row.__EMPTY_1 !== 'STATE') {
      currentState = String(row.__EMPTY_1).trim().toUpperCase();
    }
    
    if (!currentState || currentState === 'STATE') continue;

    // Identify Unit (District or Block)
    const districtName = String(row.__EMPTY_2 || '').trim().toUpperCase();
    const blockName = String(row.__EMPTY_3 || '').trim().toUpperCase();
    const unitName = blockName || districtName;
    if (!unitName || unitName === 'DISTRICT' || unitName === 'TOTAL') continue;

    const stagePct = parseFloat(row.__EMPTY_113) || 0;
    
    // Categorization logic
    let category = "Safe";
    if (stagePct > 100) category = "Over-Exploited";
    else if (stagePct > 90) category = "Critical";
    else if (stagePct > 70) category = "Semi-Critical";

    // Build human-readable parameter object for EVERY column
    const parameters = {};
    for (const [key, value] of Object.entries(row)) {
       if (headerMap[key]) {
         const label = headerMap[key];
         // Only store if it's a useful value
         if (value !== null && value !== undefined && value !== '') {
           parameters[label] = value;
         }
       }
    }

    units.push({
      state: currentState,
      district: districtName,
      unit: unitName,
      extractionPct: Math.round(stagePct * 100) / 100,
      category,
      parameters: parameters
    });
  }

  // 3. Aggregate State Results (Sum all numeric columns)
  const stateAggs = {};
  units.forEach(u => {
    if (!stateAggs[u.state]) {
      stateAggs[u.state] = { 
        state: u.state, 
        count: 0,
        totals: {} 
      };
    }
    stateAggs[u.state].count++;
    
    // Sum all numeric parameters for the state
    for (const [label, val] of Object.entries(u.parameters)) {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        stateAggs[u.state].totals[label] = (stateAggs[u.state].totals[label] || 0) + num;
      }
    }
  });

  const stateSummaries = Object.values(stateAggs).map(s => {
    // Round all totals
    for (const k in s.totals) {
      s.totals[k] = Math.round(s.totals[k] * 100) / 100;
    }
    
    // Find Stage of Extraction for the state overall (using the standardized headers)
    const extractableKey = "Annual Extractable Ground water Resource (ham) - Total";
    const extractionKey = "Ground Water Extraction for all uses (ha.m) - Total";
    
    const extractwealth = s.totals[extractableKey] || 0;
    const extractusage = s.totals[extractionKey] || 0;
    const stagePct = extractwealth > 0 ? (extractusage / extractwealth * 100) : 0;
    
    let cat = "Safe";
    if (stagePct > 100) cat = "Over-Exploited";
    else if (stagePct > 90) cat = "Critical";
    else if (stagePct > 70) cat = "Semi-Critical";

    return {
      state: s.state,
      extractionPct: Math.round(stagePct * 100) / 100,
      category: cat,
      unitCount: s.count,
      fullStats: s.totals
    };
  }).sort((a,b) => b.extractionPct - a.extractionPct);

  // 4. Save the Master Database
  const finalDatabase = {
    units: units,
    stateSummaries: stateSummaries,
    lastUpdate: new Date().toISOString()
  };

  fs.writeFileSync(OUTPUT_DATA_PATH, JSON.stringify(finalDatabase, null, 2));
  console.log(`Reconstruction Complete: ${OUTPUT_DATA_PATH}`);
  console.log(`- ${stateSummaries.length} States indexed with full stats`);
  console.log(`- ${units.length} Units (Districts/Blocks) fully mapped`);

} catch (e) {
  console.error("Data Translation Error:", e);
}
