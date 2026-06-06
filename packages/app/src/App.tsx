import { DEFAULT_SOURCE_LANGUAGE } from '@lingua-live/core';
import { Scene3D } from './components/Scene3D.js';

export function App() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>LinguaLive</h1>
        <p>AI 同声传译助手 · 默认源语言：{DEFAULT_SOURCE_LANGUAGE.toUpperCase()}</p>
      </header>
      <main className="app__main">
        <Scene3D />
        <p className="app__hint">3D 可视化占位 — 后续将展示实时音频波形与字幕流</p>
      </main>
    </div>
  );
}
