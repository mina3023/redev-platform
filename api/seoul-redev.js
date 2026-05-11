/**
 * api/seoul-redev.js
 * 서울시 재개발·재건축 정비사업 현황 API 프록시
 * GET /api/seoul-redev?page=1&size=100&gu=강남구
 *
 * 서울 열린데이터광장 OA-2253
 * 서울시 재개발 재건축 정비사업 현황
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.SEOUL_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: '서울시 API 키 미설정' });

  const {
    page = '1',
    size = '1000',
    gu   = '',       // 자치구 필터 (선택)
  } = req.query;

  const startIdx = (parseInt(page) - 1) * parseInt(size) + 1;
  const endIdx   = parseInt(page) * parseInt(size);

  // 서울 열린데이터광장 API 엔드포인트
  const BASE = 'http://openapi.seoul.go.kr:8088';
  const SERVICE = 'SttsJibunNm'; // 정비사업 현황 서비스명
  const url = `${BASE}/${API_KEY}/json/${SERVICE}/${startIdx}/${endIdx}/`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // 에러 체크
    const errorCode = data?.[SERVICE]?.RESULT?.CODE;
    if (errorCode && errorCode !== 'INFO-000') {
      return res.status(200).json({
        success: false,
        error: data?.[SERVICE]?.RESULT?.MESSAGE || 'API 오류',
        raw: data,
      });
    }

    const rows = data?.[SERVICE]?.row || [];
    const totalCount = data?.[SERVICE]?.list_total_count || 0;

    // 자치구 필터
    const filtered = gu
      ? rows.filter(r => r.CGG_NM?.includes(gu) || r.ADDR?.includes(gu))
      : rows;

    // 데이터 정제
    const items = filtered.map(r => ({
      guName:      r.CGG_NM || '',           // 자치구명
      projectName: r.BSNS_NM || '',          // 사업명
      projectType: r.BSNS_CSTM_CD_NM || '', // 사업유형 (재개발/재건축 등)
      stage:       r.STTS_NM || '',          // 현재 단계
      stageCode:   r.STTS_CD || '',          // 단계 코드
      area:        r.BSNS_AREA || '',        // 사업면적
      addr:        r.ADDR || '',             // 주소
      totalHouse:  r.BFRHL_HDCP_CNT || '',  // 기존 세대수
      planHouse:   r.TNLCC_HDCP_CNT || '',  // 건립 예정 세대수
      aprvDt:      r.ASSI_YMD || '',         // 구역지정일
      updDt:       r.LASTUPDT || '',         // 최종 업데이트
    }));

    // 단계별 집계
    const stageCount = {};
    items.forEach(item => {
      const s = item.stage || '기타';
      stageCount[s] = (stageCount[s] || 0) + 1;
    });

    // 구별 집계
    const guCount = {};
    items.forEach(item => {
      const g = item.guName || '기타';
      guCount[g] = (guCount[g] || 0) + 1;
    });

    return res.status(200).json({
      success: true,
      totalCount,
      returnCount: items.length,
      page: parseInt(page),
      items,
      summary: {
        stageCount,
        guCount,
      },
    });

  } catch (err) {
    console.error('서울시 API 오류:', err);
    return res.status(500).json({ error: '서울시 API 호출 실패', detail: err.message });
  }
}
