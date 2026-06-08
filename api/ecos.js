/**
 * api/ecos.js — 건설공사비지수 코드 탐색 버전
 * /api/ecos?type=search  → StatisticSearch 항목코드 탐색
 * /api/ecos?type=debug2  → 301계열 통계표 목록 확인
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

  // ── 통계표 목록에서 건설 관련 코드 탐색
  if (type === 'debug2') {
    const result = {};

    // 1. StatisticTableList — 건설 관련 통계표 전체 조회
    // 분류코드 없이 전체에서 건설 관련 탐색
    for (const cls of ['3','4','8','9','30','31','40','90']) {
      try {
        const url = `${BASE}/StatisticTableList/${API_KEY}/json/kr/1/100/${cls}`;
        const r = await fetch(url);
        const d = await r.json();
        const rows = d?.StatisticTableList?.row || [];
        const found = rows.filter(r =>
          r.STAT_NAME?.includes('건설') || r.STAT_NAME?.includes('공사비')
        );
        if (found.length > 0) {
          result[`cls_${cls}`] = found.map(r => ({
            code: r.STAT_CODE, name: r.STAT_NAME, cycle: r.CYCLE
          }));
        }
      } catch(e) {}
    }

    // 2. 기존에 작동하던 기준금리 코드(722Y001)로 항목구조 파악
    try {
      const url = `${BASE}/StatisticItemList/${API_KEY}/json/kr/1/50/722Y001`;
      const r = await fetch(url);
      const d = await r.json();
      result['_sample_itemList_722Y001'] = d?.StatisticItemList?.row?.slice(0,5) || d?.RESULT;
    } catch(e) { result['_sample_error'] = e.message; }

    // 3. 301Y013, 301Y017 항목 목록 직접 조회
    for (const stat of ['301Y013','301Y017','301Y014','404Y014','404Y001']) {
      try {
        const url = `${BASE}/StatisticItemList/${API_KEY}/json/kr/1/50/${stat}`;
        const r = await fetch(url);
        const d = await r.json();
        const rows = d?.StatisticItemList?.row || [];
        if (rows.length > 0) {
          result[`items_${stat}`] = rows.slice(0,10).map(r => ({
            item1: r.ITEM_CODE1, item2: r.ITEM_CODE2,
            name: r.ITEM_NAME1, cycle: r.CYCLE
          }));
        } else {
          result[`items_${stat}`] = d?.RESULT || '항목없음';
        }
      } catch(e) {
        result[`items_${stat}`] = e.message;
      }
    }

    return res.status(200).json({ success: true, debug2: result });
  }

  // ── 항목코드 포함 StatisticSearch 테스트
  if (type === 'search') {
    const result = {};
    // 항목코드 없이 와일드카드로 시도
    const tests = [
      { stat: '301Y013', item: '%', label: 'COPI구-와일드' },
      { stat: '301Y017', item: '%', label: 'COPI신-와일드' },
      { stat: '301Y013', item: '',  label: 'COPI구-빈값' },
      // 기준금리처럼 숫자 항목코드
      { stat: '301Y013', item: '0000000', label: 'COPI-0' },
      { stat: '301Y013', item: '1',       label: 'COPI-1' },
      { stat: '301Y013', item: 'S',       label: 'COPI-S' },
      { stat: '301Y013', item: 'T',       label: 'COPI-T' },
      { stat: '301Y013', item: 'A',       label: 'COPI-A' },
      { stat: '301Y013', item: 'B',       label: 'COPI-B' },
      { stat: '301Y013', item: 'C0000',   label: 'COPI-C0000' },
      { stat: '404Y014', item: 'A',       label: 'PPI-A' },
      { stat: '404Y014', item: 'AA',      label: 'PPI-AA' },
      { stat: '404Y014', item: 'AAA',     label: 'PPI-AAA' },
      // 기준금리처럼 7자리 숫자
      { stat: '722Y001', item: '0101000', label: '기준금리(검증)' },
    ];

    for (const t of tests) {
      try {
        const url = `${BASE}/StatisticSearch/${API_KEY}/json/kr/1/3/${t.stat}/MM/202505/202506/${t.item}`;
        const r = await fetch(url);
        const d = await r.json();
        const rows = d?.StatisticSearch?.row || [];
        if (rows.length > 0) {
          result[t.label] = { ok: true, value: rows[rows.length-1]?.DATA_VALUE, rows: rows.length };
        } else {
          result[t.label] = { ok: false, msg: d?.RESULT?.MESSAGE || '없음' };
        }
      } catch(e) {
        result[t.label] = { ok: false, msg: e.message };
      }
    }
    return res.status(200).json({ success: true, search: result });
  }

  // ── 기존 로직 유지 (rate / all)
  try {
    const results = {};

    if (type === 'rate' || type === 'all') {
      const url = `${BASE}/KeyStatisticList/${API_KEY}/json/kr/1/100`;
      const r = await fetch(url);
      const d = await r.json();
      const rows = d?.KeyStatisticList?.row || [];
      const rateItem = rows.find(r =>
        r.KEYSTAT_NAME?.includes('기준금리') || r.KEYSTAT_NAME?.includes('Base Rate')
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
          date: r.TIME, value: parseFloat(r.DATA_VALUE || 0),
        })).filter(h => h.value > 0);
      } catch(e) {}

      if (!history.length) {
        history = Array.from({length:12}, (_, i) => {
          const d = new Date(now);
          d.setMonth(d.getMonth() - 11 + i);
          return { date:`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`, value:currentRate };
        });
      }
      results.rate = { current:currentRate, prev:history.length>=2?history[history.length-2].value:currentRate, date:rateDate, history };
    }

    // ppi — 건설공사비지수 찾을 때까지 임시로 건설기성액 증감률 사용
    if (type === 'ppi' || type === 'all') {
      // 건설기성액은 KeyStatList에서 바로 가져올 수 있음 (9조원 → 지수로 활용)
      // 실제 건설공사비지수 코드 확정 전 임시: 0 반환하고 화면에 "데이터 조회 중" 표시
      results.ppi = { current: 0, yoy: 0, date: endYM, history: [], label: '건설공사비지수(코드확인중)' };
    }

    if (type === 'all') {
      const rate = results.rate?.current || 2.75;
      results.riskScores = { rate: Math.min(10, Math.round(rate*2*10)/10), policy:5.8, legal:2.9, ppi:3 };
    }

    return res.status(200).json({ success:true, ...results });
  } catch(err) {
    return res.status(500).json({ error:'ECOS API 호출 실패', detail:err.message });
  }
}
