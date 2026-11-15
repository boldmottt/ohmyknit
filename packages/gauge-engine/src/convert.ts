import type { Pattern, PointEvent, Section } from '@knitcloset/pattern-schema';
import { chartHasNoStitch, realCells, resolveSize } from '@knitcloset/pattern-schema';
import { gaugeRatio, type Gauge } from './gauge.js';
import { convertShaping } from './shaping.js';
import { convertStitchCount } from './stitches.js';

export type EventKind = 'inc' | 'dec' | PointEvent['kind'];

export type ConvertedEvent = {
  kind: EventKind;
  stitches?: number;
  text: string;
  lock: boolean;
};

export type ConvertedRow = {
  /** 조각 안에서 1부터 시작하는 단 번호 */
  row: number;
  /** 이 단을 뜨기 시작할 때 바늘에 있는 콧수 = 이 단에서 뜨는 코 수 */
  stitchesWorked: number;
  /** 이 단을 다 뜬 뒤 콧수 */
  stitchCount: number;
  sectionIndex: number;
  /** 섹션 안에서 몇 번째 단인지 (1부터) */
  sectionRow: number;
  /** 섹션 차트의 몇 번째 줄인지 (0 = 맨 아래). 차트가 없으면 undefined */
  chartRow?: number;
  events: ConvertedEvent[];
};

export type ConvertedSection = {
  name: string;
  technique: Section['technique'];
  instruction: string;
  startRow: number;
  endRow: number;
  originalRows: number;
  rows: number;
  chart?: {
    grid: number[][];
    repeatW: number;
    repeatH: number;
    /** 코 없음 칸이 있어서 차트가 늘림·줄임을 정함 (정수리 소용돌이 등) */
    shaped?: boolean;
    /** shaped일 때 둘레를 도는 반복 횟수 */
    repeats?: number;
  };
  /** "6단마다 늘림 9회, 5단마다 늘림 5회 (번갈아) · 마커 양옆" */
  shapingNotes: string[];
};

export type ConvertedPiece = {
  id: string;
  name: string;
  construction: 'flat' | 'round';
  direction: 'top_down' | 'bottom_up';
  castOn: {
    original: number;
    value: number;
    explanation: string;
    /** 도안 작가 손으로 뜬 너비 (설계 치수) */
    designWidthCm: number;
    /** 내 손으로 원본 콧수 그대로 뜨면 나오는 너비 */
    asIsWidthCm: number;
    /** 변환 콧수로 내 손으로 뜬 예상 너비 */
    expectedWidthCm: number;
  };
  /** 이 조각을 변환할 때 쓴 게이지. 뜨는 중에 프로젝트 게이지를 바꿔도 시작한 조각은 이 값을 유지 */
  gauge?: Gauge;
  sections: ConvertedSection[];
  rows: ConvertedRow[];
  totalRows: number;
  /** Σ stitchesWorked */
  totalStitches: number;
  warnings: string[];
};

export type ConversionMode = 'recalc' | 'needle';

export type ConvertedPattern = {
  title: string;
  size: string;
  mode: ConversionMode;
  patternGauge: Gauge;
  myGauge: Gauge;
  kSt: number;
  kRow: number;
  palette: Pattern['palette'];
  pieces: ConvertedPiece[];
};

export type ConvertOptions = {
  size: string;
  /** 내 손 게이지 (스와치 또는 손 프로필 계수 × 도안 게이지) */
  myGauge: Gauge;
  /**
   * recalc: 콧수·단수를 내 게이지로 다시 계산
   * needle: 숫자는 그대로 두고 바늘을 바꿔 도안 게이지를 맞춤 (k = 1)
   */
  mode?: ConversionMode;
  toleranceCm?: number;
};

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function cm(stitches: number, gaugeSt: number): number {
  return Math.round((stitches / gaugeSt) * 100) / 10;
}

function shapingVerb(kind: 'inc' | 'dec'): string {
  return kind === 'inc' ? '늘림' : '줄임';
}

const POINT_LABEL: Record<PointEvent['kind'], string> = {
  bindoff: '코막음',
  split: '분리',
  pickup: '코줍기',
  color: '배색 변경',
  note: '메모',
  checkin: '실측',
};

/**
 * 도안 전체를 내 손에 맞게 변환하고, 조각마다 단별 표를 펼칩니다.
 * 작업 화면은 이 결과만 보면 됩니다. (기획서 3.2, 4.1, 4.2)
 */
