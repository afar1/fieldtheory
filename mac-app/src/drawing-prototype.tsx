import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { checkDrawingPixels } from './drawing-prototype-checks';
import SketchView from './components/SketchView';
import { ThemeProvider } from './contexts/ThemeContext';
const previewTheme = new URLSearchParams(location.search).get('theme');
if (previewTheme) localStorage.setItem('darkMode', String(previewTheme === 'dark'));
function Preview() {
  const [checks, setChecks] = useState('');
  const [saved, setSaved] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [editing, setEditing] = useState(true);
  return <ThemeProvider>{editing ? <SketchView backgroundImage={saved} onClose={() => setEditing(false)} onSave={(result, copy) => { setSaved(result); setEditing(false); document.title = `Saved ${result.width}×${result.height}${copy ? ' (copy requested)' : ''}`; }} /> : <div style={{ padding: 30 }}><button onClick={() => { void checkDrawingPixels().then(setChecks).catch(e=>setChecks(`FAIL: ${e.message}`)); }}>Run PNG checks</button><p role="status">{checks}</p><button onClick={() => setEditing(true)}>Annotate saved image</button><button onClick={() => { setSaved(null); setEditing(true); }}>New drawing</button><button onClick={() => {
      localStorage.setItem('pendingSketch', JSON.stringify({ timestamp: 0, elements: [{ type:'rectangle', id:'recovery-fixture', x:100,y:100,width:200,height:150,angle:0,strokeColor:'#000000',backgroundColor:'#ffcc00',fillStyle:'solid',strokeWidth:2,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:null,updated:0,link:null,locked:false }] }));
      setSaved(null);setEditing(true);
    }}>Load legacy recovery fixture</button>{saved && <><p>{saved.width} × {saved.height} PNG</p><img src={saved.dataUrl} style={{maxWidth:'90vw',maxHeight:'80vh'}} /></>}</div>}</ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
