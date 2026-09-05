import type { LocalMlProgress } from '../local-ml';

interface Props {
  progress: LocalMlProgress | null;
}

const PHASE_LABEL: Record<LocalMlProgress['phase'], string> = {
  'loading-model': 'Model',
  compressing: 'Compress',
  ready: 'Model',
};

export function LocalMlPanel({ progress }: Props) {
  return (
    <section class="ai-panel" aria-labelledby="local-ml-panel-heading">
      <h2 id="local-ml-panel-heading" class="ai-panel-title">
        Local ML mode <span class="experimental-badge">Experimental</span>
      </h2>
      <p class="ai-estimate">
        Runs a small on-device model (TinyBERT, LLMLingua-2, ~57 MB) entirely in your browser — no
        API key, no server, nothing you paste ever leaves your machine. The first run downloads the
        model once; your browser caches it after that. LLMLingua-2 drops tokens by statistical
        importance, not meaning — it can drop the wrong word — so its output always goes through the
        same protected regions and Constraint Ledger as the other modes below. That verification is
        what makes an unsupervised local model usable at all: review every ✗ before you trust the
        result.
      </p>

      {progress && (
        <ol class="ai-steps" aria-label="Local model status">
          <li class={`ai-step ${progress.phase === 'ready' ? 'done' : 'running'}`}>
            <span class="ai-step-mark" aria-hidden="true">
              {progress.phase === 'ready' ? '✓' : '◐'}
            </span>
            <span class="ai-step-name">{PHASE_LABEL[progress.phase]}</span>
            <span class="ai-step-detail">
              {progress.message}
              {progress.percent !== null ? ` (${Math.round(progress.percent)}%)` : ''}
            </span>
          </li>
        </ol>
      )}
    </section>
  );
}
