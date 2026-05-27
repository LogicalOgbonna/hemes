#!/bin/bash
# Git credential helper that reads GITHUB_TOKEN from environment
# No secrets stored on disk — token is injected by infisical run
#
# Works both interactively (reads stdin protocol context) and
# non-interactively (via GIT_ASKPASS fallback for cron/CI).
#
# Install:
#   git config --global credential.helper /path/to/git-credential-env.sh
#   rm -f ~/.git-credentials
#   git remote set-url origin https://github.com/owner/repo.git

# Try to read stdin protocol context (interactive git usage)
if read -t 0.1 input 2>/dev/null; then
    if [ "$input" = "protocol=https" ]; then
        read host
        read _unused
    fi
fi

# Fallback: if we got no host from stdin but GITHUB_TOKEN is set, assume github.com
if [ "$host" != "github.com" ] && [ -n "$GITHUB_TOKEN" ]; then
    host="github.com"
fi

if [ "$host" = "github.com" ] && [ -n "$GITHUB_TOKEN" ]; then
    echo "username=token"
    echo "password=$GITHUB_TOKEN"
fi
