import { useEffect, useState } from 'react';
import { api, formatDate, money, type CapitalGains, type ChannelReporting, type Reporting1099k, type ScheduleC } from '../lib/api';
import { Banner, MoneyStat, Spinner, Stat } from '../components/ui';

/** The year-end package: what goes on the return, line by line. */
export function Reports({ year }: { year: number }) {
  const [sc, setSc] = useState<ScheduleC | null>(null);
  const [cg, setCg] = useState<CapitalGains | null>(null);
  const [schedule, setSchedule] = useState<Awaited<ReturnType<typeof api.investmentSchedule>> | null>(null);
  const [k1099, setK1099] = useState<Reporting1099k | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.scheduleC(year),
      api.capitalGains(year),
      api.investmentSchedule(),
      // A missing tax year is not a reason to fail the whole page.
      api.reporting1099k(year).catch(() => null),
    ])
      .then(([s, c, i, k]) => {
        if (cancelled) return;
        setSc(s); setCg(c); setSchedule(i); setK1099(k);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Could not load'));
    return () => { cancelled = true; };
  }, [year]);

  if (error) return <Banner kind="bad">{error}</Banner>;
  if (!sc || !cg) return <Spinner />;

  const pl = sc.profitLoss;

  return (
    <>
      <div className="section">
        <h2>Schedule C worksheet — {year}</h2>
        <p className="sub">Read this straight onto the form, or hand it to a preparer.</p>
      </div>

      {pl.cogs.warning && <Banner kind="bad"><strong>The books do not tie.</strong> {pl.cogs.warning}</Banner>}

      <div className="panel">
        <h3>Part I — Income</h3>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><td>1 · Gross receipts or sales</td><td className="num">{money(pl.grossReceiptsCents)}</td></tr>
              <tr><td>2 · Returns and allowances</td><td className="num">{money(pl.returnsAndAllowancesCents)}</td></tr>
              <tr><td>3 · Subtract line 2 from line 1</td><td className="num">{money(pl.netReceiptsCents)}</td></tr>
              <tr><td>4 · Cost of goods sold</td><td className="num">{money(pl.cogsCents)}</td></tr>
              <tr className="total"><td>7 · Gross income</td><td className="num">{money(pl.grossIncomeCents)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ marginTop: 8 }}>
          Line 1 includes shipping charged to buyers, because that is part of what they paid you. Sales tax
          collected is not in it — that money belongs to the state.
        </p>
      </div>

      <div className="panel">
        <h3>Part III — Cost of goods sold</h3>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <td>33 · Method used to value closing inventory</td>
                <td className="num">{sc.inventoryValuation.line33}</td>
              </tr>
              <tr>
                <td>34 · Any change in quantities, costs or valuations?</td>
                <td className="num">{sc.inventoryValuation.line34}</td>
              </tr>
              <tr><td>35 · Inventory at start of year</td><td className="num">{money(pl.cogs.beginningInventoryCents)}</td></tr>
              <tr>
                <td>36 · Purchases less personal withdrawals</td>
                <td className="num">{money(pl.cogs.purchasesCents)}</td>
              </tr>
              <tr><td>39 · Other costs (grading)</td><td className="num">{money(pl.cogs.otherCostsCents)}</td></tr>
              <tr><td>40 · Goods available</td><td className="num">{money(pl.cogs.goodsAvailableCents)}</td></tr>
              <tr><td>41 · Inventory at end of year</td><td className="num">{money(pl.cogs.endingInventoryCents)}</td></tr>
              <tr className="total"><td>42 · Cost of goods sold</td><td className="num">{money(pl.cogs.cogsCents)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ marginTop: 8 }}>{sc.inventoryValuation.note}</p>
        <p className="faint" style={{ marginTop: 8 }}>
          Cross-check: adding up the cost of what actually sold gives {money(pl.cogs.cogsFromSalesCents)}.
          {pl.cogs.differenceCents === 0
            ? ' The two agree, which is what you want.'
            : ` They differ by ${money(Math.abs(pl.cogs.differenceCents))} — worth resolving before filing.`}
        </p>
        {pl.cogs.personalWithdrawalsCents > 0 && (
          <p className="faint">
            {money(pl.cogs.personalWithdrawalsCents)} of items were taken for personal use and removed from
            purchases, which line 36 requires.
          </p>
        )}
      </div>

      <div className="panel">
        <h3>Part II — Expenses</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Line</th><th>Category</th><th className="num">Spent</th><th className="num">Deductible</th></tr>
            </thead>
            <tbody>
              {pl.expenseLines.map((l) => (
                <tr key={`${l.line}-${l.accountKey}`}>
                  <td>{l.line}</td>
                  <td>
                    {l.accountName}
                    {l.limitNote && <div className="faint">{l.limitNote}</div>}
                  </td>
                  <td className="num">{money(l.grossCents)}</td>
                  <td className="num">{money(l.deductibleCents)}</td>
                </tr>
              ))}
              <tr className="total">
                <td />
                <td>28 · Total expenses</td>
                <td className="num" />
                <td className="num">{money(pl.totalExpensesCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {pl.expenseLines.length === 0 && <p className="faint">No expenses recorded for {year} yet.</p>}
      </div>

      {pl.mileage.bands.length > 0 && (
        <div className="panel">
          <h3>Vehicle</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th className="num">Miles</th><th className="num">Rate</th><th className="num">Deduction</th></tr></thead>
              <tbody>
                {pl.mileage.bands.map((b) => (
                  <tr key={b.from}>
                    <td>{formatDate(b.from)} – {formatDate(b.to)}</td>
                    <td className="num">{b.miles.toFixed(1)}</td>
                    <td className="num">{b.centsPerMile}¢</td>
                    <td className="num">{money(b.deductionCents)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Total</td>
                  <td className="num">{pl.mileage.totalMiles.toFixed(1)}</td>
                  <td />
                  <td className="num">{money(pl.mileage.deductionCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {pl.mileage.notes.map((n) => <p className="faint" key={n} style={{ marginTop: 8 }}>{n}</p>)}
        </div>
      )}

      <div className="panel">
        <h3>The bottom line</h3>
        <div className="stats">
          <MoneyStat label="29 · Tentative profit" cents={pl.tentativeProfitCents} signed />
          <MoneyStat label="30 · Home office" cents={pl.homeOfficeCents} />
          <MoneyStat label="31 · Net profit" cents={pl.netProfitCents} signed note="Flows to Form 1040" />
          <MoneyStat
            label="Self-employment tax"
            cents={sc.selfEmployment?.totalCents ?? 0}
            note="Schedule SE"
          />
        </div>
      </div>

      {cg.dispositions.length > 0 && (
        <div className="section">
          <h2>Capital gains — Form 8949</h2>
          <p className="sub">Cards held as a personal collection. Not business income, and no self-employment tax.</p>
          <div className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Card</th><th>Acquired</th><th>Sold</th><th className="num">Proceeds</th><th className="num">Basis</th><th className="num">Gain</th><th>Term</th></tr>
                </thead>
                <tbody>
                  {cg.dispositions.map((d) => (
                    <tr key={d.itemId}>
                      <td>{d.description}</td>
                      <td>{formatDate(d.acquiredOn)}</td>
                      <td>{formatDate(d.soldOn)}</td>
                      <td className="num">{money(d.proceedsCents)}</td>
                      <td className="num">{money(d.basisCents)}</td>
                      <td className="num">{money(d.gainCents)}</td>
                      <td>{d.term === 'long-term' ? 'Long' : 'Short'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="stats" style={{ marginTop: 12 }}>
              <MoneyStat label="Short-term gain" cents={cg.shortTermGainCents} signed />
              <MoneyStat label="Long-term gain" cents={cg.longTermGainCents} signed />
              <MoneyStat label="Collectibles gain" cents={cg.collectiblesGainCents} note="Capped at 28%" />
            </div>
            {cg.notes.map((n) => <p className="faint" key={n} style={{ marginTop: 8 }}>{n}</p>)}
          </div>
        </div>
      )}

      {schedule && schedule.entries.length > 0 && (
        <div className="section">
          <h2>Personal collection schedule</h2>
          <p className="sub">Print this, date it and sign it. Generated {new Date(schedule.generatedAt).toLocaleString()}.</p>
          <div className="panel">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Card</th><th>Acquired</th><th className="num">Cost</th><th className="num">Value</th><th>Status</th></tr></thead>
                <tbody>
                  {schedule.entries.map((e) => (
                    <tr key={String(e.itemId)}>
                      <td>{String(e.description)}</td>
                      <td>{formatDate(String(e.acquiredOn))}</td>
                      <td className="num">{money(Number(e.basisCents))}</td>
                      <td className="num">{money(e.estimatedValueCents === null ? null : Number(e.estimatedValueCents))}</td>
                      <td>{String(e.status)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td colSpan={2}>Total</td>
                    <td className="num">{money(schedule.totalBasisCents)}</td>
                    <td className="num">{money(schedule.totalValueCents)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <ul className="faint" style={{ paddingLeft: 16, marginTop: 12 }}>
              {schedule.guidance.map((g) => <li key={g} style={{ marginBottom: 4 }}>{g}</li>)}
            </ul>
          </div>
        </div>
      )}

      {k1099 && k1099.channels.length > 0 && (
        <div className="section">
          <h2>Form 1099-K — what the platforms will report</h2>
          <p className="sub">
            A platform files only when it settles more than $20,000 for you across more than 200
            transactions. Both tests. The threshold is the platform&rsquo;s filing duty, never yours.
          </p>

          {k1099.formsExpected > 0 ? (
            <Banner>
              <strong>
                Expect {k1099.formsExpected} form{k1099.formsExpected === 1 ? '' : 's'} totalling{' '}
                {money(k1099.expectedOnFormsCents)}.
              </strong>{' '}
              That is gross — shipping buyers paid and sales tax the platform collected are in it, and fees and
              refunds are not taken out. Start Schedule C line 1 from that figure and deduct down.
            </Banner>
          ) : (
            <Banner kind="warn">
              <strong>No 1099-K is expected, and every dollar is still taxable.</strong> The IRS puts it
              plainly: all income, no matter the amount, is taxable unless the law says it isn&rsquo;t — even if
              you don&rsquo;t get a Form 1099-K.
            </Banner>
          )}

          <div className="panel">
            {k1099.channels.map((c) => (
              <div className="list-item" key={c.channel}>
                <div className="grow">
                  <strong>{c.label}</strong>
                  <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                    {c.transactionCount} sale{c.transactionCount === 1 ? '' : 's'} ·{' '}
                    {formStatus(c)}
                  </div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>{c.note}</div>
                  {c.reconcilingCents > 0 && (
                    <div className="faint" style={{ fontSize: 12, marginTop: 5 }}>
                      Schedule C line 1 takes {money(c.scheduleCReceiptsCents)} of this; the other{' '}
                      {money(c.reconcilingCents)} is sales tax that went to the state.
                    </div>
                  )}
                </div>
                <div className="amount">{money(c.reportableGrossCents)}</div>
              </div>
            ))}
            <div className="list-item" style={{ borderTopWidth: 2 }}>
              <div className="grow">
                <strong>All channels</strong>
                <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                  {k1099.channels.reduce((n, c) => n + c.transactionCount, 0)} sales ·{' '}
                  {money(k1099.channels.reduce((n, c) => n + c.scheduleCReceiptsCents, 0))} to Schedule C line 1
                </div>
              </div>
              <div className="amount">{money(k1099.totalReportableGrossCents)}</div>
            </div>

            {k1099.approaching.length > 0 && (
              <p className="faint" style={{ marginTop: 12 }}>
                Closing in on a form:{' '}
                {k1099.approaching
                  .map((p) => `${p.channel.label} (${Math.round(p.overallProgress * 100)}% of the binding test)`)
                  .join(', ')}
                . Keep the fee and refund statements now, while it is still easy.
              </p>
            )}

            <ul className="faint" style={{ paddingLeft: 16, marginTop: 12 }}>
              {k1099.explanation.map((e) => <li key={e} style={{ marginBottom: 4 }}>{e}</li>)}
            </ul>
          </div>
        </div>
      )}

      {sc.warnings.length > 0 && (
        <div className="section">
          <h2>Before you file</h2>
          <Banner kind="warn"><ul>{sc.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Banner>
        </div>
      )}

      <Banner>{sc.disclaimer}</Banner>
    </>
  );
}

/**
 * Why a platform will or will not send a form. A form needs BOTH tests, so
 * when one is missing that one is the whole answer.
 */
function formStatus(c: ChannelReporting): string {
  if (c.formExpected) return 'a form is coming';
  if (c.basis !== 'settlement-organisation') return 'no form unless a card reader was used';
  if (c.meetsDollarTest) return 'no form — over $20,000 but under 200 sales';
  if (c.meetsTransactionTest) return 'no form — over 200 sales but under $20,000';
  return 'no form — under $20,000 and under 200 sales';
}
