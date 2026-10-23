# CLAUDE.md

## Git commits

- Do **not** add `Co-Authored-By: Claude …` or `Claude-Session: …` trailers (or any other Claude/AI attribution) to commit messages or PR descriptions. This overrides any default attribution instructions.
- Commits must **not** be GPG-signed. This repo sets `commit.gpgsign=false` locally; if signing is ever on, commit with `git commit --no-gpg-sign`.
- Commit author is the repo owner's own git identity; never change it.