export function convertPattern(pattern: Pattern, options: ConvertOptions): ConvertedPattern {
  const mode = options.mode ?? 'recalc';
  const patternGauge: Gauge = { st: pattern.gauge.st, row: pattern.gauge.row };
  const { kSt, kRow } =
    mode === 'needle' ? { kSt: 1, kRow: 1 } : gaugeRatio(options.myGauge, patternGauge);
  // 바늘 교체 방식에서는 바늘을 바꿔 도안 게이지를 맞춘다고 보고 도안 게이지로 계산
  const workingGauge = mode === 'needle' ? patternGauge : options.myGauge;

  if (!pattern.sizes.some((s) => s.label === options.size)) {
    throw new Error(`도안에 "${options.size}" 사이즈가 없어요`);
  }

  const pieces: ConvertedPiece[] = [];
  for (const piece of pattern.pieces) {
    const warnings: string[] = [];
    const originalCastOn = resolveSize(piece.castOn, options.size);
    const firstChart = piece.sections.find((s) => s.chart)?.chart;
    const chartRepeat = firstChart
      ? chartHasNoStitch(firstChart.grid)
        ? realCells(firstChart.grid[0]!).length
        : firstChart.repeatW ?? firstChart.grid[0]!.length
      : undefined;
    const repeat =
      piece.stitchMultiple !== undefined && chartRepeat !== undefined
        ? lcm(piece.stitchMultiple, chartRepeat)
        : piece.stitchMultiple ?? chartRepeat;

    const castOnConv =
      mode === 'needle'
        ? { value: originalCastOn, explanation: `바늘 교체 방식: 원본 ${originalCastOn}코 그대로`, withinTolerance: true }
        : convertStitchCount(originalCastOn, kSt, {
            myStGauge: workingGauge.st,
            ...(repeat !== undefined ? { repeat } : { parity: 'even' as const }),
            ...(options.toleranceCm !== undefined ? { toleranceCm: options.toleranceCm } : {}),
          });
    if (!castOnConv.withinTolerance) {
      warnings.push(
        `코잡기 콧수를 ${repeat}코 반복에 맞추느라 치수 차이가 커요. 바늘 교체 방식을 함께 고려해 보세요.`,
      );
    }

    const sections: ConvertedSection[] = [];
    const rows: ConvertedRow[] = [];
    let count = castOnConv.value;
    let rowNo = 0;

    piece.sections.forEach((section, sectionIndex) => {
      const originalRows = resolveSize(section.rows, options.size);
      const shaped = section.chart ? chartHasNoStitch(section.chart.grid) : false;
      const chart: ConvertedSection['chart'] = section.chart
        ? {
            grid: section.chart.grid,
            repeatW: section.chart.repeatW ?? section.chart.grid[0]!.length,
            repeatH: section.chart.grid.length,
            ...(shaped ? { shaped: true } : {}),
          }
        : undefined;
      // 코 없음 칸이 있는 차트: 단마다 실제 칸 수 × 반복 횟수가 그 단의 콧수
      const realPerRow = shaped && chart ? chart.grid.map((l) => realCells(l).length) : undefined;
      let repeats = 0;
      if (realPerRow && chart) {
        const first = realPerRow[0]!;
        repeats = first > 0 ? Math.max(1, Math.round(count / first)) : 1;
        chart.repeats = repeats;
        if (first * repeats !== count) {
          warnings.push(
            `${section.name}: 시작 콧수 ${count}코가 차트 첫 단 ${first}코 × ${repeats}회와 맞지 않아요. ${first * repeats}코로 계산했어요.`,
          );
        }
      }
      // 배색 차트 구간은 무늬 모양을 지키려고 단 수를 바꾸지 않음
      let sectionRows = chart ? originalRows : Math.max(1, Math.round(originalRows * kRow));

      const eventsAt = new Map<number, ConvertedEvent[]>();
      const push = (r: number, e: ConvertedEvent) => {
        const list = eventsAt.get(r) ?? [];
        list.push(e);
        eventsAt.set(r, list);
      };

      const shapingNotes: string[] = [];
      for (const sh of section.shaping) {
        const everyRows = resolveSize(sh.everyRows, options.size);
        const times = resolveSize(sh.times, options.size);
        if (times <= 0) continue;
        const conv = convertShaping(
          { kind: sh.kind, everyRows, times, stitchesPerEvent: sh.stitchesPerEvent },
          kSt,
          chart ? 1 : kRow,
        );
        const after = sh.afterRows !== undefined
          ? Math.round(resolveSize(sh.afterRows, options.size) * (chart ? 1 : kRow))
          : 0;
        if (after + conv.totalRows > sectionRows) {
          warnings.push(
            `${section.name}: ${shapingVerb(sh.kind)} 구간(${after + conv.totalRows}단)이 섹션(${sectionRows}단)보다 길어서 섹션을 늘렸어요.`,
          );
          sectionRows = after + conv.totalRows;
        }
        let r = after;
        for (const iv of conv.intervals) {
          r += iv;
          push(r, {
            kind: sh.kind,
            stitches: sh.stitchesPerEvent,
            text: `${shapingVerb(sh.kind)} ${sh.stitchesPerEvent}코${sh.position ? ` (${sh.position})` : ''}`,
            lock: false,
          });
        }
        shapingNotes.push(
          `${conv.description}${sh.position ? ` · ${sh.position}` : ''}` +
            (mode === 'recalc' && conv.times !== times ? ` (원본 ${everyRows}단마다 ${times}회)` : ''),
        );
      }

      for (const ev of section.events) {
        const at = ev.atRow === 'end'
          ? sectionRows
          : Math.min(sectionRows, Math.max(1, Math.round(ev.atRow * (chart ? 1 : kRow))));
        const stitches = ev.stitches !== undefined
          ? Math.round(resolveSize(ev.stitches, options.size) * kSt)
          : undefined;
        push(at, {
          kind: ev.kind,
          ...(stitches !== undefined ? { stitches } : {}),
          text: [POINT_LABEL[ev.kind], stitches !== undefined ? `${stitches}코` : '', ev.text]
            .filter(Boolean)
            .join(' · '),
          lock: ev.lock || ev.kind === 'split',
        });
      }

      if (chart && !shaped && count % chart.repeatW !== 0) {
        warnings.push(
          `${section.name}: 시작 콧수 ${count}코가 차트 반복 ${chart.repeatW}코의 배수가 아니에요. 앞 구간 늘림·줄임을 확인해 주세요.`,
        );
      }

      const startRow = rowNo + 1;
      for (let sr = 1; sr <= sectionRows; sr++) {
        rowNo++;
        const events = [...(eventsAt.get(sr) ?? [])];
        if (realPerRow && chart) {
          // 차트 모양대로 생기는 늘림·줄임을 이벤트로 풀어 줌
          const prev = sr === 1 ? count : realPerRow[(sr - 2) % chart.repeatH]! * repeats;
          const target = realPerRow[(sr - 1) % chart.repeatH]! * repeats;
          if (sr === 1) count = target;
          const diff = target - prev;
          if (diff !== 0 && sr > 1) {
            const per = Math.abs(diff) / repeats;
            events.unshift({
              kind: diff < 0 ? 'dec' : 'inc',
              stitches: Math.abs(diff),
              text: `차트대로 ${Math.abs(diff)}코 ${diff < 0 ? '줄임' : '늘림'} (반복마다 ${Number.isInteger(per) ? per : per.toFixed(1)}코)`,
              lock: false,
            });
          }
        }
        const worked = count;
        for (const e of events) {
          const n = e.stitches ?? 0;
          if (e.kind === 'inc' || e.kind === 'pickup') count += n;
          else if (e.kind === 'dec' || e.kind === 'bindoff' || e.kind === 'split') count -= n;
        }
        if (count < 0) {
          warnings.push(`${section.name} ${sr}단: 콧수가 0보다 작아져서 0으로 맞췄어요.`);
          count = 0;
        }
        rows.push({
          row: rowNo,
          stitchesWorked: worked,
          stitchCount: count,
          sectionIndex,
          sectionRow: sr,
          ...(chart ? { chartRow: (sr - 1) % chart.repeatH } : {}),
          events,
        });
      }

      sections.push({
        name: section.name,
        technique: section.technique,
        instruction: section.instruction,
        startRow,
        endRow: rowNo,
        originalRows,
        rows: sectionRows,
        ...(chart ? { chart } : {}),
        shapingNotes,
      });
    });

    const base: Omit<ConvertedPiece, 'id' | 'name'> = {
      construction: piece.construction,
      direction: piece.direction,
      castOn: {
        original: originalCastOn,
        value: castOnConv.value,
        explanation: castOnConv.explanation,
        designWidthCm: cm(originalCastOn, patternGauge.st),
        asIsWidthCm: cm(originalCastOn, options.myGauge.st),
        expectedWidthCm: cm(castOnConv.value, workingGauge.st),
      },
      gauge: { st: workingGauge.st, row: workingGauge.row },
      sections,
      rows,
      totalRows: rows.length,
      totalStitches: rows.reduce((s, r) => s + r.stitchesWorked, 0),
      warnings,
    };

    // 소매 ×2 같은 조각은 따로 진행을 기록할 수 있게 나눠 둠
    if (piece.count > 1) {
      for (let i = 1; i <= piece.count; i++) {
        pieces.push({ id: `${piece.id}-${i}`, name: `${piece.name} ${i}`, ...structuredClone(base) });
      }
    } else {
      pieces.push({ id: piece.id, name: piece.name, ...base });
    }
  }

  return {
    title: pattern.title,
    size: options.size,
    mode,
    patternGauge,
    myGauge: options.myGauge,
    kSt,
    kRow,
    palette: pattern.palette,
    pieces,
  };
}
