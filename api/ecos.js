/**
 * api/ecos.js
 * 한국은행 ECOS API (기준금리) +
 * 한국건설기술연구원 KICT 건설공사비지수 (하드코딩, 매월 말 업데이트)
 * 출처: https://www.kict.re.kr / 승인번호 제397001호
 */

// ── 건설공사비지수 (KICT, 2020년=100 기준)
// 매월 말 KICT 발표 후 업데이트 필요
// 최종 업데이트: 2026년 5월 29일 (2026년 4월 잠정치)
const COPI_HISTORY = [
  { date: '202505', value: 131.17 }, // 추정
  { date: '202506', value: 131.35 }, // 추정
  { date: '202507', value: 131.52 }, // 추정
  { date: '202508', value: 131.68 }, // 추정
  { date: '202509', value: 131.85 }, // 추정
  { date: '202510', value: 132.12 }, // 추정
  { date: '202511', value: 132.45 }, // 확정
  { date: '202512', value: 132.70 }, // 확정
  { date: '202601', value: 133.52 }, // 확정
  { date: '202602', value: 133.76 }, // 확정
  { date: '202603', value: 134.53 }, // 확정
  { date: '202604', value: 136.88 }, // 잠정 (2026.5.29 발표)
];

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

    // ── 1. 기준금리 (ECOS API)
    if (type === 'rate' || type === 'all') {
      const url = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/100`;
      const r = await fetch(url);
      const d = await r.json();
      const rows = d?.KeyStatisticList?.row || [];
      const rateItem = rows.find(r =>
        r.KEYSTAT_NAME?.includes('기준금리') || r.KEYSTAT_NAME?.includes('Base Rate')
      );
      const currentRate = parseFloat(rateItem?.DATA_VALUE || 2.5);
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
        // 실제 한국은행 기준금리 인하 이력 (fallback)
        history = [
          {date:'202407',value:3.50},{date:'202408',value:3.50},
          {date:'202409',value:3.50},{date:'202410',value:3.25},
          {date:'202411',value:3.00},{date:'202412',value:3.00},
          {date:'202501',value:3.00},{date:'202502',value:2.75},
          {date:'202503',value:2.75},{date:'202504',value:2.75},
          {date:'202505',value:2.50},{date:'202506',value:2.50},
        ];
      }

      results.rate = {
        current: currentRate,
        prev: history.length >= 2 ? history[history.length-2].value : currentRate,
        date: rateDate,
        history,
      };
    }

    // ── 2. 건설공사비지수 (KICT 하드코딩)
    if (type === 'ppi' || type === 'all') {
      const latest  = COPI_HISTORY[COPI_HISTORY.length - 1];
      const prev12  = COPI_HISTORY.length >= 13
        ? COPI_HISTORY[COPI_HISTORY.length - 13]
        : COPI_HISTORY[0];

      // 전년동월 직접 비교 (PDF 확인값)
      // 2026년 4월(136.88) vs 2025년 4월(131.06) = +4.44%
      const PREV_YEAR_APRIL = 131.06;
      const yoy = latest.date === '202604'
        ? 4.44  // PDF 확정값
        : prev12?.value > 0
          ? Math.round((latest.value - prev12.value) / prev12.value * 100 * 10) / 10
          : 0;

      results.ppi = {
        current: latest.value,
        yoy,
        date: latest.date,
        history: COPI_HISTORY.slice(-12).map(r => ({
          date: r.date,
          value: r.value,
        })),
        label: '건설공사비지수(KICT)',
        source: '한국건설기술연구원 2026.5.29 발표',
        note: '2020년=100 기준, 잠정치(P)',
      };
    }

    // ── 3. 리스크 점수
    if (type === 'all') {
      const rate    = results.rate?.current || 2.5;
      const copiYoy = results.ppi?.yoy || 0;
      results.riskScores = {
        rate:   Math.min(10, Math.round(rate * 2 * 10) / 10),
        policy: 5.8,
        legal:  2.9,
        ppi:    Math.min(10, Math.max(1, Math.round((2 + Math.max(0, copiYoy) * 0.7) * 10) / 10)),
      };
    }

    return res.status(200).json({ success: true, ...results });

  } catch(err) {
    console.error('ECOS API 오류:', err);
    return res.status(500).json({ error: 'ECOS API 호출 실패', detail: err.message });
  }
}
