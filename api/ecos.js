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
    // 통계표: 722Y001 (한국은행 기준금리)
    // 주기: MM(월), 항목코드: 0101000
    if (type === 'rate' || type === 'all') {
      const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/722Y001/MM/${startYM}/${endYM}/0101000`;
      const r = await fetch(url);
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch(e) { d = {}; }

      const rows = d?.StatisticSearch?.row || [];

      if (rows.length === 0) {
        // 데이터 없으면 KeyStatisticList로 fallback (기준금리 key=1000000)
        const url2 = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/1/1000000`;
        const r2 = await fetch(url2);
        const d2 = await r2.json();
        const item = d2?.KeyStatisticList?.row?.[0];
        results.rate = {
          current: parseFloat(item?.DATA_VALUE || 2.75),
          prev: parseFloat(item?.DATA_VALUE || 2.75),
          date: item?.TIME || endYM,
          history: Array.from({length:12},(_,i)=>{
            const d=new Date(now);d.setMonth(d.getMonth()-11+i);
            return {date:`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`,value:2.75};
          }),
        };
      } else {
        const latest = rows[rows.length - 1];
        const prev   = rows.length >= 2 ? rows[rows.length - 2] : rows[0];
        results.rate = {
          current: parseFloat(latest?.DATA_VALUE || 0),
          prev:    parseFloat(prev?.DATA_VALUE || 0),
          date:    latest?.TIME || '',
          history: rows.slice(-12).map(r => ({
            date: r.TIME,
            value: parseFloat(r.DATA_VALUE || 0),
          })),
        };
      }
    }

    // ── 2. 생산자물가지수 (PPI)
    // 통계표: 404Y014 (생산자물가지수), 항목: AA (전체)
    if (type === 'ppi' || type === 'all') {
      const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/404Y014/MM/${startYM}/${endYM}/AA`;
      const r = await fetch(url);
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch(e) { d = {}; }

      let rows = d?.StatisticSearch?.row || [];

      // AA 안되면 AAAA 시도
      if (rows.length === 0) {
        const url2 = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/404Y014/MM/${startYM}/${endYM}/AAAA`;
        const r2 = await fetch(url2);
        const d2 = await r2.json();
        rows = d2?.StatisticSearch?.row || [];
      }

      // 그래도 없으면 다른 PPI 코드 시도 (P00)
      if (rows.length === 0) {
        const url3 = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/404Y001/MM/${startYM}/${endYM}/P00`;
        const r3 = await fetch(url3);
        const d3 = await r3.json();
        rows = d3?.StatisticSearch?.row || [];
      }

      if (rows.length === 0) {
        results.ppi = { current: 0, yoy: 0, date: endYM, history: [] };
      } else {
        const latest  = rows[rows.length - 1];
        const prev12  = rows.length >= 13 ? rows[rows.length - 13] : rows[0];
        const yoy = prev12?.DATA_VALUE
          ? Math.round(((parseFloat(latest.DATA_VALUE) - parseFloat(prev12.DATA_VALUE))
              / parseFloat(prev12.DATA_VALUE) * 100) * 10) / 10
          : 0;
        results.ppi = {
          current: parseFloat(latest?.DATA_VALUE || 0),
          yoy,
          date: latest?.TIME || '',
          history: rows.slice(-12).map(r => ({
            date: r.TIME,
            value: parseFloat(r.DATA_VALUE || 0),
          })),
        };
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

