import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { drawSwatch } from '@knitcloset/knit-render';
import type { Yarn } from '@knitcloset/pattern-schema';
import { api, fileUrl, type LibraryYarn } from '../api';

export function toYarn(y: LibraryYarn): Yarn {
  return {
    name: y.name,
    hex: y.hex,
    ...(y.brand ? { brand: y.brand } : {}),
    ...(y.hex2 ? { hex2: y.hex2 } : {}),
    ...(y.heather ? { heather: y.heather } : {}),
    ...(y.source === 'mine' ? { yarnId: y.id } : {}),
    ...(y.photoKey ? { photoKey: y.photoKey } : {}),
  };
}

const swatchCache = new Map<string, string>();
/** 사진이 없는 실은 그 색으로 뜬 작은 견본을 그려서 보여 줌 */
export function swatchUrl(y: Pick<Yarn, 'hex' | 'hex2' | 'heather' | 'name'>): string {
  const key = `${y.hex}|${y.hex2 ?? ''}|${y.heather ?? 0}`;
  const hit = swatchCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  drawSwatch(ctx, 8, 14, 12, [{ name: y.name, hex: y.hex, ...(y.hex2 ? { hex2: y.hex2 } : {}), ...(y.heather ? { heather: y.heather } : {}) }]);
  const url = c.toDataURL();
  swatchCache.set(key, url);
  return url;
}

type Props = {
  profileId: string | null;
  slotLabel: string;
  onPreview: (y: Yarn | null) => void;
  onPick: (y: Yarn) => void;
  onClose: () => void;
};

/**
 * 실 라이브러리: 검색, 브랜드·색 계열 필터, 색 순서/브랜드 순서, 올려 두면 미리보기, 페이지.
 * 내 실을 사진과 함께 등록할 수도 있어요.
 */
export function YarnLibrary({ profileId, slotLabel, onPreview, onPick, onClose }: Props) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [family, setFamily] = useState('');
  const [sort, setSort] = useState<'color' | 'brand'>('color');
  const [page, setPage] = useState(1);
  const [pinned, setPinned] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const query = useMemo(() => ({ profileId: profileId ?? undefined, q, brand, family, sort, page, per: 24 }), [profileId, q, brand, family, sort, page]);
  const list = useQuery({ queryKey: ['yarns', query], queryFn: () => api.yarns(query), placeholderData: (prev) => prev });

  useEffect(() => setPage(1), [q, brand, family, sort]);
  useEffect(() => () => onPreview(null), [onPreview]);

  return (
    <div className="yarn-lib card" role="dialog" aria-label="실 라이브러리">
      <div className="row">
        <h3 style={{ margin: 0, flex: 1 }}>🧶 실 라이브러리 <span className="muted small">· {slotLabel}</span></h3>
        <button className="btn ghost small" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" style={{ flex: 2, minWidth: 140 }} placeholder="실 이름·브랜드 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ flex: 1, minWidth: 120 }} value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="브랜드">
          <option value="">모든 브랜드</option>
          {list.data?.brands.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select className="input" style={{ flex: 1, minWidth: 100 }} value={family} onChange={(e) => setFamily(e.target.value)} aria-label="색 계열">
          <option value="">모든 색</option>
          {(list.data?.families ?? []).map((f) => <option key={f}>{f}</option>)}
        </select>
        <button className="btn small ghost" onClick={() => { setQ(''); setBrand(''); setFamily(''); }}>지우기</button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <div className="seg" role="group" aria-label="정렬">
          <button aria-pressed={sort === 'color'} onClick={() => setSort('color')}>색 순서</button>
          <button aria-pressed={sort === 'brand'} onClick={() => setSort('brand')}>브랜드 순서</button>
        </div>
        {profileId && (
          <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setAdding(!adding)}>
            {adding ? '닫기' : '+ 내 실 등록'}
          </button>
        )}
      </div>
      {adding && profileId && (
        <AddYarn
          profileId={profileId}
          onDone={async () => {
            setAdding(false);
            setSort('brand');
            await qc.invalidateQueries({ queryKey: ['yarns'] });
          }}
        />
      )}
      {pinned && <p className="small muted">미리보기 중이에요. 다시 누르면 고르고, 다른 곳을 누르면 원래대로 돌아가요.</p>}
      <div className="yarn-grid" onMouseLeave={() => !pinned && onPreview(null)}>
        {list.data?.items.map((y) => (
          <button
            key={y.id}
            className={`yarn-card${pinned === y.id ? ' pinned' : ''}`}
            onMouseEnter={() => !pinned && onPreview(toYarn(y))}
            onFocus={() => onPreview(toYarn(y))}
            onClick={(e) => {
              // 터치 기기: 첫 탭 = 미리보기, 두 번째 탭 = 선택
              const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch';
              if (touch && pinned !== y.id) {
                setPinned(y.id);
                onPreview(toYarn(y));
                return;
              }
              onPick(toYarn(y));
            }}
            title={`${y.brand} · ${y.name}${y.fiber ? ` · ${y.fiber}` : ''}`}
          >
            <img src={y.photoKey ? fileUrl(y.photoKey) : swatchUrl(toYarn(y))} alt="" />
            <span className="small">
              <i style={{ background: y.hex }} /> {y.name}
            </span>
            <span className="muted tiny">{y.source === 'mine' ? '⭐ 내 실' : y.brand}</span>
          </button>
        ))}
      </div>
      {list.data && list.data.items.length === 0 && <p className="muted">맞는 실이 없어요.</p>}
      {list.data && list.data.pages > 1 && (
        <div className="row pager">
          <button className="btn small ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="이전 페이지">←</button>
          {[...Array(list.data.pages).keys()].map((i) => (
            <button key={i} className={`btn small ghost${page === i + 1 ? ' on' : ''}`} onClick={() => setPage(i + 1)} aria-current={page === i + 1}>
              {i + 1}
            </button>
          ))}
          <button className="btn small ghost" disabled={page >= list.data.pages} onClick={() => setPage(page + 1)} aria-label="다음 페이지">→</button>
        </div>
      )}
    </div>
  );
}

