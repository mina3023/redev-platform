/**
 * api/ecos.js
 * 한국은행 ECOS Open API 프록시
 * GET /api/ecos?type=rate   → 기준금리
 * GET /api/ecos?type=ppi    → 건설공사비지수 (COPI)
 * GET /api/ecos?type=all    → 전체 지표
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

    // ── 2. 건설공사비지수 (COPI) — PPI에서 교체
    // 통계표: 301Y017 (건설공사비지수)
    // 항목코드: 0000001 (총지수)
    // 주기: MM (월별)
    if (type === 'ppi' || type === 'all') {
      let copiRows = [];

      // 건설공사비지수 코드 우선순위 시도
      const copiCodes = [
        { stat: '301Y017', item: '0000001' },  // 건설공사비지수 총지수
        { stat: '301Y017', item: '*AA' },       // 전체
        { stat: '301Y013', item: '0000001' },   // 건설공사비지수 대안코드
        { stat: '404Y014', item: 'AA00' },      // fallback: PPI
      ];

      let usedCode = null;
      for (const code of copiCodes) {
        try {
          const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/${code.stat}/MM/${startYM}/${endYM}/${code.item}`;
          const r = await fetch(url);
          const d = await r.json();
          copiRows = d?.StatisticSearch?.row || [];
          if (copiRows.length > 0) {
            usedCode = code;
            console.log(`COPI 코드 성공: ${code.stat}/${code.item}, rows: ${copiRows.length}`);
            break;
          }
        } catch(e) {}
      }

      if (copiRows.length > 0) {
        const latest = copiRows[copiRows.length - 1];
        const prev12 = copiRows.length >= 13 ? copiRows[copiRows.length - 13] : copiRows[0];
        const yoy = prev12?.DATA_VALUE && parseFloat(prev12.DATA_VALUE) !== 0
          ? Math.round(((parseFloat(latest.DATA_VALUE) - parseFloat(prev12.DATA_VALUE))
              / parseFloat(prev12.DATA_VALUE) * 100) * 10) / 10
          : 0;
        results.ppi = {
          current: parseFloat(latest?.DATA_VALUE || 0),
          yoy,
          date: latest?.TIME || '',
          history: copiRows.slice(-12).map(r => ({
            date: r.TIME,
            value: parseFloat(r.DATA_VALUE || 0),
          })),
          label: '건설공사비지수',
        };
      } else {
        // 모든 코드 실패 시 KeyStatisticList에서 유사 항목 탐색
        try {
          const url = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/100`;
          const r = await fetch(url);
          const d = await r.json();
          const rows = d?.KeyStatisticList?.row || [];
          const item = rows.find(r =>
            r.KEYSTAT_NAME?.includes('건설공사비') ||
            r.KEYSTAT_NAME?.includes('건설')
          );
          results.ppi = {
            current: parseFloat(item?.DATA_VALUE || 0),
            yoy: 0,
            date: item?.TIME || endYM,
            history: [],
            label: '건설공사비지수',
          };
        } catch(e) {
          results.ppi = { current: 0, yoy: 0, date: endYM, history: [], label: '건설공사비지수' };
        }
      }
    }

    // ── 3. 리스크 점수 계산
    if (type === 'all') {
      const rate   = results.rate?.current || 2.75;
      const copiYoy = results.ppi?.yoy || 0;

      const rateRisk = Math.min(10, Math.round(rate * 2 * 10) / 10);
      // 건설공사비 리스크: YoY 상승률 기반
      const copiRisk = Math.min(10, Math.max(1, Math.round((2 + Math.max(0, copiYoy) * 0.7) * 10) / 10));

      results.riskScores = {
        rate:   rateRisk,
        policy: 5.8,
        legal:  2.9,
        ppi:    copiRisk,
      };
    }

    return res.status(200).json({ success: true, ...results });

  } catch (err) {
    console.error('ECOS API 오류:', err);
    return res.status(500).json({ error: 'ECOS API 호출 실패', detail: err.message });
  }
}
