#!/bin/bash
# GIT_ASKPASS helper — prints GITHUB_TOKEN for git auth prompts
# 
# Git calls this as: git-askpass.sh "Username for 'https://github.com'"
# The first argument is the prompt string. Return the answer on stdout.
#
# This is more reliable than credential.helper in non-interactive contexts
# (cron jobs, `bash -c`, `infisical run`) because it doesn't need stdin.
#
# Usage:
#   export GIT_ASKPASS=/path/to/git-askpass.sh
#   git push origin main   # reads GITHUB_TOKEN from env automatically
#
# Requires: GITHUB_TOKEN environment variable

if echo "$1" | grep -qi "password\|token"; then
    echo "$GITHUB_TOKEN"
else
    echo "token"
fi
