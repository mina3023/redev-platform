/**
 * api/seoul-redev.js
 * 서울시 재개발·재건축 정비사업 현황 API 프록시
 * 서울 열린데이터광장 OA-2253
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const API_KEY = process.env.SEOUL_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: '서울시 API 키 미설정' });

  const { page = '1', size = '1000', gu = '' } = req.query;
  const startIdx = (parseInt(page) - 1) * parseInt(size) + 1;
  const endIdx   = parseInt(page) * parseInt(size);
  const BASE = 'http://openapi.seoul.go.kr:8088';

  // OA-2253에 가능한 서비스명 순서대로 시도
  const SERVICE_NAMES = [
    'GetJijukInfo',
    'SttsJibunNm',
    'RedevReconstrInfo',
    'BizAreaInfo',
    'HouseRenovationInfo',
    'SIBizInfo',
  ];

  let lastError = '';
  let lastRaw = null;

  for (const SERVICE of SERVICE_NAMES) {
    try {
      const url = `${BASE}/${API_KEY}/json/${SERVICE}/${startIdx}/${endIdx}/`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = await response.text();

      let data;
      try { data = JSON.parse(text); }
      catch(e) {
        lastError = `JSON 파싱 실패 (${SERVICE})`;
        lastRaw = text.slice(0, 300);
        continue;
      }

      // 해당 서비스명으로 데이터가 있는지 확인
      const svcData = data?.[SERVICE];
      if (!svcData) {
        lastError = `서비스명 없음: ${SERVICE}`;
        lastRaw = Object.keys(data || {}).join(', ');
        continue;
      }

      const resultCode = svcData?.RESULT?.CODE || '';
      if (resultCode && resultCode !== 'INFO-000') {
        lastError = `${SERVICE}: ${svcData?.RESULT?.MESSAGE || resultCode}`;
        continue;
      }

      const rows = svcData?.row || [];
      const totalCount = svcData?.list_total_count || rows.length;

      // 자치구 필터
      const filtered = gu
        ? rows.filter(r => JSON.stringify(r).includes(gu))
        : rows;

      // 데이터 정제 (필드명이 API마다 다를 수 있으므로 유연하게)
      const items = filtered.map(r => ({
        guName:      r.CGG_NM || r.GU_NM || r.SIGUN_NM || '',
        projectName: r.BSNS_NM || r.PRJT_NM || r.NM || r.NAME || '',
        projectType: r.BSNS_CSTM_CD_NM || r.BSNS_TYPE || r.TYPE_NM || '',
        stage:       r.STTS_NM || r.STEP_NM || r.PHASE_NM || r.STAGE || '',
        stageCode:   r.STTS_CD || r.STEP_CD || '',
        area:        r.BSNS_AREA || r.AREA || '',
        addr:        r.ADDR || r.ADDRESS || '',
        totalHouse:  r.BFRHL_HDCP_CNT || r.EXIST_HOUSE || '',
        planHouse:   r.TNLCC_HDCP_CNT || r.PLAN_HOUSE || '',
        raw:         r, // 디버그용
      }));

      // 집계
      const stageCount = {};
      const guCount = {};
      const typeCount = {};
      items.forEach(item => {
        if (item.stage) stageCount[item.stage] = (stageCount[item.stage] || 0) + 1;
        if (item.guName) guCount[item.guName] = (guCount[item.guName] || 0) + 1;
        if (item.projectType) typeCount[item.projectType] = (typeCount[item.projectType] || 0) + 1;
      });

      return res.status(200).json({
        success: true,
        serviceName: SERVICE,
        totalCount,
        returnCount: items.length,
        items,
        summary: { stageCount, guCount, typeCount },
      });

    } catch(err) {
      lastError = `${SERVICE} 호출 오류: ${err.message}`;
    }
  }

  // 모든 서비스명 실패 시 디버그 정보 반환
  return res.status(200).json({
    success: false,
    error: '모든 서비스명 시도 실패',
    lastError,
    lastRaw,
    triedServices: SERVICE_NAMES,
    hint: 'Vercel 로그에서 정확한 서비스명을 확인하세요',
  });
}

