import type { BodyKind } from './body';

const LABEL: Record<BodyKind, string> = { female: '여자', male: '남자' };

/** 마네킹 몸 고르기 (여자 · 남자) */
export function BodyPicker({ value, onChange, className }: { value: BodyKind; onChange: (k: BodyKind) => void; className?: string }) {
  return (
    <div className={`body-pick${className ? ` ${className}` : ''}`} role="radiogroup" aria-label="마네킹 몸">
      {(['female', 'male'] as const).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}>
          {LABEL[k]}
        </button>
      ))}
    </div>
  );
}
