/**
 * api/global-indicators.js
 * 글로벌 경제 지표 수집
 * - 미국 10년물 국채금리: FRED API (무료)
 * - WTI 유가: EIA API (무료)
 * - USD/KRW 환율: 한국은행 ECOS
 * - 건설공사비지수: 한국은행 ECOS
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ECOS_KEY = process.env.ECOS_API_KEY;
  const BASE_ECOS = 'https://ecos.bok.or.kr/api';

  const now = new Date();
  const endYM = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  const startDate = new Date(now); startDate.setMonth(startDate.getMonth()-12);
  const startYM = `${startDate.getFullYear()}${String(startDate.getMonth()+1).padStart(2,'0')}`;

  const results = {};

  // ── 1. USD/KRW 환율 (한국은행 ECOS: 731Y001/0000001)
  try {
    const url = `${BASE_ECOS}/StatisticSearch/${ECOS_KEY}/json/kr/1/13/731Y001/MM/${startYM}/${endYM}/0000001`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    const rows = d?.StatisticSearch?.row || [];
    const latest = rows[rows.length - 1];
    const prev   = rows[rows.length - 2] || rows[0];
    results.usdkrw = {
      current: parseFloat(latest?.DATA_VALUE || 0),
      prev:    parseFloat(prev?.DATA_VALUE || 0),
      date:    latest?.TIME || endYM,
      history: rows.slice(-12).map(r => ({ date: r.TIME, value: parseFloat(r.DATA_VALUE || 0) })),
    };
  } catch(e) {
    results.usdkrw = { current: 0, prev: 0, date: endYM, history: [] };
  }

  // ── 2. 건설공사비지수 (한국은행 ECOS: 404Y015)
  try {
    const url = `${BASE_ECOS}/StatisticSearch/${ECOS_KEY}/json/kr/1/13/404Y015/MM/${startYM}/${endYM}/AA`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    const rows = d?.StatisticSearch?.row || [];
    const latest = rows[rows.length - 1];
    const prev12 = rows[rows.length - 13] || rows[0];
    const yoy = prev12?.DATA_VALUE
      ? Math.round(((parseFloat(latest?.DATA_VALUE) - parseFloat(prev12.DATA_VALUE))
          / parseFloat(prev12.DATA_VALUE) * 100) * 10) / 10
      : 0;
    results.constIdx = {
      current: parseFloat(latest?.DATA_VALUE || 0),
      yoy,
      date: latest?.TIME || endYM,
    };
  } catch(e) {
    results.constIdx = { current: 0, yoy: 0, date: endYM };
  }

  // ── 3. 미국 10년물 국채금리 (FRED API - 무료, 키 불필요)
  try {
    const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&vintage_date=' + 
      now.toISOString().split('T')[0];
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const csv = await r.text();
    const lines = csv.trim().split('\n').filter(l => !l.startsWith('DATE') && !l.includes('.')==false);
    // 최근 유효값 찾기
    const validLines = lines.filter(l => !l.includes('.') || l.split(',')[1]?.trim() !== '.');
    const lastLine = validLines[validLines.length - 1];
    const val = lastLine ? parseFloat(lastLine.split(',')[1]) : 0;
    results.usTreasury = {
      current: isNaN(val) ? 0 : val,
      date: lastLine?.split(',')[0] || '',
    };
  } catch(e) {
    // FRED 실패 시 대안: 고정값
    results.usTreasury = { current: 0, date: '' };
  }

  // ── 4. WTI 유가 (EIA Open Data - 무료)
  try {
    const url = 'https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=DEMO_KEY&frequency=weekly&data[0]=value&facets[series][]=RWTC&sort[0][column]=period&sort[0][direction]=desc&length=1';
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const d = await r.json();
    const item = d?.response?.data?.[0];
    results.wti = {
      current: parseFloat(item?.value || 0),
      date: item?.period || '',
    };
  } catch(e) {
    results.wti = { current: 0, date: '' };
  }

  return res.status(200).json({ success: true, ...results });
}
