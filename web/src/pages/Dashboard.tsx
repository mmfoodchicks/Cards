import { useEffect, useState } from 'react';
import { api, formatDate, money, type DeadlineItem, type EstimatedTax, type Guidance, type Health, type ScheduleC } from '../lib/api';
import { Banner, MoneyStat, Spinner, Stat } from '../components/ui';

/**
 * The dashboard answers three questions, in this order:
 *   What do I owe and when?
 *   How is the business actually doing?
 *   What have I not set up yet?
 */
export function Dashboard({ year, onNavigate }: { year: number; onNavigate: (tab: string) => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [sc, setSc] = useState<ScheduleC | null>(null);
  const [est, setEst] = useState<EstimatedTax | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([]);
  const [guidance, setGuidance] = useState<Guidance[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.health(), api.scheduleC(year), api.estimatedTax(year), api.compliance(), api.guidance()])
      .then(([h, s, e, c, g]) => {
        if (cancelled) return;
        setHealth(h);
        setSc(s);
        setEst(e);
        setDeadlines(c.deadlines.filter((d) => d.urgency !== 'later'));
        setGuidance(g.guidance);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load'));
    return () => { cancelled = true; };
  }, [year]);

  if (error) return <Banner kind="bad">{error}</Banner>;
  if (!health || !sc || !est) return <Spinner />;

  const pl = sc.profitLoss;
  const urgent = deadlines.filter((d) => d.urgency === 'overdue' || d.urgency === 'imminent');

  return (
    <>
      {!health.profile.businessName && (
        <Banner kind="warn">
          <strong>Start in Settings.</strong> Tax figures depend on your filing status, state and whether you have
          other income. Until those are filled in, the numbers below are working from defaults.
          {' '}
          <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('settings'); }}>Open Settings</a>
        </Banner>
      )}

      {urgent.map((d) => (
        <Banner key={d.id} kind={d.urgency === 'overdue' ? 'bad' : 'warn'}>
          <strong>
            {d.urgency === 'overdue' ? 'Passed: ' : 'Due soon: '}
            {d.title}
          </strong>
          {' — '}
          {formatDate(d.dueOn)}
          {d.urgency === 'overdue'
            ? ` (${Math.abs(d.daysAway)} day${Math.abs(d.daysAway) === 1 ? '' : 's'} ago)`
            : ` (in ${d.daysAway} day${d.daysAway === 1 ? '' : 's'})`}
          <div style={{ marginTop: 6 }}>{d.detail}</div>
          {d.url && (
            <div style={{ marginTop: 6 }}>
              <a href={d.url} target="_blank" rel="noreferrer noopener">
                {d.formNumber ? `Form ${d.formNumber}` : 'Details'}
              </a>
            </div>
          )}
        </Banner>
      ))}

      {guidance.map((g) => (
        <div className="section" key={g.id}>
          <div className={`banner ${g.severity === 'caution' ? 'warn' : g.severity === 'opportunity' ? 'good' : ''}`}>
            <strong>{g.title}</strong>
            {g.worthCents !== undefined && g.worthCents > 0 && (
              <span style={{ marginLeft: 8 }}>Worth about {money(g.worthCents)}.</span>
            )}
            <div style={{ marginTop: 6, opacity: 0.85 }}>{g.because}</div>
            {g.body.map((line) => (
              <p key={line} style={{ margin: '8px 0 0' }}>{line}</p>
            ))}
            {g.steps && g.steps.length > 0 && (
              <>
                <div style={{ marginTop: 10, fontWeight: 700 }}>What to do</div>
                <ol style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {g.steps.map((step) => <li key={step} style={{ marginBottom: 3 }}>{step}</li>)}
                </ol>
              </>
            )}
          </div>
        </div>
      ))}

      <div className="section">
        <h2>{year} so far</h2>
        <div className="stats">
          <MoneyStat label="Gross receipts" cents={pl.grossReceiptsCents} note="Sales plus shipping charged" />
          <MoneyStat label="Cost of goods sold" cents={pl.cogsCents} note="Cost of what actually sold" />
          <MoneyStat label="Expenses" cents={pl.totalExpensesCents} note={`${pl.expenseLines.length} categories`} />
          <MoneyStat label="Net profit" cents={pl.netProfitCents} signed note="Schedule C line 31" />
        </div>
      </div>

      <div className="section">
        <h2>Set money aside</h2>
        <p className="sub">
          The mistake that hurts most in year one is spending profit that was never yours.
        </p>
        <div className="grid two">
          <div className="panel">
            <h3>Self-employment tax</h3>
            {sc.selfEmployment ? (
              <>
                <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <Stat label="Owed so far" value={money(sc.selfEmployment.totalCents)} />
                  <Stat label="Half is deductible" value={money(sc.selfEmployment.deductionCents)} />
                </div>
                <ul className="faint" style={{ paddingLeft: 16, marginTop: 10 }}>
                  {sc.selfEmployment.explanation.slice(0, 3).map((line) => <li key={line}>{line}</li>)}
                </ul>
              </>
            ) : (
              <p className="faint">No tax figures on file for {year}.</p>
            )}
          </div>

          <div className="panel">
            <h3>Next estimated payment</h3>
            {(() => {
              const next = est.quarters.find((q) => q.status !== 'paid');
              if (!next) return <p className="faint">Every instalment for {year} is covered.</p>;
              return (
                <>
                  <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <Stat label={`Quarter ${next.period.quarter}`} value={money(next.shortfallCents)} />
                    <Stat
                      label="Due"
                      value={formatDate(next.period.dueOn)}
                      note={next.daysUntilDue < 0 ? `${Math.abs(next.daysUntilDue)} days late` : `in ${next.daysUntilDue} days`}
                    />
                  </div>
                  <p className="faint" style={{ marginTop: 10 }}>{est.projectionBasis}</p>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {(pl.warnings.length > 0 || sc.warnings.length > 0) && (
        <div className="section">
          <h2>Worth looking at</h2>
          <Banner kind="warn">
            <ul>
              {[...new Set([...sc.warnings, ...pl.warnings])].slice(0, 6).map((w) => <li key={w}>{w}</li>)}
            </ul>
          </Banner>
        </div>
      )}

      {sc.figuresNeedingCheck.length > 0 && (
        <div className="section">
          <h2>Figures to confirm before filing</h2>
          <p className="sub">
            These change every year. The app will not compute from a number it could not confirm, so anything
            listed here is either missing from the totals above or flagged where it was used.
          </p>
          <div className="panel">
            {sc.figuresNeedingCheck.map((f) => (
              <div className="list-item" key={f.key}>
                <div className="grow">
                  <strong>{f.label}</strong>
                  {f.note && <div className="faint" style={{ marginTop: 3 }}>{f.note}</div>}
                  <div className="source-link" style={{ marginTop: 4 }}>
                    <a href={f.source} target="_blank" rel="noreferrer noopener">Check the source</a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h2>Where things stand</h2>
        <div className="stats">
          <Stat label="Items on hand" value={health.counts.onHand} note={money(sc.endingInventory.inventoryBasisCents) + ' at cost'} />
          <Stat label="At the grader" value={health.counts.atGrading} />
          <Stat label="Sales recorded" value={health.counts.sales} />
          <Stat label="Business miles" value={sc.vehicle.totalBusinessMiles.toFixed(0)} note={`${sc.vehicle.tripCount} trips`} />
        </div>
      </div>

      <Banner>{sc.disclaimer}</Banner>
    </>
  );
}
