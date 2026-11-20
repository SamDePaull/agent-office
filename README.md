# Agent Office

Kantor pixel-art lokal yang menampilkan agent Claude Code secara langsung. Tiap karakter berjalan
ke ruangan sesuai pekerjaan **nyata** yang ditangkap lewat hooks Claude Code, tanpa aktivitas simulasi.
Satu-satunya pengecualian adalah tombol **DEMO** yang jelas berlabel.

Konsep dan alur gambarnya diambil dari
[Office Prompt Kit](https://noobster97.github.io/youtube-video-local-agent-mission-control-ui-dashboard/).
Cakupannya hanya **kantor + telemetri**: tanpa terminal tertanam dan tanpa alur rencana/persetujuan.

## Menjalankan

Server menyala otomatis saat login lewat launchd (`~/Library/LaunchAgents/local.agent-office.plist`)
dan hidup lagi kalau mati. Buka **http://127.0.0.1:4316**.

```bash
launchctl kickstart -k gui/$(id -u)/local.agent-office   # restart (setelah mengubah server.mjs / lib/)
launchctl bootout gui/$(id -u)/local.agent-office        # matikan sampai login berikutnya
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.agent-office.plist  # nyalakan lagi
tail -f data/logs/server.log                              # log
```

Perubahan di `public/` cukup dengan muat ulang halaman; perubahan di `server.mjs` atau `lib/` butuh restart.
Selama server mati, hooks diam saja (curl gagal tanpa suara, sesi Claude tidak terganggu), tapi event
selama itu tidak tercatat.

**Di dalam VS Code:** Cmd+Shift+P → *Simple Browser: Show* → `http://127.0.0.1:4316`, lalu seret tabnya
ke samping editor. Notifikasi sistem tidak jalan di Simple Browser (hanya bunyi dan judul tab), jadi
untuk notifikasi pakai tab Chrome.

## Sesi, notifikasi, dan menjawab dari web

- **Panel Sesi** (kolom kiri): judul sesi (judul otomatis Claude atau hasil `/rename`), proyek, branch git, mode
  izin, prompt terakhir, dan untuk sesi yang dipilih juga jawaban terakhir, jumlah tool, berkas, dan agent yang jalan.
  Klik satu sesi untuk menyaring kantor, roster, dan aktivitas ke sesi itu saja; klik lagi untuk kembali ke semua.
- **Kartu di pojok kanan bawah:**
  - 🔐 *minta izin* → tombol **Izinkan / Tolak**;
  - ❓ *bertanya* → pilih jawaban (bisa pilihan ganda + "Jawaban lain"), lalu **Kirim jawaban**;
  - ✅/🧩 *selesai* → kartu singkat; klik untuk membuka sesinya.
- **Lonceng 🔔**: angka belum dibaca + riwayat hari ini, dan pengaturan notifikasi sistem/bunyi.

Cara kerja izin & pertanyaan: hook `PermissionRequest` (satu-satunya hook **sinkron**) menahan permintaan
**sampai dijawab** di halaman Agent Office atau pet desktop (batas aman 30 menit), selama salah satunya terbuka.
Selama itu dialog VS Code tidak muncul — jawab dari kartu. Tidak ada halaman/pet yang terbuka (atau semuanya terputus
> 10 detik) → langsung kembali ke dialog VS Code. Pertanyaan dengan beberapa butir ditampilkan **satu per satu**. Setiap permintaan tercatat di `data/logs/server.log`
(dijawab lewat web / waktu habis / dibatalkan).

Notifikasi sistem tidak jalan di Simple Browser VS Code (hanya bunyi, kartu, dan judul tab).
Tab yang terbuka memuat ulang sendiri setiap server diperbarui.

## Pet: Kapten Meong mini

- **Di kantor**: berjalan ke karakter yang sedang diawasinya; duduk di Ruang Santai kalau tidak ada.
- **Mood** (5 ekspresi + santai, gambar di `public/assets/pet/`): panik saat ada yang menunggu izin/jawaban →
  sedih saat tool/jawaban gagal (45 dtk) → senang saat tugas selesai / naik level → ikut bekerja → tidur saat tidak ada sesi.
- **XP & level** (`data/pet.json`): +1 per tool, +10 tugas selesai, +5 subagent selesai, +25 saat skill/MCP dipakai
  untuk pertama kalinya. Level L butuh 25·L·(L−1) XP total. Aksesori: Lv5 syal, Lv10 mahkota, Lv20 aura emas.
- **Desktop**: `~/Applications/Agent Office Pet.app` (Swift, `desktop/AgentOfficePet.swift`, build ulang dengan
  `sh desktop/build.sh`). Jendela transparan selalu di atas; seret untuk memindahkan, **klik = elus** (reaksi senang,
  +1 XP maks sekali per menit), **klik dua kali = panel mini** (sesi berjalan + aktivitas/pesan terakhir, *Sorot di office*
  → halaman office menyaring ke sesi itu, *Salin pesan terakhir*, statistik hari ini, bisukan kartu selesai/gagal
  30 mnt / 1 jam), klik kanan untuk menu (sembunyikan 1 jam, keluar). Menyala saat login lewat `local.agent-office-pet`.
- **Pesan & pilihan** (pet desktop dan pet kantor): kartu gelembung chat di samping pet untuk
  🔐 minta izin (Tolak / Izinkan), ❓ pertanyaan (klik pilihan; satu pertanyaan pilihan tunggal langsung terkirim),
  ✅ selesai (cuplikan jawaban terakhir + Buka sesi), dan ⚠️ gagal (Lihat detail). Jawaban memakai jalur yang sama
  dengan kartu di halaman kantor (ditahan sampai dijawab). Tombol kartu baru aktif 1 detik setelah muncul (anti klik tidak sengaja);
  jendela pet melebar ke arah tengah layar mengikuti isi kartu dan muncul lagi walau sedang disembunyikan.
- **Status line Claude Code**: `~/.claude/agent-office-statusline.sh` → `(=•̀ω•́=)⌨ Lv3 · 📚 figma-use · my-app ⎇ main`.

## Peringatan gagal

Hook `PostToolUseFailure` dan `StopFailure` (cadangan settings: `settings.json.bak-agent-office-3`). Tool yang gagal
(bukan yang Anda batalkan) memberi tanda ⚠ dan papan merah di karakternya selama 30 detik, kartu + riwayat lonceng,
notifikasi sistem (bisa dimatikan di 🔔 → "Saat tool / jawaban gagal"), pet ikut sedih, dan hitungan "gagal" di statistik.

## Katalog tools & skill (tombol 📚 Katalog)

Halaman `/catalog.html` mendaftar semua yang terpasang di Claude Code, supaya tidak lupa apa saja yang ada:

- **Skill**: pribadi (`~/.claude/skills`), per proyek (`<proyek>/.claude/skills`), dari plugin, dan skill claude.ai yang
  tersinkron. Skill yang tidak ada di disk tapi pernah dipakai (skill bawaan Claude Code) masuk sebagai *Terdeteksi*.
- **Command** & **Agent**: `.claude/commands` dan `.claude/agents` (pribadi, proyek, plugin), plus subagent bawaan.
- **MCP**: dari `~/.claude.json`, `.mcp.json` proyek, dan plugin; konektor claude.ai muncul begitu pernah dipakai.
  Isi `env`/header tidak pernah ditampilkan, hanya namanya.
- **Plugin**: versi dan isinya.

Proyek yang dipindai: yang tercatat di `~/.claude.json` dan semua folder di `~/Developer`.

Tiap item menampilkan **berapa kali & kapan terakhir dipakai**, dihitung dari transcript Claude Code
(`~/.claude/projects/**/*.jsonl`). Pemindaian penuh pertama memakan ±15 detik di latar belakang, sesudahnya hanya bagian
yang baru. Yang disimpan di `data/usage-history.json` hanya agregat (nama, folder, jumlah, waktu), bukan isi percakapan.
Skill proyek hanya dihitung pemakaiannya di proyek itu.

**Per asal** (sakelar ▤, default aktif): item dikelompokkan menurut pembuat/sumbernya, dalam seksi yang bisa dilipat.
Asal dibaca dari `skills-lock.json` proyek (repo GitHub, mis. `mattpocock/skills`), `author` di SKILL.md, penulis plugin,
domain/perintah server MCP, atau Anthropic untuk yang bawaan/claude.ai. Item tanpa sumber tercatat masuk *Buatan sendiri*;
asalnya bisa diisi manual di detail (kolom "asal", mis. `Panniantong/Agent-Reach`).

Skill/command/agent bernama sama di beberapa proyek digabung jadi satu kartu (daftar proyek + SKILL.md tiap proyek di detail).

**Bahasa ID | EN** (pojok kanan atas, diingat): mengganti seluruh antarmuka. Dalam mode ID, deskripsi memakai
terjemahan Bahasa Indonesia yang dibuat sekali lewat `claude -p --model haiku` (langganan Claude Anda, hook dimatikan,
tanpa tool) dan disimpan di `data/translations.json`; deskripsi baru/berubah ikut diterjemahkan otomatis saat katalog
dibuka. Isi SKILL.md/README lengkap diterjemahkan hanya saat Anda menekan **Terjemahkan** di dokumennya (±30–60 detik),
lalu tersimpan; tombol **Tampilkan asli** untuk membandingkan. Lokasi CLI dicari otomatis; set `CLAUDE_BIN` kalau tidak ketemu.

**✦ Tanya** (kotak di atas): tulis tugasnya ("bikin video dari voiceover"), Claude (Sonnet lewat `claude -p`, ±5 detik)
memilih 1–5 skill/command/agent/MCP terpasang yang paling cocok beserta alasan dan cara memanggilnya.

**🧹 Saran bersih-bersih**: daftar item yang lama tidak dipakai (> 30 hari / belum pernah, kecuali yang baru dipasang),
salinan identik di beberapa proyek, dan skill bernama sama dengan isi berbeda. Tiap baris punya perintah yang bisa disalin
(`trash …`, `claude plugin uninstall …`, `claude mcp remove …`, `diff -ru …`). Agent Office sendiri tidak menghapus apa pun.

Semua panggilan `claude -p` berjalan tanpa hook, tanpa tool, tanpa server MCP Anda, dengan system prompt pendek dan
thinking dimatikan, supaya cepat dan tidak muncul di kantor.

Lainnya: pencarian (tekan `/`), filter jenis/sumber/favorit/baru (7 hari)/belum pernah dipakai, tombol **salin cara
memanggil** (`/figma:figma-use`), isi SKILL.md / README / konfigurasi MCP, dan **catatan pribadi + tag + favorit**
(disimpan di `data/catalog-notes.json`). Katalog tidak pernah mengubah apa pun di `~/.claude`.

## Cara kerjanya

```
Claude Code (sesi mana pun) ──hooks async──▶ POST /api/hook ──▶ lib/state.mjs ──SSE──▶ browser
```

- **Hooks global** ada di `~/.claude/settings.json` (cadangan: `settings.json.bak-agent-office` sebelum pemasangan
  pertama, `settings.json.bak-agent-office-2` sebelum hook izin dibuat sinkron).
  Event: SessionStart/End, UserPromptSubmit, Pre/PostToolUse, Notification, Stop, SubagentStart/Stop memakai
  `async: true` (tidak pernah menahan sesi). `PermissionRequest` sinkron (lihat bagian di atas).
- **Server** (`server.mjs`, tanpa dependensi) hanya mendengar di `127.0.0.1`. Isi berkas dan keluaran tool tidak disimpan;
  yang disimpan cuma ringkasan (nama tool, nama berkas, potongan perintah) di `data/events/<tanggal>.ndjson`,
  dengan rahasia (token, kunci API, password) dimasking.

### Siapa ke ruangan mana

| Keadaan | Ruangan |
|---|---|
| Lead menerima prompt / selesai menjawab | Command Center (kursi pertamanya) |
| Lead baru memberi tugas ke subagent | Briefing Room (±5 detik) |
| Subagent baru mulai | Briefing Room (±5 detik) |
| Lead atau subagent memakai Read / Edit / Grep / Glob / Write | Workspace |
| … memakai Bash | Server Room (LED rak berkedip) |
| … memakai WebSearch / WebFetch / MCP | Meeting Room |
| Tool administratif (TodoWrite, Skill, ToolSearch, …) | tetap di ruangan sekarang |
| Siapa pun menunggu izin / memakai AskUserQuestion | Approval Office + badge `!` / `?` |
| Subagent selesai | ucapan penutup di meja, lalu pergi istirahat |
| Tidak ada tugas | istirahat di Lounge, Pantry, atau Briefing/Meeting yang sedang kosong |

Saat karakter memakai skill atau server MCP, muncul papan nama kecil di atas kepalanya (📚 `figma-use`, 🔌 `Figma`)
selama ±20 detik; klik untuk membuka item itu di Katalog.

Karakter tidak pindah ruangan lebih cepat dari 4 detik, jadi tidak mondar-mandir tiap tool.
Meja yang sedang dipakai bekerja ikut menyala. Klik karakter atau barisnya di roster untuk melihat
detail: tugas, tool sekarang, berkas yang diubah, dan 12 aktivitas terakhir.

Lampu kantor menyala selama ada sesi aktif (ada event dalam 45 menit terakhir dan belum SessionEnd).
Agent yang tampil bekerja tapi tanpa kabar lebih dari 15 menit dibuat redup dan diberi label umur.

## Kustom (tombol ⚙ di kanan atas)

Semua bisa diubah dari panel, dan langsung berlaku di semua tab yang terbuka:

- **Karakter:** siapa memerankan tipe agent mana (termasuk Lead dan tipe subagent kustom Anda), nama, peran,
  warna, unggah gambar per pose (latar putih dibuang otomatis; pose yang kosong memakai gambar depan), tambah/hapus karakter.
- **Tema:** pilih peta (kantor malam, kantor siang, markas cyberpunk, atau **otomatis siang/malam** mengikuti jam),
  unggah peta sendiri, warna aksen, panel gelap/terang, redupkan kantor saat tidak ada sesi.
- **Ruangan:** nama 8 ruangan dan ke ruangan mana karakter pergi untuk tiap kelompok tool (atau "tetap di tempat").

Pengaturan disimpan di `data/settings.json` (dibuat otomatis dari `data/team.json` lama saat pertama jalan;
`team.json` sekarang tidak dipakai lagi). Koordinat tiap peta ada di `data/coords/<peta>.json`; peta baru
mendapat salinan koordinat kantor malam sebagai titik awal. Kalau tata letaknya berbeda, sesuaikan di halaman Peta
(pilih petanya lewat menu di atas).

## Subagent berurutan (Volt, Ember, Ripple)

Kalau panel Kustom → Karakter → *Subagent berurutan* punya slot, subagent dipetakan **menurut urutan**, bukan tipe:
subagent pertama yang sedang jalan = slot 1 (Volt), kedua = slot 2 (Ember), ketiga = slot 3 (Ripple); lebih dari
itu jadi kembaran slot terakhir (Ripple #1, …). Slot dilepas begitu subagent selesai. Karakter per tipe
(Coki, Windah, …) tetap tampil sebagai staf yang istirahat. Hapus semua slot untuk kembali ke pemetaan per tipe.

Volt, Ember, dan Ripple adalah makhluk berdesain original (Higgsfield, GPT Image 2.6 kualitas sedang).

## Karakter

Sesi utama selalu memakai karakter "Lead". Tipe yang tidak terdaftar memakai "Tipe lain".
Kalau dua agent bertipe sama berjalan bersamaan, muncul kembaran bernomor (`Coki #1`).

| sprite | tipe | karakter saat ini |
|---|---|---|
| `lead` | sesi utama | Jensen (CEO NVIDIA) |
| `explore` | Explore | Coki Pardede |
| `general` | general-purpose | Windah Basudara |
| `plan` | Plan | Gibran |
| `guide` | claude-code-guide | dr. Tirta |
| `claude` | claude | IShowSpeed |
| `default` | tipe lain | placeholder chibi |

Gambar kantor dan keenam karakter di atas di-generate lewat Higgsfield (GPT Image 2.6, pixel art HD) sebagai
karikatur chibi untuk pemakaian lokal. Sumber aslinya ada di `raw/` (diabaikan git).
Kalau `raw/` diganti, jalankan ulang `npm run assets`.

Peta "kantor siang" dan "markas cyberpunk" juga di-generate lewat Higgsfield dari denah yang sama.

## Mengganti gambar dengan karakter Anda sendiri (ChatGPT)

1. Buka [Office Prompt Kit](https://noobster97.github.io/youtube-video-local-agent-mission-control-ui-dashboard/).
   Di **langkah 1** isi tim Anda: karakter pertama = Lead, lalu satu karakter untuk tiap sprite di tabel atas.
2. **Langkah 2 & 3**: salin prompt-nya ke ChatGPT (satu chat untuk semua gambar). Simpan hasilnya ke folder
   `raw/` di proyek ini, **memakai nama sprite**, bukan nama karakter:
   ```
   raw/lead/front.png   raw/lead/side.png   raw/lead/back.png   raw/lead/portrait.png
   raw/explore/front.png …
   raw/office.png
   ```
   `side.png` harus **menghadap kiri**. Langkah 4–5 kit (membangun aplikasi) tidak perlu, karena aplikasinya sudah ada di sini.
3. Proses gambarnya:
   ```bash
   npm run assets            # pixel art (nearest-neighbour)
   npm run assets -- --smooth  # kalau gayanya bukan pixel art
   ```
   Latar putih atau kotak-kotak dibuang otomatis, ketiga pose disamakan skala dan garis kakinya.
   Sprite yang berkasnya belum lengkap dilaporkan dan tetap memakai placeholder.
4. Setelah `office.png` ada, buka **Peta** (`/picker.html`): tandai 8 ruangan (ROOM), kursi (SEAT),
   pintu (DOOR), persimpangan (NODE), dan sambungan jalan (CONNECT) sampai checklist hijau semua, lalu **Simpan**.

Sebelum langkah di atas, kantornya memakai placeholder: tata letak 8 ruangan yang sama, digambar dengan
tileset Kenney "Roguelike Indoors" (CC0, `public/assets/kenney-indoor-LICENSE.txt`) plus perabot yang digambar kode,
dan karakter chibi original.

## Melepas

Hapus 12 entri hook yang perintahnya berisi `127.0.0.1:4316/api/hook` dari `~/.claude/settings.json`
(atau lewat menu `/hooks` di Claude Code), serta `statusLine`. Pet desktop: `launchctl bootout gui/$(id -u)/local.agent-office-pet`,
hapus plist-nya dan `~/Applications/Agent Office Pet.app`. Folder ini lalu boleh dihapus.

## Pengembangan

```bash
npm test                                   # tes logika state & pengaturan
node tools/shot.mjs http://127.0.0.1:4316/ out.png 1440 900 2500   # potret (butuh playwright; atau set PLAYWRIGHT_FROM)
curl -s http://127.0.0.1:4316/api/debug/samples                    # 40 payload hook terakhir (dipotong)
```
