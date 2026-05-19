# Neon Runner

A high-octane, hyper-casual endless runner featuring neon aesthetics, increasing difficulty, and smooth 60fps gameplay.

## Deploy to Vercel

1. Push this project to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo
3. In **Environment Variables**, add:
   - `GEMINI_API_KEY` → your Gemini API key from [aistudio.google.com](https://aistudio.google.com)
4. Click **Deploy** — Vercel auto-detects Vite ✅

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env.local` and fill in your key:
   ```
   cp .env.example .env.local
   ```
3. Run the app:
   ```
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000)
