import { lazy, Suspense } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { Closet } from './pages/Closet';
import { SiteHeader } from './SiteHeader';

const Work = lazy(() => import('./pages/Work'));
const NewProject = lazy(() => import('./pages/NewProject'));
const EditProject = lazy(() => import('./pages/EditProject'));
const Patterns = lazy(() => import('./pages/Patterns'));
const PatternEdit = lazy(() => import('./pages/PatternEdit'));
const Hands = lazy(() => import('./pages/Hands'));
const Settings = lazy(() => import('./pages/Settings'));
const Studio = lazy(() => import('./pages/Studio'));

export function App() {
  const loc = useLocation();
  const showNav = !loc.pathname.endsWith('/work') && loc.pathname !== '/';
  return (
    <>
      {showNav && <SiteHeader />}
      <Suspense fallback={<div className="page muted">불러오는 중…</div>}>
        <Routes>
          <Route path="/" element={<Closet />} />
          <Route path="/project/new" element={<NewProject />} />
          <Route path="/project/:id/work" element={<Work />} />
          <Route path="/project/:id/edit" element={<EditProject />} />
          <Route path="/patterns" element={<Patterns />} />
          <Route path="/patterns/new" element={<PatternEdit />} />
          <Route path="/patterns/:id/edit" element={<PatternEdit />} />
          <Route path="/patterns/:id/review" element={<PatternEdit />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/studio/:patternId" element={<Studio />} />
          <Route path="/profile/hands" element={<Hands />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="page">없는 페이지예요. <Link to="/">옷장으로</Link></div>} />
        </Routes>
      </Suspense>
    </>
  );
}
