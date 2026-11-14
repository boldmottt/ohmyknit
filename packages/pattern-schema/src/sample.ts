import type { PatternInput } from './index.js';

/**
 * 개발·시연용 샘플 도안. 기획서 예시 숫자(22코 30단, 몸판 200코, 6단마다 늘림 ×12)를 그대로 씁니다.
 * 차트는 이 프로젝트용으로 새로 그린 12×19 무늬입니다.
 */
const CHART_TOP_DOWN = [
  '............', // 19
  '..y.....y...', // 18
  '.yyy...yyy..', // 17
  '..y.....y...', // 16
  '............', // 15
  'o.....o.....', // 14
  'oo...ooo...o', // 13
  'ooo.ooooo.oo', // 12
  'oooooooooooo', // 11
  'b..b..b..b..', // 10
  'mmmmmmmmmmmm', // 9
  '.mm..mm..mm.', // 8
  'm..mm..mm..m', // 7
  'mmmmmmmmmmmm', // 6
  '............', // 5
  '.pp....pp...', // 4
  '.pp....pp...', // 3
  'pppp..pppp..', // 2
  '............', // 1
];

const KEY: Record<string, number> = { '.': 0, p: 1, y: 2, o: 3, m: 4, b: 5 };

export const SAMPLE_CHART_GRID: number[][] = [...CHART_TOP_DOWN]
  .reverse()
  .map((line) => [...line].map((ch) => KEY[ch]!));

export const SAMPLE_PATTERN: PatternInput = {
  title: '겨울 페어아일 요크 스웨터',
  designer: 'KnitCloset 샘플',
  yarn: 'DK 울 · 버건디 4볼, 배색 각 1볼',
  gauge: { st: 22, row: 30, needleMm: 4, technique: 'stockinette' },
  palette: [
    { name: '버건디', hex: '#6B1F3A' },
    { name: '핑크', hex: '#E8A6A8' },
    { name: '머스터드', hex: '#D9B45A' },
    { name: '오렌지', hex: '#D9622B' },
    { name: '민트', hex: '#BFE3DD' },
    { name: '블루', hex: '#2B5BD9' },
  ],
  sizes: [
    { label: 'S', finished: { 가슴둘레: 82, 총장: 56 } },
    { label: 'M', finished: { 가슴둘레: 91, 총장: 58 } },
    { label: 'L', finished: { 가슴둘레: 100, 총장: 60 } },
  ],
  pieces: [
    {
      id: 'body',
      name: '몸판',
      construction: 'round',
      direction: 'bottom_up',
      castOn: { S: 180, M: 200, L: 220 },
      stitchMultiple: 4,
      sections: [
        { name: '밑단 고무단', technique: 'ribbing', rows: 18, instruction: '2코 고무뜨기 (겉2 안2)' },
        {
          name: '몸통',
          technique: 'stockinette',
          rows: { S: 96, M: 102, L: 108 },
          instruction: '겉뜨기',
          events: [{ kind: 'checkin', atRow: 60, text: '몸통 길이 재기' }],
        },
        {
          name: '배색 무늬',
          technique: 'colorwork',
          rows: 19,
          instruction: '차트대로 배색뜨기',
          chart: { grid: SAMPLE_CHART_GRID, repeatW: 12 },
          events: [{ kind: 'split', atRow: 'end', text: '소매와 합칠 준비, 겨드랑이 코 쉼코로', stitches: 16 }],
        },
      ],
    },
    {
      id: 'sleeve',
      name: '소매',
      construction: 'round',
      direction: 'bottom_up',
      count: 2,
      castOn: { S: 44, M: 48, L: 52 },
      stitchMultiple: 4,
      sections: [
        { name: '소매 고무단', technique: 'ribbing', rows: 18, instruction: '2코 고무뜨기 (겉2 안2)' },
        {
          name: '소매 몸통',
          technique: 'stockinette',
          rows: 96,
          instruction: '겉뜨기',
          shaping: [
            { kind: 'inc', everyRows: 6, times: 12, stitchesPerEvent: 2, position: '마커 양옆', afterRows: 10 },
          ],
          events: [{ kind: 'bindoff', atRow: 'end', stitches: 8, text: '겨드랑이 코막음', lock: true }],
        },
      ],
    },
  ],
};
