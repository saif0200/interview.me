# interview.me

AI-powered voice interview practice platform. Conduct realistic mock interviews with an AI interviewer, get real-time voice interaction, and receive detailed performance reports with scored feedback.

Built for the [DigitalOcean Gradient AI Hackathon](https://dograduation.devpost.com/).

## Project Structure

```
interview.me/
├── frontend/       React + Vite + Tailwind CSS (voice UI)
├── backend/        Express + PostgreSQL + DO Gradient AI
├── .do/            App Platform deployment spec
└── package.json    npm workspaces root
```

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL (any recent version — 16, 17, or 18)
- [DigitalOcean Model Access Key](https://cloud.digitalocean.com/gen-ai/inference)

### 1. Install PostgreSQL

**macOS (Homebrew):**
```bash
brew install postgresql
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
sudo apt install postgresql
sudo systemctl start postgresql
```

### 2. Create the database

```bash
createdb interviewme
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:
```
DATABASE_URL=postgresql://your-username@localhost:5432/interviewme
DO_MODEL_ACCESS_KEY=your-key-from-digitalocean
PORT=3001
```

> To get a Model Access Key, go to [DigitalOcean GenAI Inference](https://cloud.digitalocean.com/gen-ai/inference) and create a key.

### 5. Run

```bash
npm run dev
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:3001`. The Vite dev server proxies `/api` requests to the backend automatically. Database tables are created automatically on first startup.

## Scripts

| Command                  | Description                          |
| ------------------------ | ------------------------------------ |
| `npm run dev`            | Start frontend + backend concurrently |
| `npm run dev:frontend`   | Start frontend dev server only       |
| `npm run dev:backend`    | Start backend dev server only        |
| `npm run build:frontend` | Production build frontend            |
| `npm run build:backend`  | Production build backend             |

## How It Works

1. **Enter a job title** (and optional company) on the landing page
2. **Voice interview** begins — the AI interviewer asks questions via text-to-speech, you respond via microphone
3. **Real-time conversation** streamed via SSE from DigitalOcean Gradient AI (Llama 3.3 70B)
4. **End the interview** to generate a detailed performance report with scores

## Tech Stack

**Frontend:** React 19, Vite 8, TypeScript, Tailwind CSS v4, shadcn/ui, Motion, Web Speech API (STT/TTS)

**Backend:** Express 5, PostgreSQL, OpenAI SDK (DO Gradient compatible), Server-Sent Events

**AI:** DigitalOcean Gradient AI — `llama3.3-70b-instruct` for interview conversation and report generation

**Deployment:** DigitalOcean App Platform (static site + service + managed database)

## API Endpoints

| Method | Path                       | Description                              |
| ------ | -------------------------- | ---------------------------------------- |
| POST   | `/api/sessions`            | Create interview session                 |
| GET    | `/api/sessions/:id`        | Get session + message history            |
| POST   | `/api/chat`                | Send message, stream AI response (SSE)   |
| POST   | `/api/sessions/:id/end`    | End session, trigger report generation   |
| GET    | `/api/sessions/:id/report` | Get report (200 ready, 202 generating)   |