function AddYarn({ profileId, onDone }: { profileId: string; onDone: () => void }) {
  const [f, setF] = useState({ brand: '', name: '', hex: '#B07A8C', hex2: '#7E4E6A', heather: 0, weight: 'dk', fiber: '', grams: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const add = useMutation({
    mutationFn: async () => {
      const photoKey = photo ? (await api.upload(photo)).key : undefined;
      return api.addYarn(profileId, {
        brand: f.brand,
        name: f.name,
        hex: f.hex,
        ...(f.heather > 0 ? { hex2: f.hex2, heather: f.heather } : {}),
        weight: f.weight,
        fiber: f.fiber,
        gramsOwned: f.grams ? Number(f.grams) : null,
        ...(photoKey ? { photoKey } : {}),
      });
    },
    onSuccess: onDone,
  });
  return (
    <form
      className="add-yarn"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <div className="grid2">
        <label className="field"><span>브랜드</span><input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></label>
        <label className="field"><span>색 이름</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="field"><span>주 색</span><input type="color" value={f.hex} onChange={(e) => setF({ ...f, hex: e.target.value })} /></label>
        <label className="field">
          <span>얼룩(섞인 색) {Math.round(f.heather * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={f.heather} onChange={(e) => setF({ ...f, heather: Number(e.target.value) })} />
        </label>
        {f.heather > 0 && <label className="field"><span>섞인 색</span><input type="color" value={f.hex2} onChange={(e) => setF({ ...f, hex2: e.target.value })} /></label>}
        <label className="field">
          <span>두께</span>
          <select value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })}>
            {['lace', 'fingering', 'sport', 'dk', 'worsted', 'aran', 'bulky'].map((w) => <option key={w}>{w}</option>)}
          </select>
        </label>
        <label className="field"><span>소재</span><input value={f.fiber} onChange={(e) => setF({ ...f, fiber: e.target.value })} /></label>
        <label className="field"><span>가진 양 (g)</span><input inputMode="decimal" value={f.grams} onChange={(e) => setF({ ...f, grams: e.target.value })} /></label>
        <label className="field"><span>사진 (선택)</span><input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <img src={swatchUrl({ name: f.name, hex: f.hex, ...(f.heather ? { hex2: f.hex2, heather: f.heather } : {}) })} alt="견본 미리보기" width={48} height={48} style={{ borderRadius: 8 }} />
        {add.error && <span className="error small">{(add.error as Error).message}</span>}
        <button className="btn small primary" style={{ marginLeft: 'auto' }} disabled={add.isPending || !f.name.trim()}>등록</button>
      </div>
    </form>
  );
}
