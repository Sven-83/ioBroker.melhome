# Security Policy

## Supported versions

Security fixes are made for the latest released version only. Please update before reporting.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately via GitHub:
[Report a vulnerability](https://github.com/Sven-83/ioBroker.melhome/security/advisories/new)
(repository tab *Security* → *Report a vulnerability*).

Please include:

- the adapter version and your js-controller and Node.js versions
- what an attacker can do and how to reproduce it
- logs only after removing e-mail addresses, passwords, tokens and device IDs

## What happens next

- You get a first answer within 14 days.
- Once the problem is confirmed, a fix is prepared in a private security advisory and released as soon as possible.
- You are credited in the advisory and the changelog unless you prefer otherwise.

## Scope

In scope: this adapter, including the bundled dashboard in `www/`.

Out of scope: the MELCloud Home cloud service and apps (please contact Mitsubishi Electric), the ioBroker
js-controller, admin and web adapters (please report to the ioBroker project), and setups where the web
adapter that serves the dashboard is reachable without authentication (see *Security* in the README).
