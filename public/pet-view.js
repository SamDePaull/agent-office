// Tampilan pet (dipakai di kantor dan di jendela desktop /pet.html).
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ICON = { sleep: '💤', panic: '❗', sad: '💧', happy: '🎉', work: '', idle: '' };
export const MOOD_LABEL = { idle: 'santai', sleep: 'tidur', work: 'ikut bekerja', happy: 'senang', panic: 'panik', sad: 'sedih' };

/** Buat elemen pet. Mengembalikan elemen; perbarui dengan updatePet(el, view). */
export function createPet(extraClass = '') {
  const el = document.createElement('div');
  el.className = `pet ${extraClass}`.trim();
  el.innerHTML = `
    <div class="pet-say" hidden></div>
    <div class="pet-gain" hidden></div>
    <div class="pet-body">
      <span class="pet-crown" aria-hidden="true">👑</span>
      <img alt="Kapten Meong" draggable="false" />
      <span class="pet-scarf" aria-hidden="true">🧣</span>
      <span class="pet-icon" aria-hidden="true"></span>
    </div>
    <div class="pet-lv"><b></b><i><s></s></i></div>`;
  return el;
}

export function updatePet(el, v) {
  if (!v) return;
  const img = el.querySelector('img');
  const src = `/assets/pet/${v.mood}.png`;
  if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  el.dataset.mood = v.mood;
  el.classList.toggle('scarf', v.gear.scarf);
  el.classList.toggle('crown', v.gear.crown);
  el.classList.toggle('aura', v.gear.aura);
  el.classList.toggle('levelup', v.levelUp);
  el.querySelector('.pet-icon').textContent = ICON[v.mood] ?? '';
  el.querySelector('.pet-lv b').textContent = `Lv${v.level}`;
  const span = Math.max(1, v.xpNext - v.xpLevel);
  el.querySelector('.pet-lv s').style.width = `${Math.min(100, ((v.xp - v.xpLevel) / span) * 100)}%`;
  el.title = `Kapten Meong · Lv${v.level} · ${v.xp - v.xpLevel}/${span} XP ke level berikutnya · ${MOOD_LABEL[v.mood]}`;
  const say = el.querySelector('.pet-say');
  say.hidden = !v.say;
  if (say.textContent !== v.say) say.textContent = v.say;
  const gain = el.querySelector('.pet-gain');
  const gainText = v.gain ? `+${v.gain.xp} XP` : '';
  if (gain.dataset.ts !== String(v.gain?.ts ?? '')) {
    gain.dataset.ts = String(v.gain?.ts ?? '');
    gain.hidden = !v.gain;
    gain.textContent = gainText;
    gain.title = v.gain?.why ?? '';
    // Ulangi animasi naik untuk tiap XP baru.
    gain.style.animation = 'none';
    void gain.offsetWidth;
    gain.style.animation = '';
  }
}

export { esc };
