# FFGC2K26 — The Official Arena

A working, mobile-responsive Node.js website with a private God Admin control center, persistent JSON data, leaderboard, tasks, announcements, voting and nomination polls.

## Start locally

Requires Node.js 18 or newer. No npm dependencies.

```bash
cd ffgc2k26-arena
ADMIN_USERNAME=godadmin ADMIN_PASSWORD='CHOOSE-A-STRONG-PRIVATE-PASSWORD' SESSION_SECRET='CHOOSE-A-LONG-RANDOM-SECRET' npm start
```

Open http://localhost:3000 and press **Admin** to sign in.

On Windows PowerShell:
```powershell
$env:ADMIN_USERNAME='godadmin'
$env:ADMIN_PASSWORD='CHOOSE-A-STRONG-PRIVATE-PASSWORD'
$env:SESSION_SECRET='CHOOSE-A-LONG-RANDOM-SECRET'
npm start
```

## Hosting

Deploy on a Node.js host with a **persistent disk** for `data.json`, configure environment variables `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `COOKIE_SECURE=true`, `PORT` (if needed), and `DATA_FILE` (path on persistent disk). Use HTTPS. The included JSON file is suitable for a small private group on a **single server instance**, not multiple replicas or serverless ephemeral storage. Back up the data file regularly.

**Do not upload `data.json` to a public repository after it contains member voting codes or votes.** Codes are stored only as SHA-256 hashes; the plaintext code appears only once on generation. Treat codes as secrets.

## Functionality

- Public leaderboard automatically sorted by points (descending).
- Admin: add members, rename, adjust points, nomination exemptions, regenerate voting codes.
- Admin: tasks (create/edit/status), announcements, poll creation, poll start/pause/close, results visibility.
- Public: vote once per poll with a unique private code, one or multiple selections.
- Nomination polls use the eligible member list at creation time; members cannot nominate themselves.
- Public / maintenance / private website modes. Admin login stays available in every mode.
- Activity log for administrative actions.

## Limitations and production notes

- Voting codes identify possession of a code, not a verified person. Users who share codes can let someone vote for them. For higher-assurance voting, add stronger identity verification.
- This starter has no rate limiting, automated backups, password recovery, or multi-admin support. Add rate limiting and monitoring before exposing to a large public audience.
- A poll's options are fixed after creation. Closed polls cannot be reopened.
- Rank is always automatic; manual rank override is intentionally not implemented, to avoid inconsistent point/rank standings.
- The JSON persistence layer is intended for one running process only.
- No domain, hosting, or public URL is included in this ZIP. Deployment is a separate step.
