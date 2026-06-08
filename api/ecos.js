/**
 * api/ecos.js
 * 한국은행 ECOS Open API 프록시
 * GET /api/ecos?type=rate   → 기준금리
 * GET /api/ecos?type=ppi    → 건설공사비지수 (COPI)
 * GET /api/ecos?type=all    → 전체 지표
 * GET /api/ecos?type=debug  → 코드 탐색 (개발용)
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

  // ── 디버그 모드: 어떤 코드로 데이터가 오는지 확인
  if (type === 'debug') {
    const debugResults = {};
    const testCodes = [
      { stat: '301Y013', item: '0000001', label: 'COPI총지수(구)' },
      { stat: '301Y017', item: '0000001', label: 'COPI총지수(신)' },
      { stat: '301Y017', item: 'AA',      label: 'COPI-AA(신)' },
      { stat: '301Y013', item: 'AA',      label: 'COPI-AA(구)' },
      { stat: '404Y014', item: 'AA00',    label: 'PPI총지수' },
      { stat: '404Y014', item: '2200',    label: 'PPI-건설' },
      { stat: '404Y001', item: 'P00',     label: 'PPI구버전' },
    ];
    for (const code of testCodes) {
      try {
        const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/3/${code.stat}/MM/202501/202506/${code.item}`;
        const r = await fetch(url);
        const d = await r.json();
        const rows = d?.StatisticSearch?.row || [];
        if (rows.length > 0) {
          const last = rows[rows.length - 1];
          debugResults[code.label] = { value: last.DATA_VALUE, time: last.TIME, rows: rows.length };
        } else {
          debugResults[code.label] = { error: d?.RESULT?.MESSAGE || '데이터없음' };
        }
      } catch(e) {
        debugResults[code.label] = { error: e.message };
      }
    }
    // KeyStatisticList에서 건설 관련 항목도 확인
    try {
      const url = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/200`;
      const r = await fetch(url);
      const d = await r.json();
      const rows = d?.KeyStatisticList?.row || [];
      const constructionItems = rows.filter(r =>
        r.KEYSTAT_NAME?.includes('건설') || r.KEYSTAT_NAME?.includes('공사')
      );
      debugResults['_KeyStatList_건설관련'] = constructionItems.map(r => ({
        name: r.KEYSTAT_NAME, stat: r.STAT_CODE, item: r.ITEM_CODE1,
        value: r.DATA_VALUE, time: r.TIME
      }));
    } catch(e) {}
    return res.status(200).json({ success: true, debug: debugResults });
  }

  try {
    const results = {};

    // ── 1. 기준금리 (변경 없음)
    if (type === 'rate' || type === 'all') {
      const url = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/100`;
      const r = await fetch(url);
      const d = await r.json();
      const rows = d?.KeyStatisticList?.row || [];

      const rateItem = rows.find(r =>
        r.KEYSTAT_NAME?.includes('기준금리') ||
        r.KEYSTAT_NAME?.includes('Base Rate')
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
          date: r.TIME,
          value: parseFloat(r.DATA_VALUE || 0),
        })).filter(h => h.value > 0);
      } catch(e) {}

      if (!history.length) {
        history = Array.from({length:12}, (_, i) => {
          const d = new Date(now);
          d.setMonth(d.getMonth() - 11 + i);
          return {
            date: `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`,
            value: currentRate,
          };
        });
      }

      results.rate = {
        current: currentRate,
        prev: history.length >= 2 ? history[history.length-2].value : currentRate,
        date: rateDate,
        history,
      };
    }

    // ── 2. 건설공사비지수 (COPI)
    // 주의: KeyStatisticList의 "건설" 포함 항목은 금리류가 섞여있으므로
    //       StatisticSearch로 직접 조회하고 값이 50 이상인 경우만 유효로 판단
    if (type === 'ppi' || type === 'all') {
      let copiRows = [];
      let foundLabel = '건설공사비지수';

      const copiCodes = [
        { stat: '301Y013', item: '0000001', label: 'COPI총지수(구)' },
        { stat: '301Y017', item: '0000001', label: 'COPI총지수(신)' },
        { stat: '301Y013', item: 'AA',      label: 'COPI-AA(구)' },
        { stat: '301Y017', item: 'AA',      label: 'COPI-AA(신)' },
        { stat: '404Y014', item: '2200',    label: 'PPI-건설자재' },
        { stat: '404Y014', item: 'AA00',    label: 'PPI총지수(fallback)' },
      ];

      for (const code of copiCodes) {
        try {
          const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/${code.stat}/MM/${startYM}/${endYM}/${code.item}`;
          const r = await fetch(url);
          const d = await r.json();
          const rows = d?.StatisticSearch?.row || [];

          if (rows.length > 0) {
            const lastVal = parseFloat(rows[rows.length-1]?.DATA_VALUE || 0);
            // 건설공사비지수는 50 이상 (금리·환율류 제외)
            if (lastVal >= 50) {
              copiRows = rows;
              foundLabel = code.label;
              console.log(`COPI 성공: ${code.label} = ${lastVal}`);
              break;
            } else {
              console.log(`COPI 값 이상: ${code.label} = ${lastVal} (50 미만, 스킵)`);
            }
          }
        } catch(e) {
          console.log(`COPI 코드 실패: ${code.label}`, e.message);
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
            date: r.TIME,
            value: parseFloat(r.DATA_VALUE || 0),
          })),
          label: foundLabel,
        };
      } else {
        // 모든 코드 실패 — 0 반환 (화면에서 "데이터 없음" 처리)
        console.log('COPI: 모든 코드 실패');
        results.ppi = {
          current: 0, yoy: 0, date: endYM, history: [],
          label: '건설공사비지수(조회실패)',
        };
      }
    }

    // ── 3. 리스크 점수
    if (type === 'all') {
      const rate    = results.rate?.current || 2.75;
      const copiYoy = results.ppi?.yoy || 0;
      const rateRisk = Math.min(10, Math.round(rate * 2 * 10) / 10);
      const copiRisk = Math.min(10, Math.max(1, Math.round((2 + Math.max(0, copiYoy) * 0.7) * 10) / 10));
      results.riskScores = { rate: rateRisk, policy: 5.8, legal: 2.9, ppi: copiRisk };
    }

    return res.status(200).json({ success: true, ...results });

  } catch (err) {
    console.error('ECOS API 오류:', err);
    return res.status(500).json({ error: 'ECOS API 호출 실패', detail: err.message });
  }
}
