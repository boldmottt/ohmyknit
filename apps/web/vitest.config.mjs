// 테스트 설정: 앱 설정(vite.config.ts)에 더해, Node에서 마네킹 모델 파일을 직접 읽어 넘기는 준비 파일
import { mergeConfig } from 'vite';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, { test: { setupFiles: ['./test-setup.mjs'] } });
