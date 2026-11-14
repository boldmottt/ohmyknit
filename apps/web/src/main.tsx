import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { applyPrefs, readPrefs, ToastProvider } from './ui';
import { flushAll } from './offline';
import '@fontsource/gowun-batang/400.css';
import '@fontsource/gowun-batang/700.css';
import './styles.css';
import './fx.css';

applyPrefs(readPrefs());

registerSW({ immediate: true });

// 다시 연결되면 쌓인 진행 기록을 보냄
window.addEventListener('online', () => void flushAll().catch(() => {}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true, networkMode: 'offlineFirst' },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
