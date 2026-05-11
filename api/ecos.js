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

  // 최근 12개월 기간 계산
  const now = new Date();
  const endYM = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  const startDate = new Date(now); startDate.setMonth(startDate.getMonth()-11);
  const startYM = `${startDate.getFullYear()}${String(startDate.getMonth()+1).padStart(2,'0')}`;

  try {
    const results = {};

    // ── 1. 기준금리 (한국은행 기준금리: 722Y001/0101000)
    if (type === 'rate' || type === 'all') {
      const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/722Y001/MM/${startYM}/${endYM}/0101000`;
      const r = await fetch(url);
      const d = await r.json();
      const rows = d?.StatisticSearch?.row || [];
      const latest = rows[rows.length - 1];
      const prev   = rows[rows.length - 13] || rows[0];
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

    // ── 2. 생산자물가지수 PPI (공사비 리스크 대리지표: 404Y014/AAAA)
    if (type === 'ppi' || type === 'all') {
      const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/24/404Y014/MM/${startYM}/${endYM}/AAAA`;
      const r = await fetch(url);
      const d = await r.json();
      const rows = d?.StatisticSearch?.row || [];
      const latest = rows[rows.length - 1];
      const prev12 = rows[rows.length - 13] || rows[0];
      const yoy = prev12?.DATA_VALUE
        ? ((parseFloat(latest?.DATA_VALUE) - parseFloat(prev12.DATA_VALUE)) / parseFloat(prev12.DATA_VALUE) * 100)
        : 0;
      results.ppi = {
        current: parseFloat(latest?.DATA_VALUE || 0),
        yoy: Math.round(yoy * 10) / 10,
        date: latest?.TIME || '',
        history: rows.slice(-12).map(r => ({
          date: r.TIME,
          value: parseFloat(r.DATA_VALUE || 0),
        })),
      };
    }

    // ── 3. 리스크 점수 계산 (0~10)
    if (type === 'all') {
      const rate = results.rate?.current || 3.0;
      const ppiYoy = results.ppi?.yoy || 0;

      // 금리 리스크: 기준금리가 높을수록 위험 (0%=0점, 5%=10점)
      const rateRisk = Math.min(10, Math.round(rate * 2 * 10) / 10);

      // 공사비 리스크: PPI 전년대비 상승률 (0%=2점, 10%+=9점)
      const ppiRisk = Math.min(10, Math.round((2 + ppiYoy * 0.7) * 10) / 10);

      results.riskScores = {
        rate:   rateRisk,
        policy: 5.8,   // 정책 리스크 - 추후 뉴스 API 연동
        delay:  null,  // redev_timeline에서 계산 (프론트에서 처리)
        market: null,  // 실거래 건수 증감에서 계산 (프론트에서 처리)
        legal:  2.9,   // 법적 분쟁 - 추후 법원 데이터 연동
        ppi:    ppiRisk,
      };
    }

    return res.status(200).json({ success: true, ...results });

  } catch (err) {
    console.error('ECOS API 오류:', err);
    return res.status(500).json({ error: 'ECOS API 호출 실패', detail: err.message });
  }
}
