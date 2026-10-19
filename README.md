# Liquid Glass Chess

A responsive chess game with local play, four AI strengths, the Learning Coach, sound, themes, and online rooms for two remote players.

## Free online hosting

This project is a Vite static website. The recommended free setup is **Vercel Hobby** for the website and **Supabase Free** for online rooms. Vercel serves the game globally; Supabase Realtime carries room presence and chess moves between browsers. No database table or server process is needed.

### 1. Put the project on GitHub

1. Create a GitHub account if needed, then create a new **public** repository, for example `liquid-glass-chess`.
2. Upload this project's files to the repository root. Include `src`, `index.html`, `package.json`, `package-lock.json`, and this README. Do not upload `node_modules` or `dist`.
3. Commit the files to the `main` branch.

If you use Git locally, from the project directory run:

```bash
git init
git add .
git commit -m "Add Liquid Glass Chess"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-NAME/liquid-glass-chess.git
git push -u origin main
```

If Git says the project is already a repository, skip `git init` and add/commit/push the files instead.

### 2. Create a free Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a project on the Free plan.
2. Open **Project Settings → API** (or **API Keys** in the newer dashboard).
3. Copy the **Project URL** and the **publishable/public key**. The older `anon` public key also works. Never use or publish the `service_role` or `secret` key in this website.
4. Open **Realtime → Settings** and make sure **Allow public access to channels** is enabled. This game uses public, unpersisted Realtime channels, so there is no SQL setup and no database table to create.

Room codes are randomly generated and are the invitation. Anyone who knows a code can join or send messages to that public room, so only share it with the person you intend to play. Do not put private information in room names. This is a casual friend-play implementation, not an authenticated/ranked chess service. Supabase Free projects can pause after a week with very little activity; restore the project in the Supabase dashboard if that happens.

### 3. Deploy on Vercel

1. Sign up at [vercel.com](https://vercel.com) and choose **Continue with GitHub**.
2. Select **Add New → Project**, then import your `liquid-glass-chess` repository.
3. Vercel should detect Vite. Confirm these settings if it asks:
   - Framework: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`
4. Before deploying, add these under **Environment Variables**:
   - `VITE_SUPABASE_URL` = the Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` = the Supabase publishable/public key (or legacy anon key)
   Add them to **Production** and **Preview** if you want online rooms to work on preview links too.
5. Select **Deploy**. When the build finishes, Vercel gives you a public `*.vercel.app` link.

The browser needs the Vite-prefixed values, so the public Supabase URL/key are compiled into the client. That is expected for a public key; never use a Supabase secret/service-role key here.

### 4. Test a remote game

1. Open the Vercel link and choose **Play Online** from the game-mode menu (on a phone: open the **Game** tab first).
2. Enter your name and choose **Create room as White**.
3. Use **Copy invite** and send the link or room code to your friend in another location.
4. Your friend opens the invite link (it opens the Online tab and fills in the room code), enters a name, and chooses **Join**. They join as Black. If you sent only the code, they can choose **Play Online** and type it in.
5. Once both players show as connected, take turns on the same board. Refresh/reconnect if a player loses their network connection.

### 5. Publish changes

Push later code changes to GitHub. Vercel automatically builds and deploys the latest commit. If you change either Supabase environment variable, create a new Vercel deployment because Vite reads these values at build time.

## Local development

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` and replace its placeholders with the Supabase Project URL and public key, then run:

```bash
npm run dev
```

Open the local URL shown by Vite. For a local build check, run `npm run build`.

## Online room behavior

- Create room gives the host White; joining the code gives the guest Black.
- Presence shows whether the other seat is connected. The host shares the current game state when a guest joins.
- Every move is checked against the receiving browser's legal moves before it is applied.
- Room traffic is temporary Realtime broadcast data; rooms and games are not stored as permanent matches.
- Local two-player and all four AI difficulty modes remain available without an online room.