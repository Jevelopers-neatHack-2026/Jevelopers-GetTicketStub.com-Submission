import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from '@jevelopers/team-dashboard';
import '@jevelopers/team-dashboard/style.css';
import { authorizedFixture, fixtureProvider, fixtureStates, type FixtureState } from './host';
const params = new URLSearchParams(window.location.search);
const configuredBase = params.get('base') ?? '/admin/finance';
const initialState = params.get('state');
function FixtureHost() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [state, setState] = useState<FixtureState>(fixtureStates.includes(initialState as FixtureState) ? initialState as FixtureState : 'unavailable');
  const [authenticated, setAuthenticated] = useState(params.get('auth') !== 'missing');
  const [connected, setConnected] = useState(params.get('provider') !== 'missing');
  const provider = useMemo(() => fixtureProvider(state), [state]);
  useEffect(() => { const update = () => setPathname(window.location.pathname); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  return <>
    <aside aria-label="Offline fixture controls" style={{ fontFamily: 'system-ui', padding: '1rem', background: '#F4ECDD', color: '#17140F', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
      <strong>Development fixture only</strong>
      <label>Boundary state <select value={state} onChange={(event) => setState(event.target.value as FixtureState)}>{fixtureStates.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={authenticated} onChange={(event) => setAuthenticated(event.target.checked)} /> Fixture auth grant</label>
      <label><input type="checkbox" checked={connected} onChange={(event) => setConnected(event.target.checked)} /> Fixture read port</label>
    </aside>
    <main><Dashboard basePath={configuredBase} pathname={pathname} navigate={(href) => { window.history.pushState(null, '', href + window.location.search); setPathname(window.location.pathname); }}
      access={authenticated ? authorizedFixture : { status: 'restricted' }} provider={connected ? provider : undefined}
      renderRoute={({ data }) => <section><h2>Connected read-only extension</h2><p>{data.text}</p></section>} /></main>
  </>;
}
createRoot(document.getElementById('root')!).render(<FixtureHost />);
