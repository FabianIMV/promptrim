export interface BatchRow {
  index: number;
  preview: string;
  tokensBefore: number;
  tokensAfter: number;
  pct: number;
  criticalKept: number;
  criticalTotal: number;
  blocked: number;
}

interface Props {
  rows: BatchRow[];
}

function tokens(count: number): string {
  return count.toLocaleString('en-US');
}

export function BatchView({ rows }: Props) {
  const totalBefore = rows.reduce((sum, r) => sum + r.tokensBefore, 0);
  const totalAfter = rows.reduce((sum, r) => sum + r.tokensAfter, 0);
  const totalPct =
    totalBefore > 0 ? Math.round(((totalBefore - totalAfter) / totalBefore) * 100) : 0;

  return (
    <section class="advisor" aria-labelledby="batch-heading">
      <header class="advisor-header">
        <h2 id="batch-heading" class="advisor-title">
          Batch results
        </h2>
        <span class="advisor-sub">
          {rows.length} prompts · {totalPct}% fewer tokens overall
        </span>
      </header>

      <div class="advisor-scroll">
        <table class="advisor-table">
          <caption class="sr-only">Per-prompt token reduction and constraints preserved</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Prompt</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
              <th scope="col">Saved</th>
              <th scope="col">Constraints preserved</th>
              <th scope="col">Blocked by ledger</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index}>
                <th scope="row">{row.index}</th>
                <td style="text-align:left;white-space:normal;">{row.preview}</td>
                <td>{tokens(row.tokensBefore)}</td>
                <td>{tokens(row.tokensAfter)}</td>
                <td class={row.pct > 0 ? 'good' : undefined}>{row.pct}%</td>
                <td>{row.criticalTotal > 0 ? `${row.criticalKept}/${row.criticalTotal}` : '—'}</td>
                <td>{row.blocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p class="advisor-note">
        Each prompt was compressed independently. The compressed prompt panel below joins the
        results back together with the same <code>---</code> separator you pasted in.
      </p>
    </section>
  );
}
