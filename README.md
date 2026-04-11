# 🎽 Ateena Clothing Store — Panduan Deploy ke Vercel

## Struktur Folder

```
ateena-store/
├── index.html        ← Aplikasi utama
├── api/
│   └── chat.js       ← Proxy server (menyembunyikan API key)
├── vercel.json       ← Konfigurasi Vercel
├── .gitignore        ← Mencegah file sensitif ter-commit
└── README.md
```

---

## 🚀 Langkah Deploy (sekali saja)

### 1. Siapkan Repository GitHub

Pastikan semua file ini sudah ada di repository GitHub Anda:
- `index.html`
- `api/chat.js`
- `vercel.json`
- `.gitignore`

### 2. Buat Akun Vercel

- Buka [vercel.com](https://vercel.com)
- Klik **Sign Up** → pilih **Continue with GitHub**
- Izinkan Vercel mengakses GitHub Anda

### 3. Import Project

- Di dashboard Vercel, klik **Add New → Project**
- Pilih repository `ateena-store` dari daftar
- Klik **Deploy** (biarkan semua setting default)

### 4. Tambahkan API Key (PENTING!)

Setelah deploy pertama selesai:

1. Buka **Project Settings** → pilih tab **Environment Variables**
2. Klik **Add New**
3. Isi:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-...` *(API key Anda dari console.anthropic.com)*
   - **Environment:** centang `Production`, `Preview`, `Development`
4. Klik **Save**
5. Klik **Redeploy** → pilih deployment terakhir → **Redeploy**

### 5. Selesai! ✅

Aplikasi Anda akan berjalan di URL seperti:
`https://ateena-store-xxxx.vercel.app`

---

## 🔄 Update Aplikasi

Setiap kali Anda push ke GitHub, Vercel otomatis deploy ulang.

```bash
git add .
git commit -m "Update aplikasi"
git push
```

---

## ⚠️ Catatan Keamanan

- **JANGAN** pernah taruh API key di dalam `index.html`
- API key disimpan di **Vercel Environment Variables** (aman, tidak bisa dilihat publik)
- File `.env` sudah ada di `.gitignore` agar tidak ter-upload ke GitHub

---

## 🔑 Mendapatkan Anthropic API Key

1. Buka [console.anthropic.com](https://console.anthropic.com)
2. Login / buat akun
3. Klik **API Keys** → **Create Key**
4. Copy key dan simpan di Vercel Environment Variables
