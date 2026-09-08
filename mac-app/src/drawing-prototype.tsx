import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SketchView from './components/SketchView';
import { ThemeProvider } from './contexts/ThemeContext';
function Preview() {
  const [saved, setSaved] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [editing, setEditing] = useState(true);
  return <ThemeProvider>{editing ? <SketchView backgroundImage={saved} onClose={() => setEditing(false)} onSave={(result, copy) => { setSaved(result); setEditing(false); document.title = `Saved ${result.width}×${result.height}${copy ? ' (copy requested)' : ''}`; }} /> : <div style={{ padding: 30 }}><button onClick={() => setEditing(true)}>Annotate saved image</button><button onClick={() => { setSaved(null); setEditing(true); }}>New drawing</button>{saved && <><p>{saved.width} × {saved.height} PNG</p><img src={saved.dataUrl} style={{maxWidth:'90vw',maxHeight:'80vh'}} /></>}</div>}</ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
