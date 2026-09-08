# Security model

Ghostwriter never asks for or stores an Instagram password. Publishing uses a user-supplied API access token in the process environment.

- Keep `.env` outside version control.
- Use appropriately rotated credentials where the platform permits.
- Put the dashboard behind authentication or reverse-proxy access control before exposing it to the public internet.
- Treat generated media URLs as potentially sensitive until published.
- Do not log access tokens or provider secrets.
- Prefer official platform APIs over browser automation.
