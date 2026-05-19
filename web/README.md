# hireIC web

Static landing page at [hire.renlab.ai](https://hire.renlab.ai).

- Single file: `index.html` (Inter font via CDN, no build step, no framework)
- Auto light/dark via `prefers-color-scheme`
- Live counts: GitHub Contents API + 5min localStorage cache
- Bilingual zh primary, en companion
- One config line at bottom of `<script>`: `const GH_REPO = "anzy-renlab-ai/hireIC";` — change after forking

## Local preview

```bash
# Any static server. Python is universal:
python3 -m http.server 8000 --directory web
# open http://localhost:8000
```

## Deploy to Vercel

This directory IS the deployable. Vercel just serves `index.html`.

### One-time setup

```bash
cd /Users/baidu/work/hireIC
npx vercel login
# Browser opens, authenticate.

npx vercel link
# Q: Set up "~/work/hireIC"? — Yes
# Q: Which scope? — pick your team/personal
# Q: Link to existing project? — No
# Q: Project name? — hireic
# Q: In which directory is your code located? — ./web
# Q: Want to modify settings? — No (defaults are fine for static)
```

### Deploy

```bash
# Preview (staging URL):
npx vercel --cwd web

# Production:
npx vercel --cwd web --prod
```

Vercel returns a `*.vercel.app` URL after each deploy. The `--prod` deploy
becomes the production URL aliased to your project.

### Custom domain: `hire.renlab.ai`

In Vercel dashboard → **hireic** project → Settings → Domains:

1. Add `hire.renlab.ai`
2. Vercel shows you the required DNS record. Two cases:

**Case A — `renlab.ai` DNS is at Vercel.** Vercel auto-creates the record.

**Case B — `renlab.ai` DNS is elsewhere (Cloudflare / GoDaddy / namecheap / aliyun).** Add this record at your DNS provider:

| Type    | Name | Value                       | TTL |
| ------- | ---- | --------------------------- | --- |
| `CNAME` | hire | `cname.vercel-dns.com`      | 600 |

Or, if your DNS doesn't support CNAME on subdomains for some reason:

| Type    | Name | Value          | TTL |
| ------- | ---- | -------------- | --- |
| `A`     | hire | `76.76.21.21`  | 600 |

Wait 5-30 min for propagation. Vercel auto-issues a Let's Encrypt cert once
DNS resolves correctly.

### Verify

```bash
dig hire.renlab.ai CNAME +short    # should resolve to cname.vercel-dns.com
curl -sI https://hire.renlab.ai    # 200 OK
```

## Update flow

```bash
# Edit web/index.html, then:
npx vercel --cwd web --prod
```

That's it. No CI needed for a single static file. (If you want
auto-deploy on push to main, add a Vercel git integration via the
dashboard — but that's optional.)
