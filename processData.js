import fs from 'fs';

try {
  const rawData = JSON.parse(fs.readFileSync('./data/reportData.json', 'utf8'));
  const gec = rawData.GEC || Object.values(rawData)[0];

  const results = [];

  // Build human-readable header map
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
    if (h1[k]) lastH1 = h1[k];
    if (h2[k]) lastH2 = h2[k];
    
    let name = lastH1;
    if (h2[k] && h2[k] !== lastH1) name += ' - ' + h2[k];
    if (h3[k] && h3[k] !== lastH1 && h3[k] !== h2[k]) name += ' - ' + h3[k];
    
    headerMap[k] = name.trim();
  }

  // start iterating after headers, usually row index 8
  for (let i = 8; i < gec.length; i++) {
    const row = gec[i];
    if (!row.__EMPTY_1) continue; // no state
    if (row.__EMPTY_1 === 'STATE') continue; // header

    const state = String(row.__EMPTY_1).trim();
    const district = String(row.__EMPTY_2 || '').trim();
    const block = String(row.__EMPTY_3 || '').trim();

    let extractionPct = parseFloat(row.__EMPTY_113); // Total Stage percentage
    if (isNaN(extractionPct)) continue;

    let category = "Safe";
    if (extractionPct > 100) category = "Over-Exploited";
    else if (extractionPct > 90) category = "Critical";
    else if (extractionPct > 70) category = "Semi-Critical";

    const mappedData = {};
    for (const [k, v] of Object.entries(row)) {
       if (headerMap[k]) mappedData[headerMap[k]] = v;
    }

    results.push({
      state,
      district,
      block,
      extractionPct: Math.round(extractionPct * 100) / 100,
      category,
      rawData: mappedData
    });
  }

  // Aggregate stats
  const national = {
    totalDistricts: 0,
    safe: 0,
    semiCritical: 0,
    critical: 0,
    overExploited: 0,
  };

  const stateStats = {};

  for (const district of results) {
    const { state, category } = district;
    national.totalDistricts++;
    if (category === "Safe") national.safe++;
    if (category === "Semi-Critical") national.semiCritical++;
    if (category === "Critical") national.critical++;
    if (category === "Over-Exploited") national.overExploited++;

    if (!stateStats[state]) {
      stateStats[state] = {
        total: 0, safe: 0, semi: 0, critical: 0, over: 0,
        districts: {}
      };
    }
    stateStats[state].total++;
    if (category === "Safe") stateStats[state].safe++;
    if (category === "Semi-Critical") stateStats[state].semi++;
    if (category === "Critical") stateStats[state].critical++;
    if (category === "Over-Exploited") stateStats[state].over++;

    if (!stateStats[state].districts[district.district]) {
      stateStats[state].districts[district.district] = {
        blocks: []
      };
    }
    
    // Add block data to stateStats
    stateStats[state].districts[district.district].blocks.push({
      block: district.block,
      extractionPct: district.extractionPct,
      category: district.category,
      rawData: district.rawData
    });
  }

  const finalData = {
    districts: results, // all valid district rows
    national,
    stateStats
  };

  fs.writeFileSync('./data/summaryData.json', JSON.stringify(finalData, null, 2));
  console.log('Successfully written data to ./data/summaryData.json');
} catch (e) {
  console.error(e);
}
