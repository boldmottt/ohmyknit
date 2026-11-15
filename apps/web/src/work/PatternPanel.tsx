import { useState } from 'react';
import type { ConvertedPiece } from '@knitcloset/gauge-engine';
import { COLOR_SYMBOLS, shade, type Palette } from '@knitcloset/knit-render';
import { NO_STITCH, realCells, TECHNIQUE_LABEL } from '@knitcloset/pattern-schema';
import { fileUrl, type Note, type WorkData } from '../api';
import { colorRun, pieceGauge, type RowView } from '../derive';

type Props = {
  data: WorkData;
  piece: ConvertedPiece;
  view: RowView;
  palette: Palette;
  symbols: boolean;
  hoverRow: number | null;
  onHoverRow: (r: number | null) => void;
  onPickRow: (completedRows: number) => void;
  notes: Note[];
  onPiece: (key: string) => void;
};

type Tab = 'chart' | 'steps' | 'schematic' | 'pdf';

/** ① 도안 패널: 차트 / 지시문 / 도식 / PDF + 현재 단 지시 카드 (기획서 5.4) */
export function PatternPanel(p: Props) {
  const [tab, setTab] = useState<Tab>('chart');
  return (
    <section className="pattern-panel panel" aria-label="도안">
      <div className="tabs" role="tablist">
        {(
          [
            ['chart', '차트'],
            ['steps', '지시문'],
            ['schematic', '도식'],
            ['pdf', 'PDF'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'chart' && <ChartTab {...p} />}
        {tab === 'steps' && <StepsTab {...p} />}
        {tab === 'schematic' && <SchematicTab {...p} />}
        {tab === 'pdf' && <PdfTab {...p} />}
      </div>
      <CurrentRowCard {...p} />
    </section>
  );
}

function ChartTab({ piece, view, palette, symbols, hoverRow, onHoverRow, onPickRow, notes }: Props) {
  const sec = view.section;
  if (!sec?.chart) {
    const next = piece.sections.find((s) => s.chart && s.startRow > view.completedRows);
    return (
      <div className="chart-empty">
        <p>
          지금 구간 <b>{sec?.name}</b>은 차트 없이 <b>{sec?.instruction || (sec ? TECHNIQUE_LABEL[sec.technique] : '')}</b>예요.
        </p>
        {next && (
          <p className="muted">
            배색 구간 <b>{next.name}</b>은 {next.startRow - view.completedRows - 1}단 뒤에 시작해요.
          </p>
        )}
      </div>
    );
  }
  const { grid, repeatW, repeatH } = sec.chart;
  const curChartRow = view.row?.chartRow;
  const width = grid[0]?.length ?? 0;
  const pinsByChartRow = new Set(
    notes
      .map((n) => piece.rows[n.row - 1])
      .filter((r) => r && r.sectionIndex === view.row?.sectionIndex && r.chartRow !== undefined)
      .map((r) => r!.chartRow),
  );
  const rows = [...Array(repeatH).keys()].reverse(); // 위에서 아래로 표시, 번호는 아래가 1
  const cell = Math.max(16, Math.min(28, Math.floor(260 / width)));
  return (
    <div className="chart-wrap">
      <div className="chart" style={{ ['--cell' as string]: `${cell}px` }}>
        {rows.map((r) => {
          const isCur = r === curChartRow;
          const isDone = curChartRow !== undefined && r < curChartRow;
          // 이 차트 줄에 해당하는 실제 단 (현재 반복 안에서)
          const baseRow = view.row ? view.row.row - (curChartRow ?? 0) : sec.startRow;
          const realRow = baseRow + r;
          const hovered = hoverRow === realRow;
          return (
            <div
              key={r}
              className={`chart-row${isCur ? ' current' : ''}${isDone ? ' done' : ''}${hovered ? ' hover' : ''}`}
              onMouseEnter={() => onHoverRow(realRow)}
              onMouseLeave={() => onHoverRow(null)}
              onClick={() => onPickRow(realRow - 1)}
              title={`${realRow}단 (차트 ${r + 1}단)으로 이동`}
            >
              {grid[r]!.map((c, i) => (
                <span
                  key={i}
                  className={`cell${(i + 1) % repeatW === 0 && i + 1 < width ? ' rep' : ''}${c === NO_STITCH ? ' none' : ''}`}
                  style={c === NO_STITCH ? undefined : { background: palette[c]?.hex ?? '#ccc', color: shade(palette[c]?.hex ?? '#ccc', -0.6) }}
                  title={c === NO_STITCH ? '코 없음' : undefined}
                >
                  {symbols && c > 0 ? COLOR_SYMBOLS[c % COLOR_SYMBOLS.length] : ''}
                </span>
              ))}
              <span className="rownum num">
                {r + 1}
                {pinsByChartRow.has(r) ? ' 📌' : ''}
              </span>
              {isCur && <span className="ruler" aria-hidden="true" />}
            </div>
          );
        })}
        <div className="chart-row colnums">
          {[...Array(width).keys()].map((i) => (
            <span key={i} className="cell num">
              {(width - i) % 2 === 1 || width <= 12 ? width - i : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="legend">
        {palette.map((c, i) => (
          <span key={i} className="badge">
            <i style={{ background: c.hex }} />
            {symbols && i > 0 ? `${COLOR_SYMBOLS[i]} ` : ''}
            {c.name}
          </span>
        ))}
      </div>
      <p className="muted small">단 번호는 아래부터, 코는 오른쪽부터 읽어요. 줄을 누르면 그 단으로 이동해요.</p>
    </div>
  );
}

function StepsTab({ piece, view, onPickRow }: Props) {
  return (
    <ol className="steps">
      {piece.sections.map((s, i) => {
        const state = view.completedRows >= s.endRow ? 'done' : view.completedRows + 1 >= s.startRow ? 'current' : 'todo';
        return (
          <li key={i} className={`step ${state}`}>
            <button onClick={() => onPickRow(s.startRow - 1)}>
              <div className="row">
                <b>{state === 'done' ? '✓ ' : ''}{s.name}</b>
                <span className="muted small num">
                  {s.startRow}–{s.endRow}단 ({s.rows}단{s.rows !== s.originalRows ? `, 원본 ${s.originalRows}단` : ''})
                </span>
              </div>
              <div className="small">{s.instruction || TECHNIQUE_LABEL[s.technique]}</div>
              {s.shapingNotes.map((n, j) => (
                <div key={j} className="small warn-text">⚠ {n}</div>
              ))}
            </button>
          </li>
        );
      })}
      <li className="muted small">
        코잡기: <b className="num">{piece.castOn.value}코</b>
        {piece.castOn.value !== piece.castOn.original ? ` (원본 ${piece.castOn.original}코)` : ''}
      </li>
    </ol>
  );
}

function SchematicTab({ data, piece, onPiece }: Props) {
  const g = pieceGauge(data, piece);
  const lengthCm = (rows: number) => ((rows / g.row) * 10).toFixed(1);
  const maxSt = Math.max(...piece.rows.map((r) => r.stitchesWorked));
  const designLen = (rows: number) => ((rows / data.converted.patternGauge.row) * 10).toFixed(1);
  return (
    <div className="schematic">
      <div className="row" role="group" aria-label="조각">
        {data.converted.pieces.map((pc) => (
          <button key={pc.id} className={`btn small${pc.id === piece.id ? ' primary' : ''}`} onClick={() => onPiece(pc.id)}>
            {pc.name}
          </button>
        ))}
      </div>
      <table className="dims">
        <thead>
          <tr>
            <th />
            <th>도안 설계</th>
            <th>내 보정 기준</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>시작 {piece.construction === 'round' ? '둘레' : '너비'}</td>
            <td className="num">{piece.castOn.designWidthCm}cm</td>
            <td className="num">{piece.castOn.expectedWidthCm}cm</td>
          </tr>
          <tr>
            <td>가장 넓은 곳</td>
            <td className="num">—</td>
            <td className="num">{((maxSt / g.st) * 10).toFixed(1)}cm</td>
          </tr>
          {piece.sections.map((s, i) => (
            <tr key={i}>
              <td>{s.name} 길이</td>
              <td className="num">{designLen(s.originalRows)}cm</td>
              <td className="num">{lengthCm(s.rows)}cm</td>
            </tr>
          ))}
          <tr>
            <td><b>총 길이</b></td>
            <td className="num">{designLen(piece.sections.reduce((a, s) => a + s.originalRows, 0))}cm</td>
            <td className="num"><b>{lengthCm(piece.totalRows)}cm</b></td>
          </tr>
        </tbody>
      </table>
      {piece.castOn.asIsWidthCm !== piece.castOn.designWidthCm && (
        <p className="small muted">
          원본 {piece.castOn.original}코를 그대로 떴다면 {piece.castOn.asIsWidthCm}cm가 됐을 거예요 (설계 {piece.castOn.designWidthCm}cm).
        </p>
      )}
      <p className="small muted">
        게이지: 도안 {data.converted.patternGauge.st}코 {data.converted.patternGauge.row}단 → 내 손 {g.st}코 {g.row}단 (10cm)
      </p>
    </div>
  );
}

function PdfTab({ data }: Props) {
  if (!data.project.patternFileKey) {
    return <p className="muted">이 도안에는 원본 PDF가 없어요. 도안 보관함에서 PDF를 붙일 수 있어요.</p>;
  }
  return (
    <div className="pdf-tab">
      <span className="badge warn">원본 PDF · 변환 전 숫자예요</span>
      <iframe title="원본 도안 PDF" src={fileUrl(data.project.patternFileKey)} />
    </div>
  );
}

function CurrentRowCard({ data, piece, view, palette }: Props) {
  if (view.done || !view.row) {
    return (
      <div className="row-card done">
        <b>🎉 {piece.name} 완성!</b>
        <div className="small muted">다른 조각을 골라 이어서 떠요.</div>
      </div>
    );
  }
  const r = view.row;
  const sec = view.section!;
  const isFirst = view.completedRows === 0;
  const chartLine = sec.chart && r.chartRow !== undefined ? sec.chart.grid[r.chartRow] : undefined;
  const hasEvents = r.events.length > 0;
  const changed = r.stitchesWorked !== r.stitchCount;
  return (
    <div className={`row-card${hasEvents ? ' alert' : ''}`} aria-live="polite">
      {isFirst && (
        <div className="cast-on">
          🧶 코잡기부터 시작해요: <b className="num">{piece.castOn.value}코</b>
          {data.project.needleMm ? ` · ${data.project.needleMm}mm 바늘` : ''}
        </div>
      )}
      <div className="row-card-head">
        <b className="num">{r.row}단</b>
        {r.chartRow !== undefined && <span className="muted small num">(차트 {r.chartRow + 1}단째)</span>}
        <span className="muted small">
          · {TECHNIQUE_LABEL[sec.technique]} · {piece.construction === 'round' ? '원통뜨기' : r.row % 2 ? '겉면' : '안면'}
        </span>
      </div>
      <div className="big num">
        총 {r.stitchesWorked}코
        {data.converted.mode === 'recalc' && data.converted.kSt !== 1 && r.row === 1 && (
          <span className="muted small"> (원본 {piece.castOn.original}코)</span>
        )}
      </div>
      {sec.instruction && <div>{sec.instruction}</div>}
      {chartLine && (
        <div>
          배색: {colorRun(chartLine, palette)} 반복 × {sec.chart?.shaped ? sec.chart.repeats : Math.floor(r.stitchesWorked / Math.max(1, realCells(chartLine).length))}
        </div>
      )}
      <hr />
      {hasEvents ? (
        r.events.map((e, i) => (
          <div key={i} className="event">
            {e.lock ? '🔒 ' : '⚠ '}
            {e.text}
          </div>
        ))
      ) : (
        <div className="muted small">이 단에는 늘림·줄임 없음</div>
      )}
      {changed && (
        <div className="small">
          이 단을 마치면 <b className="num">{r.stitchCount}코</b>
        </div>
      )}
    </div>
  );
}
