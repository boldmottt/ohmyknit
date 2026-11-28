import type { PatternInput } from '@knitcloset/pattern-schema';

/**
 * 테스트용 도안: 앞판·뒤판을 평면으로 어깨까지 뜨고(진동 코막음·줄임, 앞목 파임),
 * 위가 넓은 반소매 둘, 밑단 띠 둘 (3D에는 안 붙는 조각). 22코·30단 게이지, 가슴 91cm.
 * 원통 몸판을 겨드랑이까지만 뜨는 요크 스웨터(SAMPLE_PATTERN)와 달리 몸판 맨 윗단이 어깨선이라,
 * 겨드랑이는 진동이 시작하는 높이예요.
 */
export const FLAT_PATTERN: PatternInput = {
  title: '평면 앞뒤판 반소매 스웨터',
  designer: '테스트',
  gauge: { st: 22, row: 30, needleMm: 4, technique: 'stockinette' },
  palette: [
    { name: '크림', hex: '#EFE6DA' },
    { name: '버건디', hex: '#7A1F2E' },
  ],
  sizes: [{ label: 'M', finished: { 가슴둘레: 91, 총장: 44 } }],
  pieces: [
    {
      id: 'front',
      name: '앞판',
      construction: 'flat',
      direction: 'bottom_up',
      castOn: 100,
      sections: [
        { name: '밑단 고무단', technique: 'ribbing', rows: 8, instruction: '1코 고무뜨기' },
        { name: '몸통', technique: 'stockinette', rows: 58, instruction: '겉뜨기' },
        { name: '배색 무늬', technique: 'stockinette', rows: 20, instruction: '배색' },
        {
          name: '진동',
          technique: 'stockinette',
          rows: 24,
          instruction: '겉뜨기',
          events: [
            { kind: 'bindoff', atRow: 1, stitches: 6, text: '진동 코막음' },
            { kind: 'bindoff', atRow: 2, stitches: 6, text: '진동 코막음' },
          ],
          shaping: [{ kind: 'dec', everyRows: 2, times: 3, stitchesPerEvent: 2, position: '양끝', afterRows: 2 }],
        },
        {
          name: '앞목',
          technique: 'stockinette',
          rows: 22,
          instruction: '겉뜨기',
          events: [{ kind: 'bindoff', atRow: 1, stitches: 16, text: '앞목 코막음' }],
          shaping: [{ kind: 'dec', everyRows: 2, times: 4, stitchesPerEvent: 2, position: '목 양쪽', afterRows: 1 }],
        },
      ],
    },
    {
      id: 'back',
      name: '뒤판',
      construction: 'flat',
      direction: 'bottom_up',
      castOn: 100,
      sections: [
        { name: '밑단 고무단', technique: 'ribbing', rows: 8, instruction: '1코 고무뜨기' },
        { name: '몸통', technique: 'stockinette', rows: 58, instruction: '겉뜨기' },
        { name: '배색 무늬', technique: 'stockinette', rows: 20, instruction: '배색' },
        {
          name: '진동',
          technique: 'stockinette',
          rows: 46,
          instruction: '겉뜨기',
          events: [
            { kind: 'bindoff', atRow: 1, stitches: 6, text: '진동 코막음' },
            { kind: 'bindoff', atRow: 2, stitches: 6, text: '진동 코막음' },
          ],
          shaping: [{ kind: 'dec', everyRows: 2, times: 3, stitchesPerEvent: 2, position: '양끝', afterRows: 2 }],
        },
      ],
    },
    {
      id: 'sleeve',
      name: '소매',
      construction: 'flat',
      direction: 'bottom_up',
      count: 2,
      castOn: 62,
      sections: [
        { name: '소매 고무단', technique: 'ribbing', rows: 8, instruction: '1코 고무뜨기' },
        {
          name: '소매 몸통',
          technique: 'stockinette',
          rows: 48,
          instruction: '겉뜨기',
          shaping: [{ kind: 'inc', everyRows: 8, times: 6, stitchesPerEvent: 2, position: '양끝', afterRows: 2 }],
        },
      ],
    },
    {
      id: 'band',
      name: '밑단 여밈 띠',
      construction: 'flat',
      direction: 'bottom_up',
      count: 2,
      castOn: 60,
      sections: [{ name: '여밈 띠', technique: 'ribbing', rows: 8, instruction: '1코 고무뜨기' }],
    },
  ],
};
