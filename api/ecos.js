/**
 * api/ecos.js — 건설공사비지수 항목코드 정밀 탐색
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.ECOS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'ECOS API 키 미설정' });

  const { type = 'all' } = req.query;
  const BASE = 'https://ecos.bok.or.kr/api';

  const now = new Date();
  const endYM = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 23);
  const startYM = `${startDate.getFullYear()}${String(startDate.getMonth()+1).padStart(2,'0')}`;

  // ── 항목코드 전체 조회 (필드명 raw 출력)
  if (type === 'debug3') {
    const result = {};

    // 301Y013, 301Y017 항목 전체 raw 출력 (100개)
    for (const stat of ['301Y013', '301Y017', '301Y014', '404Y014']) {
      try {
        const url = `${BASE}/StatisticItemList/${API_KEY}/json/kr/1/100/${stat}`;
        const r = await fetch(url);
        const d = await r.json();
        const rows = d?.StatisticItemList?.row || [];
        // raw 전체 출력 (첫 5개)
        result[stat] = {
          total: rows.length,
          sample: rows.slice(0, 5),  // 필드명 확인용 raw
          error: d?.RESULT
        };
      } catch(e) {
        result[stat] = { error: e.message };
      }
    }

    return res.status(200).json({ success: true, debug3: result });
  }

  // ── 기본 로직
  try {
    const results = {};

    // 1. 기준금리
    if (type === 'rate' || type === 'all') {
      const url = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/100`;
      const r = await fetch(url);
      const d = await r.json();
      const rows = d?.KeyStatisticList?.row || [];
      const rateItem = rows.find(r =>
        r.KEYSTAT_NAME?.includes('기준금리') || r.KEYSTAT_NAME?.includes('Base Rate')
      );
      const currentRate = parseFloat(rateItem?.DATA_VALUE || 2.75);
      const rateDate = rateItem?.TIME || endYM;

      let history = [];
      try {
        const hUrl = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/722Y001/MM/${startYM}/${endYM}/0101000`;
        const hR = await fetch(hUrl);
        const hD = await hR.json();
        const hRows = hD?.StatisticSearch?.row || [];
        history = hRows.slice(-12).map(r => ({
          date: r.TIME, value: parseFloat(r.DATA_VALUE || 0),
        })).filter(h => h.value > 0);
      } catch(e) {}

      if (!history.length) {
        history = Array.from({length:12}, (_, i) => {
          const d = new Date(now);
          d.setMonth(d.getMonth() - 11 + i);
          return { date:`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`, value:currentRate };
        });
      }
      results.rate = {
        current: currentRate,
        prev: history.length >= 2 ? history[history.length-2].value : currentRate,
        date: rateDate,
        history
      };
    }

    // 2. 건설공사비지수 — 항목코드 자동 탐색
    if (type === 'ppi' || type === 'all') {
      let copiRows = [];
      let foundInfo = '';

      // StatisticItemList로 실제 항목코드 가져온 뒤 StatisticSearch 조회
      for (const stat of ['301Y017', '301Y013', '301Y014', '404Y014']) {
        try {
          // 1) 항목 목록 조회
          const itemUrl = `${BASE}/StatisticItemList/${API_KEY}/json/kr/1/50/${stat}`;
          const itemR = await fetch(itemUrl);
          const itemD = await itemR.json();
          const itemRows = itemD?.StatisticItemList?.row || [];

          if (!itemRows.length) continue;

          // 2) 월별(M) 항목 중 총지수/전체 계열 먼저, 없으면 첫 번째
          const monthlyItems = itemRows.filter(r => r.CYCLE === 'M' || r.CYCLE === 'MM');
          const candidates = monthlyItems.length ? monthlyItems : itemRows;

          // ITEM_CODE 필드명 동적 탐색 (API마다 다를 수 있음)
          for (const item of candidates.slice(0, 10)) {
            // 가능한 항목코드 필드명들
            const itemCode = item.ITEM_CODE || item.ITEM_CODE1 ||
                             item.item1 || item.item_code || '';
            const itemName = item.ITEM_NAME || item.ITEM_NAME1 ||
                             item.item_name || item.name || '';
            const cycle = item.CYCLE || item.cycle || '';

            if (!itemCode || cycle === 'A' || cycle === 'Q') continue; // 연간·분기 스킵

            // 3) 해당 항목코드로 StatisticSearch
            const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/${stat}/MM/${startYM}/${endYM}/${itemCode}`;
            const r = await fetch(url);
            const d = await r.json();
            const rows = d?.StatisticSearch?.row || [];

            if (rows.length > 0) {
              const lastVal = parseFloat(rows[rows.length-1]?.DATA_VALUE || 0);
              // 건설공사비지수는 50 이상이어야 유효
              if (lastVal >= 50) {
                copiRows = rows;
                foundInfo = `${stat}/${itemCode} (${itemName}) = ${lastVal}`;
                console.log('COPI 성공:', foundInfo);
                break;
              }
            }
          }
          if (copiRows.length > 0) break;
        } catch(e) {
          console.log(`${stat} 탐색 실패:`, e.message);
        }
      }

      if (copiRows.length > 0) {
        const latest = copiRows[copiRows.length - 1];
        const prev12 = copiRows.length >= 13 ? copiRows[copiRows.length - 13] : copiRows[0];
        const latestVal = parseFloat(latest?.DATA_VALUE || 0);
        const prev12Val = parseFloat(prev12?.DATA_VALUE || 0);
        const yoy = prev12Val > 0
          ? Math.round((latestVal - prev12Val) / prev12Val * 100 * 10) / 10
          : 0;

        results.ppi = {
          current: latestVal,
          yoy,
          date: latest?.TIME || '',
          history: copiRows.slice(-12).map(r => ({
            date: r.TIME, value: parseFloat(r.DATA_VALUE || 0),
          })),
          label: '건설공사비지수',
          foundCode: foundInfo,
        };
      } else {
        // 모든 시도 실패 → 0 반환, 화면에서 "—" 표시
        results.ppi = {
          current: 0, yoy: 0, date: endYM, history: [],
          label: '건설공사비지수', foundCode: '탐색실패'
        };
      }
    }

    if (type === 'all') {
      const rate = results.rate?.current || 2.75;
      const copiYoy = results.ppi?.yoy || 0;
      results.riskScores = {
        rate: Math.min(10, Math.round(rate * 2 * 10) / 10),
        policy: 5.8, legal: 2.9,
        ppi: Math.min(10, Math.max(1, Math.round((2 + Math.max(0, copiYoy) * 0.7) * 10) / 10))
      };
    }

    return res.status(200).json({ success: true, ...results });

  } catch(err) {
    console.error('ECOS API 오류:', err);
    return res.status(500).json({ error: 'ECOS API 호출 실패', detail: err.message });
  }
}
