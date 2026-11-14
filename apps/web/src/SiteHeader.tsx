import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

const NAV = [
  ['/', '옷장'],
  ['/patterns', '도안'],
  ['/studio', '스튜디오'],
  ['/profile/hands', '내 손'],
] as const;

/** 모든 화면이 함께 쓰는 머리말: 워드마크, 가운데 메뉴, 오른쪽 보조 메뉴 */
export function SiteHeader({ side }: { side?: ReactNode }) {
  const { pathname } = useLocation();
  const here = (to: string) => (to === '/' ? pathname === '/' || pathname.startsWith('/project') : pathname.startsWith(to));
  return (
    <header className="site-head">
      <Link to="/" className="wordmark">뜨개옷장</Link>
      <nav className="site-nav" aria-label="메뉴">
        {NAV.map(([to, label]) => (
          <Link key={to} to={to} aria-current={here(to) ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="site-side">
        {side}
        <Link to="/settings" aria-current={pathname === '/settings' ? 'page' : undefined}>설정</Link>
      </div>
    </header>
  );
}
