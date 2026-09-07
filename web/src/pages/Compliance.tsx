import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, type ComplianceTask, type DeadlineItem } from '../lib/api';
import { Banner, Spinner } from '../components/ui';

const JURISDICTION_LABEL: Record<string, string> = {
  federal: 'Federal — IRS',
  state: 'Utah',
  county: 'Davis County',
  city: 'Your city',
};

/** What has to be set up, and what is due when. */
export function Compliance() {
  const [tasks, setTasks] = useState<ComplianceTask[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.compliance();
      setTasks(res.tasks);
      setDeadlines(res.deadlines);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(task: ComplianceTask): Promise<void> {
    await api.setCompliance(task.id, {
      completed: !task.completed,
      completedOn: !task.completed ? new Date().toISOString().slice(0, 10) : null,
    });
    await load();
  }

  if (loading) return <Spinner />;
  if (error) return <Banner kind="bad">{error}</Banner>;

  const groups = ['federal', 'state', 'county', 'city'];
  const done = tasks.filter((t) => t.completed).length;
  const applicable = tasks.filter((t) => !t.notApplicable).length;

  return (
    <>
      <div className="section">
        <h2>Getting set up</h2>
        <p className="sub">{done} of {applicable} done. Separate agencies with separate rules — registering with one satisfies none of the others.</p>
      </div>

      {deadlines.filter((d) => d.urgency !== 'later').length > 0 && (
        <div className="section">
          <h2>Coming up</h2>
          <div className="panel">
            {deadlines.filter((d) => d.urgency !== 'later').map((d) => (
              <div className="list-item" key={d.id}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>
                    {d.title}
                    {d.urgency === 'overdue' && <span className="pill required" style={{ marginLeft: 8 }}>Passed</span>}
                    {d.urgency === 'imminent' && <span className="pill conditional" style={{ marginLeft: 8 }}>Soon</span>}
                  </div>
                  <div className="faint" style={{ marginTop: 3 }}>{d.detail}</div>
                  {d.url && (
                    <div style={{ marginTop: 4 }}>
                      <a href={d.url} target="_blank" rel="noreferrer noopener">
                        {d.formNumber ? `Form ${d.formNumber}` : 'Details'}
                      </a>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 600 }}>{formatDate(d.dueOn)}</div>
                  <div className="faint">
                    {d.daysAway < 0 ? `${Math.abs(d.daysAway)}d ago` : `in ${d.daysAway}d`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {groups.map((jurisdiction) => {
        const group = tasks.filter((t) => t.jurisdiction === jurisdiction);
        if (group.length === 0) return null;
        return (
          <div className="section" key={jurisdiction}>
            <h2>{JURISDICTION_LABEL[jurisdiction] ?? jurisdiction}</h2>
            <div className="panel">
              {group.map((task) => (
                <div className="list-item" key={task.id}>
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => void toggle(task)}
                    style={{ width: 18, height: 18, accentColor: 'var(--accent)', marginTop: 2, flex: '0 0 auto' }}
                    aria-label={`Mark "${task.title}" done`}
                  />
                  <div className="grow">
                    <div style={{ fontWeight: 600, opacity: task.completed ? 0.55 : 1 }}>
                      {task.title}
                      <span className={`pill ${task.completed ? 'done' : task.requirement}`} style={{ marginLeft: 8 }}>
                        {task.completed ? 'Done' : task.requirement}
                      </span>
                    </div>
                    <div className="faint" style={{ marginTop: 4 }}>{task.detail}</div>
                    {task.appliesWhen && (
                      <div className="faint" style={{ marginTop: 4 }}>
                        <strong>Applies when:</strong> {task.appliesWhen}
                      </div>
                    )}
                    <div className="faint" style={{ marginTop: 4 }}>
                      {task.agency}
                      {task.formNumber && ` · Form ${task.formNumber}`}
                      {task.estimatedCost && ` · ${task.estimatedCost}`}
                      {task.url && (
                        <> · <a href={task.url} target="_blank" rel="noreferrer noopener">Open</a></>
                      )}
                    </div>
                    {task.completedOn && <div className="faint">Done {formatDate(task.completedOn)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <Banner>
        This checklist is a starting point assembled from public guidance, not legal advice. Requirements change
        and vary by city. Confirm anything marked as not yet confirmed with the agency itself before relying on it.
      </Banner>
    </>
  );
}
