/**
 * api/ecos.js
 * 한국은행 ECOS Open API 프록시
 * GET /api/ecos?type=rate   → 기준금리
 * GET /api/ecos?type=ppi    → 생산자물가지수 (공사비 대리지표)
 * GET /api/ecos?type=all    → 전체 리스크 지표
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.ECOS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'ECOS API 키 미설정' });

  const { type = 'all' } = req.query;
  const BASE = 'https://ecos.bok.or.kr/api';

  // 최근 24개월 기간 (넉넉하게)
  const now = new Date();
  const endYM = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 23);
  const startYM = `${startDate.getFullYear()}${String(startDate.getMonth()+1).padStart(2,'0')}`;

  try {
    const results = {};

    // ── 1. 기준금리
    // KeyStatisticList에서 한국은행 기준금리 직접 조회 (가장 안정적)
    if (type === 'rate' || type === 'all') {
      // KeyStatisticList: 주요 경제지표 목록 전체 가져오기
      const url = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/100`;
      const r = await fetch(url);
      const d = await r.json();
      const rows = d?.KeyStatisticList?.row || [];

      // "기준금리" 항목 찾기
      const rateItem = rows.find(r =>
        r.KEYSTAT_NAME?.includes('기준금리') ||
        r.KEYSTAT_NAME?.includes('Base Rate')
      );

      const currentRate = parseFloat(rateItem?.DATA_VALUE || 2.75);
      const rateDate = rateItem?.TIME || endYM;

      // 월별 히스토리: StatisticSearch로 기준금리 추이 조회 (월별)
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

      // 히스토리 없으면 현재값으로 채우기
      if(!history.length) {
        history = Array.from({length:12},(_,i)=>{
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

    // ── 2. 생산자물가지수 (PPI) - KeyStatisticList에서 조회
    if (type === 'ppi' || type === 'all') {
      // KeyStatisticList 전체에서 생산자물가 항목 찾기
      let ppiItem = null;
      try {
        const url = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/100`;
        const r = await fetch(url);
        const d = await r.json();
        const rows = d?.KeyStatisticList?.row || [];
        ppiItem = rows.find(r =>
          r.KEYSTAT_NAME?.includes('생산자물가') ||
          r.KEYSTAT_NAME?.includes('Producer Price')
        );
      } catch(e) {}

      // StatisticSearch로 PPI 히스토리 조회
      // 통계표: 404Y014 (생산자물가지수 총지수), 항목: AA00
      let ppiRows = [];
      const ppiCodes = [
        { stat: '404Y014', item: 'AA00' },
        { stat: '404Y014', item: 'AA' },
        { stat: '404Y001', item: 'P00' },
        { stat: '404Y001', item: 'PA' },
      ];

      for (const code of ppiCodes) {
        try {
          const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/${code.stat}/MM/${startYM}/${endYM}/${code.item}`;
          const r = await fetch(url);
          const d = await r.json();
          ppiRows = d?.StatisticSearch?.row || [];
          if (ppiRows.length > 0) break;
        } catch(e) {}
      }

      if (ppiRows.length === 0 && ppiItem) {
        // KeyStatisticList에서 현재값만 사용
        results.ppi = {
          current: parseFloat(ppiItem.DATA_VALUE || 0),
          yoy: 0,
          date: ppiItem.TIME || endYM,
          history: [],
        };
      } else if (ppiRows.length > 0) {
        const latest  = ppiRows[ppiRows.length - 1];
        const prev12  = ppiRows.length >= 13 ? ppiRows[ppiRows.length - 13] : ppiRows[0];
        const yoy = prev12?.DATA_VALUE && parseFloat(prev12.DATA_VALUE) !== 0
          ? Math.round(((parseFloat(latest.DATA_VALUE) - parseFloat(prev12.DATA_VALUE))
              / parseFloat(prev12.DATA_VALUE) * 100) * 10) / 10
          : 0;
        results.ppi = {
          current: parseFloat(latest?.DATA_VALUE || 0),
          yoy,
          date: latest?.TIME || '',
          history: ppiRows.slice(-12).map(r => ({
            date: r.TIME,
            value: parseFloat(r.DATA_VALUE || 0),
          })),
        };
      } else {
        results.ppi = { current: 0, yoy: 0, date: endYM, history: [] };
      }
    }

    // ── 3. 리스크 점수 계산
    if (type === 'all') {
      const rate    = results.rate?.current  || 2.75;
      const ppiYoy  = results.ppi?.yoy       || 0;

      // 금리 리스크: 기준금리 기반 (0%→0점, 5%→10점)
      const rateRisk = Math.min(10, Math.round(rate * 2 * 10) / 10);

      // 공사비 리스크: PPI 전년비 (음수→2점, +5%→5점, +10%→9점)
      const ppiRisk  = Math.min(10, Math.max(1, Math.round((2 + Math.max(0, ppiYoy) * 0.7) * 10) / 10));

      results.riskScores = {
        rate:   rateRisk,
        policy: 5.8,
        legal:  2.9,
        ppi:    ppiRisk,
      };
    }

    return res.status(200).json({ success: true, ...results });

  } catch (err) {
    console.error('ECOS API 오류:', err);
    return res.status(500).json({ error: 'ECOS API 호출 실패', detail: err.message });
  }
}
