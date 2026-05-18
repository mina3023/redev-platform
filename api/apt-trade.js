/**
 * api/apt-trade.js
 * 국토교통부 아파트 매매 실거래가 API 프록시
 * GET /api/apt-trade?lawdCd=11&dealYmd=202412&numOfRows=50
 */

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.MOLIT_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  // 기본값: 2개월 전 (신고 지연 감안)
  const now = new Date();
  now.setMonth(now.getMonth() - 2);
  const defaultYmd = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;

  const {
    lawdCd = '11650',  // 서초구
    dealYmd = defaultYmd,
    numOfRows = '100',
    pageNo = '1',
  } = req.query;

  const endpoint = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
  const url = `${endpoint}?serviceKey=${encodeURIComponent(API_KEY)}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=${numOfRows}&pageNo=${pageNo}`;

  try {
    const response = await fetch(url);
    const xmlText = await response.text();

    // XML → JSON 간단 파싱
    const items = [];
    const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/g) || [];

    for (const item of itemMatches) {
      const get = (tag) => {
        const m = item.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`));
        return m ? m[1].trim() : '';
      };
      items.push({
        aptName:    get('aptNm'),
        dealAmount: get('dealAmount').replace(/,/g, ''),  // 만원
        buildYear:  get('buildYear'),
        dealYear:   get('dealYear'),
        dealMonth:  get('dealMonth'),
        dealDay:    get('dealDay'),
        area:       get('excluUseAr'),   // 전용면적 m²
        floor:      get('floor'),
        umdNm:      get('umdNm'),        // 법정동
        jibun:      get('jibun'),
      });
    }

    // totalCount 파싱
    const totalMatch = xmlText.match(/<totalCount>(\d+)<\/totalCount>/);
    const totalCount = totalMatch ? parseInt(totalMatch[1]) : 0;

    return res.status(200).json({
      success: true,
      totalCount,
      numOfRows: parseInt(numOfRows),
      pageNo: parseInt(pageNo),
      dealYmd,
      lawdCd,
      items,
    });
  } catch (err) {
    console.error('국토부 API 오류:', err);
    return res.status(500).json({ error: '외부 API 호출 실패', detail: err.message });
  }
}
