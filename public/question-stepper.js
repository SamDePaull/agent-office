// Pertanyaan AskUserQuestion ditampilkan satu per satu (seperti di ekstensi Claude):
// pilihan tunggal → langsung lanjut ke pertanyaan berikutnya (atau terkirim di pertanyaan terakhir);
// pilihan ganda → centang lalu "Lanjut". Bisa kembali ke pertanyaan sebelumnya.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {{questions: {question: string, header?: string, multiSelect?: boolean, options: {label: string, description?: string}[]}[]}} item
 * @param {{ onSubmit: (answers: Record<string,string>) => void, canClick?: () => boolean, compact?: boolean }} opts
 * @returns {HTMLElement}
 */
export function createQuestionStepper(item, { onSubmit, canClick = () => true, compact = false }) {
  const qs = item.questions;
  const picks = qs.map(() => new Set());
  const other = qs.map(() => '');
  let step = 0;
  const root = document.createElement('div');
  root.className = `qs${compact ? ' compact' : ''}`;

  const answerOf = (i) => {
    const labels = [...picks[i]].sort((a, b) => a - b).map((oi) => qs[i].options[oi].label);
    if (other[i].trim()) labels.push(other[i].trim());
    return labels.join(', ');
  };
  const submit = () => onSubmit(Object.fromEntries(qs.map((q, i) => [q.question, answerOf(i)])));
  const next = () => {
    if (step < qs.length - 1) {
      step += 1;
      render();
    } else submit();
  };

  function render() {
    const q = qs[step];
    const last = step === qs.length - 1;
    root.innerHTML = `
      ${
        qs.length > 1
          ? `<div class="qs-steps">${qs
              .map(
                (x, i) =>
                  `<button type="button" class="qs-step${i === step ? ' on' : ''}${answerOf(i) ? ' done' : ''}" data-step="${i}" ${
                    i > step && !answerOf(i - 1) ? 'disabled' : ''
                  }>${esc(x.header || `${i + 1}`)}</button>`,
              )
              .join('')}<span class="qs-count">${step + 1}/${qs.length}</span></div>`
          : ''
      }
      <div class="qs-q">${esc(q.question)}${q.multiSelect ? ' <small>(boleh lebih dari satu)</small>' : ''}</div>
      <div class="qs-opts">${q.options
        .map(
          (o, oi) => `<button type="button" class="qs-opt" data-o="${oi}" aria-pressed="${picks[step].has(oi)}">
            <b>${esc(o.label)}</b>${o.description && !compact ? `<span>${esc(o.description)}</span>` : ''}</button>`,
        )
        .join('')}</div>
      <input class="qs-other" placeholder="Jawaban lain…" maxlength="300" aria-label="Jawaban lain" value="${esc(other[step])}">
      <div class="qs-nav">
        ${step > 0 ? '<button type="button" class="qs-back" data-back>← Kembali</button>' : '<span></span>'}
        ${q.multiSelect || other[step] ? `<button type="button" class="qs-next ok" data-next ${answerOf(step) ? '' : 'disabled'}>${last ? 'Kirim' : 'Lanjut →'}</button>` : ''}
      </div>`;
    if (compact)
      root.querySelectorAll('.qs-opt').forEach((b) => {
        const d = q.options[Number(b.dataset.o)].description;
        if (d) b.title = d;
      });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !canClick()) return;
    if (b.dataset.step !== undefined) {
      step = Number(b.dataset.step);
      return render();
    }
    if (b.dataset.back !== undefined) {
      step -= 1;
      return render();
    }
    if (b.dataset.next !== undefined) return next();
    if (b.dataset.o !== undefined) {
      const oi = Number(b.dataset.o);
      if (qs[step].multiSelect) {
        picks[step].has(oi) ? picks[step].delete(oi) : picks[step].add(oi);
        render();
      } else {
        picks[step] = new Set([oi]);
        other[step] = '';
        next();
      }
    }
  });
  root.addEventListener('input', (e) => {
    if (!e.target.classList.contains('qs-other')) return;
    other[step] = e.target.value;
    if (!qs[step].multiSelect && other[step].trim()) picks[step].clear();
    // Perbarui tombol tanpa merender ulang (supaya kursor tidak hilang).
    root.querySelectorAll('.qs-opt').forEach((x) => x.setAttribute('aria-pressed', String(picks[step].has(Number(x.dataset.o)))));
    let nextBtn = root.querySelector('[data-next]');
    if (!nextBtn) {
      root.querySelector('.qs-nav').insertAdjacentHTML('beforeend', `<button type="button" class="qs-next ok" data-next>${step === qs.length - 1 ? 'Kirim' : 'Lanjut →'}</button>`);
      nextBtn = root.querySelector('[data-next]');
    }
    nextBtn.disabled = !answerOf(step);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('qs-other') && answerOf(step)) {
      e.preventDefault();
      next();
    }
  });
  render();
  return root;
}
