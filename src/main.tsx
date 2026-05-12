import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Editor } from './editor/Editor';
import './App.css';
import './editor/Editor.css';

function Root() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route === '#/editor' ? <Editor /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
