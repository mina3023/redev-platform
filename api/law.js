/**
 * api/law.js
 * 국가법령정보 공동활용 Open API 프록시
 * GET /api/law?type=law&query=도시정비법     → 법령 검색
 * GET /api/law?type=prec&query=재개발 조합   → 판례 검색
 * GET /api/law?type=lawDetail&lawId=XXX      → 법령 상세
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const OC = process.env.LAW_API_KEY;
  if (!OC) return res.status(500).json({ error: '법령 API 키 미설정' });

  const { type = 'law', query = '도시정비법', lawId = '', page = '1' } = req.query;
  const BASE = 'https://open.law.go.kr/LSO/search';

  try {

    // ── 1. 법령 검색
    if (type === 'law') {
      const url = `${BASE}/law.do?OC=${OC}&target=law&type=JSON&display=20&page=${page}&query=${encodeURIComponent(query)}`;
      const r = await fetch(url);
      const d = await r.json();

      const laws = d?.LawSearch?.law || [];
      const total = d?.LawSearch?.totalCnt || 0;

      return res.status(200).json({
        success: true,
        type: 'law',
        total: parseInt(total),
        items: laws.map(l => ({
          id:       l['법령ID'] || '',
          name:     l['법령명한글'] || '',
          nameEn:   l['법령명영문'] || '',
          type:     l['법령구분명'] || '',
          ministry: l['소관부처명'] || '',
          pubDate:  l['공포일자'] || '',
          pubNum:   l['공포번호'] || '',
          effDate:  l['시행일자'] || '',
          lawLink:  `https://www.law.go.kr/법령/${encodeURIComponent(l['법령명한글'] || '')}`,
        })),
      });
    }

    // ── 2. 판례 검색
    if (type === 'prec') {
      const url = `${BASE}/prec.do?OC=${OC}&target=prec&type=JSON&display=20&page=${page}&query=${encodeURIComponent(query)}`;
      const r = await fetch(url);
      const d = await r.json();

      const precs = d?.PrecSearch?.prec || [];
      const total = d?.PrecSearch?.totalCnt || 0;

      return res.status(200).json({
        success: true,
        type: 'prec',
        total: parseInt(total),
        items: precs.map(p => ({
          id:        p['판례일련번호'] || '',
          name:      p['사건명'] || '',
          caseNum:   p['사건번호'] || '',
          court:     p['법원명'] || '',
          courtType: p['법원종류코드'] || '',
          judgeDate: p['선고일자'] || '',
          judgeType: p['선고'] || '',
          caseType:  p['사건종류명'] || '',
          verdict:   p['판결유형'] || '',
          link:      `https://www.law.go.kr/판례/${p['판례일련번호'] || ''}`,
        })),
      });
    }

    // ── 3. 법령 상세 (조문 포함)
    if (type === 'lawDetail') {
      const url = `https://open.law.go.kr/LSO/lawService.do?OC=${OC}&target=law&type=JSON&ID=${lawId}`;
      const r = await fetch(url);
      const d = await r.json();

      return res.status(200).json({
        success: true,
        type: 'lawDetail',
        data: d,
      });
    }

    // ── 4. 행정규칙 검색
    if (type === 'admrul') {
      const url = `${BASE}/admrul.do?OC=${OC}&target=admrul&type=JSON&display=20&page=${page}&query=${encodeURIComponent(query)}`;
      const r = await fetch(url);
      const d = await r.json();

      const items = d?.AdmrulSearch?.admrul || [];
      const total = d?.AdmrulSearch?.totalCnt || 0;

      return res.status(200).json({
        success: true,
        type: 'admrul',
        total: parseInt(total),
        items: items.map(i => ({
          id:       i['행정규칙ID'] || '',
          name:     i['행정규칙명'] || '',
          type:     i['행정규칙종류명'] || '',
          ministry: i['소관부처명'] || '',
          pubDate:  i['발령일자'] || '',
          effDate:  i['시행일자'] || '',
        })),
      });
    }

    return res.status(400).json({ error: '잘못된 type 파라미터' });

  } catch (err) {
    console.error('법령 API 오류:', err);
    return res.status(500).json({ error: '법령 API 호출 실패', detail: err.message });
  }
}
