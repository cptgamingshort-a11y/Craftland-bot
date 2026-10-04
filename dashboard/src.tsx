import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
type Row = Record<string, unknown>;
type Data = {
  csrf: string;
  members: Row[];
  memberCount: number;
  pendingReportCount: number;
  active: number;
  points: number;
  reviews: Row[];
  reports: Row[];
  roles: Row[];
  boards: Row[];
  logs: Row[];
  summaries: Row[];
  config: { version: number; settings: unknown };
};
function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Overview');
  const [config, setConfig] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roleJson, setRoleJson] = useState(
    JSON.stringify(
      {
        autoAssign: false,
        autoRemove: false,
        protected: false,
        maintenanceDays: null,
        minimumPoints: 0,
        minimumApprovedReviews: 0,
        minimumActiveDays: 0,
        minimumQuality: null,
        maintenancePoints: null,
      },
      null,
      2,
    ),
  );
  async function load() {
    try {
      const r = await fetch('/api/overview');
      if (!r.ok)
        throw new Error(
          'Sign in with your Craftland India administrator account.',
        );
      const d: Data = await r.json();
      setData(d);
      setConfig(JSON.stringify(d.config.settings, null, 2));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(url: string, body: unknown) {
    try {
      const r = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': data!.csrf,
        },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await load();
      setError('Saved successfully.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const rows = data
    ? (
        {
          Members: data.members,
          Reviews: data.reviews,
          Reports: data.reports,
          Roles: data.roles,
          Leaderboards: data.boards,
          Moderation: data.logs,
          'AI summaries': data.summaries,
        } as Record<string, Row[]>
      )[tab]
    : undefined;
  return (
    <main>
      <header>
        <div className="brand">CI</div>
        <div>
          <span className="eyebrow">COMMUNITY OPERATIONS</span>
          <h1>Craftland India</h1>
        </div>
        <a className="button" href="/auth/login">
          Discord sign in
        </a>
      </header>
      <div className="layout">
        <nav>
          {[
            'Overview',
            'Members',
            'Reviews',
            'Reports',
            'Roles',
            'Leaderboards',
            'Moderation',
            'AI summaries',
            'Configuration',
          ].map((t) => (
            <button
              className={tab === t ? 'selected' : ''}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
          {data && (
            <button
              onClick={async () => {
                await fetch('/api/logout', {
                  method: 'POST',
                  headers: { 'X-CSRF-Token': data.csrf },
                });
                setData(null);
              }}
            >
              Sign out
            </button>
          )}
        </nav>
        <section>
          <div className="section-heading">
            <h2>{tab}</h2>
            <span className="badge">VERIFIED RECORDS</span>
          </div>
          {error && (
            <p role="status" className="notice">
              {error}
            </p>
          )}
          {!data ? (
            <article>
              <h3>Your community, in one place.</h3>
              <p>
                Sign in through Discord to access member contributions, role
                requirements, moderation history and server settings.
              </p>
            </article>
          ) : (
            <>
              {tab === 'Overview' && (
                <>
                  <div className="stats">
                    {[
                      ['Tracked members', data.memberCount],
                      ['Active this week', data.active],
                      ['Total points', data.points],
                      ['Pending reports', data.pendingReportCount],
                    ].map(([k, v]) => (
                      <article key={k}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </article>
                    ))}
                  </div>
                  <article>
                    <h3>Every contribution counts.</h3>
                    <p>
                      Community points and role eligibility are backed by
                      approved activity. AI summaries are advisory; permissions
                      and verified requirements govern actions.
                    </p>
                    <p>
                      Use /setup in Discord for guided onboarding. Tables show
                      recent records (up to 100 members, 30 reviews/reports).
                    </p>
                  </article>
                </>
              )}
              {rows && (
                <div className="records">
                  {rows.length ? (
                    rows.map((r, n) => (
                      <article key={String(r.id ?? n)}>
                        <h3>
                          {String(
                            r.username ??
                              r.name ??
                              r.type ??
                              r.period ??
                              r.action ??
                              r.id ??
                              'Record',
                          )}
                        </h3>
                        <pre>{JSON.stringify(r, null, 2)}</pre>
                      </article>
                    ))
                  ) : (
                    <article>No records yet.</article>
                  )}
                </div>
              )}
              {tab === 'Configuration' && (
                <article>
                  <h3>Server configuration</h3>
                  <p>
                    Edit channels, roles, point values, welcome, moderation and
                    Asia/Kolkata schedules. IDs are validated against your
                    server before saving.
                  </p>
                  <textarea
                    aria-label="Server configuration JSON"
                    value={config}
                    onChange={(e) => setConfig(e.target.value)}
                  />
                  <button
                    className="primary"
                    onClick={() => {
                      try {
                        void save('/api/config', {
                          version: data.config.version,
                          settings: JSON.parse(config),
                        });
                      } catch {
                        setError('Invalid JSON.');
                      }
                    }}
                  >
                    Save configuration
                  </button>
                </article>
              )}
              {tab === 'Roles' && (
                <article>
                  <h3>Configure a contribution role</h3>
                  <input
                    placeholder="Discord role ID"
                    aria-label="Discord role ID"
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                  />
                  <textarea
                    aria-label="Role requirements JSON"
                    value={roleJson}
                    onChange={(e) => setRoleJson(e.target.value)}
                  />
                  <button
                    className="primary"
                    onClick={() => {
                      try {
                        void save(`/api/roles/${roleId}`, JSON.parse(roleJson));
                      } catch {
                        setError('Invalid JSON.');
                      }
                    }}
                  >
                    Save role requirements
                  </button>
                </article>
              )}
            </>
          )}
        </section>
      </div>
      <footer>Craftland India • AI assistance with human oversight</footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
